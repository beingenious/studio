const {
  app, BrowserWindow, Menu, dialog,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const { is } = require('electron-util');
const unhandled = require('electron-unhandled');
const debug = require('electron-debug');
const contextMenu = require('electron-context-menu');
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

// Prevent window from being garbage collected
let mainWindow;

const createMainWindow = async () => {
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

  win.on('ready-to-show', () => {
    win.show();
  });

  win.on('closed', () => {
    // Dereference the window
    // For multiple windows store them in an array
    mainWindow = undefined;
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

  await win.loadURL('https://pandasuite.com/authoring/latest/');

  return win;
};

// Prevent multiple instances of the app
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.show();
  }
});

app.on('window-all-closed', () => {
  if (!is.macos) {
    app.quit();
  }
});

app.on('activate', async () => {
  if (!mainWindow) {
    mainWindow = await createMainWindow();
  }
});

(async () => {
  await app.whenReady();
  Menu.setApplicationMenu(menu);
  mainWindow = await createMainWindow();
})();
