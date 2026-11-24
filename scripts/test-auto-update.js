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
  // electron-updater emits every failure as 'error' on the updater itself.
  const updater = Object.assign(new EventEmitter(), {
    checks: 0,
    isUpdaterActive: () => active,
    checkForUpdates() {
      updater.checks += 1;
      return check();
    },
  });
  if (nativeUpdater) updater.nativeUpdater = nativeUpdater;
  return updater;
};
const withCode = (code, domain, message = 'localized text') => Object.assign(
  new Error(message),
  { code, domain },
);
// Squirrel.Mac's extraction errors carry the output of ditto as their message.
const extraction = (output) => withCode(1, 'SQRLZipArchiverErrorDomain', output);

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
const start = async (updater, report, warnDiskFull) => {
  const timer = autoUpdate(updater, report, warnDiskFull);
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

  await run('full disk: warned once per launch', async () => {
    await Promise.all([
      withCode(28, 'NSPOSIXErrorDomain'),
      withCode(640, 'NSCocoaErrorDomain'),
      withCode('ENOSPC'),
      extraction('ditto: /Users/jane/Library/Caches/update/PandaSuite Studio.app/Contents/x: '
        + 'No space left on device\nditto: Couldn\'t read pkzip signature.'),
    ].map(async (error) => {
      const warn = spy();
      const updater = fakeUpdater();
      autoUpdate(updater, spy(), warn);
      updater.emit('error', error);
      await settle();
      assert.strictEqual(warn.calls.length, 1, `warned: ${error.domain || ''} ${error.code}`);
      // Squirrel's failure arrives twice, and the check every 4 hours fails again.
      updater.emit('error', error);
      updater.emit('error', withCode('ENOSPC'));
      await settle();
      assert.strictEqual(warn.calls.length, 1, `${error.domain || ''} ${error.code}`);
    }));
  });

  await run('other failures: no warning', async () => {
    const warn = spy();
    const updater = fakeUpdater();
    autoUpdate(updater, spy(), warn);
    updater.emit('error', withCode(-1004, 'NSURLErrorDomain'));
    updater.emit('error', withCode(28));
    updater.emit('error', withCode(28, 'NSURLErrorDomain'));
    updater.emit('error', new Error('No space left on device'));
    updater.emit('error', extraction('ditto: Couldn\'t read pkzip signature.'));
    updater.emit('error', null);
    await settle();
    assert.deepStrictEqual(warn.calls, []);
  });

  await run('a failing warning stays contained', async () => {
    const throwing = fakeUpdater();
    autoUpdate(throwing, spy(), () => { throw new Error('no dialog'); });
    assert.doesNotThrow(() => throwing.emit('error', withCode('ENOSPC')));
    const rejecting = fakeUpdater();
    autoUpdate(rejecting, spy(), () => Promise.reject(new Error('no dialog')));
    rejecting.emit('error', withCode('ENOSPC'));
  });

  await run('inactive installation: no warning', async () => {
    const updater = fakeUpdater({ active: false });
    autoUpdate(updater, spy(), spy());
    assert.strictEqual(updater.listenerCount('error'), 0);
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
