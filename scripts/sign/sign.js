const path = require('path');
const { execSync } = require('child_process');

const jsign = path.join(__dirname, 'jsign-4.1.jar');
const keystore = path.join(__dirname, 'hardwareToken.cfg');

exports.default = async function sign(configuration) {
  const TOKEN_ALIAS = process.env.WINDOWS_SIGN_TOKEN_ALIAS;
  const TOKEN_PASSWORD = process.env.WINDOWS_SIGN_TOKEN_PASSWORD;

  const cmd = [
    'java',
    `-jar ${jsign}`,
    `--keystore ${keystore}`,
    '--storetype PKCS11',
    '--tsaurl http://timestamp.digicert.com',
    '--alg SHA-256',
    `--alias "${TOKEN_ALIAS}"`,
    `--storepass "${TOKEN_PASSWORD}"`,
    `"${configuration.path}"`,
  ];

  execSync(cmd.join(' '), {
    stdio: 'inherit',
  });
};
