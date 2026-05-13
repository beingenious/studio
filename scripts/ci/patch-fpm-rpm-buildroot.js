/* eslint-disable import/no-extraneous-dependencies, no-console */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { appBuilderPath } = require('app-builder-bin');

const FPM_ARTIFACT = 'fpm-1.9.3-20150715-2.2.2-mac';
const FPM_ARTIFACT_URL = `https://github.com/electron-userland/electron-builder-binaries/releases/download/${FPM_ARTIFACT}/${FPM_ARTIFACT}.7z`;
const RPM_PACKAGE_FILE = path.join('lib', 'app', 'lib', 'fpm', 'package', 'rpm.rb');

const LEGACY_BUILDROOT_ARG = '      "--define", "buildroot #{build_path}/BUILD",';
const RPM_420_BUILDROOT_ARG = '      "--buildroot", "#{build_path}/BUILD",';

function fail(message, details) {
  if (details) {
    console.error(details);
  }
  console.error(message);
  process.exit(1);
}

if (process.platform !== 'darwin') {
  console.log('Skipping fpm rpm buildroot patch outside macOS.');
  process.exit(0);
}

const download = spawnSync(appBuilderPath, ['download-artifact', '--name', FPM_ARTIFACT, '--url', FPM_ARTIFACT_URL], {
  encoding: 'utf8',
});

if (download.status !== 0) {
  fail('Failed to download electron-builder fpm artifact.', download.stderr || download.stdout);
}

const artifactPath = download.stdout
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .pop();

if (!artifactPath) {
  fail('Could not resolve electron-builder fpm artifact path.', download.stdout);
}

const rpmPackagePath = path.join(artifactPath, RPM_PACKAGE_FILE);

if (!fs.existsSync(rpmPackagePath)) {
  fail(`Could not find fpm rpm package file at ${rpmPackagePath}.`);
}

const source = fs.readFileSync(rpmPackagePath, 'utf8');

if (source.includes(RPM_420_BUILDROOT_ARG)) {
  console.log(`fpm rpm buildroot patch already applied: ${rpmPackagePath}`);
  process.exit(0);
}

if (!source.includes(LEGACY_BUILDROOT_ARG)) {
  fail(`Could not find legacy fpm buildroot argument in ${rpmPackagePath}.`);
}

fs.writeFileSync(rpmPackagePath, source.replace(LEGACY_BUILDROOT_ARG, RPM_420_BUILDROOT_ARG));
console.log(`Patched fpm rpm buildroot argument for rpm 4.20: ${rpmPackagePath}`);
