/* eslint-disable no-console */
const { app, BrowserWindow, BrowserView } = require('electron');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const captureWindowOptions = require('./capture-window-options');
const attachWindowLayout = require('../window-layout');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'studio-window-frame-')));
let win;
let phase = 'app ready';
const deadline = setTimeout(() => {
  console.error(`Native window smoke timed out waiting for ${phase}`);
  if (win) {
    console.error(JSON.stringify({
      bounds: win.getBounds(),
      maximized: win.isMaximized(),
      minimized: win.isMinimized(),
      fullscreen: win.isFullScreen(),
      loading: win.webContents.isLoading(),
      renderer: win.webContents.getOSProcessId(),
    }));
  }
  app.exit(1);
}, 30000);
const transition = (event, action) => new Promise((resolve) => {
  phase = event;
  console.log(`Waiting for ${event}`);
  win.once(event, () => {
    console.log(`Received ${event}`);
    resolve();
  });
  action();
});
const dataPage = (name) => `data:text/html,${encodeURIComponent(
  `<body style="margin:0"><script>window.sentinel=${JSON.stringify(name)}</script>${name}</body>`,
)}`;

app.whenReady().then(async () => {
  const options = await captureWindowOptions(process.platform);
  assert.strictEqual(options.frame, true, 'this native smoke targets macOS/Windows');
  win = new BrowserWindow({ ...options, show: true });
  if (process.platform === 'win32') attachWindowLayout(win, 45);
  win.webContents.on('render-process-gone', (event, details) => {
    console.error('Shell renderer exited', details);
  });
  win.webContents.on('did-fail-load', (event, code, description) => {
    console.error('Shell failed to load', code, description);
  });
  phase = 'shell load';
  await win.loadURL(dataPage('shell'));
  // Production creates BrowserViews only after the loaded tabs shell asks for one.
  const project = new BrowserView({ webPreferences: { contextIsolation: false } });
  win.addBrowserView(project);
  phase = 'project load';
  await project.webContents.loadURL(dataPage('project'));
  const content = win.getContentBounds();
  project.setBounds({
    x: 0, y: 45, width: content.width, height: content.height - 45,
  });
  project.setAutoResize({ width: true, height: true });
  assert.strictEqual(await win.webContents.executeJavaScript('window.studioNativeWindowFrame'), true);
  const verify = async () => {
    const size = win.getContentBounds();
    const bounds = project.getBounds();
    assert.strictEqual(bounds.x, 0);
    assert.strictEqual(bounds.y, 45);
    assert.strictEqual(bounds.width, size.width);
    assert.strictEqual(bounds.height, size.height - 45);
    assert.strictEqual(await win.webContents.executeJavaScript('window.sentinel'), 'shell');
    assert.strictEqual(await project.webContents.executeJavaScript('window.sentinel'), 'project');
  };
  await verify();
  await transition('maximize', () => win.maximize());
  assert(win.isMaximized());
  await verify();
  await transition('unmaximize', () => win.unmaximize());
  await verify();
  await transition('minimize', () => win.minimize());
  assert(win.isMinimized());
  await transition('restore', () => win.restore());
  await verify();
  const fullscreenCycle = async () => {
    await transition('enter-full-screen', () => win.setFullScreen(true));
    await new Promise((resolve) => setImmediate(resolve));
    assert(win.isFullScreen());
    await verify();
    await transition('leave-full-screen', () => win.setFullScreen(false));
    await new Promise((resolve) => setImmediate(resolve));
    assert(!win.isFullScreen());
    await verify();
  };
  await fullscreenCycle();
  await fullscreenCycle();
  await fullscreenCycle();
  console.log(`Native frame smoke passed: ${process.platform}, Electron ${process.versions.electron}; caption states, 3 fullscreen cycles, y45 and renderer preservation`);
  win.destroy();
  clearTimeout(deadline);
  app.quit();
}).catch((error) => {
  console.error(error);
  if (win && !win.isDestroyed()) win.destroy();
  clearTimeout(deadline);
  app.exit(1);
});
