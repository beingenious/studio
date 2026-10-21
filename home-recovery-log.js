const fs = require('fs');
const path = require('path');

const LIMIT = 256 * 1024;
const EVENTS = new Set([
  'startup', 'suspend', 'resume', 'renderer-exited', 'load-failed', 'load-rejected',
  'unresponsive', 'responsive', 'load-started', 'load-finished', 'reload-requested',
  'selection-script-failed', 'reload-unavailable', 'reload-failed', 'dialog-failed', 'react-error',
]);
const REASONS = new Set([
  'clean-exit', 'abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed',
  'integrity-failure',
]);
const ERROR_NAMES = new Set([
  'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError',
]);

module.exports = function createHomeRecoveryLog({ file, versions = {} }) {
  let warned = false;
  return (event, data = {}) => {
    if (!EVENTS.has(event)) return;
    const record = { timestamp: new Date().toISOString(), event };
    ['app', 'electron', 'chrome'].forEach((key) => {
      if (typeof versions[key] === 'string' && /^[\da-z.-]{1,40}$/i.test(versions[key])) {
        record[key] = versions[key];
      }
    });
    ['viewId', 'exitCode', 'errorCode', 'durationMs'].forEach((key) => {
      if (Number.isFinite(data[key])) record[key] = data[key];
    });
    if (REASONS.has(data.reason)) record.reason = data.reason;
    if (data.boundary === 'home') record.boundary = 'home';
    if (ERROR_NAMES.has(data.errorName)) record.errorName = data.errorName;
    if (['menu', 'dialog'].includes(data.source)) record.source = data.source;
    const line = `${JSON.stringify(record)}\n`;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
      if (size + Buffer.byteLength(line) > LIMIT) {
        if (fs.existsSync(`${file}.1`)) fs.unlinkSync(`${file}.1`);
        fs.renameSync(file, `${file}.1`);
      }
      fs.appendFileSync(file, line, { mode: 0o600 });
    } catch (error) {
      if (!warned) {
        warned = true;
        // eslint-disable-next-line no-console
        console.warn('Home recovery diagnostics could not be written.');
      }
    }
  };
};
