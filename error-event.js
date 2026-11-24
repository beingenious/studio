// Builds PostHog `$exception_list` entries from values thrown in the main process.
// Stack line parsing adapted from posthog-node (MIT), itself derived from
// getsentry/sentry-javascript (MIT).

const FRAME_LIMIT = 50;
const UNKNOWN_FUNCTION = '?';
const FRAME_LINE = /^\s*at (?:async )?(?:(.+?)\s+\()?(?:(.+):(\d+):(\d+)?|([^)]+))\)?/;
// A frame without a function name is the location alone, which may contain " (".
const LOCATION_LINE = /^\s*at (?:async )?(.+):(\d+):(\d+)\s*$/;
const URL_QUERY = /(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/g;

const attempt = (read, fallback) => {
  try {
    return read();
  } catch (error) {
    return fallback;
  }
};

const toSlashes = (value) => value.replace(/\\/g, '/');
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Windows paths compare without case: the drive letter and folders may differ in case.
const pathPrefix = (root) => {
  const normalized = toSlashes(root || '').replace(/\/+$/, '');
  if (!normalized) return () => null;
  const insensitive = /^[a-z]:\//i.test(normalized);
  const fold = (value) => (insensitive ? value.toLowerCase() : value);
  const prefix = fold(`${normalized}/`);
  return (path) => (fold(path).startsWith(prefix) ? path.slice(prefix.length) : null);
};

const functionName = (name) => {
  if (!name) return UNKNOWN_FUNCTION;
  let methodStart = name.lastIndexOf('.');
  if (name[methodStart - 1] === '.') methodStart -= 1;
  if (methodStart <= 0) return name;
  let object = name.slice(0, methodStart);
  const method = name.slice(methodStart + 1);
  const objectEnd = object.indexOf('.Module');
  const result = objectEnd > 0 ? name.slice(objectEnd + 1) : name;
  if (objectEnd > 0) object = object.slice(0, objectEnd);
  return method === '<anonymous>' ? `${object}.${UNKNOWN_FUNCTION}` : result;
};

const matchFrame = (line) => {
  if (line.length > 1024) return null;
  const location = !/\)\s*$/.test(line) && line.match(LOCATION_LINE);
  return location ? [line, undefined, ...location.slice(1)] : line.match(FRAME_LINE);
};

const parseFrame = (line, { underApp, underHome }) => {
  const match = matchFrame(line);
  if (!match) return null;
  const native = match[5] === 'native';
  const raw = match[2] || (!native && match[5]) || undefined;
  const path = raw && toSlashes(raw);
  const relative = path ? underApp(path) : null;
  const inHome = path && relative === null ? underHome(path) : null;
  let filename = path;
  if (relative !== null) filename = relative;
  else if (inHome !== null) filename = `~/${inHome}`;
  const frame = {
    platform: 'node:javascript',
    filename,
    function: functionName(match[1]),
    in_app: relative !== null && !`/${relative}`.includes('/node_modules/'),
  };
  const lineno = parseInt(match[3], 10);
  const colno = parseInt(match[4], 10);
  if (lineno) frame.lineno = lineno;
  if (colno) frame.colno = colno;
  return frame;
};

const parseStack = (stack, paths) => stack.split('\n')
  .map((line) => parseFrame(line, paths))
  .filter(Boolean)
  .slice(0, FRAME_LIMIT)
  .reverse();

const cleanMessage = (message, home) => {
  // An inspected value, such as a rejected string, shows its backslashes doubled.
  const homes = home && home.length > 1
    ? [home.replace(/\\/g, '\\\\'), home, toSlashes(home)]
    : [];
  const insensitive = /^[a-z]:[\\/]/i.test(home || '');
  return homes
    .reduce((text, form) => text.replace(new RegExp(escapeRegExp(form), insensitive ? 'gi' : 'g'), '~'), message)
    .replace(URL_QUERY, '$1');
};

const describeValue = (value) => {
  const text = attempt(() => String(value), undefined);
  return text !== undefined ? text : attempt(() => Object.prototype.toString.call(value), 'Unknown value');
};

const buildExceptionList = (value, mechanism, { appPath, home }) => {
  const isError = attempt(() => value instanceof Error, false);
  const message = isError ? attempt(() => String(value.message || ''), '') : describeValue(value);
  const exception = {
    type: (isError && (attempt(() => value.name, '') || attempt(() => value.constructor.name, ''))) || 'Error',
    value: cleanMessage(message, home),
    mechanism: { type: mechanism.type, handled: mechanism.handled, synthetic: !isError },
  };
  const stack = isError ? attempt(() => value.stack, '') : '';
  const frames = typeof stack === 'string'
    ? parseStack(stack, { underApp: pathPrefix(appPath), underHome: pathPrefix(home) })
    : [];
  if (frames.length) exception.stacktrace = { type: 'raw', frames };
  return [exception];
};

const exceptionKey = ([exception]) => {
  const frames = exception.stacktrace ? exception.stacktrace.frames : [];
  const top = frames.filter((frame) => frame.in_app).pop();
  return [exception.type, exception.value, top ? `${top.filename}:${top.lineno}` : ''].join('|');
};

module.exports = { buildExceptionList, exceptionKey, cleanMessage };
