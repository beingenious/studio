// This controller retains a BrowserView, never a mutable tab URL or the shell.
// Home's wording; a project tab passes its own, per kind of failure.
const homeTexts = (translate) => () => ({
  title: translate('homeRecovery.title'),
  message: translate('homeRecovery.message'),
  buttons: [translate('Reload'), translate('Cancel')],
  defaultId: 0,
  reload: true,
});

module.exports = function attachHomeRecovery({
  view, window, isSelected, showMessageBox, translate, log,
  texts = homeTexts(translate), sharesProcess = () => true,
}) {
  const contents = view.webContents;
  let disposed = false;
  let failure = null;
  let dismissed = false;
  let prompt = null;
  let generation = 0;
  let hangStarted = null;
  let loadStarted = null;
  // Set while the exit caused by a hang's recovery is expected, so it is not taken for a crash.
  let killing = false;
  const listeners = [];
  const alive = () => !disposed && !window.isDestroyed() && !contents.isDestroyed();
  const record = (event, data = {}) => {
    try {
      log(event, { viewId: contents.id, ...data });
    } catch (error) { /* Diagnostics are optional. */ }
  };
  const clearFailure = () => {
    failure = null;
    dismissed = false;
    generation += 1;
  };
  const reload = (source = 'menu') => {
    if (!alive() || !isSelected()) {
      record('reload-unavailable');
      return false;
    }
    // A stuck page does not reload: its renderer has to go first. Only when no other window
    // or tab lives in that process.
    const kill = failure === 'hang' && !sharesProcess();
    clearFailure();
    record('reload-requested', { source });
    try {
      if (kill) {
        killing = true;
        contents.forcefullyCrashRenderer();
      }
      contents.reload();
      return true;
    } catch (error) {
      killing = false;
      record('reload-failed');
      return false;
    }
  };
  const offer = () => {
    if (!alive() || !isSelected() || !failure || dismissed || prompt) return;
    const token = generation;
    const pending = {};
    prompt = pending;
    let result;
    let canReload = false;
    try {
      const {
        reload: reloads, buttons, ...fields
      } = texts(failure, { canReload: failure !== 'hang' || !sharesProcess() });
      canReload = reloads;
      result = showMessageBox(window, {
        type: 'warning',
        ...fields,
        buttons,
        cancelId: buttons.length - 1,
      });
    } catch (error) {
      result = Promise.reject(error);
    }
    Promise.resolve(result).then(({ response }) => {
      if (!alive() || token !== generation) return;
      if (!isSelected()) return;
      dismissed = true;
      if (response === 0 && canReload) reload('dialog');
    }).catch(() => {
      if (token === generation) dismissed = true;
      record('dialog-failed');
    }).then(() => {
      if (prompt === pending) prompt = null;
      // A new failure may have arrived while an obsolete dialog was closing.
      if (generation !== token) offer();
    });
  };
  const fail = (kind) => {
    if (!failure) {
      failure = kind;
      dismissed = false;
      generation += 1;
    } else if ((failure === 'hang' && kind !== 'hang') || (failure === 'load' && kind === 'crash')) {
      // A worse failure replaces the one on screen, or one the user set aside.
      failure = kind;
      dismissed = false;
      generation += 1;
    }
    offer();
  };
  const on = (event, listener) => {
    contents.on(event, listener);
    listeners.push([event, listener]);
  };
  on('render-process-gone', (event, details) => {
    record('renderer-exited', { reason: details.reason, exitCode: details.exitCode });
    // Its reason varies by platform ('killed', or 'crashed' on Linux): any exit will do.
    if (killing) {
      killing = false;
      return;
    }
    fail('crash');
  });
  on('did-fail-load', (event, code, description, url, mainFrame) => {
    if (!mainFrame || code === -3) return;
    killing = false;
    record('load-failed', {
      errorCode: code,
      ...(loadStarted === null ? {} : { durationMs: Date.now() - loadStarted }),
    });
    fail('load');
  });
  on('unresponsive', () => {
    if (hangStarted === null) hangStarted = Date.now();
    record('unresponsive');
    fail('hang');
  });
  on('responsive', () => {
    record('responsive', hangStarted === null ? {} : { durationMs: Date.now() - hangStarted });
    hangStarted = null;
    if (failure === 'hang') clearFailure();
  });
  on('did-start-loading', () => {
    loadStarted = Date.now();
    clearFailure();
    record('load-started');
  });
  on('did-finish-load', () => {
    killing = false;
    clearFailure();
    record('load-finished', loadStarted === null ? {} : { durationMs: Date.now() - loadStarted });
  });
  return {
    selected: offer,
    // Choosing the tab again is a new chance for a stuck page the user chose to wait for. Not on
    // window focus: closing the message gives focus back to the window.
    tabSelected() {
      if (failure === 'hang') dismissed = false;
      offer();
    },
    reload,
    loadRejected(error) {
      // did-fail-load usually precedes the loadURL rejection. Both share an episode.
      if (error && (error.errno === -3 || error.code === 'ERR_ABORTED')) return;
      record('load-rejected', { errorCode: error && error.errno });
      fail('load');
    },
    reportReactError(sender, data) {
      if (!alive() || sender !== contents || !data || data.boundary !== 'home') return false;
      record('react-error', { boundary: 'home', errorName: data.errorName });
      return true;
    },
    dispose() {
      disposed = true;
      killing = false;
      clearFailure();
      listeners.forEach(([event, listener]) => contents.removeListener(event, listener));
    },
  };
};
