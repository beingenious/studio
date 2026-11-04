const assert = require('assert');
const path = require('path');
const { createRequire } = require('module');

const builderRequire = createRequire(require.resolve('electron-builder'));
const { Packager } = builderRequire('app-builder-lib');
const { getMainFileMatchers } = builderRequire('app-builder-lib/out/fileMatcher');

(async () => {
  const root = path.join(__dirname, '..');
  const info = new Packager({ projectDir: root });
  await info.validateConfig();
  const failures = [];
  ['mac', 'win', 'linux'].forEach((platform) => {
    const matchers = getMainFileMatchers(root, path.join(root, 'dist/check'), (value) => value,
      info.config[platform], { info }, path.join(root, 'dist'), false);
    const includes = (name) => matchers.some((matcher) => {
      const filter = matcher.createFilter();
      const parts = name.split('/');
      return parts.every((part, index) => filter(
        path.join(root, ...parts.slice(0, index + 1)),
        { isDirectory: () => index < parts.length - 1 },
      ));
    });
    try {
      ['.git/config', 'dist/previous-release.exe', '.env', '.env.production',
        'docs/notes.md', 'scripts/sign/hardwareToken.cfg', 'native/macos-titlebar.m',
        'native/macos-titlebar-region.h'].forEach((name) => {
        assert.strictEqual(includes(name), false, `${platform}: exclude ${name}`);
      });
      ['package.json', 'index.js', 'preload.js', 'macos-titlebar.js', 'window-layout.js',
        'home-recovery.js', 'home-recovery-log.js', 'flash-player.js', 'menu.js',
        'i18n/i18n.js', 'i18n/en.json', 'i18n/fr.json'].forEach((name) => {
        assert.strictEqual(includes(name), true, `${platform}: retain ${name}`);
      });
      assert.strictEqual(includes('native/macos-titlebar.node'), platform === 'mac',
        `${platform}: native module boundary`);
    } catch (error) {
      failures.push(error.message);
    }
  });
  assert.deepStrictEqual(failures, []);
  process.stdout.write('Normalized package file exclusions and runtime files passed on every platform\n');
})().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
