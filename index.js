const {
  app, BrowserWindow, Menu, dialog, shell, session, globalShortcut,
} = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const { is } = require('electron-util');
const unhandled = require('electron-unhandled');
const debug = require('electron-debug');
const contextMenu = require('electron-context-menu');
const { download } = require('electron-dl');
const serve = require('electron-serve');

const values = require('lodash/values');
const pickBy = require('lodash/pickBy');
const omitBy = require('lodash/omitBy');

const menu = require('./menu');
const { setupFlashPlayer } = require('./flash-player.js');
const { __ } = require('./i18n/i18n');

unhandled();
debug();
contextMenu();
setupFlashPlayer();

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

const createPublicationWindow = async (url = 'https://pandasuite.com/authoring/latest/') => {
  const win = new BrowserWindow({
    title: app.getName(),
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      webviewTag: true,
      plugins: true,
      webSecurity: false, // For PDF scheme, because of a CORS error :-(
    },
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
    const result = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: [__('Leave'), __('Cancel')],
      title: __('Do you want to close your project?'),
      message: __('Changes you made may not be saved.'),
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) {
      event.preventDefault();
      win.destroy();
    }
  });

  const handleRedirect = (e, newUrl) => {
    if (newUrl.indexOf('/authoring/') !== -1) {
      return;
    }
    if (newUrl.indexOf('get_aws_url_for') !== -1) {
      e.preventDefault();
      download(win, newUrl);
      return;
    }

    e.preventDefault();
    shell.openExternal(newUrl);
  };

  win.webContents.on('will-navigate', handleRedirect);
  win.webContents.on('new-window', handleRedirect);


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

app.on('second-instance', async (event, argv) => {
  let win = focusedWindow || values(publicationsWindow)[0];

  if (process.platform === 'win32') {
    deeplinkingUrl = schemeToUrl(argv[argv.length - 1]);
    if (deeplinkingUrl) {
      const existingWin = getPublicationWindowByUrl(deeplinkingUrl);
      if (existingWin) {
        win = existingWin;
      } else {
        win = await createPublicationWindow(deeplinkingUrl);
        publicationsWindow[deeplinkingUrl] = win;
        return;
      }
    }
  }

  if (win) {
    resumePublicationWindow(win);
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

app.setAsDefaultProtocolClient('pandastudio');

// Protocol handler for osx
app.on('open-url', async (event, url) => {
  event.preventDefault();
  deeplinkingUrl = schemeToUrl(url);

  if (deeplinkingUrl) {
    const existingWin = getPublicationWindowByUrl(deeplinkingUrl);
    if (existingWin) {
      resumePublicationWindow(existingWin);
    } else if (app.isReady()) {
      const win = await createPublicationWindow(deeplinkingUrl);
      publicationsWindow[deeplinkingUrl] = win;
    }
  }
});

serve({
  directory: path.join(
    __dirname.includes('.asar') ? process.resourcesPath : __dirname,
    'static', 'pdfjs',
  ),
  scheme: PDFJS_SCHEME,
});

(async () => {
  await app.whenReady();

  // https://github.com/electron/electron/issues/9995
  const { cookies } = session.defaultSession;
  cookies.on('changed', (event, cookie, cause, removed) => {
    if (cookie.domain.indexOf('pandasuite.com') !== -1 && cookie.session && !removed) {
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

  if (process.platform === 'win32') {
    deeplinkingUrl = schemeToUrl(process.argv[1]);
  }

  Menu.setApplicationMenu(
    menu({
      newWindow: async function newWindow() {
        const win = await createPublicationWindow(deeplinkingUrl);
        publicationsWindow[win.webContents.getURL()] = win;
      },
    }),
  );

  if (is.macos) {
    app.dock.setMenu(
      Menu.buildFromTemplate([
        {
          label: __('New Window'),
          click: async function newWindow() {
            const win = await createPublicationWindow(deeplinkingUrl);
            publicationsWindow[win.webContents.getURL()] = win;
          },
        },
      ]),
    );
  }

  const win = await createPublicationWindow(deeplinkingUrl);
  publicationsWindow[win.webContents.getURL()] = win;

  const shortcut = process.platform === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I';
  globalShortcut.register(shortcut, () => {
    win.openDevTools({ mode: 'undocked' });
  });
})();
