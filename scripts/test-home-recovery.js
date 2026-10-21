/* eslint-disable no-console */
const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const controllerPath = path.join(__dirname, '../home-recovery');
assert(fs.existsSync(`${controllerPath}.js`), 'Home recovery controller must exist');
const attachHomeRecovery = require('../home-recovery');
const createLog = require('../home-recovery-log');

const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const contents = new EventEmitter();
  contents.id = 3;
  contents.isDestroyed = () => false;
  contents.reloads = 0;
  contents.reload = () => { contents.reloads += 1; };
  const win = { isDestroyed: () => false };
  let selected = true;
  let answer;
  const dialogs = [];
  const records = [];
  const controller = attachHomeRecovery({
    view: { webContents: contents },
    window: win,
    isSelected: () => selected,
    showMessageBox: (parent, options) => {
      dialogs.push(options);
      return new Promise((resolve) => { answer = resolve; });
    },
    translate: (key) => key,
    log: (event, data) => records.push({ event, ...data }),
  });
  return {
    contents,
    controller,
    dialogs,
    records,
    select: (value) => { selected = value; controller.selected(); },
    answer: async (response) => { answer({ response }); await tick(); },
  };
}
async function run() {
  const callbacks = {};
  const sent = [];
  const pageWindow = { addEventListener: (name, listener) => { callbacks[name] = listener; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8'), {
    require: () => ({ ipcRenderer: { send: (...args) => sent.push(args) } }),
    process: { once: (name, callback) => callback() },
    window: pageWindow,
  });
  callbacks.message({ source: {}, data: { type: 'homeRenderError', data: { boundary: 'home' } } });
  callbacks.message({ source: pageWindow, data: null });
  assert.strictEqual(sent.length, 0);
  callbacks.message({
    source: pageWindow,
    data: { type: 'homeRenderError', data: { boundary: 'home' } },
  });
  assert.strictEqual(sent.length, 1);

  let f = fixture();
  assert(f.contents.listenerCount('render-process-gone'));
  f.contents.emit('did-fail-load', {}, -3, 'private', 'https://secret', true);
  f.contents.emit('did-fail-load', {}, -105, 'private', 'https://secret', false);
  assert.strictEqual(f.dialogs.length, 0);
  f.select(false);
  f.contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 9 });
  assert.strictEqual(f.dialogs.length, 0);
  f.select(true);
  assert.strictEqual(f.dialogs.length, 1);
  f.contents.emit('unresponsive');
  assert.strictEqual(f.dialogs.length, 1);
  await f.answer(1);
  f.select(true);
  assert.strictEqual(f.dialogs.length, 1);
  f.contents.emit('responsive'); // Must not dismiss an earlier crash.
  assert.strictEqual(f.controller.reload(), true);
  assert.strictEqual(f.contents.reloads, 1);
  f.contents.emit('did-start-loading');
  f.contents.emit('did-fail-load', {}, -105, '', '', true);
  assert.strictEqual(f.dialogs.length, 2);
  f.select(false);
  await f.answer(0);
  assert.strictEqual(f.contents.reloads, 1, 'stale selection cannot reload');
  f.select(true);
  assert.strictEqual(f.dialogs.length, 3, 'deferred failure remains actionable');
  await f.answer(0);
  assert.strictEqual(f.contents.reloads, 2);
  f.controller.dispose();
  f.contents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.strictEqual(f.controller.reload(), false);

  f = fixture();
  f.select(false);
  f.contents.emit('unresponsive');
  f.contents.emit('responsive');
  f.select(true);
  assert.strictEqual(f.dialogs.length, 0);
  assert(f.records.some((record) => record.event === 'responsive' && record.durationMs >= 0));
  f.contents.emit('unresponsive');
  assert.strictEqual(f.dialogs.length, 1);
  f.contents.emit('responsive');
  await f.answer(0);
  assert.strictEqual(f.contents.reloads, 0, 'responsive invalidates stale hang dialog');
  f.contents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.strictEqual(f.dialogs.length, 2);
  f.contents.isDestroyed = () => true;
  await f.answer(0);
  assert.strictEqual(f.contents.reloads, 0);

  f = fixture();
  f.select(false);
  f.contents.emit('unresponsive');
  f.contents.emit('render-process-gone', {}, { reason: 'crashed' });
  f.contents.emit('responsive');
  f.select(true);
  assert.strictEqual(f.dialogs.length, 1, 'responsive cannot clear a crash after a hang');
  await f.answer(1);

  f = fixture();
  f.controller.loadRejected({ code: 'ERR_ABORTED' });
  assert.strictEqual(f.dialogs.length, 0, 'aborted loadURL promise is not a failure');
  f.contents.emit('did-start-loading');
  f.contents.emit('did-fail-load', {}, -105, '', '', true);
  f.controller.loadRejected({ errno: -105 });
  assert.strictEqual(f.dialogs.length, 1, 'event and promise deduplicate');
  assert(f.records.some((record) => record.event === 'load-failed' && record.durationMs >= 0));
  await f.answer(1);

  f = fixture();
  assert.strictEqual(f.controller.reportReactError({}, { boundary: 'home' }), false);
  assert.strictEqual(f.controller.reportReactError(f.contents, null), false);
  assert.strictEqual(f.controller.reportReactError(f.contents, {
    boundary: 'home', errorName: 'TypeError', message: 'secret',
  }), true);
  assert.strictEqual(f.dialogs.length, 0, 'React fallback already provides recovery');
  assert.strictEqual(f.records[0].errorName, 'TypeError');
  assert.strictEqual(f.records[0].message, undefined);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'home-recovery-'));
  try {
    const file = path.join(dir, 'logs/home-recovery.log');
    let log = createLog({ file, versions: { app: '1.7.8', electron: '11.5.0', chrome: '87' } });
    log('startup', { url: 'https://secret?token=password', message: 'password' });
    log = createLog({ file, versions: { app: '1.7.8' } });
    log('react-error', { boundary: 'home', errorName: 'https://secret', token: 'password' });
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.strictEqual(lines.length, 2, 'records survive reopening');
    assert(!lines.join('').includes('secret'));
    assert(!lines.join('').includes('password'));
    assert(JSON.parse(lines[0]).timestamp.endsWith('Z'));
    for (let i = 0; i < 3500; i += 1) log('load-started', { viewId: 3 });
    assert(fs.existsSync(`${file}.1`));
    assert(fs.statSync(file).size <= 256 * 1024);
    assert(fs.statSync(`${file}.1`).size <= 256 * 1024);
    fs.writeFileSync(path.join(dir, 'blocked'), 'file');
    const { warn } = console;
    let warnings = 0;
    console.warn = () => { warnings += 1; };
    try {
      const blockedLog = createLog({ file: path.join(dir, 'blocked/log') });
      assert.doesNotThrow(() => { blockedLog('startup'); blockedLog('resume'); });
      assert.strictEqual(warnings, 1);
    } finally {
      console.warn = warn;
    }
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
  console.log('Home recovery regression assertions passed');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
