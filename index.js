const {
  app, BrowserWindow, ipcMain, Menu, dialog, shell, session, globalShortcut,
} = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const { is } = require('electron-util');
const unhandled = require('electron-unhandled');
const debug = require('electron-debug');
const contextMenu = require('electron-context-menu');
const { download } = require('electron-dl');
const serve = require('electron-serve');

const Bugsnag = require('@bugsnag/js');

const values = require('lodash/values');
const pickBy = require('lodash/pickBy');
const omitBy = require('lodash/omitBy');

const menu = require('./menu');
const { setupFlashPlayer } = require('./flash-player');
const { __, changeLocale } = require('./i18n/i18n');

Bugsnag.start({ apiKey: 'fb0c50f4d245a45f54e68ac8161273a7' });

unhandled({
  reportButton: (error) => {
    Bugsnag.notify(error);
  },
});
debug();
contextMenu();
setupFlashPlayer();

const PANDASUITE_HOST = is.development ? 'dev.pandasuite.com' : 'pandasuite.com';
const PANDASUITE_AUTHORING_PATH = is.development ? 'dashboard/authoring' : 'authoring';
const PANDASTUDIO_SCHEME = 'pandastudio';
const PDFJS_SCHEME = 'pdf';

// Note: Must match `build.appId` in package.json
app.setAppUserModelId('com.pandasuite.studio');

if (!is.development) {
  const FOUR_HOURS = 1000 * 60 * 60 * 4;
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => { });
  }, FOUR_HOURS);

  autoUpdater.checkForUpdates().catch(() => {});
}

let publicationsWindow = {};
let focusedWindow = null;
let deeplinkingUrl;

function schemeToUrl(url) {
  return (
    url
    && url.indexOf('://')
    && url.substring(url.indexOf('://') + 3).replace(/(https?)\/\//, '$1://')
  );
}

function resumePublicationWindow(win) {
  if (win.isMinimized()) {
    win.restore();
  }
  win.show();
  win.focus();
}

function removePublicationWindow(win) {
  publicationsWindow = omitBy(publicationsWindow, (v) => v === win);
}

function getPublicationWindowByUrl(url) {
  return values(pickBy(publicationsWindow, (v, k) => (k === url)))[0];
}

const studioOnMenuItemUpdate = (item) => {
  const currentWindow = BrowserWindow.getFocusedWindow();

  if (currentWindow && currentWindow.webContents) {
    currentWindow.webContents.executeJavaScript(`window.studioOnMenuItemUpdate && window.studioOnMenuItemUpdate(${JSON.stringify(item)});`, true);
  }
};

const createPublicationWindow = async (url = `https://${PANDASUITE_HOST}/${PANDASUITE_AUTHORING_PATH}/latest`) => {
  const win = new BrowserWindow({
    title: app.getName(),
    show: false,
    width: 1280,
    height: 800,
    frame: !is.macos,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, './preload.js'),
      webviewTag: true,
      plugins: true,
      webSecurity: false, // For PDF scheme, because of a CORS error :-(
      backgroundThrottling: false,
    },
  });

  ipcMain.on('triggerFineUploaderLinux', (event, data) => {
    const currentWindow = focusedWindow || BrowserWindow.getFocusedWindow() || win;

    if (data && data.id && currentWindow.webContents) {
      if (process.platform === 'linux') {
        currentWindow.blur();
      }
      currentWindow.webContents.executeJavaScript(`document.querySelector('#${data.id} input') && document.querySelector('#${data.id} input').click();`, true);
    }
  });

  ipcMain.on('updateMenuItem', (event, data) => {
    if (data && data.id) {
      const applicationMenu = Menu.getApplicationMenu();

      if (applicationMenu) {
        const menuItem = applicationMenu.getMenuItemById(data.id);

        if (menuItem) {
          if (data.enabled !== undefined) {
            menuItem.enabled = data.enabled;
          }
        }
        if (data.click) {
          if (data.id === 'zoom') {
            try {
              if (win.isMaximized()) {
                win.unmaximize();
              } else {
                win.maximize();
              }
            } catch (e) {
              // Object has been destroyed
            }
          } else if (data.id === 'new_window') {
            (async () => {
              const newWin = await createPublicationWindow();
              publicationsWindow[newWin.webContents.getURL()] = newWin;
            })();
          } else if (data.id === 'close') {
            win.close();
          } else {
            studioOnMenuItemUpdate(data);
          }
        }
      }
    }
  });

  ipcMain.on('updateLanguage', (event, data) => {
    if (data && data.language) {
      if (changeLocale(data.language)) {
        // eslint-disable-next-line no-use-before-define
        createMenu();
      }
    }
  });

  win.on('page-title-updated', (event, title) => {
    if (title === '') {
      event.preventDefault();
      win.setTitle(app.getName());
    }
    removePublicationWindow(win);
    const currentUrl = win.webContents.getURL();
    if (publicationsWindow[currentUrl]) {
      win.destroy();
      resumePublicationWindow(publicationsWindow[currentUrl]);
    } else {
      publicationsWindow[currentUrl] = win;
    }
  });

  win.on('focus', () => {
    focusedWindow = win;
  });

  win.on('ready-to-show', () => {
    win.show();
  });

  win.on('closed', () => {
    removePublicationWindow(win);
  });

  // https://www.chromestatus.com/feature/5082396709879808
  win.webContents.on('will-prevent-unload', async (event) => {
    const destroyWindow = () => {
      event.preventDefault();
      win.destroy();
    };

    const result = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: [__('Leave'), __('Cancel')],
      title: __('Do you want to close your project?'),
      message: __('Changes you made may not be saved.'),
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) {
      destroyWindow();
    }
  });

  const handleRedirect = async (e, newUrl) => {
    if (newUrl.indexOf(`/${PANDASUITE_AUTHORING_PATH}/`) !== -1
      && !newUrl.startsWith(PANDASTUDIO_SCHEME)) {
      return;
    }
    if (newUrl.indexOf('get_aws_url_for') !== -1) {
      e.preventDefault();
      download(win, newUrl).then((downloadItem) => {
        const filename = downloadItem.getSavePath();
        shell.showItemInFolder(filename);
      }).catch(() => {
      });
      return;
    }

    e.preventDefault();
    shell.openExternal(newUrl);
  };

  win.webContents.on('will-navigate', handleRedirect);
  win.webContents.on('new-window', handleRedirect);

  win.webContents.on('did-navigate-in-page', async (event, newUrl) => {
    if (newUrl.indexOf(`/${PANDASUITE_AUTHORING_PATH}/loggedout`) !== -1) {
      shell.moveItemToTrash(app.getPath('userData'));
      app.relaunch();
      app.exit(0);
    }
  });

  // Support PDF via
  // https://github.com/sindresorhus/electron-serve

  const REQUEST_FILTER = {
    urls: ['*://*/*.pdf*'],
  };

  win.webContents.session.webRequest.onBeforeRequest(
    REQUEST_FILTER,
    (details, callback) => {
      if (/\.pdf(\?([^/]+)?)?$/i.test(details.url)
        && !(details.referrer === '' && details.resourceType === 'xhr')) {
        const matches = details.url.match(
          RegExp(/([^:]+:\/\/)([^/]+)(\/[^/]+\/[^?]+)/),
        );
        if (matches) {
          return callback({
            redirectURL:
              `${PDFJS_SCHEME}://-/web/viewer.html?toolbar=0&statusbar=0&navpanes=0&messages=0&file=${matches[1]}${matches[2]}${matches[3]}`,
          });
        }
      }
      return callback({ cancel: false });
    },
  );

  await win.loadURL(url).catch(() => { });
  return win;
};

// Prevent multiple instances of the app
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const openDeepLinkingUrl = async (url) => {
  if (url) {
    const firstWindow = publicationsWindow && values(publicationsWindow)[0];
    if (url.startsWith('__') && firstWindow) {
      const deeplinkingParts = url.split('/');
      const cmd = `window.${deeplinkingParts[0]} && window.${deeplinkingParts[0]}("${deeplinkingParts.slice(1).join('", "')}");`;
      firstWindow.webContents.executeJavaScript(cmd, true);
      resumePublicationWindow(firstWindow);
    } else if (url.indexOf(PANDASUITE_HOST) !== -1) {
      const existingWin = getPublicationWindowByUrl(url);

      if (existingWin) {
        resumePublicationWindow(existingWin);
      } else if (app.isReady()) {
        const win = await createPublicationWindow(url);
        publicationsWindow[url] = win;
      }
    }
  }
};

app.on('second-instance', async (event, argv) => {
  if (process.platform !== 'darwin') {
    deeplinkingUrl = schemeToUrl(argv[argv.length - 1]);
    openDeepLinkingUrl(deeplinkingUrl);
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', async (event, hasVisibleWindows) => {
  if (is.macos) {
    if (!hasVisibleWindows) {
      const win = focusedWindow || values(publicationsWindow)[0];
      if (win) {
        win.show();
      }
    }
  }
});

app.setAsDefaultProtocolClient(PANDASTUDIO_SCHEME);

// Protocol handler for osx
app.on('open-url', async (event, url) => {
  event.preventDefault();
  deeplinkingUrl = schemeToUrl(url);
  openDeepLinkingUrl(deeplinkingUrl);
});

serve({
  directory: path.join(
    __dirname.includes('.asar') ? process.resourcesPath : __dirname,
    'static', 'pdfjs',
  ),
  scheme: PDFJS_SCHEME,
});

const createMenu = () => {
  Menu.setApplicationMenu(
    menu({
      newWindow: async function newWindow() {
        const win = await createPublicationWindow();
        publicationsWindow[win.webContents.getURL()] = win;
      },
      studioOnMenuItemUpdate,
    }),
  );

  if (is.macos) {
    app.dock.setMenu(
      Menu.buildFromTemplate([
        {
          label: __('menu.new_window'),
          click: async function newWindow() {
            const win = await createPublicationWindow();
            publicationsWindow[win.webContents.getURL()] = win;
          },
        },
      ]),
    );
  }
};

(async () => {
  await app.whenReady();

  // https://github.com/electron/electron/issues/9995
  const { cookies } = session.defaultSession;
  cookies.on('changed', (event, cookie, cause, removed) => {
    if (cookie.domain.indexOf(PANDASUITE_HOST) !== -1 && cookie.session && !removed) {
      const url = `${cookie.secure ? 'https' : 'http'}://${cookie.domain}${cookie.path}`;
      cookies.set({
        url,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        expirationDate: Math.floor(new Date().getTime() / 1000) + 1209600,
      }).catch(() => { });
    }
  });

  if (process.platform !== 'darwin') {
    deeplinkingUrl = schemeToUrl(process.argv[1]);
  }

  createMenu();

  const win = await createPublicationWindow(deeplinkingUrl);
  publicationsWindow[win.webContents.getURL()] = win;

  const shortcut = process.platform === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I';
  globalShortcut.register(shortcut, () => {
    win.openDevTools({ mode: 'undocked' });
  });
})();
