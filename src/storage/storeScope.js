const path = require('node:path');

const SESSION_ID_BYTES = 16;
const SESSION_ID_PATTERN = /^[a-f0-9]{32}$/i;
const DEFAULT_SESSION_FILE_POLICY = Object.freeze({
  ttlMs: 2 * 60 * 60 * 1000,
  maxFiles: 100,
  maxTotalBytes: 64 * 1024 * 1024
});

const GLOBAL_SCOPE = Object.freeze({
  type: 'global',
  id: 'global',
  sessionId: null
});

function normalizeSessionId(value) {
  if (typeof value !== 'string' || !SESSION_ID_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

function isValidSessionId(value) {
  return normalizeSessionId(value) !== null;
}

function generateSessionId(entropy) {
  const value = typeof entropy === 'function' ? entropy(SESSION_ID_BYTES) : entropy;
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new TypeError('Session entropy must be a Buffer or Uint8Array');
  }
  if (value.byteLength !== SESSION_ID_BYTES) {
    throw new RangeError(`Session entropy must contain exactly ${SESSION_ID_BYTES} bytes`);
  }
  return Buffer.from(value).toString('hex');
}

function isVercelRuntime(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function resolveStoreScope(options = {}) {
  const vercel = isVercelRuntime(options.vercel ?? options.isVercel);
  if (!vercel) return GLOBAL_SCOPE;

  const sessionId = normalizeSessionId(options.sessionId);
  if (!sessionId) throw new TypeError('A valid session identifier is required on Vercel');
  return Object.freeze({
    type: 'session',
    id: sessionId,
    sessionId
  });
}

function normalizeScope(scope) {
  if (scope === GLOBAL_SCOPE) return GLOBAL_SCOPE;
  if (!scope || typeof scope !== 'object') throw new TypeError('A valid store scope is required');
  if (scope.type === 'global' && scope.id === 'global') return GLOBAL_SCOPE;
  if (scope.type !== 'session') throw new TypeError('Unknown store scope type');

  const sessionId = normalizeSessionId(scope.sessionId ?? scope.id);
  if (!sessionId) throw new TypeError('Invalid session store scope');
  return { type: 'session', id: sessionId, sessionId };
}

function assertInsideRoot(root, target) {
  const relative = path.relative(root, target);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return;
  throw new Error('Derived store path escapes its root');
}

function deriveLocalStorePath(baseDirectory, scope) {
  if (typeof baseDirectory !== 'string' || !path.isAbsolute(baseDirectory)) {
    throw new TypeError('An absolute base storage directory is required');
  }

  const root = path.normalize(baseDirectory);
  const safeScope = normalizeScope(scope);
  const target = safeScope.type === 'global'
    ? path.join(root, 'store.json')
    : path.join(root, 'sessions', `${safeScope.sessionId}.json`);
  assertInsideRoot(root, target);
  return target;
}

function normalizeRedisBaseKey(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9:_-]{0,127}$/i.test(value)) {
    throw new TypeError('Redis base key contains unsafe characters');
  }
  return value;
}

function deriveScopedRedisKey(baseKey, scope) {
  const safeBaseKey = normalizeRedisBaseKey(baseKey);
  const safeScope = normalizeScope(scope);
  return safeScope.type === 'global'
    ? `${safeBaseKey}:global`
    : `${safeBaseKey}:session:${safeScope.sessionId}`;
}

function finiteOption(value, fallback, label, options = {}) {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isFinite(candidate) || candidate < 0 || (options.integer && !Number.isSafeInteger(candidate))) {
    throw new TypeError(`${label} must be a non-negative${options.integer ? ' safe integer' : ' number'}`);
  }
  return candidate;
}

function normalizeNow(value) {
  if (value instanceof Date) return value.getTime();
  return finiteOption(value, undefined, 'nowMs');
}

function normalizeSessionFile(file, index) {
  if (!file || typeof file !== 'object' || Array.isArray(file)) {
    return { index, file, reason: 'invalid-descriptor' };
  }

  const name = typeof file.name === 'string' ? file.name : '';
  const match = /^([a-f0-9]{32})\.json$/i.exec(name);
  if (!match) return { index, file: { ...file }, reason: 'unsafe-file-name' };

  const mtimeMs = file.mtimeMs instanceof Date ? file.mtimeMs.getTime() : file.mtimeMs;
  if (!Number.isFinite(mtimeMs) || mtimeMs < 0) {
    return { index, file: { ...file }, reason: 'invalid-mtime' };
  }
  if (!Number.isSafeInteger(file.size) || file.size < 0) {
    return { index, file: { ...file }, reason: 'invalid-size' };
  }

  return {
    index,
    sessionId: match[1].toLowerCase(),
    name: `${match[1].toLowerCase()}.json`,
    mtimeMs,
    size: file.size,
    file: {
      ...file,
      name: `${match[1].toLowerCase()}.json`,
      mtimeMs,
      size: file.size,
      sessionId: match[1].toLowerCase()
    }
  };
}

function newestFirst(left, right) {
  if (left.mtimeMs !== right.mtimeMs) return right.mtimeMs - left.mtimeMs;
  if (left.name !== right.name) return left.name.localeCompare(right.name);
  return left.index - right.index;
}

function withReason(candidate, reason) {
  return { ...candidate.file, reason };
}

function planSessionFileCleanup(files, options = {}) {
  if (!Array.isArray(files)) throw new TypeError('Session files must be an array');

  const nowMs = normalizeNow(options.nowMs);
  const ttlMs = finiteOption(options.ttlMs, DEFAULT_SESSION_FILE_POLICY.ttlMs, 'ttlMs');
  const maxFiles = finiteOption(
    options.maxFiles,
    DEFAULT_SESSION_FILE_POLICY.maxFiles,
    'maxFiles',
    { integer: true }
  );
  const maxTotalBytes = finiteOption(
    options.maxTotalBytes,
    DEFAULT_SESSION_FILE_POLICY.maxTotalBytes,
    'maxTotalBytes',
    { integer: true }
  );

  const invalid = [];
  const candidates = [];
  files.forEach((file, index) => {
    const normalized = normalizeSessionFile(file, index);
    if (normalized.reason) invalid.push({ ...(normalized.file || {}), reason: normalized.reason });
    else candidates.push(normalized);
  });

  candidates.sort(newestFirst);
  const uniqueCandidates = [];
  const seenSessionIds = new Set();
  candidates.forEach(candidate => {
    if (seenSessionIds.has(candidate.sessionId)) {
      invalid.push(withReason(candidate, 'duplicate-session-file'));
      return;
    }
    seenSessionIds.add(candidate.sessionId);
    uniqueCandidates.push(candidate);
  });

  const expired = [];
  const active = [];
  uniqueCandidates.forEach(candidate => {
    if (nowMs - candidate.mtimeMs >= ttlMs) expired.push(withReason(candidate, 'expired'));
    else active.push(candidate);
  });

  const kept = [];
  const overflow = [];
  let totalBytes = 0;
  active.forEach(candidate => {
    if (kept.length >= maxFiles) {
      overflow.push(withReason(candidate, 'max-files'));
      return;
    }
    if (totalBytes + candidate.size > maxTotalBytes) {
      overflow.push(withReason(candidate, 'max-total-bytes'));
      return;
    }
    kept.push({ ...candidate.file });
    totalBytes += candidate.size;
  });

  return {
    kept,
    expired,
    overflow,
    invalid,
    removed: [...expired, ...overflow, ...invalid],
    totalBytes,
    limits: { ttlMs, maxFiles, maxTotalBytes },
    nowMs
  };
}

module.exports = {
  SESSION_ID_BYTES,
  SESSION_ID_PATTERN,
  DEFAULT_SESSION_FILE_POLICY,
  isValidSessionId,
  normalizeSessionId,
  generateSessionId,
  resolveStoreScope,
  deriveLocalStorePath,
  deriveScopedRedisKey,
  planSessionFileCleanup
};
