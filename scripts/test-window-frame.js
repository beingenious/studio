const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const captureWindowOptions = require('./capture-window-options');

(async () => {
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  // Check every platform before asserting, so all regressions are visible.
  const failures = [];
  await Promise.all(['darwin', 'win32', 'linux'].map(async (platform) => {
    const native = platform !== 'linux';
    const options = await captureWindowOptions(platform);
    const window = { addEventListener() {} };
    vm.runInNewContext(preload, {
      require: () => ({ ipcRenderer: { send() {} } }),
      process: { platform, once: (event, callback) => callback() },
      window,
    });
    try {
      assert.strictEqual(options.frame, native, `${platform}: native caption frame`);
      assert.strictEqual(options.titleBarStyle, native ? 'default' : 'hiddenInset');
      assert.strictEqual(window.studioNativeWindowFrame, native, `${platform}: synchronous capability`);
      const descriptor = Object.getOwnPropertyDescriptor(window, 'studioNativeWindowFrame');
      assert.strictEqual(descriptor.writable, false, 'capability is read-only');
    } catch (error) {
      failures.push(error.message);
    }
  }));
  assert.deepStrictEqual(failures, []);
  process.stdout.write('Native frame and preload capability assertions passed\n');
})().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
