/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const attachHomeRecovery = require('../home-recovery');
const createLog = require('../home-recovery-log');
const en = require('../i18n/en.json');
const fr = require('../i18n/fr.json');

const tick = () => new Promise((resolve) => setImmediate(resolve));
// The wording a project tab gives, as index.js builds it.
const texts = (kind, { canReload }) => {
  if (kind === 'hang' && !canReload) {
    return {
      message: 'hang', detail: 'restart', buttons: ['OK'], defaultId: 0, reload: false,
    };
  }
  if (kind === 'hang') {
    return {
      message: 'hang', detail: 'wait', buttons: ['Reload', 'Wait'], defaultId: 1, reload: true,
    };
  }
  return {
    message: kind, detail: kind, buttons: ['Reload', 'Cancel'], defaultId: 0, reload: true,
  };
};

const fixture = ({ shared = false } = {}) => {
  const contents = new EventEmitter();
  Object.assign(contents, {
    id: 7,
    isDestroyed: () => false,
    steps: [],
    reload: () => contents.steps.push('reload'),
    forcefullyCrashRenderer: () => contents.steps.push('crash'),
  });
  const dialogs = [];
  const answers = [];
  const records = [];
  const controller = attachHomeRecovery({
    view: { webContents: contents },
    window: { isDestroyed: () => false },
    isSelected: () => true,
    showMessageBox: (parent, options) => {
      dialogs.push(options);
      return new Promise((resolve) => answers.push(resolve));
    },
    translate: (key) => key,
    texts,
    sharesProcess: () => shared,
    log: (event, data) => records.push({ event, ...data }),
  });
  const answer = async (response) => {
    answers.shift()({ response });
    await tick();
  };
  return {
    contents, controller, dialogs, records, answer,
  };
};

const failures = [];
const check = async (name, test) => {
  try {
    await test();
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
};

(async () => {
  await check('texts exist in English and French', () => {
    const keys = ['crashMessage', 'crashDetail', 'loadMessage', 'loadDetail', 'hangMessage',
      'hangDetail', 'hangRestartDetail', 'wait', 'ok'].map((key) => `projectRecovery.${key}`);
    [en, fr].forEach((language) => keys.forEach((key) => {
      assert.strictEqual(typeof language[key], 'string', key);
      assert(language[key].trim(), key);
    }));
  });

  await check('each kind of failure says its own words', async () => {
    const crash = fixture();
    crash.contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    assert.deepStrictEqual(crash.dialogs[0], {
      type: 'warning',
      message: 'crash',
      detail: 'crash',
      buttons: ['Reload', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    });
    const load = fixture();
    load.contents.emit('did-fail-load', {}, -106, 'offline', 'https://x', true);
    assert.strictEqual(load.dialogs[0].message, 'load');
    const hang = fixture();
    hang.contents.emit('unresponsive');
    assert.deepStrictEqual(hang.dialogs[0].buttons, ['Reload', 'Wait']);
    assert.strictEqual(hang.dialogs[0].defaultId, 1, 'waiting is the default');
    assert.strictEqual(hang.dialogs[0].cancelId, 1);
  });

  await check('a stuck page in its own process: its renderer ends, then it reloads', async () => {
    const run = fixture();
    run.contents.emit('unresponsive');
    await run.answer(0);
    assert.deepStrictEqual(run.contents.steps, ['crash', 'reload']);
    run.contents.emit('did-start-loading');
    // Linux reports the exit as a crash: either way it is the one just caused.
    run.contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    assert.strictEqual(run.dialogs.length, 1, 'not taken for a crash');
    run.contents.emit('did-finish-load');
    run.contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    assert.strictEqual(run.dialogs.length, 2, 'a later real crash is told');
    assert.strictEqual(run.dialogs[1].message, 'crash');
  });

  await check('an expected exit that never comes does not hide a later crash', async () => {
    const run = fixture();
    run.contents.emit('unresponsive');
    await run.answer(0);
    run.contents.emit('did-fail-load', {}, -2, 'failed', 'https://x', true);
    await run.answer(1);
    run.contents.emit('did-start-loading');
    run.contents.emit('render-process-gone', {}, { reason: 'killed', exitCode: 9 });
    assert.strictEqual(run.dialogs[run.dialogs.length - 1].message, 'crash');
  });

  await check('a reload that loads without the expected exit leaves crashes told', async () => {
    const run = fixture();
    run.contents.emit('unresponsive');
    await run.answer(0);
    run.contents.emit('did-start-loading');
    run.contents.emit('did-finish-load');
    run.contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    assert.strictEqual(run.dialogs[run.dialogs.length - 1].message, 'crash');
  });

  await check('a stuck page sharing its process: no reload offered, nothing ended', async () => {
    const run = fixture({ shared: true });
    run.contents.emit('unresponsive');
    assert.deepStrictEqual(run.dialogs[0].buttons, ['OK']);
    assert.strictEqual(run.dialogs[0].detail, 'restart');
    await run.answer(0);
    assert.deepStrictEqual(run.contents.steps, [], 'OK does not reload');
    // Home's menu item can still reload it: never by ending a shared process.
    run.contents.emit('unresponsive');
    run.controller.tabSelected();
    run.controller.reload('menu');
    assert.deepStrictEqual(run.contents.steps, ['reload']);
  });

  await check('waiting: offered again when the tab is chosen again, not on focus', async () => {
    const run = fixture();
    run.contents.emit('unresponsive');
    await run.answer(1);
    run.controller.selected();
    await tick();
    assert.strictEqual(run.dialogs.length, 1, 'window focus does not reopen it');
    run.controller.tabSelected();
    assert.strictEqual(run.dialogs.length, 2, 'choosing the tab does');
    run.contents.emit('responsive');
    await run.answer(0);
    assert.deepStrictEqual(run.contents.steps, [], 'a page that answered again is not reloaded');
  });

  await check('records say which kind of tab, nothing more', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tab-recovery-'));
    try {
      const file = path.join(dir, 'log');
      const log = createLog({ file });
      log('unresponsive', { viewId: 3, role: 'project' });
      log('unresponsive', { viewId: 4, role: 'home' });
      log('unresponsive', { viewId: 5, role: 'https://pandasuite.com/authoring/1' });
      const roles = fs.readFileSync(file, 'utf8').trim().split('\n')
        .map((line) => JSON.parse(line).role);
      assert.deepStrictEqual(roles, ['project', 'home', undefined]);
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  if (failures.length) {
    console.error(`Tab recovery checks failed:\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log('Tab recovery checks passed');
  process.exit(0);
})();
