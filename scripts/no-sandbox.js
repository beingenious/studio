const fs = require('fs');
const { exec } = require('child_process');

exports.default = async function noSandboxing(context) {
  const requirePath = (path) => {
    if (!fs.existsSync(path)) {
      throw new Error(`Path does does not exist: ${path}`);
    }
  };

  const isLinux = context.targets.find((target) => ['appImage', 'deb', 'snap', 'tar.gz'].includes(target.name));

  if (!isLinux) {
    return;
  }

  [
    {
      studio: 'dist/linux-unpacked/pandasuite-studio',
      studioBin: 'dist/linux-unpacked/pandasuite-studio.bin',
    },
    {
      studio: 'dist/linux-ia32-unpacked/pandasuite-studio',
      studioBin: 'dist/linux-ia32-unpacked/pandasuite-studio.bin',
    },
  ].forEach((row) => {
    const pathPandaSuiteStudio = row.studio;
    const pathPandaSuiteStudioBin = row.studioBin;

    requirePath(pathPandaSuiteStudio);

    fs.renameSync(pathPandaSuiteStudio, pathPandaSuiteStudioBin);

    const wrapperScript = `#!/bin/bash
      SOURCE_FILE=$(readlink -f "\${BASH_SOURCE}")
      SOURCE_DIR=\${SOURCE_FILE%/*}
      "\${SOURCE_DIR}/pandasuite-studio.bin" "$@" --no-sandbox
    `;

    fs.writeFileSync(pathPandaSuiteStudio, wrapperScript);
    exec(`chmod +x ${pathPandaSuiteStudio}`);
  });
};
