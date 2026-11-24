// Without a connection the start page cannot load and the window stays empty: say so, and
// offer to try again. Resolves once the first attempt is over, without waiting for an answer.
module.exports = function loadStartPage({
  win, url, showMessageBox, translate,
}) {
  const contents = win.webContents;
  // After a failure Chromium still loads its error page. A new attempt started before that
  // ends would take the error page for its own success and miss its real failure.
  const stopped = () => (contents.isLoading()
    ? new Promise((resolve) => contents.once('did-stop-loading', resolve))
    : undefined);
  let attempt;
  const offer = () => {
    if (win.isDestroyed()) return undefined;
    return showMessageBox(win, {
      type: 'warning',
      message: translate('connection.message'),
      detail: translate('connection.detail'),
      buttons: [translate('connection.tryAgain'), translate('connection.close')],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (win.isDestroyed()) return undefined;
      if (response === 0) return attempt();
      win.close();
      return undefined;
    });
  };
  attempt = () => win.loadURL(url).catch((error) => {
    // An interrupted load (a redirect, a new navigation) is not a failure.
    if ((error && error.code === 'ERR_ABORTED') || win.isDestroyed()) return;
    if (!win.isVisible()) win.show();
    Promise.resolve().then(stopped).then(offer).catch(() => {});
  });
  return attempt();
};
