const path = require('path');

const DONT_ASK = 'moveToApplications.dontAsk';
const CANCELLED = /User rejected the authorization request/;

const isWritable = (fs, file) => {
  try {
    fs.accessSync(file, fs.constants.W_OK);
    return true;
  } catch (error) {
    return false;
  }
};

// Squirrel.Mac cannot update an app running from a read-only location (the disk image, or a
// quarantined app launched from Downloads). Offer to move it to Applications in that case,
// unless a copy is already installed there: replacing it could delete it or undo its updates.
// Resolves to true when the app moves and relaunches from Applications.
module.exports = async function moveToApplications({
  app, dialog, store, translate, fs,
}) {
  if (process.platform !== 'darwin' || !app.isPackaged) return false;
  if (store.get(DONT_ASK) || app.isInApplicationsFolder()) return false;
  // macOS paths, whatever platform runs the tests.
  const bundle = path.posix.resolve(app.getPath('exe'), '../../..');
  if (isWritable(fs, bundle)) return false;
  if (fs.existsSync(path.posix.join('/Applications', path.posix.basename(bundle)))) return false;

  const { response, checkboxChecked } = await dialog.showMessageBox({
    type: 'question',
    message: translate('moveToApplications.message'),
    detail: translate('moveToApplications.detail'),
    buttons: [translate('moveToApplications.move'), translate('moveToApplications.later')],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: translate('moveToApplications.dontAsk'),
  });
  if (response !== 0) {
    if (checkboxChecked) store.set(DONT_ASK, true);
    return false;
  }

  try {
    return app.moveToApplicationsFolder();
  } catch (error) {
    if (!CANCELLED.test(String(error && error.message))) {
      await dialog.showMessageBox({
        type: 'warning',
        message: translate('moveToApplications.failedMessage'),
        detail: translate('moveToApplications.failedDetail'),
        buttons: [translate('moveToApplications.ok')],
      });
    }
    return false;
  }
};
