/* eslint-disable class-methods-use-this, global-require, import/no-dynamic-require */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');

const ipcMain = new EventEmitter();
const logged = [];
const started = [];
const autoUpdater = { checkForUpdates: () => Promise.resolve() };
const captureException = () => {};
const autoUpdates = [];
const app = new EventEmitter();
Object.assign(app, {
  getPath: () => '/tmp',
  getVersion: () => '1.7.8',
  setAppUserModelId() {},
  commandLine: { appendSwitch() {} },
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
      scripts: [],
      executeJavaScript: (script) => { contents.scripts.push(script); return Promise.resolve(); },
      loadURL: () => {
        contents.listenersBeforeLoad = contents.listenerCount('render-process-gone');
        if (failNextLoad) {
          failNextLoad = false;
          return Promise.reject(new Error('project load failed'));
        }
        return Promise.resolve();
      },
      reload: () => { contents.reloads += 1; },
      crashes: 0,
      forcefullyCrashRenderer: () => { contents.crashes += 1; },
      pid: 100 + views.length,
      getOSProcessId: () => contents.pid,
      destroy() {},
    });
    views.push(this);
  }

  setBackgroundColor() {}

  setAutoResize() {}

  setBounds(bounds) { this.bounds = bounds; }
}
let menu;
const window = {
  isDestroyed: () => false,
  getContentBounds: () => ({ width: 1000, height: 800 }),
  addBrowserView() {},
  setTopBrowserView() {},
  removeBrowserView() {},
};
const shellContents = {
  getURL: () => 'https://pandasuite.com/dashboard/electron/tabs/',
  pid: 1,
  getOSProcessId: () => shellContents.pid,
  isDestroyed: () => false,
};
const dialogs = [];
const answers = [];
let studioInFront = true;
let openMessages = 0;
window.webContents = shellContents;
const nativeTheme = { themeSource: 'system' };
const electron = {
  app,
  ipcMain,
  BrowserView,
  BrowserWindow: {
    // As on macOS, a window showing a message does not count as focused.
    getFocusedWindow: () => (studioInFront && !openMessages ? window : null),
    fromWebContents: (contents) => (contents === shellContents ? window : null),
  },
  nativeTheme,
  webContents: {
    getAllWebContents: () => [shellContents, ...views.map((view) => view.webContents)],
  },
  dialog: {
    showMessageBox: (parent, options) => {
      dialogs.push(options);
      openMessages += 1;
      return new Promise((resolve) => answers.push(resolve));
    },
  },
  Menu: {
    getApplicationMenu: () => menu,
    setApplicationMenu: (value) => { menu = value; },
  },
};
const context = {
  require(name) {
    if (name === 'electron') return electron;
    if (name === 'electron-util') return { is: { development: false } };
    if (name === 'electron-updater') return { autoUpdater };
    if (name === './error-reporting') return { start(options) { started.push(options); }, captureException };
    if (name === './auto-update') return (...args) => autoUpdates.push(args);
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
  homeRecovery, sharesProcess, updateHomeMenu, projectTexts,
  setFocusedWindow: (win) => { focusedWindow = win; } };`, context);
const api = context.test;
assert.strictEqual(started.length, 1, 'error reporting starts once');
assert.strictEqual(started[0].enabled, false, 'the gendarmerie build reports no error');
assert.strictEqual(autoUpdates.length, 0, 'the gendarmerie build never starts auto-update');
assert.strictEqual(ipcMain.listenerCount('updateNativeTheme'), 1);
['dark', 'light', 'auto'].forEach((theme) => {
  ipcMain.emit('updateNativeTheme', { sender: shellContents }, { theme });
  assert.strictEqual(nativeTheme.themeSource, theme === 'auto' ? 'system' : theme);
});
ipcMain.emit('updateNativeTheme', { sender: shellContents }, { theme: 'invalid' });
ipcMain.emit('updateNativeTheme', { sender: shellContents }, null);
ipcMain.emit('updateNativeTheme', { sender: { getURL: shellContents.getURL } }, { theme: 'dark' });
assert.strictEqual(nativeTheme.themeSource, 'system', 'invalid or BrowserView messages cannot override native theme');
shellContents.getURL = () => 'https://pandasuite.com/authoring/project';
ipcMain.emit('updateNativeTheme', { sender: shellContents }, { theme: 'dark' });
assert.strictEqual(nativeTheme.themeSource, 'system', 'only the tabs route controls native appearance');
const preloadWindow = {};
const sent = [];
let onMessage;
preloadWindow.addEventListener = (name, callback) => { onMessage = callback; };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8'), {
  require: () => ({ ipcRenderer: { send: (...args) => sent.push(args) } }),
  process: { once: (name, callback) => callback() },
  window: preloadWindow,
});
const message = { type: 'updateNativeTheme', data: { theme: 'dark' } };
onMessage({ source: {}, data: message });
assert.strictEqual(sent.length, 0, 'iframe cannot send native appearance');
onMessage({ source: preloadWindow, data: message });
assert.strictEqual(sent.length, 1, 'own-window preference reaches main');
assert.strictEqual(sent[0][0], 'updateNativeTheme');
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
assert.strictEqual(project.bounds.y, 45, 'tabs remain a content-coordinate row');
assert.strictEqual(project.bounds.height, 755, 'native titlebar height is not added to content offset');
assert.strictEqual(project.webContents.scripts.length, 1, 'compact macOS retains its drag-region refresh');
context.process.platform = 'linux';
api.createOrSelectBrowserView({ url: 'https://pandasuite.com/authoring/project' }, window);
assert.strictEqual(project.webContents.scripts.length, 2, 'Linux retains its drag-region workaround');
context.process.platform = 'win32';
api.createOrSelectBrowserView({ url: 'https://pandasuite.com/authoring/project' }, window);
assert.strictEqual(project.webContents.scripts.length, 2, 'native Windows frames need no drag-region workaround');
context.process.platform = 'darwin';
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
  const projectUrl = 'https://pandasuite.com/authoring/other';
  api.setFocusedWindow(window);
  api.createOrSelectBrowserView({ url: projectUrl }, window);
  setImmediate(() => {
    process.removeListener('unhandledRejection', captureProjectError);
    assert.strictEqual(projectError, undefined, 'a project load failure is handled by its recovery');
    const projectView = api.publicationsBrowserView[projectUrl];
    assert(api.homeRecovery.get(projectView), 'a project tab gets a recovery');
    assert(logged.some(({ event, data }) => event === 'load-rejected' && data.role === 'project'),
      'its records say it is a project');
    assert.strictEqual(menu.item.enabled, false, 'Reload Home stays for Home only');
    api.createOrSelectBrowserView({ url: projectUrl }, window);
    assert.strictEqual(dialogs[dialogs.length - 1].message, 'projectRecovery.loadMessage',
      'the project tells its own failure');
    assert.strictEqual(JSON.stringify(dialogs[dialogs.length - 1].buttons), '["Reload","Cancel"]');
    assert.strictEqual(api.sharesProcess(projectView.webContents), false, 'a process of its own');
    shellContents.pid = projectView.webContents.pid;
    assert.strictEqual(api.sharesProcess(projectView.webContents), true, 'shared with the shell');
    shellContents.pid = 1;
    const other = views.find((view) => view !== projectView && !view.webContents.isDestroyed());
    other.webContents.pid = projectView.webContents.pid;
    assert.strictEqual(api.sharesProcess(projectView.webContents), true, 'shared with another tab');
    other.webContents.pid = 999;

    // The wording Studio ships, per failure.
    const text = (kind, canReload) => JSON.parse(
      JSON.stringify(api.projectTexts(kind, { canReload })),
    );
    assert.deepStrictEqual(text('crash', true), {
      message: 'projectRecovery.crashMessage',
      detail: 'projectRecovery.crashDetail',
      buttons: ['Reload', 'Cancel'],
      defaultId: 0,
      reload: true,
    });
    assert.strictEqual(text('load', true).detail, 'projectRecovery.loadDetail');
    assert.deepStrictEqual(text('hang', true), {
      message: 'projectRecovery.hangMessage',
      detail: 'projectRecovery.hangDetail',
      buttons: ['Reload', 'projectRecovery.wait'],
      defaultId: 1,
      reload: true,
    });
    assert.deepStrictEqual(text('hang', false), {
      message: 'projectRecovery.hangMessage',
      detail: 'projectRecovery.hangRestartDetail',
      buttons: ['projectRecovery.ok'],
      defaultId: 0,
      reload: false,
    });

    const flush = () => new Promise(setImmediate);
    // The message counts as open until its answer has been handled, as a sheet does.
    const answer = async (response) => {
      answers.shift()({ response });
      await flush();
      openMessages -= 1;
    };
    const stuck = projectView.webContents;
    (async () => {
      // A stuck project with a process of its own: Reload ends it, then reloads.
      await answer(1);
      stuck.emit('did-start-loading');
      stuck.emit('unresponsive');
      assert.strictEqual(dialogs[dialogs.length - 1].detail, 'projectRecovery.hangDetail');
      await answer(0);
      assert.strictEqual(stuck.crashes, 1, 'renderer ended');
      assert.strictEqual(stuck.reloads, 1, 'then reloaded');
      stuck.emit('did-finish-load');

      // Shared with the shell: no Reload, nothing ended.
      shellContents.pid = stuck.pid;
      stuck.emit('unresponsive');
      assert.strictEqual(JSON.stringify(dialogs[dialogs.length - 1].buttons), '["projectRecovery.ok"]');
      await answer(0);
      assert.strictEqual(stuck.crashes, 1);
      shellContents.pid = 1;
      stuck.emit('responsive');

      // Waiting: offered again when the tab is chosen again.
      stuck.emit('unresponsive');
      const before = dialogs.length;
      await answer(1);
      api.createOrSelectBrowserView({ url: projectUrl }, window);
      assert.strictEqual(dialogs.length, before + 1, 'chosen again, offered again');
      await answer(1);
      stuck.emit('responsive');

      // Studio in the background: nothing until it is in front again.
      studioInFront = false;
      stuck.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
      assert.strictEqual(dialogs.length, before + 1, 'no message in the background');
      studioInFront = true;
      api.createOrSelectBrowserView({ url: projectUrl }, window);
      assert.strictEqual(dialogs[dialogs.length - 1].message, 'projectRecovery.crashMessage');

      assert(logged.some(({ event, data }) => event === 'react-error' && data.role === 'home'),
        'Home records say Home');
      const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
      const focus = source.slice(source.indexOf("win.on('focus'"), source.indexOf("win.on('ready-to-show'"));
      assert(/selectedController\(\)/.test(focus), 'window focus offers any tab\'s failure');
      const selection = /homeSenders\.has\(view\.webContents\)\) controller\.selected\(\);/;
      assert(selection.test(source), 'Home keeps its behavior on selection');
      assert(/else controller\.tabSelected\(\);/.test(source), 'a project is offered again');
      process.stdout.write('Home recovery production wiring assertions passed\n');
    })().catch((error) => {
      console.error(error); // eslint-disable-line no-console
      process.exitCode = 1;
    });
  });
});
