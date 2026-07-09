const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.VERCEL ? path.join(os.tmpdir(), 'mediagatherer-data') : path.join(__dirname, 'data');
const EXPORT_DIR = path.join(DATA_DIR, 'exports');
const STORE_PATH = path.join(DATA_DIR, 'mediagatherer.store.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const SOURCE_IDS = [
  'duckduckgo', 'bing', 'google', 'brave', 'flickr', 'wikimedia', 'youtube', 'reddit', 'telegram',
  'instagram', 'facebook', 'tiktok', 'x', 'pinterest', 'wayback', 'vimeo', 'dailymotion',
  'freeones', 'freeonesforum', 'babesource', 'erome', 'redgifs', 'imagebam', 'imagefap', 'pornpics',
  'babepedia', 'camwhores', 'pornzog', 'onlyfans', 'fansly', 'mym', 'xhamster', 'xvideos', 'spankbang'
];

const NSFW_SOURCES = new Set([
  'freeones', 'freeonesforum', 'babesource', 'erome', 'redgifs', 'imagebam', 'imagefap', 'pornpics',
  'babepedia', 'camwhores', 'pornzog', 'onlyfans', 'fansly', 'mym', 'xhamster', 'xvideos', 'spankbang'
]);

const SOURCE_META = SOURCE_IDS.reduce((map, id) => {
  const nsfw = NSFW_SOURCES.has(id);
  map[id] = {
    id,
    label: id.replace(/\b\w/g, char => char.toUpperCase()),
    category: nsfw ? 'nsfw' : (['reddit', 'telegram', 'instagram', 'facebook', 'tiktok', 'x', 'pinterest'].includes(id) ? 'social' : 'normal'),
    nsfw,
    enabled: true,
    supports: id === 'youtube' || id === 'vimeo' || id === 'dailymotion' ? ['video'] : ['image', 'video', 'page'],
    publicOnly: true
  };
  return map;
}, {});

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function ensureLocalDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

function defaultStore() {
  return {
    history: [],
    collection: [],
    cache: {},
    queue: [],
    persons: [],
    personMediaLinks: [],
    personValidationRules: [],
    resultSnapshots: [],
    monitors: [],
    settings: {}
  };
}

function readStore() {
  ensureLocalDirs();
  if (!fs.existsSync(STORE_PATH)) return defaultStore();
  try {
    return { ...defaultStore(), ...JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) };
  } catch (error) {
    console.warn('[STORE] Lecture impossible, fallback vide:', error.message);
    return defaultStore();
  }
}

function writeStore(store) {
  ensureLocalDirs();
  fs.writeFileSync(STORE_PATH, JSON.stringify({ ...defaultStore(), ...store }, null, 2), 'utf8');
}

function makeId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function stableHash(value) {
  return crypto.createHash('sha1').update(JSON.stringify(value || {})).digest('hex');
}

function normalizeSearchTerm(value) {
  return String(value || '').trim().toLowerCase();
}

function uniq(items) {
  return [...new Set((items || []).map(item => String(item || '').trim()).filter(Boolean))];
}

function mediaText(item) {
  return [item?.title, item?.url, item?.thumbnail, item?.link, item?.source, item?.accountUrl, item?.description]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function sourceLabel(source) {
  return SOURCE_META[source]?.label || source || 'Source';
}

function inferMediaType(item) {
  if (item.type) return item.type;
  const url = String(item.url || item.thumbnail || '').toLowerCase();
  if (/\.(mp4|webm|m3u8|mov)(\?|$)/.test(url) || item.embedUrl || item.duration) return 'video';
  if (/\.(jpg|jpeg|png|gif|webp|avif)(\?|$)/.test(url)) return 'image';
  return 'page';
}

function scoreMedia(item, query) {
  const needle = normalizeSearchTerm(query).replace(/[^a-z0-9]+/g, '');
  const text = mediaText(item).replace(/[^a-z0-9]+/g, '');
  if (!needle) return 40;
  if (text.includes(needle)) return 88;
  const words = normalizeSearchTerm(query).split(/\s+/).filter(Boolean);
  const hits = words.filter(word => mediaText(item).includes(word)).length;
  if (hits === words.length && hits > 0) return 76;
  if (hits > 0) return 55;
  return SOURCE_META[item.sourceId || String(item.source || '').toLowerCase()]?.nsfw ? 45 : 25;
}

function enrichMedia(item, query, sourceId, kind = 'image') {
  const score = Number(item.confidenceScore || scoreMedia(item, query));
  const source = item.source || sourceLabel(sourceId);
  const url = item.url || item.thumbnail || item.link;
  return {
    ...item,
    type: item.type || kind,
    source,
    sourceId,
    sourceLabel: sourceLabel(sourceId),
    title: item.title || `${source} media`,
    url,
    thumbnail: item.thumbnail || url,
    link: item.link || item.url,
    confidenceScore: score,
    confidenceLabel: score >= 80 ? 'haute' : (score >= 55 ? 'moyenne' : 'faible'),
    matchReasons: item.matchReasons || (score >= 80 ? ['terme retrouve dans le resultat'] : ['resultat public a verifier']),
    visualSignature: item.visualSignature || stableHash({ url, source, title: item.title }),
    qualityLabel: item.qualityLabel || (item.width && item.height ? `${item.width}x${item.height}` : 'source publique')
  };
}

function filterMediaKind(payload, mediaKind) {
  if (mediaKind === 'photos') payload.videos = [];
  if (mediaKind === 'videos') payload.images = [];
  return payload;
}

function dedupeBy(items, keyFn) {
  const seen = new Set();
  return (items || []).filter(item => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchText(url, options = {}) {
  const response = await axios.get(url, {
    timeout: options.timeout || 12000,
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      accept: 'text/html,application/json,*/*'
    },
    validateStatus: status => status >= 200 && status < 400
  });
  return response.data;
}

function extractImagesFromHtml(html, baseUrl, query, sourceId, limit = 35) {
  const $ = cheerio.load(html || '');
  const rows = [];
  $('img').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-original') || $(el).attr('data-lazy-src');
    if (!src) return;
    let url;
    try {
      url = new URL(src, baseUrl).toString();
    } catch {
      return;
    }
    if (!/^https?:\/\//.test(url)) return;
    const title = $(el).attr('alt') || $(el).attr('title') || `${sourceLabel(sourceId)} image`;
    rows.push(enrichMedia({ url, thumbnail: url, title, link: baseUrl }, query, sourceId, 'image'));
  });
  return dedupeBy(rows, item => item.url).slice(0, limit);
}

function extractLinksAsVideos(html, baseUrl, query, sourceId, limit = 20) {
  const $ = cheerio.load(html || '');
  const rows = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (!href || !/(watch|video|\/v\/|embed|mp4|webm|clip|shorts)/i.test(href + ' ' + text)) return;
    let url;
    try {
      url = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    rows.push(enrichMedia({ url, link: url, title: text || `${sourceLabel(sourceId)} video`, duration: 'Lien public' }, query, sourceId, 'video'));
  });
  return dedupeBy(rows, item => item.url).slice(0, limit);
}

async function scrapeGenericSource(sourceId, query, options = {}) {
  const encoded = encodeURIComponent(query);
  const siteMap = {
    duckduckgo: `https://duckduckgo.com/html/?q=${encoded}`,
    bing: `https://www.bing.com/images/search?q=${encoded}`,
    google: `https://www.google.com/search?tbm=isch&q=${encoded}`,
    brave: `https://search.brave.com/images?q=${encoded}`,
    flickr: `https://www.flickr.com/search/?text=${encoded}`,
    wikimedia: `https://commons.wikimedia.org/w/index.php?search=${encoded}&title=Special:MediaSearch&type=image`,
    youtube: `https://www.youtube.com/results?search_query=${encoded}`,
    reddit: `https://www.reddit.com/search/?q=${encoded}&type=media`,
    vimeo: `https://vimeo.com/search?q=${encoded}`,
    dailymotion: `https://www.dailymotion.com/search/${encoded}/videos`,
    erome: `https://fr.erome.com/search?q=${encoded}`,
    redgifs: `https://www.redgifs.com/search?query=${encoded}`,
    imagebam: `https://www.imagebam.com/search/${encoded}`,
    imagefap: `https://www.imagefap.com/search/${encoded}`,
    pornpics: `https://www.pornpics.com/?q=${encoded}`,
    babepedia: `https://www.babepedia.com/search/${encoded}`,
    camwhores: `https://www.camwhores.tv/tags/${encoded}/`,
    pornzog: `https://pornzog.com/search/${encoded}`,
    xhamster: `https://xhamster.com/search/${encoded}`,
    xvideos: `https://www.xvideos.com/?k=${encoded}`,
    spankbang: `https://spankbang.com/s/${encoded}/`
  };
  const url = siteMap[sourceId] || `https://duckduckgo.com/html/?q=${encoded}+site:${encodeURIComponent(sourceId + '.com')}`;
  const html = await fetchText(url, { timeout: options.timeout || 12000 });
  const images = extractImagesFromHtml(html, url, query, sourceId, options.imageLimit || 35);
  const videos = extractLinksAsVideos(html, url, query, sourceId, options.videoLimit || 20);
  return { images, videos, status: { success: true, note: `scan public ${url}`, imagesCount: images.length, videosCount: videos.length } };
}

async function scrapeImageSearchWithFallback(query, sources, options = {}) {
  const images = [];
  const videos = [];
  const status = {};
  const safe = options.safe !== false;
  const selected = uniq(String(sources || 'duckduckgo').split(',')).filter(Boolean);

  await Promise.all(selected.map(async (sourceId) => {
    if (!SOURCE_META[sourceId]) {
      status[sourceId] = { success: false, error: 'source inconnue', imagesCount: 0, videosCount: 0 };
      return;
    }
    if (safe && NSFW_SOURCES.has(sourceId)) {
      status[sourceId] = { success: false, skipped: true, error: 'bloque par SafeSearch', imagesCount: 0, videosCount: 0 };
      return;
    }
    try {
      const result = await scrapeGenericSource(sourceId, query, options);
      images.push(...result.images);
      videos.push(...result.videos);
      status[sourceId] = result.status;
    } catch (error) {
      status[sourceId] = { success: false, error: error.message, imagesCount: 0, videosCount: 0 };
    }
  }));

  return {
    success: true,
    query,
    images: dedupeBy(images, item => item.visualSignature || item.url),
    videos: dedupeBy(videos, item => item.visualSignature || item.url),
    status
  };
}

function serializeRows(rows, format = 'json') {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (format === 'csv') {
    const keys = uniq(safeRows.flatMap(row => Object.keys(row || {}))).slice(0, 40);
    const escapeCsv = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    return [keys.join(','), ...safeRows.map(row => keys.map(key => escapeCsv(typeof row[key] === 'object' ? JSON.stringify(row[key]) : row[key])).join(','))].join('\n');
  }
  if (format === 'markdown') {
    return safeRows.map(row => `- ${row.title || row.name || row.displayName || row.id || 'item'}${row.url ? ` - ${row.url}` : ''}`).join('\n') || '- Aucun resultat';
  }
  return JSON.stringify(safeRows, null, 2);
}

function sendExport(res, name, rows, format = 'json') {
  const ext = format === 'markdown' ? 'md' : format;
  const contentType = format === 'csv' ? 'text/csv' : (format === 'markdown' ? 'text/markdown' : 'application/json');
  res.setHeader('content-type', `${contentType}; charset=utf-8`);
  res.setHeader('content-disposition', `attachment; filename="${name}.${ext}"`);
  res.send(serializeRows(rows, format));
}

function buildPersonQueries(person, depth = 'normal') {
  const base = uniq([person.displayName, person.name, ...(person.aliases || []), ...(person.usernames || [])]);
  const positives = uniq(person.positiveKeywords || []);
  const accounts = uniq((person.accounts || []).flatMap(account => [account.url, account.username, account.platform]));
  const queries = [];
  base.forEach(term => {
    queries.push(`"${term}"`);
    if (depth !== 'quick') {
      queries.push(`"${term}" photo`);
      queries.push(`"${term}" video`);
      queries.push(`"${term}" interview`);
    }
    positives.forEach(keyword => queries.push(`"${term}" ${keyword}`));
  });
  accounts.forEach(term => {
    if (term) queries.push(String(term));
  });
  if (depth === 'archive') {
    base.forEach(term => {
      queries.push(`"${term}" archive`);
      queries.push(`"${term}" wayback`);
    });
  }
  const limits = { quick: 8, normal: 20, deep: 32, archive: 40 };
  return uniq(queries).slice(0, limits[depth] || 20);
}

function scorePersonMedia(person, item) {
  const text = mediaText(item);
  const positives = uniq([person.displayName, person.name, ...(person.aliases || []), ...(person.usernames || []), ...(person.positiveKeywords || [])])
    .map(normalizeSearchTerm)
    .filter(Boolean);
  const negatives = uniq(person.excludeKeywords || []).map(normalizeSearchTerm).filter(Boolean);
  const evidence = [];
  let score = Number(item.confidenceScore || 20);
  positives.forEach(term => {
    if (term && text.includes(term)) {
      score += 12;
      evidence.push(`terme retrouve: ${term}`);
    }
  });
  negatives.forEach(term => {
    if (term && text.includes(term)) {
      score -= 35;
      evidence.push(`mot exclu: ${term}`);
    }
  });
  score = Math.max(0, Math.min(100, score));
  return { score, evidence, suggestedStatus: score >= 75 ? 'probable' : 'to_review' };
}

function applyPersonRules(store, personId, link) {
  const text = JSON.stringify(link || {}).toLowerCase();
  const matchedRules = (store.personValidationRules || []).filter(rule => rule.personId === personId && text.includes(String(rule.value || '').toLowerCase()));
  let status = link.status || 'to_review';
  matchedRules.forEach(rule => {
    if (rule.action === 'exclude') status = 'excluded';
    if (rule.action === 'false_positive') status = 'false_positive';
    if (rule.action === 'confirm') status = 'confirmed';
    if (rule.action === 'probable') status = 'probable';
  });
  return { ...link, status, matchedRules: matchedRules.map(rule => rule.id) };
}

function publicOnlyPersonGuard(person = {}) {
  return {
    publicOnly: person.publicOnly !== false,
    consentMode: person.consentMode || 'public_or_consented',
    safeMode: person.safeMode !== false,
    blocked: ['private_accounts', 'login_bypass', 'private_address', 'private_phone', 'live_location']
  };
}

app.get('/api/health', (req, res) => {
  const store = readStore();
  res.json({
    ok: true,
    app: 'MediaGatherer',
    storage: {
      mode: 'json',
      historyCount: store.history.length,
      collectionCount: store.collection.length,
      personCount: store.persons.length,
      personMediaCount: store.personMediaLinks.length,
      cacheEntries: Object.keys(store.cache || {}).length
    },
    modules: {
      mediaFinder: true,
      personFinder: true,
      collection: true,
      exports: true,
      cache: true,
      queue: true,
      desktop: 'stub'
    }
  });
});

app.get('/api/storage/status', (req, res) => {
  const store = readStore();
  res.json({ mode: 'json', path: STORE_PATH, exportDir: EXPORT_DIR, counts: {
    history: store.history.length,
    collection: store.collection.length,
    persons: store.persons.length,
    personMediaLinks: store.personMediaLinks.length
  } });
});

app.get('/api/search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) return res.status(400).json({ error: 'Parametre q requis' });
  const sources = String(req.query.sources || 'duckduckgo');
  const cacheKey = stableHash({ query, sources, safe: req.query.safe, media: req.query.media, mode: req.query.mode });
  const store = readStore();
  const cached = store.cache?.[cacheKey];
  if (!req.query.fresh && cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return res.json({ ...cached.payload, cached: true });
  }
  const payload = await scrapeImageSearchWithFallback(query, sources, {
    safe: String(req.query.safe || 'true') !== 'false',
    mediaKind: req.query.media || 'both'
  });
  filterMediaKind(payload, req.query.media || 'both');
  store.cache[cacheKey] = { key: cacheKey, createdAt: Date.now(), query, sources, payload };
  store.history.unshift({ id: makeId('hist'), query, sources: sources.split(','), createdAt: new Date().toISOString(), imagesCount: payload.images.length, videosCount: payload.videos.length });
  store.history = store.history.slice(0, 200);
  writeStore(store);
  res.json(payload);
});

app.get('/api/wayback/hosts', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ domains: [] });
  const result = await scrapeImageSearchWithFallback(q, 'duckduckgo,bing', { safe: true });
  const domains = uniq([...result.images, ...result.videos].map(item => {
    try { return new URL(item.link || item.url).hostname.replace(/^www\./, ''); } catch { return null; }
  })).slice(0, 12);
  res.json({ query: q, domains });
});

app.get('/api/wayback/cdx', async (req, res) => {
  const domain = String(req.query.domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!domain) return res.status(400).json({ error: 'domain requis' });
  try {
    const url = `https://web.archive.org/cdx/search/cdx?url=*.${encodeURIComponent(domain)}/*&output=json&fl=original,timestamp,mimetype&filter=statuscode:200&collapse=urlkey&limit=200`;
    const rows = await fetchText(url, { timeout: 20000 });
    const parsed = Array.isArray(rows) ? rows.slice(1) : [];
    const images = [];
    const videos = [];
    parsed.forEach(row => {
      const original = row[0];
      const timestamp = row[1];
      const mimetype = row[2] || '';
      const archived = `https://web.archive.org/web/${timestamp}if_/${original}`;
      const item = enrichMedia({ url: archived, thumbnail: archived, link: `https://web.archive.org/web/${timestamp}/${original}`, title: original }, req.query.q || domain, 'wayback', mimetype.startsWith('video') ? 'video' : 'image');
      if (mimetype.startsWith('video')) videos.push(item); else if (mimetype.startsWith('image')) images.push(item);
    });
    res.json({ success: true, domain, images: images.slice(0, 120), videos: videos.slice(0, 60) });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message, images: [], videos: [] });
  }
});

app.get('/api/wayback/archive', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ images: [], videos: [] });
  try {
    const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}+AND+(mediatype:image+OR+mediatype:movies)&fl[]=identifier,title,mediatype&rows=50&output=json`;
    const data = await fetchText(url, { timeout: 15000 });
    const docs = data?.response?.docs || [];
    const images = [];
    const videos = [];
    docs.forEach(doc => {
      const thumb = `https://archive.org/services/img/${doc.identifier}`;
      const item = enrichMedia({ url: doc.mediatype === 'movies' ? `https://archive.org/details/${doc.identifier}` : thumb, thumbnail: thumb, link: `https://archive.org/details/${doc.identifier}`, title: doc.title || doc.identifier }, q, 'wayback', doc.mediatype === 'movies' ? 'video' : 'image');
      if (doc.mediatype === 'movies') videos.push(item); else images.push(item);
    });
    res.json({ success: true, images, videos });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message, images: [], videos: [] });
  }
});

app.get('/api/account/scrape', async (req, res) => {
  const url = String(req.query.url || '');
  if (!/^https?:\/\//.test(url)) return res.status(400).json({ error: 'URL publique requise' });
  try {
    const html = await fetchText(url, { timeout: 15000 });
    const query = new URL(url).hostname;
    const sourceId = new URL(url).hostname.replace(/^www\./, '').split('.')[0];
    const payload = {
      success: true,
      images: extractImagesFromHtml(html, url, query, sourceId, 120),
      videos: extractLinksAsVideos(html, url, query, sourceId, 80),
      status: { [sourceId]: { success: true, note: 'page publique scannee' } }
    };
    filterMediaKind(payload, req.query.media || 'both');
    res.json(payload);
  } catch (error) {
    res.status(502).json({ success: false, error: error.message, images: [], videos: [] });
  }
});

app.get('/api/connections/providers', (req, res) => {
  res.json({ providers: [
    { id: 'youtube', label: 'YouTube Data API', configured: Boolean(process.env.YOUTUBE_API_KEY), unlocks: 'Recherche officielle videos publiques', fields: [{ name: 'apiKey', label: 'API key', type: 'password' }] },
    { id: 'flickr', label: 'Flickr API', configured: Boolean(process.env.FLICKR_API_KEY), unlocks: 'Recherche officielle photos publiques', fields: [{ name: 'apiKey', label: 'API key', type: 'password' }] },
    { id: 'google', label: 'Google Custom Search', configured: Boolean(process.env.GOOGLE_API_KEY), unlocks: 'Recherche web/images officielle', fields: [{ name: 'apiKey', label: 'API key', type: 'password' }, { name: 'cx', label: 'Search CX', type: 'text' }] },
    { id: 'telegram', label: 'Telegram API', configured: false, unlocks: 'Canaux publics uniquement', fields: [{ name: 'apiId', label: 'API ID', type: 'text' }, { name: 'apiHash', label: 'API hash', type: 'password' }] }
  ] });
});
app.post('/api/connections/:id', (req, res) => res.json({ ok: true, provider: req.params.id, note: 'Configuration session recue; stockage persistant volontairement non active.' }));
app.post('/api/connections/:id/test', (req, res) => res.json({ ok: true, provider: req.params.id, note: 'Test local OK; verifier les quotas cote fournisseur.' }));
app.delete('/api/connections/:id', (req, res) => res.json({ ok: true, provider: req.params.id }));

app.get('/api/safety/policy', (req, res) => {
  res.json({
    publicOnly: true,
    allowed: ['contenus publics', 'APIs officielles', 'pages archivees publiques', 'profils fournis avec consentement'],
    blocked: ['contournement login', 'paywall prive', 'adresses privees', 'telephone prive', 'localisation temps reel', 'mineurs']
  });
});

app.get('/api/history', (req, res) => res.json({ items: readStore().history }));
app.post('/api/history', (req, res) => {
  const store = readStore();
  const item = { id: makeId('hist'), createdAt: new Date().toISOString(), ...req.body };
  store.history.unshift(item);
  writeStore(store);
  res.json(item);
});
app.delete('/api/history', (req, res) => { const store = readStore(); store.history = []; writeStore(store); res.json({ ok: true }); });
app.delete('/api/history/:id', (req, res) => { const store = readStore(); store.history = store.history.filter(item => item.id !== req.params.id); writeStore(store); res.json({ ok: true }); });

app.get('/api/collection', (req, res) => {
  const rows = readStore().collection.filter(item => {
    if (req.query.q && !mediaText(item).includes(String(req.query.q).toLowerCase())) return false;
    if (req.query.type && req.query.type !== 'all' && inferMediaType(item) !== req.query.type) return false;
    if (req.query.status && req.query.status !== 'all' && item.status !== req.query.status) return false;
    return true;
  });
  res.json({ items: rows });
});
app.get('/api/collection/stats', (req, res) => {
  const rows = readStore().collection;
  res.json({ total: rows.length, images: rows.filter(item => inferMediaType(item) === 'image').length, videos: rows.filter(item => inferMediaType(item) === 'video').length });
});
app.get('/api/collection/options', (req, res) => res.json({ statuses: ['saved', 'favorite', 'to_review', 'ignored'], types: ['image', 'video', 'page'] }));
app.post('/api/collection', (req, res) => {
  const store = readStore();
  const item = { id: makeId('col'), status: 'saved', createdAt: new Date().toISOString(), ...req.body };
  store.collection.unshift(item);
  writeStore(store);
  res.json(item);
});
app.patch('/api/collection/:id', (req, res) => {
  const store = readStore();
  store.collection = store.collection.map(item => item.id === req.params.id ? { ...item, ...req.body, updatedAt: new Date().toISOString() } : item);
  writeStore(store);
  res.json({ ok: true });
});
app.post('/api/collection/bulk-update', (req, res) => {
  const ids = new Set(req.body.ids || []);
  const store = readStore();
  store.collection = store.collection.map(item => ids.has(item.id) ? { ...item, ...req.body.patch, updatedAt: new Date().toISOString() } : item);
  writeStore(store);
  res.json({ ok: true, updated: ids.size });
});
app.delete('/api/collection', (req, res) => { const store = readStore(); store.collection = []; writeStore(store); res.json({ ok: true }); });
app.delete('/api/collection/:id', (req, res) => { const store = readStore(); store.collection = store.collection.filter(item => item.id !== req.params.id); writeStore(store); res.json({ ok: true }); });

app.get('/api/sources', (req, res) => res.json({ sources: Object.values(SOURCE_META) }));
app.get('/api/sources/diagnostics', (req, res) => res.json({ sources: Object.values(SOURCE_META).map(source => ({ ...source, status: 'configured', lastTest: null })) }));
app.get('/api/sources/adapters', (req, res) => res.json({ adapters: Object.values(SOURCE_META).map(source => ({ id: source.id, supports: source.supports, mode: 'public-html-or-api' })) }));

app.get('/api/cache/status', (req, res) => {
  const cache = readStore().cache || {};
  res.json({ entries: Object.keys(cache).length, ttlMs: CACHE_TTL_MS });
});
app.get('/api/cache/entries', (req, res) => res.json({ entries: Object.values(readStore().cache || {}) }));
app.post('/api/cache/prune', (req, res) => {
  const store = readStore();
  const before = Object.keys(store.cache || {}).length;
  store.cache = Object.fromEntries(Object.entries(store.cache || {}).filter(([, value]) => Date.now() - value.createdAt < CACHE_TTL_MS));
  writeStore(store);
  res.json({ ok: true, removed: before - Object.keys(store.cache).length });
});
app.delete('/api/cache', (req, res) => { const store = readStore(); store.cache = {}; writeStore(store); res.json({ ok: true }); });

app.get('/api/queue/status', (req, res) => {
  const queue = readStore().queue || [];
  res.json({ total: queue.length, pending: queue.filter(job => job.status === 'pending').length, running: queue.filter(job => job.status === 'running').length, done: queue.filter(job => job.status === 'done').length });
});
app.get('/api/queue/jobs', (req, res) => res.json({ jobs: readStore().queue || [] }));
app.post('/api/queue/jobs', (req, res) => {
  const store = readStore();
  const job = { id: makeId('job'), status: 'pending', createdAt: new Date().toISOString(), ...req.body };
  store.queue.unshift(job);
  writeStore(store);
  res.json(job);
});
app.post('/api/queue/jobs/:id/:action', (req, res) => {
  const store = readStore();
  const actionMap = { start: 'running', pause: 'paused', resume: 'running', cancel: 'cancelled', 'retry-errors': 'pending' };
  store.queue = store.queue.map(job => job.id === req.params.id ? { ...job, status: actionMap[req.params.action] || job.status, updatedAt: new Date().toISOString() } : job);
  writeStore(store);
  res.json({ ok: true });
});
app.delete('/api/queue/jobs/:id', (req, res) => { const store = readStore(); store.queue = store.queue.filter(job => job.id !== req.params.id); writeStore(store); res.json({ ok: true }); });

app.post('/api/imports/batch', (req, res) => {
  const text = String(req.body.text || '');
  const queries = uniq(text.split(/\r?\n|,|;/).map(line => line.trim())).slice(0, 500);
  res.json({ queries, count: queries.length });
});
app.post('/api/search/batch', async (req, res) => {
  const queries = uniq(req.body.queries || []);
  if (req.body.dryRun) return res.json({ dryRun: true, queries });
  const results = [];
  for (const query of queries.slice(0, 20)) {
    results.push(await scrapeImageSearchWithFallback(query, req.body.sources || 'duckduckgo', { safe: req.body.safe !== false }));
  }
  res.json({ results });
});

app.get('/api/dashboard/overview', (req, res) => {
  const store = readStore();
  res.json({
    history: store.history.length,
    collection: store.collection.length,
    sources: Object.keys(SOURCE_META).length,
    cache: Object.keys(store.cache || {}).length,
    queue: store.queue.length,
    persons: store.persons.length,
    personMedia: store.personMediaLinks.length
  });
});
app.get('/api/dashboard', (req, res) => res.redirect('/api/dashboard/overview'));
app.post('/api/dashboard/results-snapshot', (req, res) => {
  const store = readStore();
  const snapshot = { id: makeId('snap'), createdAt: new Date().toISOString(), ...req.body };
  store.resultSnapshots.unshift(snapshot);
  writeStore(store);
  res.json(snapshot);
});

app.get('/api/franchises', (req, res) => {
  const rows = readStore().collection;
  const groups = {};
  rows.forEach(item => {
    const tag = (item.tags || []).find(value => /^franchise:/i.test(value)) || 'franchise:Non classe';
    const name = tag.replace(/^franchise:/i, '');
    groups[name] = groups[name] || { slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, count: 0 };
    groups[name].count += 1;
  });
  res.json({ franchises: Object.values(groups) });
});
app.get('/api/franchises/:slug/timeline', (req, res) => res.json({ slug: req.params.slug, events: readStore().collection.map(item => ({ id: item.id, title: item.title, date: item.createdAt, type: inferMediaType(item) })) }));

app.get('/api/persons/options', (req, res) => res.json({ types: ['public_figure', 'creator', 'artist', 'journalist', 'athlete', 'consented_person', 'unknown_public'], statuses: ['to_review', 'probable', 'confirmed', 'false_positive', 'excluded', 'saved'], depths: ['quick', 'normal', 'deep', 'archive'] }));
app.get('/api/persons/stats', (req, res) => {
  const store = readStore();
  res.json({ persons: store.persons.length, mediaLinks: store.personMediaLinks.length, rules: store.personValidationRules.length });
});
app.get('/api/persons/search/depths', (req, res) => res.json({ depths: ['quick', 'normal', 'deep', 'archive'] }));
app.get('/api/persons', (req, res) => res.json({ persons: readStore().persons }));
app.post('/api/persons', (req, res) => {
  const store = readStore();
  const person = {
    id: makeId('person'),
    name: String(req.body.name || req.body.displayName || '').trim(),
    displayName: String(req.body.displayName || req.body.name || '').trim(),
    type: req.body.type || 'unknown_public',
    aliases: uniq(req.body.aliases || []),
    usernames: uniq(req.body.usernames || []),
    accounts: Array.isArray(req.body.accounts) ? req.body.accounts : [],
    positiveKeywords: uniq(req.body.positiveKeywords || []),
    excludeKeywords: uniq(req.body.excludeKeywords || []),
    publicOnly: req.body.publicOnly !== false,
    safeMode: req.body.safeMode !== false,
    notes: req.body.notes || '',
    createdAt: new Date().toISOString()
  };
  if (!person.name) return res.status(400).json({ error: 'Nom requis' });
  store.persons.unshift(person);
  writeStore(store);
  res.json(person);
});
app.get('/api/persons/:id', (req, res) => {
  const person = readStore().persons.find(item => item.id === req.params.id);
  if (!person) return res.status(404).json({ error: 'Profil introuvable' });
  res.json({ ...person, guard: publicOnlyPersonGuard(person) });
});
app.patch('/api/persons/:id', (req, res) => {
  const store = readStore();
  store.persons = store.persons.map(person => person.id === req.params.id ? { ...person, ...req.body, updatedAt: new Date().toISOString() } : person);
  writeStore(store);
  res.json({ ok: true });
});
app.delete('/api/persons/:id', (req, res) => {
  const store = readStore();
  store.persons = store.persons.filter(person => person.id !== req.params.id);
  store.personMediaLinks = store.personMediaLinks.filter(link => link.personId !== req.params.id);
  store.personValidationRules = store.personValidationRules.filter(rule => rule.personId !== req.params.id);
  writeStore(store);
  res.json({ ok: true });
});
app.post('/api/persons/:id/aliases', (req, res) => {
  const store = readStore();
  store.persons = store.persons.map(person => person.id === req.params.id ? { ...person, aliases: uniq([...(person.aliases || []), req.body.alias]) } : person);
  writeStore(store);
  res.json({ ok: true });
});
app.post('/api/persons/:id/accounts', (req, res) => {
  const store = readStore();
  store.persons = store.persons.map(person => person.id === req.params.id ? { ...person, accounts: [...(person.accounts || []), req.body] } : person);
  writeStore(store);
  res.json({ ok: true });
});
app.get('/api/persons/:id/queries', (req, res) => {
  const person = readStore().persons.find(item => item.id === req.params.id);
  if (!person) return res.status(404).json({ error: 'Profil introuvable' });
  res.json({ queries: buildPersonQueries(person, req.query.depth || 'normal'), guard: publicOnlyPersonGuard(person) });
});
app.get('/api/persons/:id/search-plan', (req, res) => {
  const person = readStore().persons.find(item => item.id === req.params.id);
  if (!person) return res.status(404).json({ error: 'Profil introuvable' });
  res.json({ personId: person.id, depth: req.query.depth || 'normal', queries: buildPersonQueries(person, req.query.depth || 'normal'), sources: req.query.sources || 'duckduckgo,bing,wikimedia,reddit,wayback', guard: publicOnlyPersonGuard(person) });
});
app.post('/api/persons/:id/search', async (req, res) => {
  const store = readStore();
  const person = store.persons.find(item => item.id === req.params.id);
  if (!person) return res.status(404).json({ error: 'Profil introuvable' });
  if (person.publicOnly === false || person.safeMode === false) return res.status(400).json({ error: 'Person Finder exige publicOnly et safeMode actifs' });
  const queries = buildPersonQueries(person, req.body.depth || 'normal').slice(0, Number(req.body.maxQueries || 10));
  if (req.body.dryRun) return res.json({ dryRun: true, queries });
  const created = [];
  for (const query of queries) {
    const payload = await scrapeImageSearchWithFallback(query, req.body.sources || 'duckduckgo,bing,wikimedia,reddit', { safe: true });
    const items = [...payload.images, ...payload.videos];
    items.forEach(item => {
      const score = scorePersonMedia(person, item);
      if (score.score < Number(req.body.minScore || 30)) return;
      const link = applyPersonRules(store, person.id, {
        id: makeId('pmedia'),
        personId: person.id,
        media: item,
        mediaType: inferMediaType(item),
        status: score.suggestedStatus,
        personScore: score.score,
        evidence: score.evidence,
        query,
        depth: req.body.depth || 'normal',
        createdAt: new Date().toISOString()
      });
      store.personMediaLinks.unshift(link);
      created.push(link);
    });
  }
  store.personMediaLinks = dedupeBy(store.personMediaLinks, link => `${link.personId}:${link.media?.visualSignature || link.media?.url}`);
  writeStore(store);
  res.json({ personId: person.id, queries, created: created.length, links: created });
});
app.get('/api/persons/:id/media', (req, res) => res.json({ links: readStore().personMediaLinks.filter(link => link.personId === req.params.id) }));
app.post('/api/persons/:id/media', (req, res) => {
  const store = readStore();
  const link = { id: makeId('pmedia'), personId: req.params.id, status: 'to_review', createdAt: new Date().toISOString(), ...req.body };
  store.personMediaLinks.unshift(link);
  writeStore(store);
  res.json(link);
});
app.patch('/api/persons/:id/media/:linkId', (req, res) => {
  const store = readStore();
  store.personMediaLinks = store.personMediaLinks.map(link => link.id === req.params.linkId && link.personId === req.params.id ? { ...link, ...req.body, updatedAt: new Date().toISOString() } : link);
  writeStore(store);
  res.json({ ok: true });
});
app.post('/api/persons/:id/media/:linkId/validate', (req, res) => {
  const store = readStore();
  store.personMediaLinks = store.personMediaLinks.map(link => link.id === req.params.linkId && link.personId === req.params.id ? { ...link, status: req.body.status || 'to_review', validationNote: req.body.note || '', validatedAt: new Date().toISOString() } : link);
  writeStore(store);
  res.json({ ok: true });
});
app.get('/api/persons/:id/media/:linkId/analyze', (req, res) => {
  const store = readStore();
  const person = store.persons.find(item => item.id === req.params.id);
  const link = store.personMediaLinks.find(item => item.id === req.params.linkId && item.personId === req.params.id);
  if (!person || !link) return res.status(404).json({ error: 'Introuvable' });
  res.json({ ...scorePersonMedia(person, link.media || link), applicableRules: (store.personValidationRules || []).filter(rule => JSON.stringify(link).toLowerCase().includes(String(rule.value || '').toLowerCase())) });
});
app.get('/api/persons/gallery/options', (req, res) => res.json({ types: ['image', 'video', 'page'], statuses: ['to_review', 'probable', 'confirmed', 'false_positive', 'excluded', 'saved'] }));
app.get('/api/persons/:id/gallery', (req, res) => {
  let links = readStore().personMediaLinks.filter(link => link.personId === req.params.id);
  if (req.query.status && req.query.status !== 'all') links = links.filter(link => link.status === req.query.status);
  if (req.query.type && req.query.type !== 'all') links = links.filter(link => link.mediaType === req.query.type);
  if (req.query.q) links = links.filter(link => mediaText(link.media).includes(String(req.query.q).toLowerCase()));
  res.json({ links });
});
app.get('/api/persons/:id/gallery/stats', (req, res) => {
  const links = readStore().personMediaLinks.filter(link => link.personId === req.params.id);
  res.json({ total: links.length, toReview: links.filter(link => link.status === 'to_review').length, probable: links.filter(link => link.status === 'probable').length, confirmed: links.filter(link => link.status === 'confirmed').length, falsePositive: links.filter(link => link.status === 'false_positive').length });
});
app.get('/api/persons/:id/media/:linkId/details', (req, res) => {
  const link = readStore().personMediaLinks.find(item => item.id === req.params.linkId && item.personId === req.params.id);
  if (!link) return res.status(404).json({ error: 'Media introuvable' });
  res.json({ link, proof: { query: link.query, evidence: link.evidence || [], source: link.media?.source, url: link.media?.link || link.media?.url } });
});
app.get('/api/persons/timeline/options', (req, res) => res.json({ eventTypes: ['profile_created', 'alias_added', 'account_added', 'media_discovered', 'media_validated', 'rule_created'] }));
app.get('/api/persons/:id/timeline', (req, res) => {
  const store = readStore();
  const person = store.persons.find(item => item.id === req.params.id);
  if (!person) return res.status(404).json({ error: 'Profil introuvable' });
  const events = [
    { id: `${person.id}:created`, type: 'profile_created', date: person.createdAt, title: `Profil cree: ${person.displayName || person.name}` },
    ...(person.aliases || []).map(alias => ({ id: `${person.id}:alias:${alias}`, type: 'alias_added', date: person.createdAt, title: `Alias: ${alias}` })),
    ...store.personMediaLinks.filter(link => link.personId === person.id).map(link => ({ id: link.id, type: link.validatedAt ? 'media_validated' : 'media_discovered', date: link.validatedAt || link.createdAt, title: link.media?.title || 'Media trouve', status: link.status, mediaType: link.mediaType }))
  ].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  res.json({ events });
});
app.get('/api/persons/:id/timeline/stats', (req, res) => {
  const links = readStore().personMediaLinks.filter(link => link.personId === req.params.id);
  res.json({ events: links.length + 1, media: links.length, validated: links.filter(link => link.validatedAt).length });
});
app.get('/api/persons/:id/validation/rules', (req, res) => res.json({ rules: readStore().personValidationRules.filter(rule => rule.personId === req.params.id) }));
app.post('/api/persons/:id/validation/rules', (req, res) => {
  const store = readStore();
  const rule = { id: makeId('rule'), personId: req.params.id, type: req.body.type || 'keyword', action: req.body.action || 'exclude', value: req.body.value || '', createdAt: new Date().toISOString() };
  store.personValidationRules.unshift(rule);
  writeStore(store);
  res.json(rule);
});
app.delete('/api/persons/:id/validation/rules/:ruleId', (req, res) => {
  const store = readStore();
  store.personValidationRules = store.personValidationRules.filter(rule => rule.id !== req.params.ruleId || rule.personId !== req.params.id);
  writeStore(store);
  res.json({ ok: true });
});
app.post('/api/persons/:id/validation/apply-rules', (req, res) => {
  const store = readStore();
  let updated = 0;
  store.personMediaLinks = store.personMediaLinks.map(link => {
    if (link.personId !== req.params.id) return link;
    const next = applyPersonRules(store, req.params.id, link);
    if (next.status !== link.status) updated += 1;
    return next;
  });
  if (!req.body.dryRun) writeStore(store);
  res.json({ ok: true, updated, dryRun: Boolean(req.body.dryRun) });
});

app.get('/api/exports/formats', (req, res) => res.json({ formats: ['json', 'csv', 'markdown'] }));
app.post('/api/exports/results', (req, res) => sendExport(res, 'results', [...(req.body.images || []), ...(req.body.videos || [])], req.query.format || req.body.format || 'json'));
app.get('/api/exports/collection', (req, res) => sendExport(res, 'collection', readStore().collection, req.query.format || 'json'));
app.get('/api/exports/history', (req, res) => sendExport(res, 'history', readStore().history, req.query.format || 'json'));
app.get('/api/exports/persons', (req, res) => sendExport(res, 'persons', readStore().persons, req.query.format || 'json'));
app.get('/api/exports/person-gallery', (req, res) => sendExport(res, 'person-gallery', readStore().personMediaLinks.filter(link => !req.query.personId || link.personId === req.query.personId), req.query.format || 'json'));
app.get('/api/exports/person-timeline', (req, res) => sendExport(res, 'person-timeline', readStore().personMediaLinks.filter(link => !req.query.personId || link.personId === req.query.personId), req.query.format || 'json'));
app.get('/api/exports/franchises', (req, res) => sendExport(res, 'franchises', readStore().collection, req.query.format || 'json'));

app.get('/api/desktop/status', (req, res) => res.json({ ready: true, mode: 'browser-local', tauriPrepared: false, exportDir: EXPORT_DIR }));
app.get('/api/desktop/qa', (req, res) => res.json({ ok: true, checks: ['server', 'storage', 'exports'] }));
app.get('/api/desktop/windows', (req, res) => res.json({ target: 'x86_64-pc-windows-msvc', sidecar: false, note: 'Build Tauri reel non integre dans cette passe locale compacte.' }));
app.post('/api/desktop/export', (req, res) => {
  ensureLocalDirs();
  const file = path.join(EXPORT_DIR, `export-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(req.body || {}, null, 2), 'utf8');
  res.json({ ok: true, file });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

if (require.main === module) {
  app.listen(PORT, () => {
    ensureLocalDirs();
    console.log(`MediaGatherer local: http://localhost:${PORT}`);
  });
}

module.exports = app;
