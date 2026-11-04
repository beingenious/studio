module.exports = (win) => {
  // Load only for macOS windows; other platforms need no native module.
  const native = require('./native/macos-titlebar.node'); // eslint-disable-line global-require, import/no-unresolved
  const observer = native.attach(win.getNativeWindowHandle());
  win.once('closed', () => native.detach(observer));
};
