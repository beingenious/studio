// Sends unhandled main-process errors to PostHog error tracking.
const { app, net } = require('electron');
const crypto = require('crypto');
const os = require('os');
const { is } = require('electron-util');
const { buildExceptionList, exceptionKey } = require('./error-event');

const TOKEN = 'phc_dATlDYccNlkcRo1WckwguZdAHwrh3Z6rNtGql9fu6ro';
const ENDPOINT = 'https://paw.pandasuite.com/i/v0/e/';
const LIMIT = 20;
const OS_NAMES = { darwin: 'Mac OS X', win32: 'Windows', linux: 'Linux' };

// Random per launch and kept in memory only: links the errors of one launch, nothing more.
const launchId = crypto.randomBytes(16).toString('hex');
// One entry per admitted event: deduplicates and counts towards the limit.
const admitted = new Set();
let settings = null;

const ignore = () => {
  // Reporting must never throw.
};

const send = (event) => {
  try {
    const request = net.request({ method: 'POST', url: settings.endpoint });
    request.setHeader('Content-Type', 'application/json');
    request.on('error', ignore);
    request.on('response', (response) => {
      try {
        response.on('error', ignore);
        response.on('data', ignore);
      } catch (error) {
        // Reporting must never throw.
      }
    });
    request.end(JSON.stringify(event));
  } catch (error) {
    // Reporting must never throw.
  }
};

const captureException = (value, mechanism = { type: 'generic', handled: true }) => {
  try {
    if (!settings || !settings.enabled || admitted.size >= LIMIT) return;
    const exceptionList = buildExceptionList(value, mechanism, {
      appPath: app.getAppPath(),
      home: os.homedir(),
    });
    const key = exceptionKey(exceptionList);
    if (admitted.has(key)) return;
    admitted.add(key);
    const event = {
      api_key: TOKEN,
      event: '$exception',
      distinct_id: launchId,
      timestamp: new Date().toISOString(),
      properties: {
        $exception_list: exceptionList,
        $exception_level: 'error',
        $process_person_profile: false,
        $app_name: 'PandaSuite Studio',
        $app_version: app.getVersion(),
        $os: OS_NAMES[process.platform] || process.platform,
        $os_version: process.getSystemVersion(),
        $lib: 'pandasuite-studio',
        electron_version: process.versions.electron,
        arch: process.arch,
        process: 'main',
      },
    };
    if (app.isReady()) send(event);
    else app.whenReady().then(() => send(event), ignore);
  } catch (error) {
    // Reporting must never throw.
  }
};

const start = ({ endpoint = ENDPOINT, enabled = !is.development } = {}) => {
  settings = { endpoint, enabled };
  process.on('uncaughtExceptionMonitor', (error) => {
    captureException(error, { type: 'onuncaughtexception', handled: false });
  });
  process.on('unhandledRejection', (reason) => {
    captureException(reason, { type: 'onunhandledrejection', handled: false });
  });
};

module.exports = { start, captureException };
