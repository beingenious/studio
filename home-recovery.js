// This controller retains a BrowserView, never a mutable tab URL or the shell.
module.exports = function attachHomeRecovery({
  view, window, isSelected, showMessageBox, translate, log,
}) {
  const contents = view.webContents;
  let disposed = false;
  let failure = null;
  let dismissed = false;
  let prompt = null;
  let generation = 0;
  let hangStarted = null;
  let loadStarted = null;
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
    clearFailure();
    record('reload-requested', { source });
    try {
      contents.reload();
      return true;
    } catch (error) {
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
    try {
      result = showMessageBox(window, {
        type: 'warning',
        title: translate('homeRecovery.title'),
        message: translate('homeRecovery.message'),
        buttons: [translate('Reload'), translate('Cancel')],
        defaultId: 0,
        cancelId: 1,
      });
    } catch (error) {
      result = Promise.reject(error);
    }
    Promise.resolve(result).then(({ response }) => {
      if (!alive() || token !== generation) return;
      if (!isSelected()) return;
      dismissed = true;
      if (response === 0) reload('dialog');
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
    } else if (failure === 'hang' && kind !== 'hang') {
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
    fail('crash');
  });
  on('did-fail-load', (event, code, description, url, mainFrame) => {
    if (!mainFrame || code === -3) return;
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
    clearFailure();
    record('load-finished', loadStarted === null ? {} : { durationMs: Date.now() - loadStarted });
  });
  return {
    selected: offer,
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
      clearFailure();
      listeners.forEach(([event, listener]) => contents.removeListener(event, listener));
    },
  };
};
