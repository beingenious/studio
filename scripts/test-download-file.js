/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const downloadFile = require('../download-file');
const en = require('../i18n/en.json');
const fr = require('../i18n/fr.json');

const DIR = '/Users/jane/Downloads';
const URL = 'https://pandasuite.com/get_aws_url_for/123';
const KEYS = ['download.failedMessage', 'download.failedDetail', 'download.tryAgain', 'Cancel'];

// Lets the chained promises of a failure and its message run.
const settle = () => [1, 2, 3, 4, 5].reduce(
  (previous) => previous.then(() => new Promise(setImmediate)),
  Promise.resolve(),
);

const fakeItem = ({
  url = URL, filename = 'export.zip', total = 100, mime = 'application/zip',
} = {}) => {
  const item = new EventEmitter();
  Object.assign(item, {
    received: 0,
    savePath: null,
    cancelled: 0,
    getURLChain: () => [url, 'https://bucket.example/export.zip?signature'],
    getFilename: () => filename,
    getMimeType: () => mime,
    getTotalBytes: () => total,
    getReceivedBytes: () => item.received,
    setSavePath: (file) => { item.savePath = file; },
    // As in Electron 11, cancel() emits 'done' before it returns.
    cancel: () => {
      item.cancelled += 1;
      item.emit('done', {}, 'cancelled');
    },
  });
  return item;
};

const studio = ({ existing = [], answers = [] } = {}) => {
  const session = new EventEmitter();
  const win = new EventEmitter();
  const state = {
    requested: [],
    progress: [],
    dialogs: [],
    revealed: [],
    finished: [],
    removed: [],
    destroyed: false,
  };
  win.webContents = {
    session,
    downloadURL: (url) => state.requested.push(url),
  };
  Object.assign(win, {
    isDestroyed: () => state.destroyed,
    setProgressBar: (value) => state.progress.push(value),
  });
  // Downloads is case-insensitive, as on most Macs and Windows PCs.
  const files = new Set(existing.map((name) => path.join(DIR, name).toLowerCase()));
  const options = (translate = (key) => en[key]) => ({
    win,
    url: URL,
    directory: DIR,
    showMessageBox: (parent, dialog) => {
      state.dialogs.push({ parent, dialog });
      const answer = answers.shift();
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve({ response: answer === undefined ? 1 : answer });
    },
    showItemInFolder: (file) => state.revealed.push(file),
    downloadFinished: (file) => state.finished.push(file),
    translate,
    fs: {
      existsSync: (file) => files.has(file.toLowerCase()),
      unlinkSync: (file) => {
        state.removed.push(file);
        files.delete(file.toLowerCase());
      },
    },
  });
  // Electron announces the item on the session of the window that asked for it.
  const start = (item, source = win.webContents) => {
    session.emit('will-download', {}, item, source);
    if (item.savePath) files.add(item.savePath.toLowerCase());
  };
  return {
    win, session, state, options, start, files,
  };
};

const failures = [];
const rejections = [];
process.on('unhandledRejection', (reason) => rejections.push(reason));
// A check left waiting forever would end the process early and silently: fail instead.
let finished = false;
process.on('exit', () => {
  if (finished) return;
  console.error('Download checks stopped before the end');
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
  await check('Studio downloads through it, without electron-dl', () => {
    const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
    assert(!source.includes('electron-dl'), 'electron-dl is gone');
    const calls = source.match(/startDownload\((currentWindow|win), newUrl\)/g) || [];
    assert.strictEqual(calls.length, 2, 'both links download through it');
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    assert(!pkg.dependencies['electron-dl'], 'no longer a dependency');
  });

  await check('texts exist in English and French', () => {
    [en, fr].forEach((language) => KEYS.forEach((name) => {
      assert.strictEqual(typeof language[name], 'string', name);
      assert(language[name].trim(), name);
    }));
    assert(en['download.failedDetail'].includes('{file}'));
    assert(fr['download.failedDetail'].includes('{file}'));
  });

  await check('completed: in Downloads, revealed, no message', async () => {
    const run = studio();
    downloadFile(run.options());
    assert.deepStrictEqual(run.state.requested, [URL]);
    const item = fakeItem();
    run.start(item);
    assert.strictEqual(item.savePath, path.join(DIR, 'export.zip'));
    item.received = 40;
    item.emit('updated', {}, 'progressing');
    item.received = 100;
    item.emit('done', {}, 'completed');
    await settle();
    assert.deepStrictEqual(run.state.progress, [0.4, -1]);
    assert.deepStrictEqual(run.state.revealed, [item.savePath]);
    assert.deepStrictEqual(run.state.finished, [item.savePath]);
    assert.deepStrictEqual(run.state.dialogs, []);
    assert.strictEqual(run.session.listenerCount('will-download'), 0, 'listener removed');
  });

  await check('a free name when the file exists or another download holds it', async () => {
    const run = studio({ existing: ['export.zip'] });
    downloadFile(run.options());
    downloadFile(run.options());
    const first = fakeItem();
    const second = fakeItem({ filename: 'EXPORT.zip' });
    run.start(first);
    run.start(second);
    assert.strictEqual(first.savePath, path.join(DIR, 'export (1).zip'));
    assert.strictEqual(second.savePath, path.join(DIR, 'EXPORT (2).zip'), 'case does not matter');
    first.emit('done', {}, 'completed');
    second.emit('done', {}, 'completed');
  });

  await check('a name without extension gets the one its type implies', async () => {
    const run = studio();
    downloadFile(run.options());
    downloadFile(run.options());
    const pdf = fakeItem({ filename: 'report', mime: 'application/pdf' });
    const unknown = fakeItem({ filename: 'notes', mime: 'application/octet-stream' });
    run.start(pdf);
    run.start(unknown);
    assert.strictEqual(pdf.savePath, path.join(DIR, 'report.pdf'));
    assert.strictEqual(unknown.savePath, path.join(DIR, 'notes'));
    pdf.emit('done', {}, 'completed');
    unknown.emit('done', {}, 'completed');
  });

  await check('other downloads are left alone', async () => {
    const run = studio();
    downloadFile(run.options());
    const other = fakeItem({ url: 'https://example.com/image.png' });
    run.start(other);
    run.start(fakeItem(), { other: 'window' });
    assert.strictEqual(other.savePath, null);
    assert.strictEqual(run.session.listenerCount('will-download'), 1, 'still waiting for its own');
    const own = fakeItem();
    run.start(own);
    assert(own.savePath);
    own.emit('done', {}, 'completed');
  });

  await check('the same link twice: two downloads, each handled once', async () => {
    const run = studio();
    downloadFile(run.options());
    downloadFile(run.options());
    const first = fakeItem();
    const second = fakeItem();
    run.start(first);
    assert.strictEqual(run.session.listenerCount('will-download'), 1);
    run.start(second);
    assert.notStrictEqual(first.savePath, second.savePath);
    first.emit('done', {}, 'completed');
    second.emit('done', {}, 'completed');
    await settle();
    assert.strictEqual(run.state.revealed.length, 2);
  });

  await check('progress covers every download of the window and never goes back', async () => {
    const run = studio();
    downloadFile(run.options());
    downloadFile(run.options());
    const first = fakeItem({ total: 100 });
    const second = fakeItem({ total: 300 });
    run.start(first);
    run.start(second);
    first.received = 100;
    first.emit('updated', {}, 'progressing');
    first.emit('done', {}, 'completed');
    second.received = 100;
    second.emit('updated', {}, 'progressing');
    second.received = 300;
    second.emit('done', {}, 'completed');
    assert.deepStrictEqual(run.state.progress, [0.25, 0.25, 0.5, -1]);
  });

  await check('interrupted: cancelled, partial removed, one message', () => Promise.all(
    [en, fr].map(async (language) => {
      const run = studio();
      downloadFile(run.options((name) => language[name]));
      const item = fakeItem();
      run.start(item);
      item.emit('updated', {}, 'interrupted');
      item.emit('updated', {}, 'interrupted');
      await settle();
      assert.strictEqual(item.cancelled, 1, 'cancelled once');
      assert.deepStrictEqual(run.state.removed, [item.savePath]);
      assert(!run.files.has(item.savePath.toLowerCase()));
      assert.strictEqual(run.state.dialogs.length, 1);
      const { parent, dialog } = run.state.dialogs[0];
      assert.strictEqual(parent, run.win);
      assert.deepStrictEqual(dialog, {
        type: 'warning',
        message: language['download.failedMessage'],
        detail: language['download.failedDetail'].replace('{file}', 'export.zip'),
        buttons: [language['download.tryAgain'], language.Cancel],
        defaultId: 0,
        cancelId: 1,
      });
      assert.deepStrictEqual(run.state.revealed, []);
      assert.deepStrictEqual(run.state.progress, [-1]);
    }),
  ));

  await check('interrupted for good: same message, nothing to cancel', async () => {
    const run = studio();
    downloadFile(run.options());
    const item = fakeItem();
    run.start(item);
    item.emit('done', {}, 'interrupted');
    await settle();
    assert.strictEqual(item.cancelled, 0);
    assert.deepStrictEqual(run.state.removed, [item.savePath]);
    assert.strictEqual(run.state.dialogs.length, 1);
  });

  await check('try again starts the same link over', async () => {
    const run = studio({ answers: [0] });
    downloadFile(run.options());
    const item = fakeItem();
    run.start(item);
    item.emit('updated', {}, 'interrupted');
    await settle();
    assert.deepStrictEqual(run.state.requested, [URL, URL]);
    const retry = fakeItem();
    run.start(retry);
    assert.strictEqual(retry.savePath, item.savePath, 'the freed name is used again');
    retry.emit('done', {}, 'completed');
    await settle();
    assert.deepStrictEqual(run.state.revealed, [retry.savePath]);
  });

  await check('cancel the message: nothing more', async () => {
    const run = studio({ answers: [1] });
    downloadFile(run.options());
    const item = fakeItem();
    run.start(item);
    item.emit('updated', {}, 'interrupted');
    await settle();
    assert.deepStrictEqual(run.state.requested, [URL]);
  });

  await check('a download cancelled elsewhere stays silent', async () => {
    const run = studio();
    downloadFile(run.options());
    const item = fakeItem();
    run.start(item);
    item.emit('done', {}, 'cancelled');
    await settle();
    assert.deepStrictEqual(run.state.dialogs, []);
    assert.deepStrictEqual(run.state.removed, []);
  });

  await check('window closed: no waiting listener, no message', async () => {
    const run = studio();
    downloadFile(run.options());
    run.win.emit('closed');
    assert.strictEqual(run.session.listenerCount('will-download'), 0);

    const during = studio();
    downloadFile(during.options());
    const item = fakeItem();
    during.start(item);
    during.state.destroyed = true;
    item.emit('updated', {}, 'interrupted');
    await settle();
    assert.deepStrictEqual(during.state.dialogs, []);
    assert.deepStrictEqual(during.state.removed, [item.savePath], 'partial still removed');
  });

  await check('a failing message stays contained', async () => {
    const run = studio({ answers: [new Error('no dialog')] });
    downloadFile(run.options());
    const item = fakeItem();
    run.start(item);
    item.emit('updated', {}, 'interrupted');
  });

  finished = true;
  if (failures.length) {
    console.error(`Download checks failed:\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log('Download checks passed');
  process.exit(0);
})();
