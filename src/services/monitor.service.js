const MONITOR_INTERVALS = Object.freeze([15, 30, 60, 180, 360, 720, 1440, 10080]);

function boundedText(value, maxLength = 200) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function normalizeInterval(value, fallback = 60) {
  const requested = Number(value);
  if (!Number.isFinite(requested)) return MONITOR_INTERVALS.includes(fallback) ? fallback : 60;
  return MONITOR_INTERVALS.reduce((closest, candidate) => (
    Math.abs(candidate - requested) < Math.abs(closest - requested) ? candidate : closest
  ), MONITOR_INTERVALS[0]);
}

function safeMonitorConfig(value = {}, existing = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const previous = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  const checkedSources = Array.isArray(input.checkedSources)
    ? [...new Set(input.checkedSources.map(source => boundedText(source, 80)).filter(Boolean))].slice(0, 100)
    : [...(previous.checkedSources || [])];
  return {
    ...previous,
    ...input,
    query: boundedText(input.query == null ? previous.query : input.query, 200),
    checkedSources,
    safeSearch: input.safeSearch !== false,
    adultConfirmed: input.adultConfirmed === true,
    matchMode: ['strict', 'smart', 'broad'].includes(input.matchMode) ? input.matchMode : (previous.matchMode || 'smart'),
    riskMode: ['cautious', 'balanced', 'aggressive'].includes(input.riskMode) ? input.riskMode : (previous.riskMode || 'cautious'),
    mediaKind: ['photos', 'videos', 'both'].includes(input.mediaKind) ? input.mediaKind : (previous.mediaKind || 'both')
  };
}

function nextRunAt(intervalMinutes, now = Date.now()) {
  return new Date(Number(now) + intervalMinutes * 60 * 1000).toISOString();
}

function normalizeMonitor(input = {}, existing = {}, options = {}) {
  const now = Number(options.now || Date.now());
  const query = boundedText(input.query == null ? existing.query : input.query, 200);
  if (!query) return null;
  const intervalMinutes = normalizeInterval(
    input.intervalMinutes == null ? existing.intervalMinutes : input.intervalMinutes,
    existing.intervalMinutes || 60
  );
  const enabled = input.enabled == null ? existing.enabled === true : input.enabled === true;
  const intervalChanged = intervalMinutes !== existing.intervalMinutes;
  const enabledChanged = enabled !== (existing.enabled === true);
  const suppliedKeys = Array.isArray(input.lastMediaKeys) ? input.lastMediaKeys : existing.lastMediaKeys;
  return {
    ...existing,
    id: existing.id || options.id,
    query,
    config: safeMonitorConfig(input.config, existing.config),
    enabled,
    intervalMinutes,
    newOnly: input.newOnly == null ? existing.newOnly !== false : input.newOnly !== false,
    lastRunAt: existing.lastRunAt || (options.acceptBaseline ? boundedText(input.lastRunAt, 80) : '') || null,
    nextRunAt: enabled
      ? ((intervalChanged || enabledChanged || !existing.nextRunAt) ? nextRunAt(intervalMinutes, now) : existing.nextRunAt)
      : null,
    lastImages: Math.max(0, Number(existing.lastImages ?? (options.acceptBaseline ? input.lastImages : 0)) || 0),
    lastVideos: Math.max(0, Number(existing.lastVideos ?? (options.acceptBaseline ? input.lastVideos : 0)) || 0),
    newImages: Math.max(0, Number(existing.newImages || 0) || 0),
    newVideos: Math.max(0, Number(existing.newVideos || 0) || 0),
    lastMediaKeys: [...new Set((suppliedKeys || []).map(value => boundedText(value, 1000)).filter(Boolean))].slice(0, 1000),
    lastNewItems: Array.isArray(existing.lastNewItems) ? existing.lastNewItems.slice(0, 50) : [],
    lastError: boundedText(existing.lastError, 500) || null,
    createdAt: existing.createdAt || new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString()
  };
}

function monitorMediaKey(item = {}) {
  return boundedText(item.visualSignature || item.visualHash || item.url || item.link || item.thumbnail, 1000);
}

function compactMonitorItem(item = {}) {
  return {
    type: item.type || (/video/i.test(item.mediaType || '') ? 'video' : 'image'),
    title: boundedText(item.title, 300),
    url: boundedText(item.url, 2000),
    thumbnail: boundedText(item.thumbnail, 2000),
    link: boundedText(item.link, 2000),
    sourceId: boundedText(item.sourceId || item.source, 100),
    discoveredAt: new Date().toISOString()
  };
}

function applyMonitorResults(monitor, images = [], videos = [], options = {}) {
  const now = Number(options.now || Date.now());
  const currentItems = [...images, ...videos];
  const currentKeys = [...new Set(currentItems.map(monitorMediaKey).filter(Boolean))].slice(0, 1000);
  const previousKeys = new Set(monitor.lastMediaKeys || []);
  const hasBaseline = previousKeys.size > 0;
  const newItems = hasBaseline ? currentItems.filter(item => {
    const key = monitorMediaKey(item);
    return key && !previousKeys.has(key);
  }) : [];
  const newImages = newItems.filter(item => item.type !== 'video').length;
  const newVideos = newItems.filter(item => item.type === 'video').length;
  return {
    monitor: {
      ...monitor,
      lastRunAt: new Date(now).toISOString(),
      nextRunAt: monitor.enabled ? nextRunAt(monitor.intervalMinutes, now) : null,
      lastImages: images.length,
      lastVideos: videos.length,
      newImages,
      newVideos,
      lastMediaKeys: currentKeys,
      lastNewItems: newItems.slice(0, 50).map(compactMonitorItem),
      lastError: null,
      updatedAt: new Date(now).toISOString()
    },
    newItems
  };
}

function applyMonitorError(monitor, error, options = {}) {
  const now = Number(options.now || Date.now());
  return {
    ...monitor,
    lastRunAt: new Date(now).toISOString(),
    nextRunAt: monitor.enabled ? nextRunAt(monitor.intervalMinutes, now) : null,
    lastError: boundedText(error?.message || error, 500) || 'monitor_failed',
    updatedAt: new Date(now).toISOString()
  };
}

function isMonitorDue(monitor, now = Date.now()) {
  if (!monitor?.enabled) return false;
  const dueAt = Date.parse(monitor.nextRunAt || monitor.lastRunAt || '');
  return !Number.isFinite(dueAt) || dueAt <= Number(now);
}

module.exports = {
  MONITOR_INTERVALS,
  normalizeInterval,
  safeMonitorConfig,
  normalizeMonitor,
  monitorMediaKey,
  applyMonitorResults,
  applyMonitorError,
  isMonitorDue
};
