/* eslint-disable no-console, no-underscore-dangle, global-require */
const assert = require('assert');
const Module = require('module');

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
const KEYS = ['message', 'detail', 'move', 'later', 'dontAsk', 'failedMessage', 'failedDetail', 'ok']
  .map((key) => `moveToApplications.${key}`);
const t = translateFor('fr');

const fixture = ({
  packaged = true, inApplications = false, writable = false, accessError = 'EROFS',
  installed = false, dontAsk = false, answer = { response: 1, checkboxChecked: false },
  move = () => true,
} = {}) => {
  const state = { locationChecks: 0, dialogs: [], stored: { 'moveToApplications.dontAsk': dontAsk } };
  const app = {
    isPackaged: packaged,
    getPath: (name) => (name === 'exe' ? `${BUNDLE}/Contents/MacOS/PandaSuite Studio` : ''),
    isInApplicationsFolder: () => {
      state.locationChecks += 1;
      return inApplications;
    },
    moveToApplicationsFolder: move,
  };
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
    accessSync: (path) => {
      if (path !== BUNDLE || writable) return;
      throw Object.assign(new Error(accessError), { code: accessError });
    },
    existsSync: (path) => installed && path === INSTALLED,
  };
  return {
    state,
    ask: () => moveToApplications({
      app, dialog, store, translate: t, fs,
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

  const moving = (move) => fixture({ answer: { response: 0, checkboxChecked: false }, move });
  await check('moved', async () => {
    assert.strictEqual(await moving(() => true).ask(), true);
  });
  await check('move declined by Electron', async () => {
    const { state, ask } = moving(() => false);
    assert.strictEqual(await ask(), false);
    assert.strictEqual(state.dialogs.length, 1, 'no failure dialog');
  });
  await check('authorization cancelled', async () => {
    const { state, ask } = moving(() => {
      throw new Error('User rejected the authorization request');
    });
    assert.strictEqual(await ask(), false);
    assert.strictEqual(state.dialogs.length, 1, 'no failure dialog');
  });
  await check('move failed', async () => {
    const { state, ask } = moving(() => {
      throw new Error('Failed to copy current bundle to the applications folder');
    });
    assert.strictEqual(await ask(), false);
    assert.deepStrictEqual(state.dialogs[1], {
      type: 'warning',
      message: t('moveToApplications.failedMessage'),
      detail: t('moveToApplications.failedDetail'),
      buttons: [t('moveToApplications.ok')],
    });
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
