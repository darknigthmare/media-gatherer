function createRemoteStore(options = {}) {
  const url = String(options.url || '').replace(/\/+$/, '');
  const token = String(options.token || '');
  const key = String(options.key || 'mediagatherer:store');
  const enabled = Boolean(url && token);
  let state = enabled ? 'not_loaded' : 'disabled';
  let lastError = '';
  let lastLoadedAt = null;
  let lastSavedAt = null;
  let pending = Promise.resolve();

  async function command(parts) {
    if (!enabled) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(url, {
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

  async function load() {
    if (!enabled) return null;
    state = 'loading';
    try {
      const value = await command(['GET', key]);
      state = value ? 'ready' : 'empty';
      lastLoadedAt = new Date().toISOString();
      lastError = '';
      return value ? JSON.parse(value) : null;
    } catch (error) {
      state = 'error';
      lastError = error.message;
      throw error;
    }
  }

  function persist(store) {
    if (!enabled) return Promise.resolve(false);
    const payload = JSON.stringify(store);
    pending = pending.catch(() => undefined).then(async () => {
      try {
        await command(['SET', key, payload]);
        state = 'ready';
        lastSavedAt = new Date().toISOString();
        lastError = '';
        return true;
      } catch (error) {
        state = 'error';
        lastError = error.message;
        throw error;
      }
    });
    return pending;
  }

  function flush() {
    return pending.catch(() => false);
  }

  function status() {
    return { enabled, provider: enabled ? 'upstash-redis-rest' : 'local-json', state, key, lastLoadedAt, lastSavedAt, lastError: lastError || null };
  }

  return { enabled, load, persist, flush, status };
}

module.exports = { createRemoteStore };
