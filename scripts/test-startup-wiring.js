/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');

const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
// Window creation is where these checks stop: past it, startup needs the real Electron.
const STOP = new Error('stop: window creation reached');
const errorReporting = { start() {}, captureException() {} };
const translate = (key) => key;

const start = ({
  lock = true, moved = false, deepLink = false, diskFull = false,
} = {}) => {
  const order = [];
  let ready;
  // One readiness for every caller, as in Electron.
  const readiness = new Promise((resolve) => { ready = resolve; });
  let moveArgs;
  const update = { warnings: [] };
  const app = new EventEmitter();
  Object.assign(app, {
    getPath: () => '/tmp',
    getVersion: () => '1.7.10',
    getLocale: () => 'fr-FR',
    setAppUserModelId() {},
    setAsDefaultProtocolClient() {},
    requestSingleInstanceLock: () => lock,
    quit() {},
    whenReady: () => {
      order.push('ready');
      return readiness;
    },
  });
  const electron = {
    app,
    ipcMain: new EventEmitter(),
    dialog: {},
    nativeTheme: {},
    BrowserWindow: { getFocusedWindow: () => null },
    powerMonitor: { on() {} },
    session: { defaultSession: { cookies: { on() {} } } },
    Menu: { getApplicationMenu: () => null, setApplicationMenu: () => order.push('menu') },
    screen: {
      getCursorScreenPoint() {},
      getDisplayNearestPoint() {
        order.push('window');
        throw STOP;
      },
    },
  };
  const stubs = {
    electron,
    'electron-util': { is: { development: false } },
    'electron-updater': { autoUpdater: { checkForUpdates: () => Promise.resolve() } },
    './error-reporting': errorReporting,
    './auto-update': (updater, report, warnDiskFull) => {
      // The updater runs before ready: a full disk can be found that early.
      if (diskFull) update.result = warnDiskFull();
      return null;
    },
    './update-warning': (args) => {
      update.warnings.push(args);
      return 'dialog promise';
    },
    './flash-player': { setupFlashPlayer() {} },
    './i18n/i18n': { __: translate, changeLocale() {}, translateFor: (locale) => `translator:${locale}` },
    './move-to-applications': (args) => {
      order.push('move');
      moveArgs = args;
      return Promise.resolve(moved);
    },
    './menu': () => ({ getMenuItemById() {} }),
    './home-recovery-log': () => () => {},
  };
  vm.runInNewContext(source, {
    require(name) {
      if (name in stubs) return stubs[name];
      if (name.startsWith('lodash/') || ['path', 'util', 'child_process'].includes(name)) {
        // eslint-disable-next-line global-require, import/no-dynamic-require
        return require(name);
      }
      return () => {};
    },
    process: { platform: 'darwin', versions: {}, argv: [] },
    __dirname: path.join(__dirname, '..'),
    setInterval() {},
  });
  // On macOS a launch by link delivers open-url before ready.
  if (deepLink) app.emit('open-url', { preventDefault() {} }, 'pandastudio://pandasuite.com/link');
  return new Promise((resolve) => setImmediate(() => {
    // Whatever waits for ready must not have run yet.
    update.beforeReady = update.warnings.length;
    ready();
    setImmediate(() => resolve({
      order, moveArgs, update, electron,
    }));
  }));
};

// Check every case before failing, so all regressions are visible.
const failures = [];
const onRejection = (error) => {
  if (error !== STOP) failures.push(`unexpected rejection: ${error && error.message}`);
};
const check = async (name, test) => {
  try {
    await test();
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
};

async function run() {
  process.on('unhandledRejection', onRejection);
  await check('second instance stops before startup', async () => {
    const { order } = await start({ lock: false });
    assert.deepStrictEqual(order, []);
  });
  await check('moved: startup stops before the menu and window', async () => {
    const { order, moveArgs } = await start({ moved: true });
    assert.deepStrictEqual(order, ['ready', 'move']);
    assert.strictEqual(moveArgs.translate, 'translator:fr-FR', 'asks in the system language');
    assert.strictEqual(typeof moveArgs.execFile, 'function', 'runs the copy commands');
    assert.strictEqual(moveArgs.report, errorReporting.captureException, 'reports failures');
  });
  await check('not moved: the question comes before the menu and window', async () => {
    const { order } = await start({ moved: false });
    assert.deepStrictEqual(order, ['ready', 'move', 'menu', 'window']);
  });
  await check('launched by a link: no question', async () => {
    const { order } = await start({ moved: true, deepLink: true });
    assert.deepStrictEqual(order, ['ready', 'menu', 'window']);
  });
  await check('full disk: warned once ready, in the app language', async () => {
    const { update, electron } = await start({ diskFull: true });
    assert.strictEqual(update.beforeReady, 0, 'nothing shown before ready');
    assert.strictEqual(await update.result, 'dialog promise', 'hands back the dialog promise');
    assert.strictEqual(update.warnings.length, 1);
    const [args] = update.warnings;
    assert.strictEqual(args.dialog, electron.dialog);
    assert.strictEqual(args.BrowserWindow, electron.BrowserWindow);
    assert.strictEqual(args.translate, translate, 'follows the language the dashboard set');
  });
  process.removeListener('unhandledRejection', onRejection);
  if (failures.length) {
    console.error(`Startup wiring checks failed:\n${failures.join('\n')}`);
    process.exitCode = 1;
    return;
  }
  console.log('Startup wiring checks passed');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
