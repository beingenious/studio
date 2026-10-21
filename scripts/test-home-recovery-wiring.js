/* eslint-disable class-methods-use-this, global-require, import/no-dynamic-require */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');

const ipcMain = new EventEmitter();
const logged = [];
const app = new EventEmitter();
Object.assign(app, {
  getPath: () => '/tmp',
  getVersion: () => '1.7.8',
  setAppUserModelId() {},
  setAsDefaultProtocolClient() {},
  requestSingleInstanceLock: () => true,
  whenReady: () => new Promise(() => {}),
});
const views = [];
let failNextLoad = false;
class BrowserView {
  constructor() {
    this.webContents = new EventEmitter();
    const contents = this.webContents;
    Object.assign(contents, {
      id: views.length + 1,
      reloads: 0,
      isDestroyed: () => false,
      focus() {},
      executeJavaScript: () => Promise.resolve(),
      loadURL: () => {
        contents.listenersBeforeLoad = contents.listenerCount('render-process-gone');
        if (failNextLoad) {
          failNextLoad = false;
          return Promise.reject(new Error('project load failed'));
        }
        return Promise.resolve();
      },
      reload: () => { contents.reloads += 1; },
      destroy() {},
    });
    views.push(this);
  }

  setBackgroundColor() {}

  setAutoResize() {}

  setBounds() {}
}
let menu;
const window = {
  isDestroyed: () => false,
  getContentBounds: () => ({ width: 1000, height: 800 }),
  addBrowserView() {},
  setTopBrowserView() {},
  removeBrowserView() {},
};
const electron = {
  app,
  ipcMain,
  BrowserView,
  BrowserWindow: { getFocusedWindow: () => window },
  Menu: {
    getApplicationMenu: () => menu,
    setApplicationMenu: (value) => { menu = value; },
  },
};
const context = {
  require(name) {
    if (name === 'electron') return electron;
    if (name === 'electron-util') return { is: { development: false } };
    if (name === 'electron-updater') {
      return { autoUpdater: { checkForUpdates: () => Promise.resolve() } };
    }
    if (name === '@bugsnag/js') return { start() {} };
    if (name === './flash-player') return { setupFlashPlayer() {} };
    if (name === './i18n/i18n') return { __: (key) => key };
    if (name === './menu') {
      return (options) => ({
        options,
        item: { enabled: options.reloadHomeEnabled },
        getMenuItemById() { return this.item; },
      });
    }
    if (name === './home-recovery') return require('../home-recovery');
    if (name === './home-recovery-log') {
      return () => (event, data) => logged.push({ event, data });
    }
    if (name.startsWith('lodash/') || name === 'path') return require(name);
    return () => {};
  },
  process: { platform: 'darwin', versions: {}, argv: [] },
  __dirname: path.join(__dirname, '..'),
  setInterval() {},
};
vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8')}
this.test = { createOrSelectBrowserView, createMenu, publicationsBrowserView, updateMenuItem,
  setFocusedWindow: (win) => { focusedWindow = win; } };`, context);
const api = context.test;
api.setFocusedWindow(window);
api.createMenu();
api.createOrSelectBrowserView({ url: 'https://pandasuite.com/dashboard/' }, window);
assert.strictEqual(menu.item.enabled, false, 'exact root alone is insufficient');
api.createOrSelectBrowserView({ url: 'https://pandasuite.com/dashboard/', home: true }, window);
assert.strictEqual(menu.item.enabled, false, 'existing view cannot acquire Home role');
delete api.publicationsBrowserView['https://pandasuite.com/dashboard/'];
api.createOrSelectBrowserView({ url: 'https://pandasuite.com/dashboard/', home: true }, window);
const home = views[views.length - 1];
assert.strictEqual(home.webContents.listenersBeforeLoad, 1, 'listeners precede loadURL');
assert.strictEqual(menu.item.enabled, true);
menu.options.reloadHome();
assert.strictEqual(home.webContents.reloads, 1);
api.createOrSelectBrowserView({ url: 'https://pandasuite.com/authoring/project', home: true }, window);
const project = views[views.length - 1];
assert.strictEqual(menu.item.enabled, false, 'flag cannot convert project to Home');
menu.options.reloadHome();
assert.strictEqual(home.webContents.reloads, 1);
assert.strictEqual(project.webContents.reloads, 0);
api.updateMenuItem('', { id: 'reloadHome', enabled: true });
assert.strictEqual(menu.item.enabled, false, 'renderer cannot enable native Home action');
api.publicationsBrowserView.changedKey = home;
delete api.publicationsBrowserView['https://pandasuite.com/dashboard/'];
api.createOrSelectBrowserView({ url: 'changedKey' }, window);
api.createMenu();
assert.strictEqual(menu.item.enabled, true, 'role survives mutable tab key and menu rebuild');
menu.options.reloadHome();
assert.strictEqual(home.webContents.reloads, 2);
assert.strictEqual(project.webContents.reloads, 0);
assert.strictEqual(ipcMain.listenerCount('homeRenderError'), 1);
ipcMain.emit('homeRenderError', { sender: project.webContents }, { boundary: 'home' });
assert.strictEqual(logged.filter((record) => record.event === 'react-error').length, 0, 'project sender cannot supply Home diagnostics');
ipcMain.emit('homeRenderError', { sender: home.webContents }, { boundary: 'home' });
assert.strictEqual(logged.filter((record) => record.event === 'react-error').length, 1, 'retained Home sender supplies optional diagnostics');
let unhandled = false;
const onRejection = () => { unhandled = true; };
process.on('unhandledRejection', onRejection);
home.webContents.executeJavaScript = () => Promise.reject(new Error('renderer unavailable'));
api.createOrSelectBrowserView({ url: 'changedKey' }, window);
setImmediate(() => {
  process.removeListener('unhandledRejection', onRejection);
  assert.strictEqual(unhandled, false, 'Home selection script failure must not escape recovery');
  home.webContents.isDestroyed = () => true;
  home.webContents.emit('destroyed');
  assert.strictEqual(menu.item.enabled, false, 'destroyed Home disables native action');
  let projectError;
  const captureProjectError = (error) => { projectError = error; };
  process.on('unhandledRejection', captureProjectError);
  failNextLoad = true;
  api.createOrSelectBrowserView({ url: 'https://pandasuite.com/authoring/other' }, window);
  setImmediate(() => {
    process.removeListener('unhandledRejection', captureProjectError);
    assert(projectError && projectError.message === 'project load failed',
      'project load retains existing global unhandled-error policy');
    process.stdout.write('Home recovery production wiring assertions passed\n');
  });
});
