const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Exercise the real constructor options without starting the remote shell or
// touching an installed app's profile. Stop at the native Electron boundary.
module.exports = async (platform) => {
  const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
  const declaration = source.slice(
    source.indexOf('const createPublicationWindow ='),
    source.indexOf('// Prevent multiple instances of the app'),
  );
  const stop = new Error('captured BrowserWindow');
  let captured;
  const context = {
    process: { platform },
    is: { linux: platform === 'linux' },
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ bounds: { width: 1250, height: 800 } }),
    },
    windowStateKeeper: () => ({ width: 1000, height: 700 }),
    app: { getName: () => 'Studio native window smoke' },
    path,
    __dirname: path.join(__dirname, '..'),
    BrowserWindow: class {
      constructor(options) {
        captured = options;
        throw stop;
      }
    },
  };
  vm.runInNewContext(`${declaration}\nthis.createWindow = createPublicationWindow;`, context);
  try {
    await context.createWindow();
  } catch (error) {
    if (error !== stop) throw error;
  }
  if (!captured) throw new Error('BrowserWindow constructor was not reached');
  return captured;
};
