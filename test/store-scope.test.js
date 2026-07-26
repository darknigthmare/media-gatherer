const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
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
} = require('../src/storage/storeScope');

const SESSION_A = 'a'.repeat(32);
const SESSION_B = 'b'.repeat(32);
const SESSION_C = 'c'.repeat(32);
const SESSION_D = 'd'.repeat(32);

test('validates and normalizes only exact 128-bit hexadecimal session identifiers', () => {
  assert.equal(SESSION_ID_BYTES, 16);
  assert.equal(SESSION_ID_PATTERN.test(SESSION_A), true);
  assert.equal(isValidSessionId(SESSION_A), true);
  assert.equal(isValidSessionId(SESSION_A.toUpperCase()), true);
  assert.equal(normalizeSessionId(SESSION_A.toUpperCase()), SESSION_A);

  [
    '',
    'a'.repeat(31),
    'a'.repeat(33),
    'g'.repeat(32),
    ` ${SESSION_A}`,
    `${SESSION_A} `,
    '../store',
    null,
    undefined,
    123
  ].forEach(value => {
    assert.equal(isValidSessionId(value), false);
    assert.equal(normalizeSessionId(value), null);
  });
});

test('generates a session identifier from deterministic injectable entropy', () => {
  const entropy = Uint8Array.from({ length: 16 }, (_, index) => index);
  const generated = generateSessionId(entropy);
  assert.equal(generated, '000102030405060708090a0b0c0d0e0f');
  assert.equal(isValidSessionId(generated), true);

  let requestedBytes = 0;
  assert.equal(generateSessionId(bytes => {
    requestedBytes = bytes;
    return Buffer.alloc(bytes, 0xff);
  }), 'f'.repeat(32));
  assert.equal(requestedBytes, SESSION_ID_BYTES);
});

test('rejects malformed or incorrectly sized generation entropy', () => {
  assert.throws(() => generateSessionId(), TypeError);
  assert.throws(() => generateSessionId('not-bytes'), TypeError);
  assert.throws(() => generateSessionId(Buffer.alloc(15)), RangeError);
  assert.throws(() => generateSessionId(Buffer.alloc(17)), RangeError);
  assert.throws(() => generateSessionId(() => null), TypeError);
});

test('uses one global scope locally and an isolated session scope on Vercel', () => {
  const localWithoutSession = resolveStoreScope({ vercel: false });
  const localWithUnsafeSession = resolveStoreScope({ vercel: false, sessionId: '../ignored' });
  assert.strictEqual(localWithoutSession, localWithUnsafeSession);
  assert.deepEqual(localWithoutSession, {
    type: 'global',
    id: 'global',
    sessionId: null
  });
  assert.equal(Object.isFrozen(localWithoutSession), true);

  const vercelScope = resolveStoreScope({ isVercel: '1', sessionId: SESSION_A.toUpperCase() });
  assert.deepEqual(vercelScope, {
    type: 'session',
    id: SESSION_A,
    sessionId: SESSION_A
  });
  assert.equal(Object.isFrozen(vercelScope), true);
  assert.notDeepEqual(vercelScope, resolveStoreScope({ vercel: true, sessionId: SESSION_B }));
});

test('requires a valid session identifier for an isolated Vercel scope', () => {
  assert.throws(() => resolveStoreScope({ vercel: true }), /valid session identifier/i);
  assert.throws(
    () => resolveStoreScope({ vercel: 'true', sessionId: '../../global' }),
    /valid session identifier/i
  );
  assert.throws(
    () => resolveStoreScope({ vercel: 1, sessionId: `${SESSION_A}:admin` }),
    /valid session identifier/i
  );
});

test('derives deterministic local paths that remain inside the storage root', () => {
  const root = path.resolve('temporary-storage-root');
  const globalPath = deriveLocalStorePath(root, resolveStoreScope({ vercel: false }));
  const sessionPath = deriveLocalStorePath(
    root,
    resolveStoreScope({ vercel: true, sessionId: SESSION_A })
  );

  assert.equal(globalPath, path.join(root, 'store.json'));
  assert.equal(sessionPath, path.join(root, 'sessions', `${SESSION_A}.json`));
  assert.equal(path.relative(root, globalPath).startsWith('..'), false);
  assert.equal(path.relative(root, sessionPath).startsWith('..'), false);
});

test('rejects unsafe local-path scopes instead of normalizing traversal', () => {
  const root = path.resolve('temporary-storage-root');
  assert.throws(() => deriveLocalStorePath('', { type: 'global', id: 'global' }), TypeError);
  assert.throws(
    () => deriveLocalStorePath('relative-root', { type: 'global', id: 'global' }),
    /absolute base storage directory/i
  );
  assert.throws(() => deriveLocalStorePath(root, null), TypeError);
  assert.throws(
    () => deriveLocalStorePath(root, { type: 'session', id: '../store.json' }),
    /invalid session store scope/i
  );
  assert.throws(
    () => deriveLocalStorePath(root, { type: 'global', id: '../../global' }),
    /unknown store scope type/i
  );
});

test('derives collision-resistant scoped Redis keys and rejects unsafe bases', () => {
  const globalScope = resolveStoreScope({ vercel: false });
  const sessionScope = resolveStoreScope({ vercel: true, sessionId: SESSION_A });
  assert.equal(deriveScopedRedisKey('mediagatherer:store', globalScope), 'mediagatherer:store:global');
  assert.equal(
    deriveScopedRedisKey('mediagatherer:store', sessionScope),
    `mediagatherer:store:session:${SESSION_A}`
  );

  [
    '',
    '../mediagatherer',
    'mediagatherer/store',
    'mediagatherer\\store',
    'mediagatherer.store',
    ' key',
    `a${'b'.repeat(128)}`
  ].forEach(baseKey => {
    assert.throws(() => deriveScopedRedisKey(baseKey, globalScope), /unsafe characters/i);
  });
  assert.throws(
    () => deriveScopedRedisKey('mediagatherer:store', { type: 'session', id: '../admin' }),
    /invalid session store scope/i
  );
});

test('plans expiration first, then bounds active files by recency and count', () => {
  const nowMs = Date.UTC(2026, 6, 26, 12, 0, 0);
  const hour = 60 * 60 * 1000;
  const files = [
    { name: `${SESSION_A}.json`, mtimeMs: nowMs - 3 * hour, size: 10 },
    { name: `${SESSION_B}.json`, mtimeMs: nowMs - 10, size: 20 },
    { name: `${SESSION_C}.json`, mtimeMs: nowMs - 20, size: 30 },
    { name: `${SESSION_D}.json`, mtimeMs: nowMs - 30, size: 40 }
  ];

  const result = planSessionFileCleanup(files, {
    nowMs,
    ttlMs: 2 * hour,
    maxFiles: 2,
    maxTotalBytes: 1000
  });

  assert.deepEqual(result.kept.map(file => file.sessionId), [SESSION_B, SESSION_C]);
  assert.deepEqual(result.expired.map(file => [file.sessionId, file.reason]), [[SESSION_A, 'expired']]);
  assert.deepEqual(result.overflow.map(file => [file.sessionId, file.reason]), [[SESSION_D, 'max-files']]);
  assert.equal(result.invalid.length, 0);
  assert.equal(result.totalBytes, 50);
  assert.equal(result.removed.length, 2);
  assert.deepEqual(result.limits, {
    ttlMs: 2 * hour,
    maxFiles: 2,
    maxTotalBytes: 1000
  });
});

test('bounds total bytes without allowing one oversized file to block smaller files', () => {
  const nowMs = 10_000;
  const result = planSessionFileCleanup([
    { name: `${SESSION_A}.json`, mtimeMs: 9999, size: 100 },
    { name: `${SESSION_B}.json`, mtimeMs: 9998, size: 30 },
    { name: `${SESSION_C}.json`, mtimeMs: 9997, size: 20 }
  ], {
    nowMs,
    ttlMs: 1000,
    maxFiles: 10,
    maxTotalBytes: 50
  });

  assert.deepEqual(result.kept.map(file => file.sessionId), [SESSION_B, SESSION_C]);
  assert.deepEqual(result.overflow.map(file => [file.sessionId, file.reason]), [
    [SESSION_A, 'max-total-bytes']
  ]);
  assert.equal(result.totalBytes, 50);
});

test('rejects unsafe metadata and keeps only the newest descriptor per session', () => {
  const nowMs = 10_000;
  const input = [
    { name: `${SESSION_A.toUpperCase()}.json`, mtimeMs: 9900, size: 5, marker: 'newest' },
    { name: `${SESSION_A}.json`, mtimeMs: 9800, size: 5, marker: 'duplicate' },
    { name: '../store.json', mtimeMs: 9900, size: 5 },
    { name: `${SESSION_B}.json/../../store.json`, mtimeMs: 9900, size: 5 },
    { name: `${SESSION_B}.json`, mtimeMs: -1, size: 5 },
    { name: `${SESSION_C}.json`, mtimeMs: 9900, size: -1 },
    null
  ];

  const snapshot = JSON.parse(JSON.stringify(input));
  const result = planSessionFileCleanup(input, { nowMs, ttlMs: 1000 });
  assert.deepEqual(result.kept.map(file => [file.sessionId, file.marker]), [[SESSION_A, 'newest']]);
  assert.deepEqual(
    result.invalid.map(file => file.reason).sort(),
    [
      'duplicate-session-file',
      'invalid-descriptor',
      'invalid-mtime',
      'invalid-size',
      'unsafe-file-name',
      'unsafe-file-name'
    ].sort()
  );
  assert.deepEqual(input, snapshot);
});

test('accepts boundary policies and rejects malformed cleanup options', () => {
  const result = planSessionFileCleanup([
    { name: `${SESSION_A}.json`, mtimeMs: 1000, size: 0 }
  ], {
    nowMs: new Date(1000),
    ttlMs: 0,
    maxFiles: 0,
    maxTotalBytes: 0
  });
  assert.equal(result.kept.length, 0);
  assert.equal(result.expired[0].reason, 'expired');

  assert.deepEqual(DEFAULT_SESSION_FILE_POLICY, {
    ttlMs: 2 * 60 * 60 * 1000,
    maxFiles: 100,
    maxTotalBytes: 64 * 1024 * 1024
  });
  assert.equal(Object.isFrozen(DEFAULT_SESSION_FILE_POLICY), true);

  assert.throws(() => planSessionFileCleanup(null), /must be an array/i);
  assert.throws(() => planSessionFileCleanup([]), /nowMs/);
  assert.throws(() => planSessionFileCleanup([], { nowMs: Number.NaN }), /nowMs/);
  assert.throws(() => planSessionFileCleanup([], { nowMs: 0, ttlMs: -1 }), /ttlMs/);
  assert.throws(() => planSessionFileCleanup([], { nowMs: 0, maxFiles: 1.5 }), /maxFiles/);
  assert.throws(
    () => planSessionFileCleanup([], { nowMs: 0, maxTotalBytes: Infinity }),
    /maxTotalBytes/
  );
});
