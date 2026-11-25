/* eslint-disable no-console */
const assert = require('assert');
const warnDiskFull = require('../update-warning');
const en = require('../i18n/en.json');
const fr = require('../i18n/fr.json');

const KEYS = ['autoUpdate.diskFullMessage', 'autoUpdate.diskFullDetail', 'autoUpdate.ok'];
const fakeWindow = ({ visible = true, minimized = false, destroyed = false } = {}) => ({
  isVisible: () => visible,
  isMinimized: () => minimized,
  isDestroyed: () => destroyed,
});
const show = ({ focused = null, windows = [], translate = (key) => en[key] } = {}) => {
  const calls = [];
  const dialog = {
    showMessageBox(...args) {
      calls.push(args);
      return Promise.resolve({ response: 0 });
    },
  };
  const BrowserWindow = { getFocusedWindow: () => focused, getAllWindows: () => windows };
  const result = warnDiskFull({ dialog, BrowserWindow, translate });
  return { calls, result };
};

// Check every case before failing, so all regressions are visible.
const failures = [];
const check = (name, test) => {
  try {
    test();
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
};

check('texts exist in English and French', () => {
  [en, fr].forEach((language) => KEYS.forEach((key) => {
    assert.strictEqual(typeof language[key], 'string', key);
    assert(language[key].trim(), key);
  }));
});

check('a warning with the translated texts', () => {
  [en, fr].forEach((language) => {
    const { calls, result } = show({ translate: (key) => language[key] });
    assert.deepStrictEqual(calls, [[{
      type: 'warning',
      message: language['autoUpdate.diskFullMessage'],
      detail: language['autoUpdate.diskFullDetail'],
      buttons: [language['autoUpdate.ok']],
    }]]);
    assert(result instanceof Promise, 'returns the dialog promise');
  });
});

check('on the focused window when it can show it', () => {
  const focused = fakeWindow();
  const { calls } = show({ focused, windows: [fakeWindow(), focused] });
  assert.strictEqual(calls[0][0], focused);
});

check('on another visible window when the focused one cannot', () => {
  const visible = fakeWindow();
  const { calls } = show({
    focused: fakeWindow({ minimized: true }),
    windows: [fakeWindow({ visible: false }), fakeWindow({ destroyed: true }), visible],
  });
  assert.strictEqual(calls[0][0], visible);
});

check('without a parent when no window can show it', () => {
  const { calls } = show({
    windows: [fakeWindow({ visible: false }), fakeWindow({ minimized: true })],
  });
  assert.strictEqual(calls[0].length, 1, 'no parent window');
});

if (failures.length) {
  console.error(`Update warning checks failed:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('Update warning checks passed');
