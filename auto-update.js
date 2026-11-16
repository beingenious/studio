const FOUR_HOURS = 1000 * 60 * 60 * 4;
// Squirrel.Mac unpacks each attempt into a random folder; one message per failure keeps
// retries of the same refusal together.
const SQUIRREL_FOLDER = /\/update\.[^/]+\//g;

// Checks for updates at startup and every four hours where the installation can update
// itself. Download failures are reported as handled errors; check failures (offline,
// proxy, DNS) stay silent and are retried at the next check.
module.exports = (autoUpdater, report) => {
  if (!autoUpdater.isUpdaterActive()) return null;

  if (autoUpdater.nativeUpdater) {
    autoUpdater.nativeUpdater.on('error', (error) => {
      if (error && typeof error.message === 'string') {
        // eslint-disable-next-line no-param-reassign
        error.message = error.message.replace(SQUIRREL_FOLDER, '/update.*/');
      }
      report(error);
    });
  }

  const check = () => autoUpdater.checkForUpdates().then(
    (result) => result && result.downloadPromise
      && result.downloadPromise.catch((error) => report(error)),
    () => {},
  );
  check();
  return setInterval(check, FOUR_HOURS);
};
