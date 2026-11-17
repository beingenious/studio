/* eslint-disable no-console, no-underscore-dangle, global-require */
const assert = require('assert');
const Module = require('module');
const { EventEmitter } = require('events');
const os = require('os');
const path = require('path');

// i18n.js reads the locale from Electron as soon as it loads.
const load = Module._load;
Module._load = function stub(request, ...args) {
  if (request === 'electron') return { app: { getLocale: () => '' } };
  return load.call(this, request, ...args);
};
const { __, changeLocale, translateFor } = require('../i18n/i18n');
const moveToApplications = require('../move-to-applications');
const en = require('../i18n/en.json');
const fr = require('../i18n/fr.json');

const PLATFORM = Object.getOwnPropertyDescriptor(process, 'platform');
const setPlatform = (value) => Object.defineProperty(process, 'platform', { ...PLATFORM, value });
const BUNDLE = '/Volumes/PandaSuite Studio/PandaSuite Studio.app';
const INSTALLED = '/Applications/PandaSuite Studio.app';
const TRANSLOCATED = '/private/var/folders/vn/abc123/T/AppTranslocation/0F1E2D3C/d/PandaSuite Studio.app';
const STAGING = '/var/folders/vn/abc123/T/studio-move-Xy12Z9';
const COPY = `${STAGING}/PandaSuite Studio.app`;
const failure = (message) => Object.assign(new Error(message), { code: 1 });
const KEYS = ['message', 'detail', 'move', 'later', 'dontAsk', 'failedMessage', 'failedDetail', 'ok']
  .map((key) => `moveToApplications.${key}`);
const t = translateFor('fr');

const fixture = ({
  packaged = true, inApplications = false, writable = false, accessError = 'EROFS',
  installed = false, dontAsk = false, answer = { response: 1, checkboxChecked: false },
  bundle = BUNDLE, applicationsWritable = true, fail = {}, relaunched = true, linkDuringCopy,
} = {}) => {
  const state = {
    locationChecks: 0,
    dialogs: [],
    stored: { 'moveToApplications.dontAsk': dontAsk },
    calls: [],
    reports: [],
  };
  const app = Object.assign(new EventEmitter(), {
    isPackaged: packaged,
    getPath: (name) => (name === 'exe' ? `${bundle}/Contents/MacOS/PandaSuite Studio` : ''),
    isInApplicationsFolder: () => {
      state.locationChecks += 1;
      return inApplications;
    },
    relaunch: (options) => {
      state.calls.push(['relaunch', options]);
      return relaunched;
    },
    quit: () => state.calls.push(['quit']),
  });
  const dialog = {
    showMessageBox: (options) => {
      state.dialogs.push(options);
      return Promise.resolve(state.dialogs.length === 1 ? answer : { response: 0 });
    },
  };
  const store = {
    get: (key) => state.stored[key],
    set: (key, value) => { state.stored[key] = value; },
  };
  const fs = {
    constants: { W_OK: 2 },
    accessSync: (file) => {
      if (file === bundle && !writable) {
        throw Object.assign(new Error(accessError), { code: accessError });
      }
      if (file === '/Applications' && !applicationsWritable) {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      }
    },
    existsSync: (file) => installed && file === INSTALLED,
    mkdtempSync: (prefix) => {
      state.calls.push(['mkdtemp', prefix]);
      if (fail.mkdtemp) throw fail.mkdtemp;
      return STAGING;
    },
    renameSync: (from, to) => {
      state.calls.push(['rename', from, to]);
      if (fail.rename) throw fail.rename;
    },
  };
  const execFile = (file, args) => {
    state.calls.push([file, ...args]);
    if (linkDuringCopy && file === '/usr/bin/ditto') app.emit('open-url', {}, linkDuringCopy);
    const error = fail[path.posix.basename(file)];
    return error ? Promise.reject(error) : Promise.resolve({ stdout: '', stderr: '' });
  };
  const report = (error) => state.reports.push(error);
  return {
    state,
    app,
    ask: () => moveToApplications({
      app, dialog, store, translate: t, fs, execFile, report,
    }),
  };
};

// Check every case before failing, so all regressions are visible.
const failures = [];
const check = async (name, test) => {
  setPlatform('darwin');
  try {
    await test();
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
};
const silent = async (options) => {
  const { state, ask } = fixture(options);
  assert.strictEqual(await ask(), false);
  assert.strictEqual(state.dialogs.length, 0, 'no dialog');
  return state;
};

async function run() {
  await check('other platform', async () => {
    setPlatform('win32');
    const state = await silent();
    assert.strictEqual(state.locationChecks, 0, 'the macOS-only API is not called');
  });
  await check('development build', () => silent({ packaged: false }));
  await check('refusal remembered', () => silent({ dontAsk: true }));
  await check('already in Applications', () => silent({ inApplications: true }));
  await check('writable location', () => silent({ writable: true }));
  await check('copy already installed', () => silent({ installed: true }));

  await check('unwritable for another reason', async () => {
    const { state, ask } = fixture({ accessError: 'EACCES' });
    await ask();
    assert.strictEqual(state.dialogs.length, 1);
  });

  await check('not now', async () => {
    const { state, ask } = fixture();
    assert.strictEqual(await ask(), false);
    assert.strictEqual(state.dialogs.length, 1);
    assert.deepStrictEqual(state.dialogs[0], {
      type: 'question',
      message: t('moveToApplications.message'),
      detail: t('moveToApplications.detail'),
      buttons: [t('moveToApplications.move'), t('moveToApplications.later')],
      defaultId: 0,
      cancelId: 1,
      checkboxLabel: t('moveToApplications.dontAsk'),
    });
    assert.strictEqual(state.stored['moveToApplications.dontAsk'], false, 'nothing remembered');
  });

  await check('not now, do not ask again', async () => {
    const { state, ask } = fixture({ answer: { response: 1, checkboxChecked: true } });
    assert.strictEqual(await ask(), false);
    assert.strictEqual(state.stored['moveToApplications.dontAsk'], true);
  });

  const moving = (options) => fixture({
    answer: { response: 0, checkboxChecked: false }, ...options,
  });
  const PREFIX = path.posix.join(os.tmpdir(), 'studio-move-');
  const DITTO = ['/usr/bin/ditto', BUNDLE, COPY];
  const XATTR = ['/usr/bin/xattr', '-dr', 'com.apple.quarantine', COPY];
  const RM = ['/bin/rm', '-rf', STAGING];
  const failed = (state, calls) => {
    assert.deepStrictEqual(state.calls, calls);
    assert.strictEqual(state.dialogs.length, 2, 'failure dialog');
    assert.deepStrictEqual(state.dialogs[1], {
      type: 'warning',
      message: t('moveToApplications.failedMessage'),
      detail: t('moveToApplications.failedDetail'),
      buttons: [t('moveToApplications.ok')],
    });
  };
  const reported = (state) => {
    assert.strictEqual(state.reports.length, 1, 'one report');
    return state.reports[0].message;
  };

  await check('moved', async () => {
    const { state, ask } = moving();
    assert.strictEqual(await ask(), true);
    assert.deepStrictEqual(state.calls, [
      ['mkdtemp', PREFIX], DITTO, XATTR, ['rename', COPY, INSTALLED], RM,
      ['relaunch', { execPath: '/usr/bin/open', args: [INSTALLED] }],
      ['quit'],
    ]);
    assert.strictEqual(state.dialogs.length, 1, 'no failure dialog');
    assert.strictEqual(state.reports.length, 0);
  });
  await check('moved, with a link opened meanwhile', async () => {
    const link = 'pandastudio://https//pandasuite.com/dashboard/';
    const { state, app, ask } = moving({ linkDuringCopy: link });
    assert.strictEqual(await ask(), true);
    assert.deepStrictEqual(state.calls[5],
      ['relaunch', { execPath: '/usr/bin/open', args: ['-a', INSTALLED, link] }]);
    assert.strictEqual(app.listenerCount('open-url'), 0, 'stops listening');
  });
  await check('moved, temporary folder left behind', async () => {
    const { state, ask } = moving({ fail: { rm: failure('Command failed: /bin/rm') } });
    assert.strictEqual(await ask(), true);
    assert.strictEqual(state.reports.length, 0);
  });
  await check('Applications not writable', async () => {
    const { state, ask } = moving({ applicationsWritable: false });
    assert.strictEqual(await ask(), false);
    failed(state, []);
    assert.strictEqual(state.reports.length, 0, 'an expected situation is not reported');
  });
  await check('copy failed', async () => {
    const { state, ask } = moving({
      fail: { ditto: failure(`Command failed: /usr/bin/ditto ${BUNDLE} ${COPY}\nditto: ${COPY}: No space left on device`) },
    });
    assert.strictEqual(await ask(), false);
    failed(state, [['mkdtemp', PREFIX], DITTO, RM]);
    assert.strictEqual(reported(state),
      'Command failed: /usr/bin/ditto <app> <staging>/PandaSuite Studio.app\nditto: <staging>/PandaSuite Studio.app: No space left on device');
  });
  await check('quarantine not removed', async () => {
    const { state, ask } = moving({
      fail: { xattr: failure(`Command failed: /usr/bin/xattr -dr com.apple.quarantine ${COPY}\nxattr: [Errno 13] Permission denied: '${COPY}/Contents/Info.plist'`) },
    });
    assert.strictEqual(await ask(), false);
    failed(state, [['mkdtemp', PREFIX], DITTO, XATTR, RM]);
    assert.strictEqual(reported(state),
      'Command failed: /usr/bin/xattr -dr com.apple.quarantine <staging>/PandaSuite Studio.app\nxattr: [Errno 13] Permission denied: \'<staging>/PandaSuite Studio.app/Contents/Info.plist\'');
  });
  await check('rename failed', async () => {
    const { state, ask } = moving({
      fail: { rename: failure(`EACCES: permission denied, rename '${COPY}' -> '${INSTALLED}'`) },
    });
    assert.strictEqual(await ask(), false);
    failed(state, [['mkdtemp', PREFIX], DITTO, XATTR, ['rename', COPY, INSTALLED], RM]);
    assert.strictEqual(reported(state),
      `EACCES: permission denied, rename '<staging>/PandaSuite Studio.app' -> '${INSTALLED}'`);
  });
  await check('temporary folder not created', async () => {
    const { state, ask } = moving({
      fail: { mkdtemp: failure(`ENOSPC: no space left on device, mkdtemp '${PREFIX}XXXXXX'`) },
    });
    assert.strictEqual(await ask(), false);
    failed(state, [['mkdtemp', PREFIX]]);
    assert.strictEqual(reported(state), "ENOSPC: no space left on device, mkdtemp '<staging>'");
  });
  await check('translocated copy failed', async () => {
    const { state, ask } = moving({
      bundle: TRANSLOCATED,
      fail: { ditto: failure(`Command failed: /usr/bin/ditto ${TRANSLOCATED} ${COPY}`) },
    });
    assert.strictEqual(await ask(), false);
    assert.deepStrictEqual(state.calls[1], ['/usr/bin/ditto', TRANSLOCATED, COPY]);
    assert.strictEqual(reported(state),
      'Command failed: /usr/bin/ditto <app> <staging>/PandaSuite Studio.app');
  });
  await check('relaunch failed', async () => {
    const { state, ask } = moving({ relaunched: false });
    assert.strictEqual(await ask(), false);
    failed(state, [
      ['mkdtemp', PREFIX], DITTO, XATTR, ['rename', COPY, INSTALLED], RM,
      ['relaunch', { execPath: '/usr/bin/open', args: [INSTALLED] }],
    ]);
    assert(reported(state), 'reported with a message');
  });

  await check('texts', () => {
    KEYS.forEach((key) => {
      assert(typeof en[key] === 'string' && en[key], `en.json lacks ${key}`);
      assert(typeof fr[key] === 'string' && fr[key], `fr.json lacks ${key}`);
    });
    assert.strictEqual(translateFor('fr')('moveToApplications.later'), 'Plus tard');
    assert.strictEqual(translateFor('en-US')('moveToApplications.later'), 'Not Now');
    assert.strictEqual(translateFor('')('moveToApplications.later'), 'Not Now');
  });

  await check('global language unchanged', () => {
    // Check right after each translator, from both languages: a translator that switched the
    // app's language would otherwise be hidden by the next one switching it back.
    translateFor('fr')('moveToApplications.later');
    assert.strictEqual(__('Leave'), en.Leave, 'a French translator leaves the app in English');
    changeLocale('fr-FR');
    translateFor('en-US')('moveToApplications.later');
    assert.strictEqual(__('Leave'), fr.Leave, 'an English translator leaves the app in French');
    changeLocale('en-US');
  });

  Object.defineProperty(process, 'platform', PLATFORM);
  Module._load = load;
  if (failures.length) {
    console.error(`Move to Applications checks failed:\n${failures.join('\n')}`);
    process.exitCode = 1;
    return;
  }
  console.log('Move to Applications checks passed');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
