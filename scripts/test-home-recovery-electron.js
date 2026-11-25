/* eslint-disable no-console */
const { app, BrowserWindow, BrowserView } = require('electron');
const http = require('http');
const assert = require('assert');
const attach = require('../home-recovery');

const records = [];
let win;
let server;
let controller;
const timeout = setTimeout(() => { console.error('SMOKE TIMEOUT'); app.exit(1); }, 25000);
const loaded = (contents) => new Promise((resolve, reject) => {
  contents.once('did-finish-load', resolve);
  contents.once('destroyed', () => reject(new Error('contents destroyed')));
});
app.whenReady().then(async () => {
  server = http.createServer((request, response) => {
    if (request.url === '/failure') {
      response.destroy();
      return;
    }
    const key = request.url;
    response.end(`<html><body>${key}<script>window.sentinel=${JSON.stringify(`${key}-alive`)};</script></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false } });
  const home = new BrowserView();
  const project = new BrowserView();
  win.addBrowserView(home);
  win.addBrowserView(project);
  const loads = { shell: 0, project: 0, home: 0 };
  win.webContents.on('did-finish-load', () => { loads.shell += 1; });
  project.webContents.on('did-finish-load', () => { loads.project += 1; });
  home.webContents.on('did-finish-load', () => { loads.home += 1; });
  let selected = true;
  let prompts = 0;
  let responseChoice = 0;
  controller = attach({
    view: home,
    window: win,
    isSelected: () => selected,
    showMessageBox: () => {
      prompts += 1;
      return new Promise((resolve) => setImmediate(() => resolve({ response: responseChoice })));
    },
    translate: (key) => key,
    log: (event, data) => { records.push({ event, ...data }); },
  });
  await win.loadURL(`${base}/shell`);
  await project.webContents.loadURL(`${base}/project`);
  await home.webContents.loadURL(`${base}/home`);
  const shellCount = loads.shell;
  const projectCount = loads.project;
  let done = loaded(home.webContents);
  assert(controller.reload('menu'));
  await done;
  assert.strictEqual(loads.home, 2);
  assert.strictEqual(loads.shell, shellCount);
  assert.strictEqual(loads.project, projectCount);
  assert.strictEqual(await win.webContents.executeJavaScript('window.sentinel'), '/shell-alive');
  assert.strictEqual(await project.webContents.executeJavaScript('window.sentinel'), '/project-alive');
  selected = false;
  home.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 9 });
  assert.strictEqual(prompts, 0);
  selected = true;
  done = loaded(home.webContents);
  controller.selected();
  await done;
  assert.strictEqual(prompts, 1);
  assert.strictEqual(loads.home, 3);
  assert.strictEqual(loads.project, projectCount);
  assert.strictEqual(loads.shell, shellCount);
  assert(records.some((record) => record.event === 'renderer-exited'));
  assert(records.some((record) => record.event === 'reload-requested'));
  selected = false;
  responseChoice = 1;
  await home.webContents.loadURL(`${base}/failure`).catch((error) => controller.loadRejected(error));
  assert.strictEqual(prompts, 1, 'real failed load stays deferred in background');
  selected = true;
  controller.selected();
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(prompts, 2);
  assert(records.some((record) => record.event === 'load-failed'));
  await home.webContents.loadURL(`${base}/home`);
  responseChoice = 0;
  const pids = {
    home: home.webContents.getOSProcessId(),
    project: project.webContents.getOSProcessId(),
    shell: win.webContents.getOSProcessId(),
  };
  let actualCrash = 'skipped: renderer process shared';
  if (pids.home !== pids.project && pids.home !== pids.shell) {
    done = loaded(home.webContents);
    home.webContents.forcefullyCrashRenderer();
    await done;
    assert.strictEqual(loads.shell, shellCount);
    assert.strictEqual(loads.project, projectCount);
    assert.strictEqual(await project.webContents.executeJavaScript('window.sentinel'), '/project-alive');
    assert.strictEqual(await win.webContents.executeJavaScript('window.sentinel'), '/shell-alive');
    actualCrash = 'PASS actual Home renderer crash recovered; project/shell unchanged';
  }
  console.log(JSON.stringify({
    actualCrash,
    pids,
    result: 'PASS',
    electron: process.versions.electron,
    checks: ['native Home reload', 'background failure deferred', 'native failure recovery', 'real failed main-frame load',
      'project and shell loads unchanged', 'project and shell sentinels preserved'],
    shellLoads: loads.shell,
    projectLoads: loads.project,
    homeLoads: loads.home,
    limitation: 'The original overnight blank Home was not reproduced',
  }));
  controller.dispose();
  win.destroy();
  server.close();
  clearTimeout(timeout);
  app.quit();
}).catch((error) => {
  console.error(error.stack);
  if (controller) controller.dispose();
  if (win) win.destroy();
  if (server) server.close();
  clearTimeout(timeout);
  app.exit(1);
});
