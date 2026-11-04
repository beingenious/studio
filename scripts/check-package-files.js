const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const builderRequire = createRequire(require.resolve('electron-builder'));
const { readAsar } = builderRequire('app-builder-lib/out/asar/asar');

module.exports = async (context) => {
  const mac = context.electronPlatformName === 'darwin';
  const resources = mac
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents/Resources')
    : path.join(context.appOutDir, 'resources');
  const archive = await readAsar(path.join(resources, 'app.asar'));
  const root = archive.header.files;
  Object.keys(root).forEach((name) => {
    assert(!name.startsWith('.') && !['dist', 'build', 'docs', 'scripts'].includes(name),
      `Unexpected development path in application archive: ${name}`);
  });
  const entry = (name) => name.split('/').reduce((node, part) => (
    node && node.files ? node.files[part] : null
  ), archive.header);
  ['package.json', 'index.js', 'preload.js', 'macos-titlebar.js', 'window-layout.js',
    'home-recovery.js', 'home-recovery-log.js', 'flash-player.js', 'menu.js',
    'i18n/i18n.js', 'i18n/en.json', 'i18n/fr.json'].forEach((name) => {
    const file = entry(name);
    assert(file && typeof file.size === 'number', `Missing application file: ${name}`);
  });
  if (mac) {
    assert.deepStrictEqual(Object.keys(root.native ? root.native.files : {}), ['macos-titlebar.node']);
    assert(entry('native/macos-titlebar.node').unpacked, 'macOS module must be unpacked');
    assert(fs.statSync(path.join(resources, 'app.asar.unpacked/native/macos-titlebar.node')).isFile());
  } else {
    assert(!root.native, 'macOS native files must not be included on this platform');
  }
  if (context.electronPlatformName === 'linux') {
    assert(entry('static/Icon.png'), 'Missing Linux window icon');
  }
  const flash = {
    darwin: ['PepperFlashPlayer.plugin/Contents/MacOS/PepperFlashPlayer'],
    win32: ['pepflashplayer64.dll', 'pepflashplayer32.dll'],
    linux: ['libpepflashplayer.x86_64.so', 'libpepflashplayer.i386.so'],
  }[context.electronPlatformName];
  ['pdfjs/web/viewer.html', 'pdfjs/build/pdf.js',
    ...flash.map((name) => `flash_player_ppapi/${name}`)].forEach((name) => {
    assert(fs.statSync(path.join(resources, 'static', name)).isFile(), `Missing application resource: ${name}`);
  });
  process.stdout.write(`Application package contents verified: ${context.electronPlatformName}\n`);
};
