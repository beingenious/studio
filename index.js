const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  dialog,
  shell,
  session,
  BrowserView,
  screen,
} = require('electron');
const path = require('path');
// const { autoUpdater } = require('electron-updater');
const { is } = require('electron-util');
const unhandled = require('electron-unhandled');
const debug = require('electron-debug');
const contextMenu = require('electron-context-menu');
const { download } = require('electron-dl');
const serve = require('electron-serve');
const windowStateKeeper = require('electron-window-state');

const Bugsnag = require('@bugsnag/js');

const values = require('lodash/values');
const omitBy = require('lodash/omitBy');
const each = require('lodash/each');
const find = require('lodash/find');
const map = require('lodash/map');

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

app.commandLine.appendSwitch('auth-server-whitelist', '*.krb.gendarmerie.fr');
app.commandLine.appendSwitch('auth-negotiate-delegate-whitelist', '*.krb.gendarmerie.fr');
app.commandLine.appendSwitch('proxy-pac-url', 'http://portail.gendarmerie.fr/scripts/proxy2.js');
app.commandLine.appendSwitch('ignore-certificate-errors');

app.userAgentFallback = 'Mozilla/5.0 (X11; Linux x86_64; rv:102.0) Gecko/20100101 Firefox/102.0';

app.commandLine.appendSwitch(
  'disable-features',
  'HardwareMediaKeyHandling,MediaSessionService,CrossOriginOpenerPolicy',
);

const PANDASUITE_HOST = is.development
  ? 'dev.pandasuite.com'
  : 'pandasuite.com';
const PANDASUITE_AUTHORING_PATH = is.development
  ? 'dashboard/authoring'
  : 'authoring';

const PANDASTUDIO_SCHEME = 'pandastudio';
const PANDASTUDIO_START_URL = `https://${PANDASUITE_HOST}/dashboard/electron/tabs/`;
const PDFJS_SCHEME = 'pdf';

const ELECTRON_MENU_HEIGHT = 45;

// Note: Must match `build.appId` in package.json
app.setAppUserModelId('com.pandasuite.studio');

// if (!is.development) {
//   const FOUR_HOURS = 1000 * 60 * 60 * 4;
//   setInterval(() => {
//     autoUpdater.checkForUpdates().catch(() => {});
//   }, FOUR_HOURS);

//   autoUpdater.checkForUpdates().catch(() => {});
// }

const publicationsBrowserView = {};
const garbageBrowserView = {};
const publicationsMenuItems = {};
let focusBrowserView = null;

let publicationsWindow = {};
let focusedWindow = null;
let deeplinkingUrl;

function schemeToUrl(url) {
  return (
    url &&
    url.indexOf('://') &&
    url.substring(url.indexOf('://') + 3).replace(/(https?)\/\//, '$1://')
  );
}

function resumePublicationWindow() {
  const currentWindow =
    focusedWindow ||
    BrowserWindow.getFocusedWindow() ||
    (publicationsWindow && values(publicationsWindow)[0]);

  if (!currentWindow) {
    return;
  }

  if (currentWindow.isMinimized()) {
    currentWindow.restore();
  }
  currentWindow.show();
  currentWindow.focus();
}

function removePublicationWindow(win) {
  publicationsWindow = omitBy(publicationsWindow, (v) => v === win);
}

const executeJavaScript = (cmd, userInteraction = true) => {
  const currentWindow =
    focusedWindow ||
    BrowserWindow.getFocusedWindow() ||
    (publicationsWindow && values(publicationsWindow)[0]);

  each(publicationsBrowserView, (browserView) => {
    if (browserView.webContents) {
      browserView.webContents.executeJavaScript(cmd, userInteraction);
    }
  });

  if (currentWindow && currentWindow.webContents) {
    currentWindow.webContents.executeJavaScript(cmd, userInteraction);
  }
};

const studioOnMenuItemUpdate = (item) => {
  if (focusBrowserView && focusBrowserView.webContents) {
    focusBrowserView.webContents.executeJavaScript(
      `window.studioOnMenuItemUpdate && window.studioOnMenuItemUpdate(${JSON.stringify(
        item,
      )});`,
      true,
    );
  }
};

const studioOnSelectedTab = (item) => {
  const currentWindow = focusedWindow || BrowserWindow.getFocusedWindow();

  if (currentWindow && currentWindow.webContents) {
    currentWindow.webContents.executeJavaScript(
      `window.studioOnSelectedTab && window.studioOnSelectedTab(${JSON.stringify(
        item,
      )});`,
      true,
    );
  }
};

const studioOnRemovedTab = (item) => {
  const currentWindow = focusedWindow || BrowserWindow.getFocusedWindow();

  if (currentWindow && currentWindow.webContents) {
    currentWindow.webContents.executeJavaScript(
      `window.studioOnRemovedTab && window.studioOnRemovedTab(${JSON.stringify(
        item,
      )});`,
      true,
    );
  }
};

const studioOnUpdatedTab = (item) => {
  const currentWindow = focusedWindow || BrowserWindow.getFocusedWindow();

  if (currentWindow && currentWindow.webContents) {
    currentWindow.webContents.executeJavaScript(
      `window.studioOnUpdatedTab && window.studioOnUpdatedTab(${JSON.stringify(
        item,
      )});`,
      true,
    );
  }
};

const setDocumentEdited = (url, enabled) => {
  const currentWindow = focusedWindow || BrowserWindow.getFocusedWindow();

  if (currentWindow && currentWindow.webContents) {
    currentWindow.webContents.executeJavaScript(
      `window.setDocumentEdited && window.setDocumentEdited(${JSON.stringify({
        url,
        edited: enabled,
      })});`,
      true,
    );
  }
};

const updateMenuItem = (url, data) => {
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
        if (data.id === 'new') {
          studioOnSelectedTab({ new: true });
        } else if (data.id === 'close') {
          studioOnRemovedTab({ url });
        } else if (data.id === 'closeWindow') {
          const currentWindow =
            focusedWindow || BrowserWindow.getFocusedWindow();

          if (currentWindow) {
            currentWindow.close();
          }
        } else if (data.id === 'minimizeWindow') {
          const currentWindow =
            focusedWindow || BrowserWindow.getFocusedWindow();

          if (currentWindow) {
            currentWindow.minimize();
          }
        } else if (data.id === 'maximizeWindow') {
          const currentWindow =
            focusedWindow || BrowserWindow.getFocusedWindow();

          if (currentWindow) {
            if (currentWindow.isMaximized()) {
              currentWindow.unmaximize();
            } else {
              currentWindow.maximize();
            }
          }
        } else if (data.id === 'openDevTools') {
          if (focusBrowserView && focusBrowserView.webContents) {
            focusBrowserView.webContents.openDevTools({ mode: 'undocked' });
          }
        } else {
          studioOnMenuItemUpdate(data);
        }
      }
    }
  }
};

const updateMenuItems = (currentUrl, items) => {
  each(items, (item) => {
    if (item && item.id === 'save') {
      setDocumentEdited(currentUrl, item.enabled);
    }
    updateMenuItem(currentUrl, item);
  });
};

const removeBrowserView = (url) => {
  const currentWindow = focusedWindow || BrowserWindow.getFocusedWindow();
  const view = publicationsBrowserView[url];

  if (view) {
    currentWindow.removeBrowserView(view);
    garbageBrowserView[url] = view;
    delete publicationsBrowserView[url];
  }
  delete publicationsMenuItems[url];
};

const updateExistingMenuItems = (url) => {
  const menuItems = publicationsMenuItems[url];

  if (menuItems) {
    updateMenuItems(url, menuItems);
  } else {
    const firstMenuItem = find(publicationsMenuItems, (item) => item);

    if (firstMenuItem) {
      updateMenuItems(
        url,
        map(firstMenuItem, (item) => ({ ...item, enabled: false })),
      );
    }
  }
};

const createOrSelectBrowserView = ({ url }, win) => {
  const currentWindow =
    focusedWindow || BrowserWindow.getFocusedWindow() || win;
  const contentBounds = currentWindow.getContentBounds();

  let view = publicationsBrowserView[url];
  if (!view) {
    view = new BrowserView({
      webPreferences: {
        preload: path.join(__dirname, './preload.js'),
        webviewTag: true,
        plugins: true,
        webSecurity: false, // For PDF scheme, because of a CORS error :-(
        backgroundThrottling: false,
        allowRendererProcessReuse: true,
        contextIsolation: false,
      },
    });

    view.setBackgroundColor('#fff');
    publicationsBrowserView[url] = view;
    currentWindow.addBrowserView(view);

    view.webContents.loadURL(url);
    if (is.development) {
      view.webContents.openDevTools({ mode: 'undocked' });
    }

    view.webContents.on('will-prevent-unload', async (event) => {
      const result = await dialog.showMessageBox(currentWindow, {
        type: 'question',
        buttons: [__('Leave'), __('Cancel')],
        title: __('Are you sure you want to close this project?'),
        message: __('Unsaved changes will be discarded.'),
        defaultId: 0,
        cancelId: 1,
      });
      if (result.response === 0) {
        event.preventDefault();
        removeBrowserView(url);
      }
    });

    const handleRedirect = async (e, newUrl) => {
      if (
        newUrl.indexOf(`/${PANDASUITE_AUTHORING_PATH}/`) !== -1 &&
        !newUrl.startsWith(PANDASTUDIO_SCHEME)
      ) {
        return;
      }
      if (newUrl.indexOf('get_aws_url_for') !== -1) {
        e.preventDefault();
        download(currentWindow, newUrl)
          .then((downloadItem) => {
            const filename = downloadItem.getSavePath();
            shell.showItemInFolder(filename);
          })
          .catch(() => {});
        return;
      }

      e.preventDefault();
      shell.openExternal(newUrl);
    };

    view.webContents.on('will-navigate', handleRedirect);
    view.webContents.on('new-window', handleRedirect);

    view.webContents.on('did-navigate-in-page', async (event, newUrl) => {
      if (newUrl.indexOf(`/${PANDASUITE_AUTHORING_PATH}/loggedout`) !== -1) {
        shell.moveItemToTrash(app.getPath('userData'));
        app.relaunch();
        app.exit(0);
      }
    });

    view.setAutoResize({ width: true, height: true });
    view.setBounds({
      x: 0,
      y: ELECTRON_MENU_HEIGHT,
      width: contentBounds.width,
      height: contentBounds.height - ELECTRON_MENU_HEIGHT,
    });
  }

  // if (focusBrowserView && focusBrowserView !== view) {
  //   currentWindow.removeBrowserView(focusBrowserView);
  // }
  // currentWindow.addBrowserView(view);

  focusBrowserView = view;
  currentWindow.setTopBrowserView(view);

  view.webContents.focus();
  view.webContents.executeJavaScript(
    'var e=document.getElementById("studio-drag-fix");e&&e.parentNode.removeChild(e),setTimeout(()=>{var e=document.createElement("div");e.id="studio-drag-fix",e.style.position="fixed",e.style.webkitAppRegion="no-drag",e.style.pointerEvents="none",document.body.appendChild(e)},500);',
    true,
  );

  each(garbageBrowserView, (v, k) => {
    v.webContents.destroy();
    delete garbageBrowserView[k];
  });

  updateExistingMenuItems(url);
};

const openDeepLinkingUrl = async (url) => {
  if (url) {
    if (url.startsWith('__')) {
      const deeplinkingParts = url.split('/');
      executeJavaScript(
        `window.${deeplinkingParts[0]} && window.${
          deeplinkingParts[0]
        }("${deeplinkingParts.slice(1).join('", "')}");`,
      );
      resumePublicationWindow();
    } else if (url.indexOf(PANDASUITE_HOST) !== -1) {
      resumePublicationWindow();
      studioOnSelectedTab({ url });
    }
  }
};

const createPublicationWindow = async (url = null) => {
  const { bounds } = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint(),
  );
  const defaultWidth = Math.floor(bounds.width * 0.8);
  const defaultHeight = Math.floor(bounds.height * 0.9);

  const mainWindowState = windowStateKeeper({
    defaultWidth,
    defaultHeight,
  });

  const win = new BrowserWindow({
    title: app.getName(),
    icon: is.linux ? path.join(__dirname, 'static', 'Icon.png') : undefined,
    show: false,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, './preload.js'),
      webviewTag: true,
      plugins: true,
      webSecurity: false, // For PDF scheme, because of a CORS error :-(
      backgroundThrottling: false,
      allowRendererProcessReuse: true,
      contextIsolation: false,
    },
  });

  if (is.development) {
    win.openDevTools({ mode: 'undocked' });
  }

  mainWindowState.manage(win);

  ipcMain.on('createOrSelectTab', (event, data) => {
    createOrSelectBrowserView(data, win);
  });

  ipcMain.on('updateTab', (event, { url: tabUrl, label, fromUrl }) => {
    if (fromUrl !== tabUrl) {
      const menuItems = publicationsMenuItems[fromUrl];

      if (menuItems) {
        publicationsMenuItems[tabUrl] = menuItems;
        delete publicationsMenuItems[fromUrl];
      }

      const view = publicationsBrowserView[fromUrl];
      if (view) {
        publicationsBrowserView[tabUrl] = view;
        delete publicationsBrowserView[fromUrl];
      }
    }
    studioOnUpdatedTab({
      fromUrl,
      label,
      url: tabUrl,
    });
  });

  ipcMain.on('removeTab', (event, { url: tabUrl }) => {
    removeBrowserView(tabUrl);
  });

  ipcMain.on('navigateToHomeTab', (event, { url: tabUrl, homeTabBaseUrl }) => {
    const homeBrowserView = publicationsBrowserView[homeTabBaseUrl];

    if (homeBrowserView) {
      resumePublicationWindow();
      studioOnSelectedTab({ url: homeTabBaseUrl });

      if (homeBrowserView && homeBrowserView.webContents) {
        homeBrowserView.webContents.executeJavaScript(
          `window.pushURLFromElectron && window.pushURLFromElectron(${JSON.stringify(
            tabUrl,
          )});`,
          true,
        );
      }
    }
  });

  ipcMain.on('triggerFineUploaderLinux', (event, data) => {
    const currentWindow =
      focusedWindow || BrowserWindow.getFocusedWindow() || win;

    if (data && data.id && currentWindow.webContents) {
      if (process.platform === 'linux') {
        currentWindow.blur();
      }
      if (focusBrowserView && focusBrowserView.webContents) {
        focusBrowserView.webContents.executeJavaScript(
          `document.querySelector('#${data.id} input') && document.querySelector('#${data.id} input').click();`,
          true,
        );
      }
    }
  });

  ipcMain.on('updateMenuItems', (event, items) => {
    const currentUrl = event.sender.getURL();

    publicationsMenuItems[currentUrl] = items;

    if (
      focusBrowserView &&
      focusBrowserView.webContents.getURL() === currentUrl
    ) {
      updateMenuItems(currentUrl, items);
    }
  });

  ipcMain.on('updateMenuItem', (event, data) => {
    const currentUrl = event.sender.getURL();

    updateMenuItem(currentUrl, data);
  });

  ipcMain.on('updateLanguage', (event, data) => {
    if (data && data.language) {
      if (changeLocale(data.language)) {
        // eslint-disable-next-line no-use-before-define
        createMenu();
        executeJavaScript(
          `window.dashboardUpdateLanguage && window.dashboardUpdateLanguage("${data.language}");`,
        );
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
      resumePublicationWindow();
    } else {
      publicationsWindow[currentUrl] = win;
    }
  });

  win.on('focus', () => {
    focusedWindow = win;
    if (focusBrowserView) {
      focusBrowserView.webContents.focus();
    }
  });

  win.on('ready-to-show', () => {
    win.show();
  });

  win.on('closed', () => {
    removePublicationWindow(win);
  });

  win.webContents.on('dom-ready', () => {
    if (url) {
      openDeepLinkingUrl(url);
    }
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
      title: __('Are you sure you want to close this project?'),
      message: __('Unsaved changes will be discarded.'),
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) {
      destroyWindow();
    }
  });

  const handleRedirect = async (e, newUrl) => {
    if (
      newUrl.indexOf(`/${PANDASUITE_AUTHORING_PATH}/`) !== -1 &&
      !newUrl.startsWith(PANDASTUDIO_SCHEME)
    ) {
      return;
    }
    if (newUrl.indexOf('get_aws_url_for') !== -1) {
      e.preventDefault();
      download(win, newUrl)
        .then((downloadItem) => {
          const filename = downloadItem.getSavePath();
          shell.showItemInFolder(filename);
        })
        .catch(() => {});
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
      if (
        /\.pdf(\?([^/]+)?)?$/i.test(details.url) &&
        !(details.referrer === '' && details.resourceType === 'xhr') &&
        details.url.indexOf('no_redirect') === -1
      ) {
        const matches = details.url.match(
          RegExp(/([^:]+:\/\/)([^/]+)(\/[^/]+\/[^?]+)/),
        );
        if (matches) {
          return callback({
            redirectURL: `${PDFJS_SCHEME}://-/web/viewer.html?toolbar=0&statusbar=0&navpanes=0&messages=0&file=${matches[1]}${matches[2]}${matches[3]}`,
          });
        }
      }
      return callback({ cancel: false });
    },
  );

  await win.loadURL(PANDASTUDIO_START_URL).catch(() => {});
  return win;
};

// Prevent multiple instances of the app
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

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
      const currentWindow =
        focusedWindow ||
        BrowserWindow.getFocusedWindow() ||
        (publicationsWindow && values(publicationsWindow)[0]);

      if (currentWindow) {
        currentWindow.show();
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
    'static',
    'pdfjs',
  ),
  scheme: PDFJS_SCHEME,
});

const createMenu = () => {
  Menu.setApplicationMenu(
    menu({
      newWindow: () => {
        studioOnSelectedTab({ new: true });
      },
      closeWindow: () => {
        if (focusBrowserView && focusBrowserView.webContents) {
          const focusUrl = focusBrowserView.webContents.getURL();

          if (focusUrl.indexOf(`/${PANDASUITE_AUTHORING_PATH}/`) !== -1) {
            return studioOnRemovedTab({ url: focusUrl });
          }
        }
        const win = focusedWindow || values(publicationsWindow)[0];

        if (win) {
          win.close();
        }
        return false;
      },
      studioOnMenuItemUpdate,
    }),
  );
};

(async () => {
  await app.whenReady();

  // https://github.com/electron/electron/issues/9995
  const { cookies } = session.defaultSession;
  cookies.on('changed', (event, cookie, cause, removed) => {
    if (
      cookie.domain.indexOf(PANDASUITE_HOST) !== -1 &&
      cookie.session &&
      !removed
    ) {
      const url = `${cookie.secure ? 'https' : 'http'}://${cookie.domain}${
        cookie.path
      }`;
      cookies
        .set({
          url,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          expirationDate: Math.floor(new Date().getTime() / 1000) + 1209600,
        })
        .catch(() => {});
    }
  });

  if (process.platform !== 'darwin') {
    deeplinkingUrl = schemeToUrl(process.argv[1]);
  }

  createMenu();

  const win = await createPublicationWindow(deeplinkingUrl);
  publicationsWindow[win.webContents.getURL()] = win;
})();
