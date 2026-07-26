function createRemoteStore(options = {}) {
  const url = String(options.url || '').replace(/\/+$/, '');
  const token = String(options.token || '');
  const baseKey = String(options.key || 'mediagatherer:store');
  const enabled = Boolean(url && token);
  const fetchImpl = options.fetch || globalThis.fetch;
  const ttlSeconds = Number.isSafeInteger(options.ttlSeconds) && options.ttlSeconds > 0
    ? options.ttlSeconds
    : 0;
  const states = new Map();
  const pendingByKey = new Map();

  function safeScope(scope) {
    const value = String(scope || 'global').trim().toLowerCase();
    return /^[a-z0-9_-]{1,80}$/.test(value) ? value : 'global';
  }

  function scopedKey(scope) {
    const normalized = safeScope(scope);
    return normalized === 'global'
      ? `${baseKey}:global`
      : `${baseKey}:session:${normalized}`;
  }

  function scopeState(scope) {
    const normalized = safeScope(scope);
    if (!states.has(normalized)) {
      states.set(normalized, {
        state: enabled ? 'not_loaded' : 'disabled',
        lastError: '',
        lastLoadedAt: null,
        lastSavedAt: null
      });
    }
    return states.get(normalized);
  }

  async function command(parts) {
    if (!enabled) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(parts),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Upstash HTTP ${response.status}`);
      const payload = await response.json();
      if (payload.error) throw new Error(payload.error);
      return payload.result;
    } finally {
      clearTimeout(timer);
    }
  }

  async function load(scope = 'global') {
    if (!enabled) return null;
    const normalized = safeScope(scope);
    const current = scopeState(normalized);
    current.state = 'loading';
    try {
      const value = await command(['GET', scopedKey(normalized)]);
      current.state = value ? 'ready' : 'empty';
      current.lastLoadedAt = new Date().toISOString();
      current.lastError = '';
      return value ? JSON.parse(value) : null;
    } catch (error) {
      current.state = 'error';
      current.lastError = error.message;
      throw error;
    }
  }

  function persist(store, scope = 'global') {
    if (!enabled) return Promise.resolve(false);
    const normalized = safeScope(scope);
    const key = scopedKey(normalized);
    const current = scopeState(normalized);
    const payload = JSON.stringify(store);
    const previous = pendingByKey.get(key) || Promise.resolve();
    const pending = previous.catch(() => undefined).then(async () => {
      try {
        const commandParts = ['SET', key, payload];
        if (ttlSeconds && normalized !== 'global') commandParts.push('EX', String(ttlSeconds));
        await command(commandParts);
        current.state = 'ready';
        current.lastSavedAt = new Date().toISOString();
        current.lastError = '';
        return true;
      } catch (error) {
        current.state = 'error';
        current.lastError = error.message;
        throw error;
      }
    });
    pendingByKey.set(key, pending);
    return pending;
  }

  function flush(scope = 'global') {
    const pending = pendingByKey.get(scopedKey(scope)) || Promise.resolve(true);
    return pending.catch(() => false);
  }

  function status(scope = 'global') {
    const normalized = safeScope(scope);
    const current = scopeState(normalized);
    return {
      enabled,
      provider: enabled ? 'upstash-redis-rest' : 'local-json',
      state: current.state,
      key: scopedKey(normalized),
      scope: normalized,
      lastLoadedAt: current.lastLoadedAt,
      lastSavedAt: current.lastSavedAt,
      lastError: current.lastError || null
    };
  }

  return { enabled, load, persist, flush, status, scopedKey };
}

module.exports = { createRemoteStore };
