/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const loadStartPage = require('../connection-recovery');
const en = require('../i18n/en.json');
const fr = require('../i18n/fr.json');

const URL = 'https://pandasuite.com/dashboard/electron/tabs/';
const KEYS = ['connection.message', 'connection.detail', 'connection.tryAgain', 'connection.close'];
const failure = (code = 'ERR_INTERNET_DISCONNECTED') => Object.assign(new Error(code), { code });
// Lets the chained promises of a failed attempt, its message and its retry run.
const settle = () => [1, 2, 3, 4, 5].reduce(
  (previous) => previous.then(() => new Promise(setImmediate)),
  Promise.resolve(),
);

// loads: what each loadURL call does in turn; answers: the button chosen in each dialog.
const setup = ({
  loads, answers = [], visible = true, loading = false,
} = {}) => {
  const win = new EventEmitter();
  win.webContents = Object.assign(new EventEmitter(), { isLoading: () => win.loading });
  win.loading = loading;
  const state = {
    loads: [], dialogs: [], shown: 0, closed: 0, destroyed: false,
  };
  Object.assign(win, {
    isDestroyed: () => state.destroyed,
    isVisible: () => visible,
    show: () => { state.shown += 1; },
    close: () => { state.closed += 1; },
    loadURL(url) {
      state.loads.push(url);
      const next = loads.shift();
      return next ? Promise.reject(next) : Promise.resolve();
    },
  });
  const showMessageBox = (parent, options) => {
    state.dialogs.push({ parent, options });
    const answer = answers.shift();
    if (answer instanceof Error) return Promise.reject(answer);
    if (typeof answer === 'function') return answer();
    return Promise.resolve({ response: answer });
  };
  return { win, state, showMessageBox };
};
const start = (setupResult, translate = (key) => en[key]) => loadStartPage({
  win: setupResult.win, url: URL, showMessageBox: setupResult.showMessageBox, translate,
});

const failures = [];
// A check left waiting forever would end the process early and silently: fail instead.
let finished = false;
process.on('exit', () => {
  if (finished) return;
  console.error('Connection recovery checks stopped before the end');
  process.exitCode = 1;
});
const rejections = [];
process.on('unhandledRejection', (reason) => rejections.push(reason));
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
  await check('Studio windows load their start page through it', () => {
    const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
    const from = source.indexOf('const createPublicationWindow');
    const body = source.slice(from, source.indexOf('\n};\n', from));
    assert(/loadStartPage\(\{\s*win,\s*url: PANDASTUDIO_START_URL,/.test(body), 'with recovery');
    assert(/showMessageBox: \(parent, options\) => dialog\.showMessageBox\(parent, options\)/
      .test(body), 'messages on the window');
    assert(/translate: translateFor\(app\.getLocale\(\)\)/.test(body), 'in the system language');
    assert(!/win\.loadURL\(/.test(body), 'no other load of the start page');
  });

  await check('texts exist in English and French', () => {
    [en, fr].forEach((language) => KEYS.forEach((key) => {
      assert.strictEqual(typeof language[key], 'string', key);
      assert(language[key].trim(), key);
    }));
  });

  await check('loaded: no message', async () => {
    const run = setup({ loads: [] });
    await start(run);
    await settle();
    assert.deepStrictEqual(run.state.loads, [URL]);
    assert.strictEqual(run.state.dialogs.length, 0);
  });

  await check('no connection: a translated message on the window', () => Promise.all(
    [en, fr].map(async (language) => {
      const run = setup({ loads: [failure()], answers: [1], visible: false });
      await start(run, (key) => language[key]);
      await settle();
      assert.strictEqual(run.state.shown, 1, 'the window is shown first');
      assert.strictEqual(run.state.dialogs.length, 1);
      const { parent, options } = run.state.dialogs[0];
      assert.strictEqual(parent, run.win);
      assert.deepStrictEqual(options, {
        type: 'warning',
        message: language['connection.message'],
        detail: language['connection.detail'],
        buttons: [language['connection.tryAgain'], language['connection.close']],
        defaultId: 0,
        cancelId: 1,
      });
    }),
  ));

  await check('startup does not wait for the answer', async () => {
    let answer;
    const run = setup({
      loads: [failure()],
      answers: [() => new Promise((resolve) => { answer = resolve; })],
    });
    let returned = false;
    start(run).then(() => { returned = true; });
    await settle();
    assert.strictEqual(run.state.dialogs.length, 1);
    assert(returned, 'returned while the message is open');
    answer({ response: 1 });
  });

  await check('try again until it loads', async () => {
    const run = setup({ loads: [failure(), failure()], answers: [0, 0] });
    await start(run);
    await settle();
    assert.deepStrictEqual(run.state.loads, [URL, URL, URL]);
    assert.strictEqual(run.state.dialogs.length, 2, 'one message per failed attempt');
    assert.strictEqual(run.state.closed, 0);
  });

  await check('the message waits for the error page to finish loading', async () => {
    const run = setup({ loads: [failure()], answers: [1], loading: true });
    await start(run);
    await settle();
    assert.strictEqual(run.state.dialogs.length, 0, 'not while the error page loads');
    run.win.loading = false;
    run.win.webContents.emit('did-stop-loading');
    await settle();
    assert.strictEqual(run.state.dialogs.length, 1);
  });

  await check('close', async () => {
    const run = setup({ loads: [failure()], answers: [1] });
    await start(run);
    await settle();
    assert.strictEqual(run.state.closed, 1);
    assert.deepStrictEqual(run.state.loads, [URL]);
  });

  await check('an interrupted load is not a failure', async () => {
    const run = setup({ loads: [Object.assign(failure('ERR_ABORTED'), { errno: -3 })] });
    await start(run);
    await settle();
    assert.strictEqual(run.state.dialogs.length, 0);
  });

  await check('window closed before or during the message', async () => {
    const before = setup({ loads: [failure()] });
    before.state.destroyed = true;
    await start(before);
    await settle();
    assert.strictEqual(before.state.dialogs.length, 0);

    let answer;
    const during = setup({
      loads: [failure()],
      answers: [() => new Promise((resolve) => { answer = resolve; })],
    });
    await start(during);
    await settle();
    during.state.destroyed = true;
    answer({ response: 0 });
    await settle();
    assert.deepStrictEqual(during.state.loads, [URL], 'no new attempt');
    assert.strictEqual(during.state.closed, 0);
  });

  await check('a failing message stays contained', async () => {
    const run = setup({ loads: [failure()], answers: [new Error('no dialog')] });
    await start(run);
    await settle();
    const throwing = setup({ loads: [failure()] });
    throwing.showMessageBox = () => { throw new Error('no dialog'); };
    await start(throwing);
  });

  finished = true;
  if (failures.length) {
    console.error(`Connection recovery checks failed:\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log('Connection recovery checks passed');
  process.exit(0);
})();
