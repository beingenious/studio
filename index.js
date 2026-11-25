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
  powerMonitor,
  nativeTheme,
  clipboard,
  webContents,
} = require('electron');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { is } = require('electron-util');
const unhandled = require('electron-unhandled');
const debug = require('electron-debug');
const contextMenu = require('electron-context-menu');
const serve = require('electron-serve');
const windowStateKeeper = require('electron-window-state');

const values = require('lodash/values');
const omitBy = require('lodash/omitBy');
const each = require('lodash/each');
const find = require('lodash/find');
const map = require('lodash/map');

const menu = require('./menu');
const attachHomeRecovery = require('./home-recovery');
const attachWindowLayout = require('./window-layout');
const attachMacTitlebar = require('./macos-titlebar');
const createHomeRecoveryLog = require('./home-recovery-log');
const { setupFlashPlayer } = require('./flash-player');
const { __, changeLocale, translateFor } = require('./i18n/i18n');
const config = require('./config');
const errorReporting = require('./error-reporting');
const moveToApplications = require('./move-to-applications');
const loadStartPage = require('./connection-recovery');
const downloadFile = require('./download-file');
const createErrorWarning = require('./error-warning');

// Gendarmerie build: errors are not reported.
errorReporting.start({ enabled: false });

// Until the dashboard sets the language, the system's applies.
let dashboardLanguage = false;
// An unexpected error leaves Studio running: say so in plain words, details on request.
unhandled(is.development ? {} : {
  showDialog: false,
  logger: createErrorWarning({
    whenReady: () => app.whenReady(),
    nextFocusedWindow: () => new Promise((resolve) => app.once('browser-window-focus', resolve)),
    BrowserWindow,
    showMessageBox: (parent, options) => dialog.showMessageBox(parent, options),
    translate: () => (dashboardLanguage ? __ : translateFor(app.getLocale())),
    writeClipboard: (text) => clipboard.writeText(text),
    home: app.getPath('home'),
    log: console.error, // eslint-disable-line no-console
  }),
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
const PANDASTUDIO_HOME_URL = `https://${PANDASUITE_HOST}/dashboard/`;
const PDFJS_SCHEME = 'pdf';

const ELECTRON_MENU_HEIGHT = 45;

// Note: Must match `build.appId` in package.json
app.setAppUserModelId('com.pandasuite.studio');

// Gendarmerie build: no automatic update, the package comes from the GendBuntu repository.

const publicationsBrowserView = {};
const garbageBrowserView = {};
const publicationsMenuItems = {};
let focusBrowserView = null;
let focusedWindow = null;
const homeRecovery = new WeakMap();
const homeSenders = new WeakMap();
const viewWindows = new WeakMap();
let homeLog;
const logHome = (event, data) => {
  if (!homeLog) {
    homeLog = createHomeRecoveryLog({
      file: path.join(app.getPath('userData'), 'logs', 'home-recovery.log'),
      versions: {
        app: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
      },
    });
  }
  homeLog(event, data);
};
// The recovery of the selected tab of the focused window, Home or a project.
const selectedController = () => {
  if (!focusBrowserView || focusBrowserView.webContents.isDestroyed()) return null;
  const win = viewWindows.get(focusBrowserView);
  if (!win || win.isDestroyed() || win !== focusedWindow) return null;
  return homeRecovery.get(focusBrowserView);
};
// Home is the one view whose page reports its errors.
const selectedHome = () => (
  focusBrowserView && homeSenders.has(focusBrowserView.webContents) ? selectedController() : null
);
// Ending a stuck renderer would also end whatever else lives in its process.
const sharesProcess = (contents) => {
  const id = contents.getOSProcessId();
  return webContents.getAllWebContents().some((other) => other !== contents
    && !other.isDestroyed() && other.getOSProcessId() === id);
};
const updateHomeMenu = () => {
  const applicationMenu = Menu.getApplicationMenu();
  const item = applicationMenu && applicationMenu.getMenuItemById('reloadHome');
  if (item) item.enabled = !!selectedHome();
};
ipcMain.on('homeRenderError', (event, data) => {
  const controller = homeSenders.get(event.sender);
  if (controller) controller.reportReactError(event.sender, data);
});

let publicationsWindow = {};
let deeplinkingUrl;

ipcMain.on('updateNativeTheme', (event, data) => {
  if (!data || !['auto', 'light', 'dark'].includes(data.theme)) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.webContents !== event.sender ||
      event.sender.getURL() !== PANDASTUDIO_START_URL) return;
  nativeTheme.themeSource = data.theme === 'auto' ? 'system' : data.theme;
});

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
  if (data && data.id === 'reloadHome') return;
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
    const controller = homeRecovery.get(view);
    if (controller) {
      controller.dispose();
      homeRecovery.delete(view);
      homeSenders.delete(view.webContents);
    }
    if (focusBrowserView === view) focusBrowserView = null;
    updateHomeMenu();
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

const startDownload = (win, url) => downloadFile({
  win,
  url,
  directory: app.getPath('downloads'),
  showMessageBox: (parent, options) => dialog.showMessageBox(parent, options),
  showItemInFolder: (file) => shell.showItemInFolder(file),
  // The Dock bounces its Downloads stack on macOS.
  downloadFinished: (file) => app.dock && app.dock.downloadFinished(file),
  translate: __,
  fs,
});

// What a project tab says when it fails: a crash already lost what was not saved, a failed load
// has nothing to lose, a stuck page may lose it on reload, so waiting is the default.
const projectTexts = (kind, { canReload }) => {
  if (kind === 'hang' && !canReload) {
    return {
      message: __('projectRecovery.hangMessage'),
      detail: __('projectRecovery.hangRestartDetail'),
      buttons: [__('projectRecovery.ok')],
      defaultId: 0,
      reload: false,
    };
  }
  if (kind === 'hang') {
    return {
      message: __('projectRecovery.hangMessage'),
      detail: __('projectRecovery.hangDetail'),
      buttons: [__('Reload'), __('projectRecovery.wait')],
      defaultId: 1,
      reload: true,
    };
  }
  return {
    message: __(`projectRecovery.${kind}Message`),
    detail: __(`projectRecovery.${kind}Detail`),
    buttons: [__('Reload'), __('Cancel')],
    defaultId: 0,
    reload: true,
  };
};

const createOrSelectBrowserView = ({ url, home }, win) => {
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

    viewWindows.set(view, currentWindow);
    if (home === true && url === PANDASTUDIO_HOME_URL) {
      const homeView = view;
      const controller = attachHomeRecovery({
        view: homeView,
        window: currentWindow,
        isSelected: () => focusBrowserView === homeView && focusedWindow === currentWindow,
        showMessageBox: (parent, options) => dialog.showMessageBox(parent, options),
        translate: __,
        sharesProcess: () => sharesProcess(homeView.webContents),
        log: (event, data) => logHome(event, { ...data, role: 'home' }),
      });
      homeRecovery.set(homeView, controller);
      homeSenders.set(homeView.webContents, controller);
      homeView.webContents.once('destroyed', () => {
        controller.dispose();
        homeRecovery.delete(homeView);
        homeSenders.delete(homeView.webContents);
        updateHomeMenu();
      });
    } else {
      const projectView = view;
      homeRecovery.set(projectView, attachHomeRecovery({
        view: projectView,
        window: currentWindow,
        isSelected: () => focusBrowserView === projectView && focusedWindow === currentWindow,
        // Not while Studio is in the background: window focus offers it on return.
        canOffer: () => BrowserWindow.getFocusedWindow() === currentWindow,
        showMessageBox: (parent, options) => dialog.showMessageBox(parent, options),
        translate: __,
        texts: projectTexts,
        sharesProcess: () => sharesProcess(projectView.webContents),
        log: (event, data) => logHome(event, { ...data, role: 'project' }),
      }));
    }
    const loadPromise = view.webContents.loadURL(url);
    const controller = homeRecovery.get(view);
    if (controller) loadPromise.catch((error) => controller.loadRejected(error));
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
        startDownload(currentWindow, newUrl);
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
  updateHomeMenu();
  const controller = homeRecovery.get(view);
  // Home keeps its behavior: a message set aside stays so until the menu or a new failure.
  if (controller) {
    if (homeSenders.has(view.webContents)) controller.selected();
    else controller.tabSelected();
  }

  view.webContents.focus();
  if (process.platform !== 'win32') {
    const selectionScript = view.webContents.executeJavaScript(
      'var e=document.getElementById("studio-drag-fix");e&&e.parentNode.removeChild(e),setTimeout(()=>{var e=document.createElement("div");e.id="studio-drag-fix",e.style.position="fixed",e.style.webkitAppRegion="no-drag",e.style.pointerEvents="none",document.body.appendChild(e)},500);',
      true,
    );

    if (controller) {
      const role = homeSenders.has(view.webContents) ? 'home' : 'project';
      selectionScript.catch(() => logHome('selection-script-failed', { role }));
    }
  }

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
    frame: process.platform === 'win32',
    titleBarStyle: { darwin: 'hidden', win32: 'default', linux: 'hiddenInset' }[process.platform],
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 12, y: 31 } } : {}),
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

  if (process.platform === 'win32') attachWindowLayout(win, ELECTRON_MENU_HEIGHT);
  if (process.platform === 'darwin') attachMacTitlebar(win);

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
      const changed = changeLocale(data.language);
      // From now on the dashboard's language applies, changed or not.
      dashboardLanguage = true;
      if (changed) {
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
    updateHomeMenu();
    const controller = selectedController();
    if (controller) controller.selected();
    if (focusBrowserView) {
      focusBrowserView.webContents.focus();
    }
  });

  win.on('ready-to-show', () => {
    win.show();
  });

  win.on('closed', () => {
    each(publicationsBrowserView, (view, key) => {
      if (viewWindows.get(view) === win) {
        const controller = homeRecovery.get(view);
        if (controller) controller.dispose();
        homeRecovery.delete(view);
        homeSenders.delete(view.webContents);
        if (focusBrowserView === view) focusBrowserView = null;
        delete publicationsBrowserView[key];
      }
    });
    if (focusedWindow === win) focusedWindow = null;
    updateHomeMenu();
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
      startDownload(win, newUrl);
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

  await loadStartPage({
    win,
    url: PANDASTUDIO_START_URL,
    showMessageBox: (parent, options) => dialog.showMessageBox(parent, options),
    // The dashboard has not set the language yet: use the system's.
    translate: translateFor(app.getLocale()),
  });
  return win;
};

// Prevent multiple instances of the app
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
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
      reloadHomeEnabled: !!selectedHome(),
      reloadHome: () => {
        const controller = selectedHome();
        if (controller) controller.reload();
      },
    }),
  );
};

(async () => {
  // quit() before ready does not stop this startup: a second instance must not build windows.
  if (!gotLock) return;
  await app.whenReady();
  // A deep link would be lost by the relaunch: ask at the next normal launch instead.
  if (!deeplinkingUrl && await moveToApplications({
    app,
    dialog,
    store: config,
    translate: translateFor(app.getLocale()),
    fs,
    execFile: promisify(execFile),
    report: errorReporting.captureException,
  })) return;
  logHome('startup');
  powerMonitor.on('suspend', () => logHome('suspend'));
  powerMonitor.on('resume', () => logHome('resume'));

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
