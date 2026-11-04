const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const { execFileSync } = require('child_process');

const attached = [];
const detached = [];
const context = {
  module: { exports: {} },
  require: () => ({
    attach: (handle) => { attached.push(handle); return handle; },
    detach: (handle) => detached.push(handle),
  }),
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../macos-titlebar.js'), 'utf8'), context);
const first = new EventEmitter();
const second = new EventEmitter();
first.getNativeWindowHandle = () => 'first';
second.getNativeWindowHandle = () => 'second';
context.module.exports(first);
context.module.exports(second);
assert.deepStrictEqual(attached, ['first', 'second']);
first.emit('closed');
first.emit('closed');
assert.deepStrictEqual(detached, ['first'], 'close removes only its own observer once');
second.emit('closed');
assert.deepStrictEqual(detached, ['first', 'second']);

if (process.platform === 'darwin') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-titlebar-test-'));
  const executable = path.join(directory, 'caption-test');
  execFileSync('xcrun', [
    'clang', '-fobjc-arc', '-framework', 'Cocoa',
    path.join(__dirname, '../native/test-macos-titlebar-region.m'), '-o', executable,
  ], { stdio: 'inherit' });
  execFileSync(executable, [], { stdio: 'inherit' });
  fs.unlinkSync(executable);
  fs.rmdirSync(directory);
}
process.stdout.write('macOS titlebar observer lifetime assertions passed\n');
