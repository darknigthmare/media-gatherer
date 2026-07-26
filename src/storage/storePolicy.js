const BOUNDED_STORE_LIMITS = Object.freeze({
  history: 200,
  collection: 10000,
  queue: 250,
  persons: 2000,
  personMediaLinks: 25000,
  personValidationRules: 10000,
  aliasCandidates: 2000,
  resultSnapshots: 200,
  monitors: 50,
  sourceDiagnostics: 512,
  cache: 500
});

const RECENCY_TIMESTAMP_FIELDS = Object.freeze([
  'updatedAt',
  'validatedAt',
  'finishedAt',
  'lastTest',
  'lastRunAt',
  'lastCheckedAt',
  'lastSeenAt',
  'discoveredAt',
  'createdAt',
  'startedAt',
  'date',
  'timestamp'
]);

const BOUNDED_ARRAY_KEYS = Object.freeze([
  'history',
  'collection',
  'queue',
  'persons',
  'personMediaLinks',
  'personValidationRules',
  'aliasCandidates',
  'resultSnapshots',
  'monitors'
]);

const BOUNDED_OBJECT_KEYS = Object.freeze([
  'sourceDiagnostics',
  'cache'
]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value, seen = new WeakMap()) {
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (seen.has(value)) return seen.get(value);

  if (Array.isArray(value)) {
    const clone = [];
    seen.set(value, clone);
    value.forEach(item => clone.push(cloneValue(item, seen)));
    return clone;
  }

  const clone = {};
  seen.set(value, clone);
  Object.keys(value).forEach(key => {
    clone[key] = cloneValue(value[key], seen);
  });
  return clone;
}

function timestampToEpoch(value) {
  if (value instanceof Date) {
    const epoch = value.getTime();
    return Number.isFinite(epoch) ? epoch : Number.NEGATIVE_INFINITY;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return Number.NEGATIVE_INFINITY;
    return value > 0 && value < 1e12 ? value * 1000 : value;
  }

  if (typeof value !== 'string' || !value.trim()) return Number.NEGATIVE_INFINITY;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return timestampToEpoch(Number(trimmed));
  const epoch = Date.parse(trimmed);
  return Number.isFinite(epoch) ? epoch : Number.NEGATIVE_INFINITY;
}

function recordRecency(record) {
  if (!isRecord(record)) return Number.NEGATIVE_INFINITY;
  return RECENCY_TIMESTAMP_FIELDS.reduce(
    (latest, field) => Math.max(latest, timestampToEpoch(record[field])),
    Number.NEGATIVE_INFINITY
  );
}

function mostRecentEntries(entries, limit) {
  return entries
    .map(([key, value], index) => ({
      key,
      value,
      index,
      recency: recordRecency(value)
    }))
    .sort((left, right) => {
      if (left.recency !== right.recency) return right.recency - left.recency;
      return left.index - right.index;
    })
    .slice(0, limit)
    .map(({ key, value }) => [key, cloneValue(value)]);
}

function normalizeBoundedStore(store, defaults = {}) {
  const safeStore = isRecord(store) ? store : {};
  const safeDefaults = isRecord(defaults) ? defaults : {};
  const normalized = {
    ...cloneValue(safeDefaults),
    ...cloneValue(safeStore)
  };

  BOUNDED_ARRAY_KEYS.forEach(key => {
    const candidate = Array.isArray(safeStore[key])
      ? safeStore[key]
      : (Array.isArray(safeDefaults[key]) ? safeDefaults[key] : []);
    normalized[key] = mostRecentEntries(
      candidate.map((value, index) => [index, value]),
      BOUNDED_STORE_LIMITS[key]
    ).map(([, value]) => value);
  });

  BOUNDED_OBJECT_KEYS.forEach(key => {
    const candidate = isRecord(safeStore[key])
      ? safeStore[key]
      : (isRecord(safeDefaults[key]) ? safeDefaults[key] : {});
    normalized[key] = Object.fromEntries(
      mostRecentEntries(Object.entries(candidate), BOUNDED_STORE_LIMITS[key])
    );
  });

  return normalized;
}

module.exports = {
  BOUNDED_STORE_LIMITS,
  RECENCY_TIMESTAMP_FIELDS,
  BOUNDED_ARRAY_KEYS,
  BOUNDED_OBJECT_KEYS,
  normalizeBoundedStore
};
