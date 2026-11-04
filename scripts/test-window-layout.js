const assert = require('assert');
const { EventEmitter } = require('events');
const attachWindowLayout = require('../window-layout');

(async () => {
  let content = { width: 1008, height: 720 };
  let destroyed = false;
  const views = Array.from({ length: 2 }, () => ({
    setBounds(bounds) { this.bounds = bounds; },
  }));
  const win = new EventEmitter();
  win.isDestroyed = () => destroyed;
  win.getContentBounds = () => {
    assert(!destroyed, 'deferred work must not read a closed window');
    return content;
  };
  win.getBrowserViews = () => views;
  attachWindowLayout(win, 45);
  const verify = () => views.forEach((view) => {
    assert.deepStrictEqual(view.bounds, {
      x: 0, y: 45, width: content.width, height: content.height - 45,
    });
  });
  win.emit('resize');
  verify();
  // The native border adds content width without an equal outer-window delta.
  content = { width: 1024, height: 768 };
  win.emit('resize');
  verify();
  const fullTransition = async (event, nextBounds) => {
    win.emit(event); // Windows notifies before applying the native frame change.
    content = nextBounds; // There may be no outer-size resize notification.
    await new Promise((resolve) => setImmediate(resolve));
    verify();
  };
  await fullTransition('enter-full-screen', { width: 1040, height: 768 });
  await fullTransition('leave-full-screen', { width: 1008, height: 720 });
  win.emit('enter-full-screen');
  destroyed = true;
  await new Promise((resolve) => setImmediate(resolve));
  process.stdout.write('Exact Windows content layout assertions passed for all retained views\n');
})().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
