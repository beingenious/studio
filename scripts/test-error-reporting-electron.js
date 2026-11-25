/* eslint-disable no-console, global-require */
const { app, net } = require('electron');
const assert = require('assert');
const events = require('events');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'studio-error-reporting-')));
let phase = 'setup';
const deadline = setTimeout(() => {
  console.error(`Error reporting test timed out during ${phase}`);
  app.exit(1);
}, 30000);

const bodies = [];
const waiters = [];
const valueOf = (body) => body.properties.$exception_list[0].value;
const settle = () => waiters.slice().forEach((waiter) => {
  const body = bodies.find((candidate) => valueOf(candidate) === waiter.value);
  if (body) {
    waiters.splice(waiters.indexOf(waiter), 1);
    waiter.resolve(body);
  }
});
const bodyFor = (value) => new Promise((resolve) => {
  waiters.push({ value, resolve });
  settle();
});
let onBody = () => {};
const server = http.createServer((request, response) => {
  let data = '';
  request.on('data', (chunk) => { data += chunk; });
  request.on('end', () => {
    bodies.push(JSON.parse(data));
    settle();
    onBody();
    if (data.includes('cut-response')) {
      response.writeHead(200, { 'Content-Length': 100 });
      response.write('x'.repeat(50), () => request.socket.destroy());
      return;
    }
    response.end('{"status":"Ok"}');
  });
});

// Spy on the network boundary: keep every request the reporter creates.
const requests = [];
const createRequest = net.request.bind(net);
net.request = (...args) => {
  const request = createRequest(...args);
  requests.push(request);
  return request;
};

const handled = [];
let onHandled = () => {};
const nextHandled = () => new Promise((resolve) => { onHandled = resolve; });
const tick = () => new Promise((resolve) => setImmediate(resolve));

const run = async (endpoint) => {
  // A development build sends nothing: the default `enabled` follows `is.development`.
  const development = require('../error-reporting');
  development.start({ endpoint });
  development.captureException(new Error('dev'));
  delete require.cache[require.resolve('../error-reporting')];

  const reporter = require('../error-reporting');
  reporter.start({ endpoint, enabled: true });
  require('electron-unhandled')({
    logger: (error) => {
      handled.push(error);
      onHandled();
    },
  });

  phase = 'capture before ready';
  assert(!app.isReady(), 'setup must run before ready');
  reporter.captureException(new Error('before ready'));
  await app.whenReady();
  assert.strictEqual(requests.length, 1, 'only the enabled instance sends, once ready');
  await bodyFor('before ready');

  phase = 'unhandled rejection';
  let wait = nextHandled();
  const rejected = new Error('rejected');
  Promise.reject(rejected);
  await wait;
  const rejection = await bodyFor('rejected');
  const [exception] = rejection.properties.$exception_list;
  assert.deepStrictEqual(exception.mechanism,
    { type: 'onunhandledrejection', handled: false, synthetic: false });
  const { frames } = exception.stacktrace;
  const innermost = frames[frames.length - 1];
  assert.strictEqual(innermost.filename, 'test-error-reporting-electron.js');
  assert.strictEqual(innermost.in_app, true);
  assert.strictEqual(typeof innermost.lineno, 'number');

  phase = 'uncaught exception';
  wait = nextHandled();
  setImmediate(() => { throw new Error('uncaught'); });
  await wait;
  assert.strictEqual((await bodyFor('uncaught')).properties.$exception_list[0].mechanism.type,
    'onuncaughtexception');

  phase = 'unusual thrown values';
  await [null, 'x', Object.create(null)].reduce((previous, value) => previous.then(() => {
    const thrown = nextHandled();
    setImmediate(() => { throw value; });
    return thrown;
  }), Promise.resolve());
  assert.strictEqual(handled.length, 5, 'electron-unhandled still handles every value');
  await Promise.all(['null', 'x', '[object Object]'].map(async (value) => {
    const [thrown] = (await bodyFor(value)).properties.$exception_list;
    assert.strictEqual(thrown.mechanism.synthetic, true);
  }));

  phase = 'hostile stack getter';
  const hostile = new Error('hostile');
  Object.defineProperty(hostile, 'stack', { get() { throw new Error('stack getter'); } });
  assert.doesNotThrow(() => reporter.captureException(hostile,
    { type: 'onuncaughtexception', handled: false }));
  await bodyFor('hostile');

  phase = 'response cut mid-body';
  const before = { handled: handled.length, requests: requests.length };
  reporter.captureException(new Error('cut-response'));
  assert.strictEqual(requests.length, before.requests + 1);
  const cut = requests[requests.length - 1];
  let responseError = null;
  // errorMonitor observes without counting as a listener, so it cannot hide a missing one.
  cut.on('response', (response) => response.on(events.errorMonitor, (error) => {
    responseError = error;
  }));
  await new Promise((resolve) => cut.on(events.errorMonitor, resolve));
  await tick();
  assert(responseError, 'the response stream failed');
  assert.strictEqual(handled.length, before.handled, 'a failed send is never an unhandled error');
  assert.strictEqual(requests.length, before.requests + 1, 'a failed send is never reported');

  phase = 'deduplication and limit';
  reporter.captureException(rejected);
  assert.strictEqual(requests.length, 8, 'an identical error is sent once per launch');
  Array.from({ length: 20 }, (unused, index) => reporter.captureException(new Error(`n${index}`)));
  assert.strictEqual(requests.length, 20, 'at most 20 events per launch');
  await new Promise((resolve) => {
    onBody = () => bodies.length >= 20 && resolve();
    onBody();
  });
  assert(bodies.every((body) => valueOf(body) !== 'dev'));
  assert.strictEqual(new Set(bodies.map((body) => body.distinct_id)).size, 1);
  bodies.forEach((body) => {
    assert(body.api_key.startsWith('phc_'));
    assert.strictEqual(body.event, '$exception');
    const { properties } = body;
    assert.strictEqual(properties.$exception_level, 'error');
    assert.strictEqual(properties.$process_person_profile, false);
    assert.strictEqual(properties.$app_name, 'PandaSuite Studio');
    assert.strictEqual(properties.$app_version, app.getVersion());
    assert.strictEqual(properties.$os,
      { darwin: 'Mac OS X', win32: 'Windows', linux: 'Linux' }[process.platform]);
    assert.strictEqual(typeof properties.$os_version, 'string');
    assert.strictEqual(properties.$lib, 'pandasuite-studio');
    assert.strictEqual(properties.process, 'main');
  });
};

server.listen(0, '127.0.0.1', () => {
  run(`http://127.0.0.1:${server.address().port}/i/v0/e/`).then(() => {
    clearTimeout(deadline);
    server.close();
    console.log('Error reporting verified');
    app.exit(0);
  }, (error) => {
    console.error(`Error reporting test failed during ${phase}:`, error);
    app.exit(1);
  });
});
