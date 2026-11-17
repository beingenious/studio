const os = require('os');
const path = require('path');

const DONT_ASK = 'moveToApplications.dontAsk';
const APPLICATIONS = '/Applications';
const STAGING = /[^\s']*\/studio-move-[^/\s']*/g;

const isWritable = (fs, file) => {
  try {
    fs.accessSync(file, fs.constants.W_OK);
    return true;
  } catch (error) {
    return false;
  }
};

// The copy is made aside, in a folder of its own: Applications only ever receives a complete
// copy, and a copy still running from an interrupted attempt cannot touch this one.
const install = async ({ fs, execFile }, bundle) => {
  const name = path.posix.basename(bundle);
  const staging = fs.mkdtempSync(path.posix.join(os.tmpdir(), 'studio-move-'));
  const copy = path.posix.join(staging, name);
  const installed = path.posix.join(APPLICATIONS, name);
  try {
    await execFile('/usr/bin/ditto', [bundle, copy]);
    // A copy keeps the quarantine of a downloaded app, and macOS would run it read-only again.
    await execFile('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', copy]);
    fs.renameSync(copy, installed);
  } finally {
    await execFile('/bin/rm', ['-rf', staging]).catch(() => {});
  }
  return installed;
};

// These paths hold the account's temporary folder and a random part: without them, reports of
// one failure group together and cannot link launches.
const forReport = (error, bundle) => {
  if (error && typeof error.message === 'string') {
    // eslint-disable-next-line no-param-reassign
    error.message = error.message.split(bundle).join('<app>').replace(STAGING, '<staging>');
  }
  return error;
};

// Squirrel.Mac cannot update an app running from a read-only location (the disk image, or a
// quarantined app launched from Downloads). Offer to move it to Applications in that case,
// unless a copy is already installed there: replacing it could delete it or undo its updates.
// Resolves to true when the app moves and relaunches from Applications.
module.exports = async function moveToApplications({
  app, dialog, store, translate, fs, execFile, report,
}) {
  if (process.platform !== 'darwin' || !app.isPackaged) return false;
  if (store.get(DONT_ASK) || app.isInApplicationsFolder()) return false;
  // macOS paths, whatever platform runs the tests.
  const bundle = path.posix.resolve(app.getPath('exe'), '../../..');
  if (isWritable(fs, bundle)) return false;
  if (fs.existsSync(path.posix.join(APPLICATIONS, path.posix.basename(bundle)))) return false;

  // A link opened during the question or the copy would be lost by the relaunch: pass it on.
  let link;
  const onLink = (event, url) => { link = url; };
  app.on('open-url', onLink);
  try {
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

    // Without the rights to write in Applications, a copy would be wasted: say how to move it.
    if (isWritable(fs, APPLICATIONS)) {
      try {
        const installed = await install({ fs, execFile }, bundle);
        // Runs once Studio has quit, so the copy can take the single-instance lock.
        const args = link ? ['-a', installed, link] : [installed];
        if (app.relaunch({ execPath: '/usr/bin/open', args }) === false) {
          throw new Error('Could not relaunch from Applications');
        }
        app.quit();
        return true;
      } catch (error) {
        report(forReport(error, bundle));
      }
    }
    await dialog.showMessageBox({
      type: 'warning',
      message: translate('moveToApplications.failedMessage'),
      detail: translate('moveToApplications.failedDetail'),
      buttons: [translate('moveToApplications.ok')],
    });
    return false;
  } finally {
    app.removeListener('open-url', onLink);
  }
};
