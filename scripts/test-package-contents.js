const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRequire } = require('module');
const checkPackage = require('./check-package-files');

const builderRequire = createRequire(require.resolve('electron-builder'));
const asarRequire = createRequire(builderRequire.resolve('app-builder-lib'));
const asar = asarRequire('@electron/asar');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-package-check-'));
const write = (base, name) => {
  const file = path.join(base, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'fixture');
};

const fixture = async (platform, options = {}) => {
  const directory = fs.mkdtempSync(path.join(temporary, 'case-'));
  const source = path.join(directory, 'source');
  const output = path.join(directory, 'output');
  const resources = platform === 'darwin'
    ? path.join(output, 'Studio Fixture.app/Contents/Resources')
    : path.join(output, 'resources');
  ['package.json', 'index.js', 'preload.js', 'macos-titlebar.js', 'window-layout.js',
    'home-recovery.js', 'home-recovery-log.js', 'flash-player.js', 'menu.js',
    'i18n/i18n.js', 'i18n/en.json', 'i18n/fr.json',
    'node_modules/example/dist/index.js'].forEach((name) => write(source, name));
  if (platform === 'darwin' || options.foreignNative) write(source, 'native/macos-titlebar.node');
  if (platform === 'linux') write(source, 'static/Icon.png');
  if (options.extra) write(source, options.extra);
  if (options.missing) fs.unlinkSync(path.join(source, options.missing));
  fs.mkdirSync(resources, { recursive: true });
  await asar.createPackageWithOptions(source, path.join(resources, 'app.asar'), {
    unpack: platform === 'darwin' && !options.packedNative ? 'macos-titlebar.node' : undefined,
  });
  const flash = {
    darwin: ['PepperFlashPlayer.plugin/Contents/MacOS/PepperFlashPlayer'],
    win32: ['pepflashplayer64.dll', 'pepflashplayer32.dll'],
    linux: ['libpepflashplayer.x86_64.so', 'libpepflashplayer.i386.so'],
  }[platform];
  ['pdfjs/web/viewer.html', 'pdfjs/build/pdf.js',
    ...flash.map((name) => `flash_player_ppapi/${name}`)].forEach((name) => {
    write(resources, `static/${name}`);
  });
  return {
    appOutDir: output,
    electronPlatformName: platform,
    packager: { appInfo: { productFilename: 'Studio Fixture' } },
  };
};

(async () => {
  try {
    await Promise.all(['darwin', 'win32', 'linux'].map(async (platform) => {
      await checkPackage(await fixture(platform)); // Dependency dist paths remain valid.
    }));
    await Promise.all(['.git/config', '.env', 'dist/previous-release.exe', 'docs/notes.md', 'scripts/build.js'].map(async (extra) => {
      const context = await fixture('win32', { extra });
      await assert.rejects(() => checkPackage(context), /Unexpected development path/);
    }));
    const foreign = await fixture('win32', { foreignNative: true });
    await assert.rejects(() => checkPackage(foreign), /macOS native files/);
    const packed = await fixture('darwin', { packedNative: true });
    await assert.rejects(() => checkPackage(packed), /macOS module must be unpacked/);
    const missing = await fixture('linux', { missing: 'preload.js' });
    await assert.rejects(() => checkPackage(missing), /Missing application file: preload.js/);
    process.stdout.write('Package archive validation passed for valid and rejected packages\n');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
