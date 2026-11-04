const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const build = (context) => {
  if ((context ? context.electronPlatformName : process.platform) !== 'darwin') return;
  const directory = path.join(__dirname, '../native');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-titlebar-build-'));
  const include = require('node-api-headers').include_dir; // eslint-disable-line global-require, import/no-extraneous-dependencies
  const slices = ['x86_64', 'arm64'].map((arch) => {
    const output = path.join(temporary, `${arch}.node`);
    execFileSync('xcrun', [
      'clang', '-arch', arch,
      `-mmacosx-version-min=${arch === 'arm64' ? '11.0' : '10.10'}`,
      '-fno-objc-arc', '-DNAPI_VERSION=6', '-Werror=unguarded-availability-new',
      '-bundle', '-undefined', 'dynamic_lookup', '-framework', 'Cocoa',
      '-I', include, path.join(directory, 'macos-titlebar.m'), '-o', output,
    ], { stdio: 'inherit' });
    return output;
  });
  execFileSync('xcrun', [
    'lipo', '-create', ...slices, '-output', path.join(directory, 'macos-titlebar.node'),
  ], { stdio: 'inherit' });
  slices.forEach((slice) => fs.unlinkSync(slice));
  fs.rmdirSync(temporary);
};

module.exports = build;
if (require.main === module) build();
