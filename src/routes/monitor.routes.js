const express = require('express');
const {
  MONITOR_INTERVALS,
  normalizeMonitor,
  monitorMediaKey,
  applyMonitorResults,
  applyMonitorError,
  isMonitorDue
} = require('../services/monitor.service');

function createMonitorRouter(dependencies = {}) {
  const router = express.Router();
  const running = new Set();
  const sourceMeta = dependencies.sourceMeta || {};

  function sanitizeSources(config = {}) {
    return {
      ...config,
      checkedSources: (config.checkedSources || []).filter(sourceId => sourceMeta[sourceId])
    };
  }

  router.get('/', (req, res) => {
    const items = dependencies.readStore().monitors || [];
    res.json({
      items: String(req.query.due || '') === 'true' ? items.filter(item => isMonitorDue(item)) : items,
      intervals: MONITOR_INTERVALS,
      scheduler: 'local_while_application_open'
    });
  });

  router.post('/', (req, res) => {
    const query = String(req.body?.query || '').trim();
    if (!query) return res.status(400).json({ error: 'Requete requise' });
    const existing = dependencies.readStore().monitors.find(item => item.query === query) || {};
    const baselineItems = Array.isArray(req.body?.baselineItems) ? req.body.baselineItems : [];
    const monitor = normalizeMonitor({
      ...req.body,
      config: sanitizeSources(req.body?.config),
      lastMediaKeys: baselineItems.map(monitorMediaKey).filter(Boolean)
    }, existing, {
      id: existing.id || dependencies.makeId('monitor'),
      acceptBaseline: true
    });
    if (!monitor) return res.status(400).json({ error: 'Veille invalide' });
    dependencies.mutateStore(store => {
      store.monitors = [monitor, ...(store.monitors || []).filter(item => item.id !== monitor.id)].slice(0, 50);
    });
    return res.json(monitor);
  });

  router.patch('/:id', (req, res) => {
    const current = dependencies.readStore().monitors.find(item => item.id === req.params.id);
    if (!current) return res.status(404).json({ error: 'Veille introuvable' });
    const monitor = normalizeMonitor({
      query: req.body?.query,
      config: req.body?.config ? sanitizeSources(req.body.config) : undefined,
      enabled: req.body?.enabled,
      intervalMinutes: req.body?.intervalMinutes,
      newOnly: req.body?.newOnly
    }, current, { id: current.id });
    dependencies.mutateStore(store => {
      store.monitors = (store.monitors || []).map(item => item.id === current.id ? monitor : item);
    });
    return res.json(monitor);
  });

  router.post('/:id/run', async (req, res) => {
    const current = dependencies.readStore().monitors.find(item => item.id === req.params.id);
    if (!current) return res.status(404).json({ error: 'Veille introuvable' });
    if (running.has(current.id)) return res.status(409).json({ error: 'Cette veille est deja en cours' });
    const config = current.config || {};
    const selectedSources = (config.checkedSources?.length ? config.checkedSources : ['duckduckgo'])
      .filter(sourceId => sourceMeta[sourceId]);
    const safe = config.safeSearch !== false;
    const adultGuard = dependencies.adultSearchGuard({
      safe,
      selectedSources,
      nsfwSources: dependencies.nsfwSources,
      adultConfirmed: config.adultConfirmed === true
    });
    if (!adultGuard.allowed) return res.status(403).json({ error: adultGuard.reason, code: 'adult_confirmation_required' });
    running.add(current.id);
    try {
      const payload = await dependencies.scrape(current.query, selectedSources.join(','), {
        safe,
        adultConfirmed: adultGuard.adultConfirmed,
        matchMode: config.matchMode || 'smart',
        riskMode: 'cautious'
      });
      const images = config.mediaKind === 'videos' ? [] : (payload.images || []);
      const videos = config.mediaKind === 'photos' ? [] : (payload.videos || []);
      const result = applyMonitorResults(current, images, videos);
      dependencies.mutateStore(store => {
        store.monitors = (store.monitors || []).map(item => item.id === current.id ? result.monitor : item);
      });
      return res.json({
        ok: true,
        monitor: result.monitor,
        newItems: result.monitor.newOnly ? result.newItems : [...images, ...videos].slice(0, 50),
        status: payload.status || {}
      });
    } catch (error) {
      const monitor = applyMonitorError(current, error);
      dependencies.mutateStore(store => {
        store.monitors = (store.monitors || []).map(item => item.id === current.id ? monitor : item);
      });
      return res.status(502).json({ error: error.message, monitor });
    } finally {
      running.delete(current.id);
    }
  });

  router.delete('/', (req, res) => {
    dependencies.mutateStore(store => { store.monitors = []; });
    res.json({ ok: true });
  });

  router.delete('/:id', (req, res) => {
    if (!dependencies.readStore().monitors.some(item => item.id === req.params.id)) {
      return res.status(404).json({ error: 'Veille introuvable' });
    }
    dependencies.mutateStore(store => {
      store.monitors = (store.monitors || []).filter(item => item.id !== req.params.id);
    });
    return res.json({ ok: true });
  });

  return router;
}

module.exports = { createMonitorRouter };
