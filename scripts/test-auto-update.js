/* eslint-disable no-console */
const assert = require('assert');
const { EventEmitter } = require('events');
const autoUpdate = require('../auto-update');

const rejections = [];
const onRejection = (reason) => rejections.push(reason);
process.on('unhandledRejection', onRejection);

// Let the event loop run instead of awaiting the fake's own promise: awaiting it
// would mark a rejection as handled and hide one the module let through.
const settle = async () => {
  await new Promise(setImmediate);
  await new Promise(setImmediate);
};
const spy = () => {
  const report = (...args) => report.calls.push(args);
  report.calls = [];
  return report;
};
const fakeUpdater = ({ active = true, check = () => Promise.resolve({}), nativeUpdater } = {}) => {
  const updater = {
    checks: 0,
    isUpdaterActive: () => active,
    checkForUpdates() {
      updater.checks += 1;
      return check();
    },
  };
  if (nativeUpdater) updater.nativeUpdater = nativeUpdater;
  return updater;
};

// Check every case before failing, so all regressions are visible.
const failures = [];
const run = async (name, test) => {
  const before = rejections.length;
  try {
    await test();
    await settle();
    assert.strictEqual(rejections.length, before, 'no unhandled rejection');
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
};
const start = async (updater, report) => {
  const timer = autoUpdate(updater, report);
  await settle();
  clearInterval(timer);
  return timer;
};

(async () => {
  await run('download rejected', async () => {
    const error = new Error('download failed');
    const report = spy();
    await start(fakeUpdater({
      check: () => Promise.resolve({ downloadPromise: Promise.reject(error) }),
    }), report);
    assert.deepStrictEqual(report.calls, [[error]], 'reported once, as the only argument');
  });

  await run('check rejected', async () => {
    const report = spy();
    await start(fakeUpdater({ check: () => Promise.reject(new Error('offline')) }), report);
    assert.deepStrictEqual(report.calls, [], 'check failures stay silent');
  });

  await run('no update', async () => {
    const report = spy();
    await start(fakeUpdater({ check: () => Promise.resolve(null) }), report);
    await start(fakeUpdater({ check: () => Promise.resolve({ updateInfo: {} }) }), report);
    assert.deepStrictEqual(report.calls, []);
  });

  await run('download succeeded', async () => {
    const report = spy();
    await start(fakeUpdater({
      check: () => Promise.resolve({ downloadPromise: Promise.resolve(['update.zip']) }),
    }), report);
    assert.deepStrictEqual(report.calls, []);
  });

  await run('inactive installation', async () => {
    const updater = fakeUpdater({ active: false });
    assert.strictEqual(autoUpdate(updater, spy()), null);
    assert.strictEqual(updater.checks, 0, 'nothing is checked');
  });

  await run('Squirrel.Mac refusal', async () => {
    const nativeUpdater = new EventEmitter();
    const report = spy();
    await start(fakeUpdater({ nativeUpdater }), report);
    const refusal = (folder) => new Error('Code signature at URL file:///Users/jane/Library/Caches/'
      + `com.pandasuite.studio.ShipIt/${folder}/PandaSuite%20Studio.app/ did not pass validation`);
    const first = refusal('update.Ab12Cd3');
    const second = refusal('update.Zz99Yy8');
    // Electron 11 emits the error and its message as two arguments.
    nativeUpdater.emit('error', first, first.message);
    nativeUpdater.emit('error', second, second.message);
    assert.deepStrictEqual(report.calls, [[first], [second]], 'reported with one argument');
    assert(first.message.includes('/update.*/') && !first.message.includes('Ab12Cd3'), first.message);
    assert.strictEqual(second.message, first.message, 'retries share one message');
    const bare = new Error('ignored');
    Object.defineProperty(bare, 'message', { value: 42 });
    assert.doesNotThrow(() => nativeUpdater.emit('error', bare));
    assert.strictEqual(report.calls.length, 3);
  });

  await run('no native updater', async () => {
    await start(fakeUpdater(), spy());
  });

  process.removeListener('unhandledRejection', onRejection);
  if (failures.length) {
    console.error(`Auto-update checks failed:\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log('Auto-update checks passed');
  process.exit(0);
})();
