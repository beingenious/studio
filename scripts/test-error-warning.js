/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const util = require('util');
const createErrorWarning = require('../error-warning');
const en = require('../i18n/en.json');
const fr = require('../i18n/fr.json');

const KEYS = ['errorWarning.message', 'errorWarning.detail', 'errorWarning.ok', 'errorWarning.copy'];
const HOME = '/Users/jane';

const settle = () => [1, 2, 3, 4, 5, 6].reduce(
  (previous) => previous.then(() => new Promise(setImmediate)),
  Promise.resolve(),
);
const failure = (message, frame = 'at open (/Users/jane/Studio/app.js:1:1)') => {
  const error = new Error(message);
  error.stack = `Error: ${message}\n    ${frame}`;
  return error;
};
const fakeWindow = ({ visible = true, minimized = false, destroyed = false } = {}) => ({
  isVisible: () => visible,
  isMinimized: () => minimized,
  isDestroyed: () => destroyed,
});

// answers: what each message does in turn (a button index, an Error, or a pending promise).
const setup = ({
  windows = [fakeWindow()], focused = null, answers = [], language = en, home = HOME,
} = {}) => {
  const state = {
    logged: [], dialogs: [], clipboard: [], focusWaiters: [], ready: false, readyWaiters: [],
  };
  const app = {
    windows,
    focused,
  };
  const warn = createErrorWarning({
    whenReady: () => (state.ready
      ? Promise.resolve()
      : new Promise((resolve) => state.readyWaiters.push(resolve))),
    nextFocusedWindow: () => new Promise((resolve) => state.focusWaiters.push(resolve)),
    BrowserWindow: {
      getFocusedWindow: () => app.focused,
      getAllWindows: () => app.windows,
    },
    showMessageBox: (parent, options) => {
      state.dialogs.push({ parent, options });
      const answer = answers.shift();
      if (answer instanceof Error) return Promise.reject(answer);
      if (answer instanceof Promise) return answer;
      return Promise.resolve({ response: answer === undefined ? 0 : answer });
    },
    translate: () => (key) => language[key],
    writeClipboard: (text) => state.clipboard.push(text),
    home,
    log: (error) => state.logged.push(error),
  });
  const ready = () => {
    state.ready = true;
    state.readyWaiters.splice(0).forEach((resolve) => resolve());
  };
  const focus = () => state.focusWaiters.splice(0).forEach((resolve) => resolve());
  return {
    warn, state, app, ready, focus,
  };
};

const failures = [];
const rejections = [];
process.on('unhandledRejection', (reason) => rejections.push(reason));
// A check left waiting forever would end the process early and silently: fail instead.
let finished = false;
process.on('exit', () => {
  if (finished) return;
  console.error('Error warning checks stopped before the end');
  process.exitCode = 1;
});
const check = async (name, test) => {
  const before = rejections.length;
  try {
    await test();
    await settle();
    assert.strictEqual(rejections.length, before, 'no unhandled rejection');
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
};

(async () => {
  await check('Studio uses it, outside development, in the right language', () => {
    const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
    const outsideDevelopment = /unhandled\(is\.development \? \{\} : \{\s*showDialog: false,/;
    assert(outsideDevelopment.test(source), 'replaces the technical dialog');
    assert(/showDialog: false,\s*logger: createErrorWarning\(/.test(source), 'with this warning');
    assert(/translate: \(\) => \(dashboardLanguage \? __ : translateFor\(app\.getLocale\(\)\)\)/
      .test(source), 'the dashboard language once set, the system one before');
    assert(/home: app\.getPath\('home'\)/.test(source), 'the home folder is cleaned');
    assert(/showMessageBox: \(parent, options\) => dialog\.showMessageBox\(parent, options\)/
      .test(source), 'on its window');
    assert(/writeClipboard: \(text\) => clipboard\.writeText\(text\)/.test(source), 'copies');
    assert(/app\.once\('browser-window-focus', resolve\)/.test(source), 'waits for a window');
    const handler = source.slice(source.indexOf("ipcMain.on('updateLanguage'"));
    const set = handler.indexOf('dashboardLanguage = true');
    assert(set > handler.indexOf('changeLocale(data.language)'), 'set once the language is valid');
    assert(set < handler.indexOf('if (changed)'), 'set even when the language does not change');
  });

  await check('texts exist in English and French', () => {
    [en, fr].forEach((language) => KEYS.forEach((key) => {
      assert.strictEqual(typeof language[key], 'string', key);
      assert(language[key].trim(), key);
    }));
  });

  await check('one translated message on the window, once ready', () => Promise.all(
    [en, fr].map(async (language) => {
      const run = setup({ language });
      const error = failure('boom');
      run.warn(error);
      await settle();
      assert.deepStrictEqual(run.state.logged, [error], 'logged at once');
      assert.strictEqual(run.state.dialogs.length, 0, 'nothing before ready');
      run.ready();
      await settle();
      assert.strictEqual(run.state.dialogs.length, 1);
      assert.strictEqual(run.state.dialogs[0].parent, run.app.windows[0]);
      assert.deepStrictEqual(run.state.dialogs[0].options, {
        type: 'warning',
        message: language['errorWarning.message'],
        detail: language['errorWarning.detail'],
        buttons: [language['errorWarning.ok'], language['errorWarning.copy']],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      assert.deepStrictEqual(run.state.clipboard, [], 'OK copies nothing');
    }),
  ));

  await check('the focused window first, else another visible one', async () => {
    const focused = fakeWindow();
    const run = setup({ windows: [fakeWindow(), focused], focused });
    run.ready();
    run.warn(failure('one'));
    await settle();
    assert.strictEqual(run.state.dialogs[0].parent, focused);

    const visible = fakeWindow();
    const other = setup({
      windows: [fakeWindow({ visible: false }), fakeWindow({ destroyed: true }), visible],
      focused: fakeWindow({ minimized: true }),
    });
    other.ready();
    other.warn(failure('two'));
    await settle();
    assert.strictEqual(other.state.dialogs[0].parent, visible);
  });

  await check('no window that can show it: waits for one to get focus', async () => {
    const run = setup({ windows: [fakeWindow({ minimized: true })] });
    run.ready();
    run.warn(failure('boom'));
    await settle();
    assert.strictEqual(run.state.dialogs.length, 0, 'never without a window');
    // The focused window can be gone again: asked anew.
    run.focus();
    await settle();
    assert.strictEqual(run.state.dialogs.length, 0);
    const win = fakeWindow();
    run.app.windows = [win];
    run.focus();
    await settle();
    assert.strictEqual(run.state.dialogs.length, 1);
    assert.strictEqual(run.state.dialogs[0].parent, win);
  });

  await check('one at a time, never twice the same error, a new one is told', async () => {
    let answer;
    const run = setup({ answers: [new Promise((resolve) => { answer = resolve; })] });
    run.ready();
    run.warn(failure('first'));
    run.warn(failure('second', 'at other (/Users/jane/Studio/other.js:2:2)'));
    await settle();
    assert.strictEqual(run.state.dialogs.length, 1, 'not while one is open');
    assert.strictEqual(run.state.logged.length, 2, 'both logged');
    answer({ response: 0 });
    await settle();
    run.warn(failure('first, at another time'));
    await settle();
    assert.strictEqual(run.state.dialogs.length, 1, 'same frames: same error');
    run.warn(failure('third', 'at more (/Users/jane/Studio/more.js:3:3)'));
    await settle();
    assert.strictEqual(run.state.dialogs.length, 2, 'a different error is told');
  });

  await check('a message over several lines is still the same error', async () => {
    const run = setup();
    run.ready();
    run.warn(failure('boom\nfirst detail'));
    await settle();
    run.warn(failure('boom\nsecond detail'));
    await settle();
    assert.strictEqual(run.state.dialogs.length, 1);
  });

  await check('two different rejected values are two errors', async () => {
    const run = setup();
    run.ready();
    const rejected = (value) => {
      const error = new Error(`Non-error value: ${value}`);
      error.name = 'NonError';
      error.stack = `NonError: ${value}\n    at ensureError (node_modules/ensure-error/index.js:1:1)`;
      return error;
    };
    run.warn(rejected("'offline'"));
    await settle();
    run.warn(rejected("'timeout'"));
    await settle();
    assert.strictEqual(run.state.dialogs.length, 2);
  });

  await check('a message that failed is tried again for the same error', async () => {
    const run = setup({ answers: [new Error('no dialog')] });
    run.ready();
    run.warn(failure('boom'));
    await settle();
    run.warn(failure('boom'));
    await settle();
    assert.strictEqual(run.state.dialogs.length, 2);
  });

  await check('Copy Details: the stack without the home folder', async () => {
    const run = setup({ answers: [1] });
    run.ready();
    run.warn(failure('cannot read /Users/jane/Documents/x'));
    await settle();
    assert.deepStrictEqual(run.state.clipboard, [
      'Error: cannot read ~/Documents/x\n    at open (~/Studio/app.js:1:1)',
    ]);

    // A rejected string, as electron-unhandled hands it over (ensure-error inspects it).
    const windows = setup({ answers: [1], home: 'C:\\Users\\Jane' });
    windows.ready();
    const value = util.inspect('C:\\Users\\Jane\\work.js');
    const rejected = new Error(`Non-error value: ${value}`);
    rejected.stack = `NonError: ${value}\n    at c:\\users\\jane\\app.js:1:1`;
    windows.warn(rejected);
    await settle();
    assert.deepStrictEqual(windows.state.clipboard, [
      "NonError: '~\\\\work.js'\n    at ~\\app.js:1:1",
    ]);
  });

  await check('nothing escapes from the warning', async () => {
    const throwing = createErrorWarning({
      whenReady: () => Promise.resolve(),
      nextFocusedWindow: () => new Promise(() => {}),
      BrowserWindow: { getFocusedWindow: () => { throw new Error('gone'); }, getAllWindows: () => [] },
      showMessageBox: () => { throw new Error('no dialog'); },
      translate: () => (key) => key,
      writeClipboard: () => { throw new Error('no clipboard'); },
      home: HOME,
      log: () => { throw new Error('no log'); },
    });
    assert.doesNotThrow(() => throwing(failure('boom')));
    assert.doesNotThrow(() => throwing(null));
  });

  finished = true;
  if (failures.length) {
    console.error(`Error warning checks failed:\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log('Error warning checks passed');
  process.exit(0);
})();
