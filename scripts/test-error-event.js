const assert = require('assert');
const { buildExceptionList, exceptionKey, cleanMessage } = require('../error-event');

const MAC_APP = '/Applications/PandaSuite Studio.app/Contents/Resources/app.asar';
const WIN_APP = 'C:\\Users\\jane\\AppData\\Local\\Programs\\pandasuite-studio\\resources\\app.asar';
const LINUX_APP = '/opt/PandaSuite Studio/resources/app.asar';
const mac = { appPath: MAC_APP, home: '/Users/jane' };
const rejection = { type: 'onunhandledrejection', handled: false };

const errorWithStack = (message, lines) => {
  const error = new Error(message);
  error.stack = [`Error: ${message}`, ...lines.map((line) => `    at ${line}`)].join('\n');
  return error;
};
const framesOf = (list) => list[0].stacktrace.frames;
const frameNamed = (list, filename) => framesOf(list).find((frame) => frame.filename === filename);

// Check every case before failing, so all regressions are visible.
const failures = [];
const check = (name, test) => {
  try {
    test();
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
};

check('macOS paths, frame order and message cleaning', () => {
  const list = buildExceptionList(errorWithStack(
    "ENOENT '/Users/jane/Library/x' https://release-assets.githubusercontent.com/a/b?X-Amz-Signature=secret",
    [
      `Object.task (${MAC_APP}/node_modules/electron-updater/out/AppImageUpdater.js:40:50)`,
      `createWindow (${MAC_APP}/index.js:120:5)`,
      'SimpleURLLoaderWrapper.<anonymous> (electron/js2c/browser_init.js:105:6536)',
      'events.js:315:20',
    ],
  ), rejection, mac);
  assert.strictEqual(list.length, 1);
  const [exception] = list;
  assert.strictEqual(exception.type, 'Error');
  assert(exception.value.includes('~/Library/x'), exception.value);
  assert(exception.value.includes('https://release-assets.githubusercontent.com/a/b'), exception.value);
  assert(!exception.value.includes('jane') && !exception.value.includes('X-Amz-Signature'), exception.value);
  assert.deepStrictEqual(exception.mechanism, { ...rejection, synthetic: false });
  assert.strictEqual(exception.stacktrace.type, 'raw');
  const frames = framesOf(list);
  assert.deepStrictEqual(frames.map((frame) => frame.filename), [
    'events.js',
    'electron/js2c/browser_init.js',
    'index.js',
    'node_modules/electron-updater/out/AppImageUpdater.js',
  ]);
  assert(frames.every((frame) => frame.platform === 'node:javascript'));
  const app = frameNamed(list, 'index.js');
  assert.deepStrictEqual([app.in_app, app.function, app.lineno, app.colno], [true, 'createWindow', 120, 5]);
  const updater = frames[frames.length - 1];
  assert.deepStrictEqual([updater.in_app, updater.function], [false, 'Object.task']);
  assert.strictEqual(frameNamed(list, 'electron/js2c/browser_init.js').in_app, false);
});

check('Windows paths with a different drive letter case', () => {
  const lower = WIN_APP.toLowerCase();
  const list = buildExceptionList(errorWithStack('C:\\Users\\jane\\AppData\\Local\\Temp\\f', [
    `x (${lower}\\node_modules\\electron-updater\\out\\AppUpdater.js:507:31)`,
    `run (${lower}\\index.js:10:2)`,
  ]), rejection, { appPath: WIN_APP, home: 'C:\\Users\\jane' });
  assert.strictEqual(frameNamed(list, 'index.js').in_app, true);
  assert.strictEqual(frameNamed(list, 'node_modules/electron-updater/out/AppUpdater.js').in_app, false);
  assert(framesOf(list).every((frame) => !frame.filename.includes('\\')));
  assert.strictEqual(list[0].value, '~\\AppData\\Local\\Temp\\f');
  assert(!JSON.stringify(list).toLowerCase().includes('jane'));
});

check('a rejected string shows the home folder with doubled backslashes', () => {
  // ensure-error passes a rejected value through util.inspect.
  const value = require('util').inspect('C:\\Users\\Jane\\work.js'); // eslint-disable-line global-require
  assert.strictEqual(cleanMessage(value, 'C:\\Users\\Jane'), "'~\\\\work.js'");
});

check('Linux path under the home folder', () => {
  const list = buildExceptionList(errorWithStack('boom', ['load (/home/jane/.config/x.js:1:1)']),
    rejection, { appPath: LINUX_APP, home: '/home/jane' });
  assert.deepStrictEqual(framesOf(list).map((frame) => [frame.filename, frame.in_app]),
    [['~/.config/x.js', false]]);
});

check('anonymous frames under paths that contain " ("', () => {
  const app = '/Users/jane/Applications (Work)/PandaSuite Studio.app/Contents/Resources/app.asar';
  const list = buildExceptionList(errorWithStack('boom', [`${app}/index.js:1:8`]),
    rejection, { appPath: app, home: '/Users/jane' });
  assert.deepStrictEqual(
    framesOf(list).map((frame) => [frame.filename, frame.function, frame.in_app]),
    [['index.js', '?', true]],
  );
  const windows = buildExceptionList(errorWithStack('boom', [
    'C:\\Users\\John (Work)\\AppData\\Local\\Programs\\pandasuite-studio\\resources\\app.asar\\index.js:10:5',
  ]), rejection, {
    appPath: 'C:\\Users\\John (Work)\\AppData\\Local\\Programs\\pandasuite-studio\\resources\\app.asar',
    home: 'C:\\Users\\John (Work)',
  });
  assert.deepStrictEqual(framesOf(windows).map((frame) => [frame.filename, frame.in_app]),
    [['index.js', true]]);
  assert(!JSON.stringify(list).includes('jane') && !JSON.stringify(windows).includes('John'));
});

check('message lines are never read as frames', () => {
  const list = buildExceptionList(errorWithStack('first line\ncache-control: public, max-age=0 at edge',
    [`run (${MAC_APP}/index.js:1:1)`]), rejection, mac);
  assert.deepStrictEqual(framesOf(list).map((frame) => frame.filename), ['index.js']);
});

check('empty message and custom name', () => {
  assert.strictEqual(buildExceptionList(new Error(), rejection, mac)[0].value, '');
  const error = new Error('denied');
  error.name = 'HttpError';
  assert.strictEqual(buildExceptionList(error, rejection, mac)[0].type, 'HttpError');
});

check('values that are not errors', () => {
  const [text] = buildExceptionList('x', rejection, mac);
  assert.deepStrictEqual(text, { type: 'Error', value: 'x', mechanism: { ...rejection, synthetic: true } });
  assert.strictEqual(buildExceptionList(null, rejection, mac)[0].value, 'null');
  assert.strictEqual(buildExceptionList(Object.create(null), rejection, mac)[0].value, '[object Object]');
  const hostile = new Error('hostile');
  Object.defineProperty(hostile, 'stack', { get() { throw new Error('stack getter'); } });
  const [exception] = buildExceptionList(hostile, rejection, mac);
  assert.deepStrictEqual([exception.type, exception.value, exception.stacktrace], ['Error', 'hostile', undefined]);
});

check('key separates errors by their innermost Studio frame', () => {
  const at = (line) => errorWithStack('same', [`run (${MAC_APP}/index.js:${line}:1)`]);
  const key = (error) => exceptionKey(buildExceptionList(error, rejection, mac));
  assert.notStrictEqual(key(at(1)), key(at(2)));
  assert.strictEqual(key(at(1)), key(at(1)));
});

if (failures.length) {
  throw new Error(`Error event checks failed:\n${failures.join('\n')}`);
}
process.stdout.write('Error event checks passed\n');
