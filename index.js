const {
  app, BrowserWindow, Menu, dialog, shell, session,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const { is } = require('electron-util');
const unhandled = require('electron-unhandled');
const debug = require('electron-debug');
const contextMenu = require('electron-context-menu');

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

// Note: Must match `build.appId` in package.json
app.setAppUserModelId('com.pandasuite.studio');

if (!is.development) {
  const FOUR_HOURS = 1000 * 60 * 60 * 4;
  setInterval(() => {
    autoUpdater.checkForUpdates();
  }, FOUR_HOURS);

  autoUpdater.checkForUpdates();
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
    if (newUrl.indexOf('/authoring/') === -1) {
      e.preventDefault();
      shell.openExternal(newUrl);
    }
  };

  win.webContents.on('will-navigate', handleRedirect);
  win.webContents.on('new-window', handleRedirect);

  await win.loadURL(url);

  return win;
};

// Prevent multiple instances of the app
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', async (event, argv) => {
  let win = focusedWindow || values(publicationsWindow)[0];

  if (process.platform === 'win32') {
    deeplinkingUrl = schemeToUrl(argv[1]);
    if (deeplinkingUrl) {
      const existingWin = getPublicationWindowByUrl(deeplinkingUrl);
      if (existingWin) {
        win = existingWin;
      } else {
        win = await createPublicationWindow();
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

(async () => {
  await app.whenReady();

  // https://github.com/electron/electron/issues/9995
  const { cookies } = session.defaultSession;
  cookies.on('changed', (event, cookie, cause, removed) => {
    if (cookie.session && !removed) {
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
      });
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
  // Only for MacOS
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

  const win = await createPublicationWindow(deeplinkingUrl);
  publicationsWindow[win.webContents.getURL()] = win;
})();
