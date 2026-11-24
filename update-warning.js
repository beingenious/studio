const canShow = (win) => !win.isDestroyed() && win.isVisible() && !win.isMinimized();

// Tells the user that an update could not be installed because the disk is full. On macOS a
// dialog without a parent blocks every window: attach it to a window that can show it.
module.exports = function warnDiskFull({ dialog, BrowserWindow, translate }) {
  const focused = BrowserWindow.getFocusedWindow();
  const parent = focused && canShow(focused)
    ? focused
    : BrowserWindow.getAllWindows().find(canShow);
  const options = {
    type: 'warning',
    message: translate('autoUpdate.diskFullMessage'),
    detail: translate('autoUpdate.diskFullDetail'),
    buttons: [translate('autoUpdate.ok')],
  };
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
};
