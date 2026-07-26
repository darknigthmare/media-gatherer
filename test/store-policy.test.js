const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BOUNDED_STORE_LIMITS,
  RECENCY_TIMESTAMP_FIELDS,
  BOUNDED_ARRAY_KEYS,
  BOUNDED_OBJECT_KEYS,
  normalizeBoundedStore
} = require('../src/storage/storePolicy');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function datedRows(count, prefix) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    createdAt: new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString(),
    nested: { index }
  }));
}

test('exports an immutable and complete bounded-store policy', () => {
  assert.equal(Object.isFrozen(BOUNDED_STORE_LIMITS), true);
  assert.equal(Object.isFrozen(RECENCY_TIMESTAMP_FIELDS), true);
  assert.equal(Object.isFrozen(BOUNDED_ARRAY_KEYS), true);
  assert.equal(Object.isFrozen(BOUNDED_OBJECT_KEYS), true);
  assert.deepEqual(
    [...BOUNDED_ARRAY_KEYS, ...BOUNDED_OBJECT_KEYS].sort(),
    Object.keys(BOUNDED_STORE_LIMITS).sort()
  );
  Object.values(BOUNDED_STORE_LIMITS).forEach(limit => {
    assert.equal(Number.isSafeInteger(limit), true);
    assert.ok(limit > 0);
  });
});

test('bounds every store collection and preserves the most recent records', () => {
  const store = { settings: { theme: 'dark' } };

  BOUNDED_ARRAY_KEYS.forEach(key => {
    store[key] = datedRows(BOUNDED_STORE_LIMITS[key] + 3, key);
  });

  BOUNDED_OBJECT_KEYS.forEach(key => {
    store[key] = Object.fromEntries(
      datedRows(BOUNDED_STORE_LIMITS[key] + 3, key).map(row => [row.id, row])
    );
  });

  const normalized = normalizeBoundedStore(store, {});

  BOUNDED_ARRAY_KEYS.forEach(key => {
    const limit = BOUNDED_STORE_LIMITS[key];
    assert.equal(normalized[key].length, limit);
    assert.equal(normalized[key][0].id, `${key}-${limit + 2}`);
    assert.equal(normalized[key].at(-1).id, `${key}-3`);
  });

  BOUNDED_OBJECT_KEYS.forEach(key => {
    const limit = BOUNDED_STORE_LIMITS[key];
    const keys = Object.keys(normalized[key]);
    assert.equal(keys.length, limit);
    assert.equal(keys[0], `${key}-${limit + 2}`);
    assert.equal(keys.at(-1), `${key}-3`);
  });

  assert.deepEqual(normalized.settings, { theme: 'dark' });
});

test('uses the newest valid timestamp and keeps undated ties stable', () => {
  const store = {
    history: [
      { id: 'created-newer', createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 'updated-newest', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z' },
      { id: 'numeric-seconds', timestamp: 1767225600 },
      { id: 'undated-first' },
      { id: 'undated-second', updatedAt: 'invalid' }
    ]
  };

  const normalized = normalizeBoundedStore(store, {});
  assert.deepEqual(
    normalized.history.map(row => row.id),
    ['updated-newest', 'created-newer', 'numeric-seconds', 'undated-first', 'undated-second']
  );
});

test('does not mutate or retain mutable references from store or defaults', () => {
  const defaults = deepFreeze({
    history: [{ id: 'default', createdAt: '2025-01-01T00:00:00.000Z' }],
    collection: [],
    settings: { language: 'fr' }
  });
  const store = deepFreeze({
    history: [{ id: 'input', createdAt: '2026-01-01T00:00:00.000Z', nested: { score: 1 } }],
    cache: { result: { createdAt: 1767225600000, payload: { count: 1 } } }
  });

  const normalized = normalizeBoundedStore(store, defaults);
  assert.equal(normalized.history[0].id, 'input');
  assert.notEqual(normalized.history, store.history);
  assert.notEqual(normalized.history[0], store.history[0]);
  assert.notEqual(normalized.history[0].nested, store.history[0].nested);
  assert.notEqual(normalized.cache.result, store.cache.result);
  assert.notEqual(normalized.cache.result.payload, store.cache.result.payload);
  assert.notEqual(normalized.settings, defaults.settings);

  normalized.history[0].nested.score = 2;
  normalized.cache.result.payload.count = 2;
  assert.equal(store.history[0].nested.score, 1);
  assert.equal(store.cache.result.payload.count, 1);
});

test('falls back to defaults for malformed bounded containers', () => {
  const defaults = {
    history: [{ id: 'fallback', createdAt: '2026-01-01T00:00:00.000Z' }],
    cache: { fallback: { createdAt: 1767225600000 } },
    settings: { locale: 'fr-FR' }
  };
  const normalized = normalizeBoundedStore(
    {
      history: 'invalid',
      cache: [],
      persons: null,
      sourceDiagnostics: 'invalid',
      settings: { locale: 'en-US' }
    },
    defaults
  );

  assert.deepEqual(normalized.history.map(row => row.id), ['fallback']);
  assert.deepEqual(Object.keys(normalized.cache), ['fallback']);
  assert.deepEqual(normalized.persons, []);
  assert.deepEqual(normalized.sourceDiagnostics, {});
  assert.deepEqual(normalized.settings, { locale: 'en-US' });
});
