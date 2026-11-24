const { cleanMessage } = require('./error-event');

const canShow = (win) => !win.isDestroyed() && win.isVisible() && !win.isMinimized();

// Tells the user, in their language, that Studio ran into an unexpected problem, with the
// details at hand. One message at a time, and never twice for the same error in a launch.
module.exports = function createErrorWarning({
  whenReady, nextFocusedWindow, BrowserWindow, showMessageBox, translate, writeClipboard, home,
  log,
}) {
  let open = false;
  // Errors told, by their stack frames: a message that varies (an id, a time) is the same error.
  const told = new Set();

  // Never without a window: on macOS a message without one blocks Studio until it is answered.
  const windowFor = () => {
    const focused = BrowserWindow.getFocusedWindow();
    const win = focused && canShow(focused)
      ? focused
      : BrowserWindow.getAllWindows().find(canShow);
    return win || nextFocusedWindow().then(windowFor);
  };

  const tell = (details, key) => Promise.resolve()
    .then(whenReady)
    .then(windowFor)
    .then((win) => {
      const t = translate();
      return showMessageBox(win, {
        type: 'warning',
        message: t('errorWarning.message'),
        detail: t('errorWarning.detail'),
        buttons: [t('errorWarning.ok'), t('errorWarning.copy')],
        defaultId: 0,
        cancelId: 0,
        // Plain buttons on Windows, not command links.
        noLink: true,
      });
    })
    .then(({ response }) => {
      // Only once the user has seen it: a message that failed is tried again next time.
      told.add(key);
      if (response === 1) writeClipboard(details);
    });

  return (error) => {
    try {
      log(error);
    } catch (logError) {
      // Logging is optional.
    }
    try {
      const details = cleanMessage(String(error.stack || error), home);
      const frames = details.split('\n').filter((line) => /^\s*at /.test(line)).join('\n');
      // A rejected value, or an error without a stack, gets its frames from ensure-error, the
      // same whatever the error: then only its text tells it apart.
      const borrowed = error.name === 'NonError' || details.includes('<Original stack missing>');
      const key = borrowed || !frames ? details : frames;
      if (open || told.has(key)) return;
      open = true;
      tell(details, key)
        .catch(() => {})
        .then(() => { open = false; });
    } catch (warningError) {
      // electron-unhandled would show its own English box if this threw.
    }
  };
};
