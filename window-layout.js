// Electron 11's Windows autoresize uses outer-window deltas. Native frame
// changes also alter the content area, so size every retained view explicitly.
module.exports = (win, tabHeight) => {
  const layout = () => {
    if (win.isDestroyed()) return;
    const { width, height } = win.getContentBounds();
    win.getBrowserViews().forEach((view) => {
      view.setBounds({
        x: 0, y: tabHeight, width, height: height - tabHeight,
      });
    });
  };
  win.on('resize', layout);
  // Windows announces fullscreen before applying its native frame change.
  const afterFrameChange = () => setImmediate(layout);
  win.on('enter-full-screen', afterFrameChange);
  win.on('leave-full-screen', afterFrameChange);
};
