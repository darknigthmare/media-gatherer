const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const dnsModule = require('dns');
const dns = dnsModule.promises;
const net = require('net');
const { version: APP_VERSION } = require('./package.json');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const APP_DATA_ROOT = process.pkg ? path.dirname(process.execPath) : __dirname;
const DATA_DIR = process.env.MEDIAGATHERER_DATA_DIR || (process.env.VERCEL ? path.join(os.tmpdir(), 'mediagatherer-data') : path.join(APP_DATA_ROOT, 'data'));
const EXPORT_DIR = path.join(DATA_DIR, 'exports');
const STORE_PATH = path.join(DATA_DIR, 'mediagatherer.store.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_SCHEMA_VERSION = '2026-07-14-media-10';
const MAX_HTML_BYTES = 8 * 1024 * 1024;
const MAX_PROXY_BYTES = 100 * 1024 * 1024;
const IS_VOLATILE_STORAGE = Boolean(process.env.VERCEL && !process.env.MEDIAGATHERER_DATA_DIR);
const SESSION_CONNECTIONS = new Map();
const SOURCE_HEALTH = new Map();

const SOURCE_IDS = [
  'duckduckgo', 'bing', 'google', 'brave', 'flickr', 'wikimedia', 'youtube', 'reddit', 'telegram',
  'instagram', 'facebook', 'tiktok', 'x', 'pinterest', 'wayback', 'vimeo', 'dailymotion',
  'freeones', 'freeonesforum', 'babesource', 'erome', 'redgifs', 'imagebam', 'imagefap', 'pornpics',
  'babepedia', 'camwhores', 'pornzog', 'onlyfans', 'fansly', 'mym', 'xhamster', 'xvideos', 'spankbang',
  'pornhub', 'youporn', 'tube8', 'tnaflix', 'motherless', 'eporner', 'xnxx', 'hqporner', 'nuvid',
  'drtuber', 'pornone', 'youjizz', 'phunforum', 'planetsuzy', 'bellazon'
];

const NSFW_SOURCES = new Set([
  'freeones', 'freeonesforum', 'babesource', 'erome', 'redgifs', 'imagebam', 'imagefap', 'pornpics',
  'babepedia', 'camwhores', 'pornzog', 'onlyfans', 'fansly', 'mym', 'xhamster', 'xvideos', 'spankbang',
  'pornhub', 'youporn', 'tube8', 'tnaflix', 'motherless', 'eporner', 'xnxx', 'hqporner', 'nuvid',
  'drtuber', 'pornone', 'youjizz', 'phunforum', 'planetsuzy', 'bellazon'
]);

const SOURCE_LABELS = {
  duckduckgo: 'DuckDuckGo',
  redgifs: 'RedGIFs',
  imagebam: 'ImageBam',
  imagefap: 'ImageFap',
  pornpics: 'PornPics',
  babepedia: 'BabePedia',
  camwhores: 'CamWhores',
  pornzog: 'PornZog',
  freeones: 'FreeOnes',
  freeonesforum: 'FreeOnes Forum',
  babesource: 'BabeSource',
  onlyfans: 'OnlyFans public',
  fansly: 'Fansly public',
  mym: 'MYM public',
  xhamster: 'xHamster',
  xvideos: 'XVideos',
  spankbang: 'SpankBang',
  pornhub: 'Pornhub',
  youporn: 'YouPorn',
  tube8: 'Tube8',
  tnaflix: 'TNAFlix',
  motherless: 'Motherless',
  eporner: 'Eporner',
  xnxx: 'XNXX',
  hqporner: 'HQPorner',
  nuvid: 'Nuvid',
  drtuber: 'DrTuber',
  pornone: 'PornOne',
  youjizz: 'YouJizz',
  phunforum: 'Phun Forum',
  planetsuzy: 'PlanetSuzy',
  bellazon: 'Bellazon Forum'
};

const NSFW_ADAPTERS = {
  freeones: { domains: ['freeones.com'], pagePatterns: [/\/html\//i, /\/forums\//i], media: ['image', 'page'] },
  freeonesforum: { domains: ['freeones.com'], pagePatterns: [/\/forums\//i, /\/threads\//i], media: ['image', 'page'] },
  babesource: { domains: ['babesource.com'], pagePatterns: [/\/(?:model|babe|gallery|video)\//i], media: ['image', 'video'] },
  erome: { domains: ['erome.com'], pagePatterns: [/\/a\//i, /\/i\//i], media: ['image', 'video'], crawlLimit: 8 },
  redgifs: { domains: ['redgifs.com'], pagePatterns: [/\/watch\//i, /\/gifs\//i], media: ['video'], crawlLimit: 8 },
  imagebam: { domains: ['imagebam.com'], pagePatterns: [/\/(?:gallery|image)\//i], media: ['image'], crawlLimit: 8 },
  imagefap: { domains: ['imagefap.com'], pagePatterns: [/\/(?:gallery|photo|pictures)\//i], media: ['image'], crawlLimit: 8 },
  pornpics: { domains: ['pornpics.com'], pagePatterns: [/\/(?:galleries|gallery|photos?)\//i], media: ['image'], crawlLimit: 8 },
  babepedia: { domains: ['babepedia.com'], pagePatterns: [/\/babe\//i, /\/gallery\//i], media: ['image'], crawlLimit: 8 },
  camwhores: { domains: ['camwhores.tv'], pagePatterns: [/\/(?:videos?|models?|tags?)\//i], media: ['image', 'video'], crawlLimit: 6 },
  pornzog: { domains: ['pornzog.com'], pagePatterns: [/\/(?:video|watch)\//i], media: ['video'], crawlLimit: 6 },
  onlyfans: { domains: ['onlyfans.com'], pagePatterns: [/\/[^/?#]+\/?$/i], media: ['image', 'page'], crawlLimit: 3, publicProfileOnly: true },
  fansly: { domains: ['fansly.com'], pagePatterns: [/\/(?:creator|profile)\//i, /^\/[a-z0-9._-]+\/?$/i], media: ['image', 'page'], crawlLimit: 3, publicProfileOnly: true },
  mym: { domains: ['mym.fans'], pagePatterns: [/\/[^/?#]+\/?$/i], media: ['image', 'page'], crawlLimit: 3, publicProfileOnly: true },
  xhamster: { domains: ['xhamster.com'], pagePatterns: [/\/videos\//i, /\/users\//i], media: ['video'], crawlLimit: 6 },
  xvideos: { domains: ['xvideos.com'], pagePatterns: [/\/video[^/]*\//i, /\/profiles?\//i], media: ['video'], crawlLimit: 6 },
  spankbang: { domains: ['spankbang.com'], pagePatterns: [/\/video\//i, /\/profile\//i], media: ['video'], crawlLimit: 6 },
  pornhub: { domains: ['pornhub.com'], pagePatterns: [/\/view_video\.php/i, /\/(?:model|pornstar|users?)\//i], media: ['video'], crawlLimit: 6 },
  youporn: { domains: ['youporn.com'], pagePatterns: [/\/watch\//i, /\/(?:porntags|pornstar)\//i], media: ['video'], crawlLimit: 6 },
  tube8: { domains: ['tube8.com'], pagePatterns: [/\/(?:porn-video|video|pornstar)\//i, /\/[^/]+\/[^/]+\/\d+/i], media: ['video'], crawlLimit: 6 },
  tnaflix: { domains: ['tnaflix.com'], pagePatterns: [/\/(?:hd-videos?|videos?|profile)\//i], media: ['video'], crawlLimit: 6 },
  motherless: { domains: ['motherless.com'], pagePatterns: [/\/(?:G|GI|GV|term|m)\//i], media: ['image', 'video'], crawlLimit: 6 },
  eporner: {
    domains: ['eporner.com'],
    pagePatterns: [/\/video-[^/]+\//i, /\/embed\//i],
    media: ['video'],
    crawlLimit: 4,
    transport: 'eporner-api-v2'
  },
  xnxx: { domains: ['xnxx.com'], pagePatterns: [/\/video-[^/]+\//i], media: ['video'], crawlLimit: 5 },
  hqporner: { domains: ['hqporner.com'], pagePatterns: [/\/hdporn\/[^/]+\.html/i], media: ['video'], crawlLimit: 5 },
  nuvid: { domains: ['nuvid.com'], pagePatterns: [/\/video\/\d+\//i], media: ['video'], crawlLimit: 5 },
  drtuber: { domains: ['drtuber.com'], pagePatterns: [/\/video\/\d+\//i], media: ['video'], crawlLimit: 5 },
  pornone: { domains: ['pornone.com'], pagePatterns: [/\/[^/]+\/[^/]*video-\d+\/\d+\/?$/i], media: ['video'], crawlLimit: 5 },
  youjizz: { domains: ['youjizz.com'], pagePatterns: [/\/videos\/[^/]+\.html/i], media: ['video'], crawlLimit: 5 },
  phunforum: { domains: ['forum.phun.org', 'phun.org'], pagePatterns: [/\/threads\/[^/]+\.\d+\/?/i], media: ['image', 'video'], crawlLimit: 4, forum: true, transport: 'public-forum-get' },
  planetsuzy: { domains: ['planetsuzy.org'], pagePatterns: [/\/showthread\.php\?.*\bt=\d+/i, /\/t\d+[^/]*\.html/i], media: ['image', 'video'], crawlLimit: 4, forum: true, transport: 'public-forum-form' },
  bellazon: { domains: ['bellazon.com'], pagePatterns: [/\/main\/topic\/\d+-[^/]+\/?/i], media: ['image', 'video'], crawlLimit: 4, forum: true, transport: 'public-forum-get' }
};

const SOURCE_META = SOURCE_IDS.reduce((map, id) => {
  const nsfw = NSFW_SOURCES.has(id);
  map[id] = {
    id,
    label: SOURCE_LABELS[id] || id.replace(/\b\w/g, char => char.toUpperCase()),
    category: nsfw ? 'nsfw' : (['reddit', 'telegram', 'instagram', 'facebook', 'tiktok', 'x', 'pinterest'].includes(id) ? 'social' : 'normal'),
    nsfw,
    enabled: true,
    supports: NSFW_ADAPTERS[id]?.media || (id === 'youtube' || id === 'vimeo' || id === 'dailymotion' ? ['video'] : ['image', 'video', 'page']),
    adapter: NSFW_ADAPTERS[id] ? 'source-crawl' : 'generic-public',
    publicOnly: true,
    subtype: NSFW_ADAPTERS[id]?.forum ? 'forum' : (nsfw ? 'platform' : 'general')
  };
  return map;
}, {});

app.set('trust proxy', 1);
const configuredOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const allowedOrigins = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://media-gatherer.vercel.app',
  ...configuredOrigins
]);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('Origine CORS non autorisee'));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-App-Token']
}));
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      mediaSrc: ["'self'", 'blob:', 'https:'],
      connectSrc: ["'self'", 'https:'],
      frameSrc: ['https:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"]
    }
  }
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Trop de requetes. Reessayez plus tard.' }
});
const searchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 90,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Limite de recherche atteinte. Reessayez plus tard.' }
});
const proxyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 180,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Limite du proxy atteinte. Reessayez plus tard.' }
});
app.use('/api', apiLimiter);
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const requiredToken = process.env.APP_WRITE_TOKEN;
  if (requiredToken && req.get('x-app-token') !== requiredToken) return res.status(401).json({ error: 'Jeton ecriture requis' });
  const origin = req.get('origin');
  if (origin && !allowedOrigins.has(origin)) return res.status(403).json({ error: 'Origine ecriture interdite' });
  return next();
});

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
    sourceDiagnostics: {},
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
  const payload = JSON.stringify({ ...defaultStore(), ...store }, null, 2);
  const temporaryPath = `${STORE_PATH}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporaryPath, payload, 'utf8');
  try {
    fs.renameSync(temporaryPath, STORE_PATH);
  } catch (error) {
    fs.copyFileSync(temporaryPath, STORE_PATH);
    fs.unlinkSync(temporaryPath);
  }
}

function mutateStore(mutator) {
  const store = readStore();
  const result = mutator(store);
  writeStore(store);
  return result;
}

function makeId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function stableHash(value) {
  return crypto.createHash('sha1').update(JSON.stringify(value || {})).digest('hex');
}

function normalizeSearchTerm(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function repairMojibake(value) {
  const text = String(value || '');
  if (!/(?:Ã.|Â.|â[\u0080-\u00bf]|ð[\u0080-\u00bf])/u.test(text)) return text;
  const repaired = Buffer.from(text, 'latin1').toString('utf8');
  const replacementCount = candidate => (candidate.match(/�/g) || []).length;
  return replacementCount(repaired) <= replacementCount(text) ? repaired : text;
}

function isSafeHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function textMatchesQuery(value, query) {
  const haystack = normalizeSearchTerm(value);
  const needle = normalizeSearchTerm(query);
  if (!needle) return true;
  if (haystack.includes(needle)) return true;
  const compactHaystack = haystack.replace(/[^a-z0-9]+/g, '');
  const compactNeedle = needle.replace(/[^a-z0-9]+/g, '');
  return compactNeedle.length >= 3 && compactHaystack.includes(compactNeedle);
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

function compactSearchTerm(value) {
  return normalizeSearchTerm(value).replace(/[^a-z0-9]+/g, '');
}

function searchTokens(value) {
  return normalizeSearchTerm(value).split(/[^a-z0-9]+/).filter(token => token.length >= 2);
}

function isSearchPageUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''));
    const host = parsed.hostname.replace(/^www\./, '');
    return ['bing.com', 'google.com', 'duckduckgo.com', 'search.brave.com'].some(domain => host === domain || host.endsWith(`.${domain}`)) ||
      /\/(?:search|results?|images\/search)(?:\/|$)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function sourceLabel(source) {
  return SOURCE_META[source]?.label || source || 'Source';
}

function sourceDomain(sourceId) {
  const domains = {
    duckduckgo: 'duckduckgo.com',
    bing: 'bing.com',
    google: 'google.com',
    brave: 'search.brave.com',
    flickr: 'flickr.com',
    wikimedia: 'commons.wikimedia.org',
    youtube: 'youtube.com',
    reddit: 'reddit.com',
    telegram: 't.me',
    instagram: 'instagram.com',
    facebook: 'facebook.com',
    tiktok: 'tiktok.com',
    x: 'x.com',
    pinterest: 'pinterest.com',
    wayback: 'web.archive.org',
    vimeo: 'vimeo.com',
    dailymotion: 'dailymotion.com',
    erome: 'erome.com',
    redgifs: 'redgifs.com',
    imagebam: 'imagebam.com',
    imagefap: 'imagefap.com',
    pornpics: 'pornpics.com',
    babepedia: 'babepedia.com',
    camwhores: 'camwhores.tv',
    pornzog: 'pornzog.com',
    xhamster: 'xhamster.com',
    xvideos: 'xvideos.com',
    spankbang: 'spankbang.com',
    freeones: 'freeones.com',
    freeonesforum: 'freeones.com',
    babesource: 'babesource.com',
    onlyfans: 'onlyfans.com',
    fansly: 'fansly.com',
    mym: 'mym.fans',
    pornhub: 'pornhub.com',
    youporn: 'youporn.com',
    tube8: 'tube8.com',
    tnaflix: 'tnaflix.com',
    motherless: 'motherless.com',
    eporner: 'eporner.com',
    xnxx: 'xnxx.com',
    hqporner: 'hqporner.com',
    nuvid: 'nuvid.com',
    drtuber: 'drtuber.com',
    pornone: 'pornone.com',
    youjizz: 'youjizz.com',
    phunforum: 'forum.phun.org',
    planetsuzy: 'planetsuzy.org',
    bellazon: 'bellazon.com'
  };
  return domains[sourceId] || `${sourceId}.com`;
}

function sourceDomains(sourceId) {
  return NSFW_ADAPTERS[sourceId]?.domains || [sourceDomain(sourceId)];
}

function hostMatchesSource(rawUrl, sourceId) {
  try {
    const host = new URL(rawUrl).hostname.replace(/^www\./, '').toLowerCase();
    return sourceDomains(sourceId).some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function inferMediaType(item) {
  if (item.type) return item.type;
  const url = String(item.url || item.thumbnail || '').toLowerCase();
  if (/\.(mp4|webm|m3u8|mov)(\?|$)/.test(url) || item.embedUrl || item.duration) return 'video';
  if (/\.(jpg|jpeg|png|gif|webp|avif)(\?|$)/.test(url)) return 'image';
  return 'page';
}

function evaluateMediaMatch(item, query) {
  const needle = compactSearchTerm(query);
  if (!needle) return { score: 40, reasons: ['requete vide'] };
  const title = compactSearchTerm(item?.title);
  const description = compactSearchTerm(item?.description);
  const mediaUrl = compactSearchTerm(item?.url || item?.thumbnail);
  const account = compactSearchTerm(item?.accountUrl);
  const pageUrl = isSearchPageUrl(item?.link) ? '' : compactSearchTerm(item?.link);
  const tokens = searchTokens(query);
  const titleText = normalizeSearchTerm(item?.title);
  const descriptionText = normalizeSearchTerm(item?.description);
  const tokenHits = tokens.filter(token => titleText.includes(token) || descriptionText.includes(token)).length;

  if (account && account.includes(needle)) return { score: 100, reasons: ['username exact dans le compte public'] };
  if (title && title.includes(needle)) return { score: 96, reasons: ['terme exact dans le titre'] };
  if (pageUrl && pageUrl.includes(needle)) return { score: 90, reasons: ['terme exact dans la page source'] };
  if (mediaUrl && mediaUrl.includes(needle)) return { score: 86, reasons: ['terme exact dans URL media'] };
  if (description && description.includes(needle)) return { score: 82, reasons: ['terme exact dans la description'] };
  if (tokens.length && tokenHits === tokens.length) return { score: 76, reasons: ['tous les termes dans le contexte'] };
  if (item?.trustedContext) return { score: 68, reasons: ['media extrait depuis une page cible validee'] };
  if (tokenHits > 0) return { score: 52, reasons: ['correspondance partielle a verifier'] };
  return { score: 20, reasons: ['aucune preuve textuelle suffisante'] };
}

function enrichMedia(item, query, sourceId, kind = 'image') {
  const normalizedItem = {
    ...item,
    title: repairMojibake(item?.title),
    description: repairMojibake(item?.description)
  };
  const match = evaluateMediaMatch(normalizedItem, query);
  const score = Number(normalizedItem.confidenceScore || match.score);
  const source = normalizedItem.source || sourceLabel(sourceId);
  const url = normalizedItem.url || normalizedItem.thumbnail || normalizedItem.link;
  const thumbnail = normalizedItem.thumbnail || ((normalizedItem.type || kind) === 'image' && looksLikeImage(url) ? url : '');
  return {
    ...normalizedItem,
    type: normalizedItem.type || kind,
    source,
    sourceId,
    sourceLabel: sourceLabel(sourceId),
    title: normalizedItem.title || `${source} media`,
    url,
    thumbnail,
    link: normalizedItem.link || normalizedItem.url,
    confidenceScore: score,
    confidenceLabel: score >= 80 ? 'haute' : (score >= 55 ? 'moyenne' : 'faible'),
    matchReasons: normalizedItem.matchReasons || match.reasons,
    visualSignature: normalizedItem.visualSignature || stableHash({ type: normalizedItem.type || kind, media: canonicalMediaKey({ ...normalizedItem, url }) }),
    qualityLabel: normalizedItem.qualityLabel || (normalizedItem.width && normalizedItem.height ? `${normalizedItem.width}x${normalizedItem.height}` : 'source publique')
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

function canonicalMediaKey(item = {}) {
  const rawUrl = String(item.url || item.thumbnail || item.link || '');
  try {
    const parsed = new URL(rawUrl);
    const normalizedPath = decodeURIComponent(parsed.pathname)
      .replace(/\/(?:thumbs?|thumbnails?|previews?|small|medium)\//gi, '/')
      .replace(/\.thumb(?=\.[a-z0-9]{2,5}\.[a-f0-9]{8,}\.[a-z0-9]{2,5}$)/i, '')
      .replace(/(\.[a-z0-9]{2,5})\.[a-f0-9]{8,}(?=\.[a-z0-9]{2,5}$)/i, '$1')
      .replace(/(?:[-_.](?:thumb|thumbnail|small|medium|preview|\d{2,4}x\d{2,4}))(?=\.[a-z0-9]{2,5}$)/gi, '')
      .replace(/_(?:240p|360p|480p|720p|1080p|2160p)(?=\.[a-z0-9]{2,5}$)/i, '');
    return `${parsed.hostname.toLowerCase()}${normalizedPath.toLowerCase()}`;
  } catch {
    return normalizeSearchTerm(rawUrl);
  }
}

function mediaQualityScore(item = {}) {
  const url = String(item.url || '');
  const pixels = Math.min((Number(item.width) || 0) * (Number(item.height) || 0), 100000000) / 1000000;
  return pixels +
    (/original|master|source|full|large|1080|2160|4k/i.test(url) ? 12 : 0) +
    (/\/(?:thumbs?|thumbnails?|previews?|small|medium)\//i.test(url) ? -20 : 0) +
    (/(?:\/|[-_.])(?:thumb|thumbnail|preview)(?:[\/_\-.]|$)/i.test(url) ? -20 : 0) +
    (/\.(?:jpg|jpeg|png|webp|avif|mp4|webm)(?:[?#]|$)/i.test(url) ? 4 : 0) +
    (item.thumbnail && item.thumbnail !== item.url ? 2 : 0);
}

function dedupeBestMedia(items = []) {
  const best = new Map();
  for (const item of items) {
    const key = `${inferMediaType(item)}:${canonicalMediaKey(item)}`;
    const current = best.get(key);
    if (!current || mediaQualityScore(item) > mediaQualityScore(current)) best.set(key, item);
  }
  return [...best.values()];
}

const PUBLIC_REQUEST_HEADERS = {
  'user-agent': `MediaGatherer/${APP_VERSION} (+public-media-research)`,
  accept: 'text/html,application/xhtml+xml,application/json,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8'
};

async function requestPublicUrl(rawUrl, options = {}) {
  let currentUrl = await validatePublicMediaUrl(rawUrl);
  const redirectLimit = Number.isFinite(options.redirectLimit) ? options.redirectLimit : 4;
  for (let redirectCount = 0; redirectCount <= redirectLimit; redirectCount += 1) {
    const response = await axios.get(currentUrl, {
      timeout: options.timeout || 14000,
      responseType: options.responseType || 'text',
      maxRedirects: 0,
      maxContentLength: options.maxContentLength || MAX_HTML_BYTES,
      maxBodyLength: options.maxBodyLength || options.maxContentLength || MAX_HTML_BYTES,
      headers: {
        ...PUBLIC_REQUEST_HEADERS,
        referer: new URL(currentUrl).origin,
        ...(options.headers || {})
      },
      lookup: safeDnsLookup,
      validateStatus: status => status >= 200 && status < 500
    });
    if (response.status < 300 || response.status >= 400) {
      response.finalUrl = currentUrl;
      return response;
    }
    const location = response.headers.location;
    if (!location) throw new Error('Redirection sans destination');
    if (redirectCount === redirectLimit) throw new Error('Trop de redirections');
    currentUrl = await validatePublicMediaUrl(new URL(location, currentUrl).toString());
  }
  throw new Error('Redirection non resolue');
}

async function fetchText(url, options = {}) {
  const response = await requestPublicUrl(url, {
    timeout: options.timeout || 12000,
    responseType: options.responseType || 'text',
    headers: options.headers,
    maxContentLength: options.maxContentLength || MAX_HTML_BYTES
  });
  if (response.status >= 400) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const contentType = String(response.headers?.['content-type'] || '');
  if (typeof response.data === 'string' && /application\/(?:json|[^;]+\+json)/i.test(contentType)) {
    try { return JSON.parse(response.data); } catch { return response.data; }
  }
  return response.data;
}

async function fetchPage(url, options = {}) {
  const response = await requestPublicUrl(url, {
    timeout: options.timeout || 14000,
    responseType: 'text',
    headers: options.headers,
    maxContentLength: MAX_HTML_BYTES
  });
  return {
    html: String(response.data || ''),
    statusCode: response.status,
    finalUrl: response.finalUrl || url,
    contentType: response.headers?.['content-type'] || '',
    headers: response.headers || {}
  };
}

function cookieHeaderFromResponse(headers = {}) {
  const values = headers['set-cookie'];
  return (Array.isArray(values) ? values : (values ? [values] : []))
    .map(value => String(value).split(';', 1)[0])
    .filter(Boolean)
    .join('; ');
}

async function postPublicForm(rawUrl, fields, initialPage, options = {}) {
  const url = await validatePublicMediaUrl(rawUrl);
  const cookie = cookieHeaderFromResponse(initialPage?.headers);
  const response = await axios.post(url, new URLSearchParams(fields).toString(), {
    timeout: options.timeout || 14000,
    responseType: 'text',
    maxRedirects: 0,
    maxContentLength: MAX_HTML_BYTES,
    maxBodyLength: MAX_HTML_BYTES,
    headers: {
      ...PUBLIC_REQUEST_HEADERS,
      'content-type': 'application/x-www-form-urlencoded',
      origin: new URL(url).origin,
      referer: initialPage?.finalUrl || new URL(url).origin,
      ...(cookie ? { cookie } : {})
    },
    lookup: safeDnsLookup,
    validateStatus: status => status >= 200 && status < 500
  });
  if (response.status >= 300 && response.status < 400 && response.headers.location) {
    return fetchPage(new URL(response.headers.location, url).toString(), {
      timeout: options.timeout || 14000,
      headers: cookie ? { cookie } : undefined
    });
  }
  return {
    html: String(response.data || ''),
    statusCode: response.status,
    finalUrl: url,
    contentType: response.headers?.['content-type'] || '',
    headers: response.headers || {}
  };
}

async function fetchPublicForumSearchPage(sourceId, query, options = {}) {
  const definitions = {
    planetsuzy: {
      formUrl: 'http://www.planetsuzy.org/search.php',
      formSelector: 'form[action*="search.php?do=process"]',
      fields: ($) => ({
        s: $('input[name="s"]').first().attr('value') || '',
        securitytoken: $('input[name="securitytoken"]').first().attr('value') || 'guest',
        do: 'process',
        searchthreadid: '',
        query,
        titleonly: '1',
        searchuser: '',
        exactname: '1',
        replylimit: '0',
        showposts: '0',
        childforums: '1',
        dosearch: 'Search Now'
      })
    },
  };
  const definition = definitions[sourceId];
  if (!definition) throw new Error('Formulaire de forum non configure');
  const initialPage = await fetchPage(definition.formUrl, { timeout: options.timeout || 14000 });
  if (initialPage.statusCode >= 400) throw Object.assign(new Error(`HTTP ${initialPage.statusCode}`), { status: initialPage.statusCode });
  const $ = cheerio.load(initialPage.html || '');
  const form = $(definition.formSelector).first();
  if (!form.length) throw new Error('Formulaire de recherche public introuvable');
  const action = absolutize(form.attr('action'), initialPage.finalUrl);
  if (!action || !hostMatchesSource(action, sourceId)) throw new Error('Action de formulaire hors source');
  return postPublicForm(action, definition.fields($), initialPage, options);
}

function firstSrcFromSrcset(srcset) {
  const candidates = String(srcset || '')
    .split(',')
    .map(part => {
      const [url, descriptor] = part.trim().split(/\s+/, 2);
      const width = Number(String(descriptor || '').replace(/[^\d.]/g, '')) || 0;
      return { url, width };
    })
    .filter(item => item.url);
  candidates.sort((a, b) => b.width - a.width);
  return candidates[0]?.url || '';
}

function mediaUrlQualityScore(value) {
  return (looksLikeImage(value) || looksLikeVideo(value) ? 4 : 0) +
    (/original|full|large|master|source|1080|2160|4k/i.test(value) ? 3 : 0) +
    (/thumb|small|tiny|preview|placeholder|blank|sprite|logo|avatar/i.test(value) ? -3 : 0);
}

function bestMediaCandidate(values = []) {
  const candidates = values
    .flatMap(value => String(value || '').includes(',') ? [firstSrcFromSrcset(value), value] : [value])
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .filter(value => !/^data:/i.test(value))
    .sort((a, b) => {
      const aScore = mediaUrlQualityScore(a);
      const bScore = mediaUrlQualityScore(b);
      return bScore - aScore;
    });
  return candidates[0] || '';
}

function unwrapSearchResultUrl(candidate, baseUrl) {
  const absolute = absolutize(candidate, baseUrl);
  if (!absolute) return '';
  try {
    const parsed = new URL(absolute);
    const direct = parsed.searchParams.get('uddg') || parsed.searchParams.get('q') || parsed.searchParams.get('url');
    if (direct && /^https?:\/\//i.test(direct)) return direct;
    const bing = parsed.searchParams.get('u');
    if (bing?.startsWith('a1')) {
      const decoded = Buffer.from(bing.slice(2), 'base64').toString('utf8');
      if (/^https?:\/\//i.test(decoded)) return decoded;
    }
  } catch {
    return absolute;
  }
  return absolute;
}

function pageMatchesAdapter(url, sourceId) {
  const adapter = NSFW_ADAPTERS[sourceId];
  if (!adapter || !hostMatchesSource(url, sourceId)) return false;
  return !adapter.pagePatterns?.length || adapter.pagePatterns.some(pattern => pattern.test(new URL(url).pathname + new URL(url).search));
}

function isProfileLikeSourcePage(rawUrl, sourceId) {
  try {
    if (!hostMatchesSource(rawUrl, sourceId)) return false;
    const pathname = new URL(rawUrl).pathname;
    if (NSFW_ADAPTERS[sourceId]?.publicProfileOnly) return !/^\/?$/.test(pathname);
    return /\/(?:users?|profiles?|models?|pornstars?|performers?|creators?|channels?|actress|babe|girls?|tags?|porn-maker|m)\/[^/]+/i.test(pathname) ||
      (sourceId === 'freeones' && /\/html\/[^/]+/i.test(pathname));
  } catch {
    return false;
  }
}

function absolutize(candidate, baseUrl) {
  if (!candidate) return '';
  try {
    const cleaned = String(candidate).replace(/\\u002F/g, '/').replace(/&amp;/g, '&').trim();
    return new URL(cleaned, baseUrl).toString();
  } catch {
    return '';
  }
}

function looksLikeImage(url) {
  return /\.(jpg|jpeg|png|gif|webp|avif)(?:[?#].*)?$/i.test(url) || /\/(thumb|thumbnail|image|media|photos?)\//i.test(url);
}

function looksLikeVideo(url) {
  return /\.(mp4|webm|m3u8|mov)(?:[?#].*)?$/i.test(url) || /\/(video|videos|watch|embed|clip|shorts)\//i.test(url);
}

function isLikelyUiAsset(url, title = '', width = 0, height = 0) {
  const value = `${url} ${title}`.toLowerCase();
  if (/\.(?:svg|ico)(?:[?#]|$)/i.test(url)) return true;
  if (/\/(?:rsrc\.php|sa\/simg)\//i.test(value)) return true;
  if (/image\.php\?[^#]*\bu=\d+/i.test(value)) return true;
  if (/\/(?:images?\/(?:misc|badges?|buttons?|statusicon|smilies?|ranks?|avatars?)|styles?\/[^/]+\/images?|themes?\/[^/]+\/(?:images?|assets?))\//i.test(value)) return true;
  if (/(?:^|[\/_-])(logo|favicon|sprite|placeholder|blank|loading|tracking|pixel|badge|button|icon|icons|background|bg|header|footer|android-chrome|apple-touch|mstile|twitter-card)(?:[\/_\-.]|$)/i.test(value)) return true;
  if (/^(search|menu|close|fermer|english|photos?|videos?|people|personnes|groups?|groupes)$/i.test(String(title || '').trim())) return true;
  const numericWidth = Number(width) || 0;
  const numericHeight = Number(height) || 0;
  return Boolean(numericWidth && numericHeight && (numericWidth < 120 || numericHeight < 90));
}

function isPrivateIp(address) {
  if (!address) return true;
  const normalized = String(address).toLowerCase().split('%')[0];
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('::ffff:')) return isPrivateIp(normalized.slice(7));
  if (net.isIP(normalized) === 4) {
    const parts = normalized.split('.').map(Number);
    return parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
      (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) ||
      (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) ||
      parts[0] === 0 || parts[0] >= 224;
  }
  return false;
}

function safeDnsLookup(hostname, options, callback) {
  dnsModule.lookup(hostname, options, (error, address, family) => {
    if (error) return callback(error);
    const addresses = Array.isArray(address) ? address.map(entry => entry.address) : [address];
    if (addresses.some(isPrivateIp)) return callback(new Error('Resolution privee bloquee'));
    return callback(null, address, family);
  });
}

async function validatePublicMediaUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ''));
  } catch {
    throw new Error('URL invalide');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('URL http(s) requise');
  if (parsed.username || parsed.password) throw new Error('Identifiants dans URL interdits');
  if (parsed.port && !['80', '443'].includes(parsed.port)) throw new Error('Port non autorise');
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.local')) throw new Error('Hote local bloque');
  if (net.isIP(hostname) && isPrivateIp(hostname)) throw new Error('Adresse privee bloquee');
  const addresses = await dns.lookup(hostname, { all: true });
  if (addresses.some(entry => isPrivateIp(entry.address))) throw new Error('Resolution privee bloquee');
  return parsed.toString();
}

function extractImagesFromHtml(html, baseUrl, query, sourceId, limit = 35, options = {}) {
  const $ = cheerio.load(html || '');
  const rows = [];
  const trustedDetailPage = Boolean(options.trustedContext);
  $('img').each((_, el) => {
    const linkedHref = $(el).closest('a[href]').attr('href');
    const linkedImage = absolutize(linkedHref, baseUrl);
    const src = bestMediaCandidate([
      $(el).attr('data-full'),
      $(el).attr('data-full-image'),
      $(el).attr('data-fullsrc'),
      $(el).attr('data-file'),
      $(el).attr('data-large'),
      $(el).attr('data-src'),
      $(el).attr('data-original'),
      $(el).attr('data-original-src'),
      $(el).attr('data-lazy-src'),
      $(el).attr('data-thumb'),
      $(el).attr('data-thumbnail'),
      $(el).attr('srcset'),
      $(el).attr('data-srcset'),
      /\.(?:jpg|jpeg|png|gif|webp|avif)(?:[?#]|$)/i.test(linkedImage) ? linkedHref : '',
      $(el).attr('src')
    ]);
    if (!src) return;
    const url = absolutize(src, baseUrl);
    if (!/^https?:\/\//.test(url)) return;
    const title = $(el).attr('alt') || $(el).attr('title') || `${sourceLabel(sourceId)} image`;
    const width = Number($(el).attr('width') || $(el).attr('data-width')) || 0;
    const height = Number($(el).attr('height') || $(el).attr('data-height')) || 0;
    const card = $(el).closest('article, li, figure, [class*="item"], [class*="card"], [class*="thumb"], [class*="result"]');
    const context = [title, card.text()].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (isLikelyUiAsset(url, title, width, height)) return;
    if (!trustedDetailPage && !textMatchesQuery(context, query) && !textMatchesQuery(url, query)) return;
    rows.push(enrichMedia({ url, thumbnail: url, title, link: baseUrl, width, height, trustedContext: trustedDetailPage }, query, sourceId, 'image'));
  });
  $('meta[property="og:image"], meta[name="twitter:image"], link[rel="image_src"], video[poster], source[srcset]').each((_, el) => {
    const src = bestMediaCandidate([$(el).attr('content'), $(el).attr('href'), $(el).attr('poster'), $(el).attr('srcset')]);
    const url = absolutize(src, baseUrl);
    const title = $('title').text().trim() || `${sourceLabel(sourceId)} image`;
    if (/^https?:\/\//.test(url) && !isLikelyUiAsset(url, title) && (trustedDetailPage || textMatchesQuery(title, query) || textMatchesQuery(url, query))) {
      rows.push(enrichMedia({ url, thumbnail: url, title, link: baseUrl, trustedContext: trustedDetailPage }, query, sourceId, 'image'));
    }
  });
  if (trustedDetailPage && options.scanEmbeddedUrls !== false) {
    const imageRegex = /https?:\\?\/\\?\/[^"'<>\\\s]+?\.(?:jpg|jpeg|png|gif|webp|avif)(?:\?[^"'<>\\\s]*)?/gi;
    for (const match of String(html || '').matchAll(imageRegex)) {
      const url = absolutize(match[0].replace(/\\\//g, '/'), baseUrl);
      if (/^https?:\/\//.test(url) && !isLikelyUiAsset(url)) {
        rows.push(enrichMedia({ url, thumbnail: url, title: $('title').text().trim() || `${sourceLabel(sourceId)} image`, link: baseUrl, trustedContext: true }, query, sourceId, 'image'));
      }
    }
  }
  return dedupeBy(rows, item => item.url).slice(0, limit);
}

function extractLinksAsVideos(html, baseUrl, query, sourceId, limit = 20, options = {}) {
  const $ = cheerio.load(html || '');
  const rows = [];
  const trustedDetailPage = Boolean(options.trustedContext);
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (!href || !/(watch|video|\/v\/|embed|mp4|webm|clip|shorts)/i.test(href)) return;
    let url;
    try {
      url = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    const card = $(el).closest('article, li, figure, [class*="item"], [class*="card"], [class*="thumb"], [class*="result"]');
    const context = [text, card.text(), url].filter(Boolean).join(' ').replace(/\s+/g, ' ');
    if (!textMatchesQuery(context, query)) return;
    const posterElement = card.find('img').first();
    const thumbnail = absolutize(bestMediaCandidate([posterElement.attr('data-src'), posterElement.attr('srcset'), posterElement.attr('src')]), baseUrl);
    rows.push(enrichMedia({ url, link: url, thumbnail, title: text || `${sourceLabel(sourceId)} video`, duration: 'Ouvrir la source', playback: 'external' }, query, sourceId, 'video'));
  });
  $('video[src], source[src], meta[property="og:video"], meta[property="og:video:url"], meta[name="twitter:player"]').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('content');
    const url = absolutize(src, baseUrl);
    const title = $('title').text().trim() || `${sourceLabel(sourceId)} video`;
    const parentVideo = $(el).is('source') ? $(el).closest('video') : $(el);
    const thumbnail = absolutize(parentVideo.attr('poster') || $('meta[property="og:image"]').attr('content'), baseUrl);
    if (/^https?:\/\//.test(url) && (trustedDetailPage || textMatchesQuery(title, query) || textMatchesQuery(url, query))) {
      rows.push(enrichMedia({ url, link: baseUrl, thumbnail, title, duration: 'Media public', trustedContext: trustedDetailPage }, query, sourceId, 'video'));
    }
  });
  const videoRegex = /https?:\\?\/\\?\/[^"'<>\\\s]+?\.(?:mp4|webm|m3u8|mov)(?:\?[^"'<>\\\s]*)?/gi;
  for (const match of String(html || '').matchAll(videoRegex)) {
    const url = absolutize(match[0].replace(/\\\//g, '/'), baseUrl);
    if (/^https?:\/\//.test(url) && (trustedDetailPage || textMatchesQuery(url, query))) {
      rows.push(enrichMedia({ url, link: baseUrl, title: `${sourceLabel(sourceId)} video`, duration: 'Media public', trustedContext: trustedDetailPage }, query, sourceId, 'video'));
    }
  }
  return dedupeBy(rows, item => item.url).slice(0, limit);
}

function extractStructuredMedia(html, baseUrl, query, sourceId) {
  const $ = cheerio.load(html || '');
  const images = [];
  const videos = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = JSON.parse($(el).text());
      const queue = Array.isArray(raw) ? [...raw] : [raw];
      while (queue.length) {
        const node = queue.shift();
        if (!node || typeof node !== 'object') continue;
        if (Array.isArray(node['@graph'])) queue.push(...node['@graph']);
        const title = node.name || node.headline || $('title').text().trim() || `${sourceLabel(sourceId)} media`;
        const thumbnail = absolutize(Array.isArray(node.thumbnailUrl) ? node.thumbnailUrl[0] : node.thumbnailUrl, baseUrl);
        const imageUrl = absolutize(typeof node.image === 'object' ? (node.image.contentUrl || node.image.url) : (Array.isArray(node.image) ? node.image[0] : node.image), baseUrl);
        const videoUrl = absolutize(node.contentUrl || node.embedUrl, baseUrl);
        const type = String(node['@type'] || '').toLowerCase();
        if (imageUrl && (type.includes('image') || !videoUrl)) {
          images.push(enrichMedia({ url: imageUrl, thumbnail: thumbnail || imageUrl, link: baseUrl, title, width: node.width, height: node.height }, query, sourceId, 'image'));
        }
        if (videoUrl && (type.includes('video') || looksLikeVideo(videoUrl))) {
          videos.push(enrichMedia({ url: videoUrl, thumbnail, link: baseUrl, title, duration: node.duration || 'Media public' }, query, sourceId, 'video'));
        }
      }
    } catch {
      // Invalid JSON-LD is common on legacy pages; HTML extraction remains available.
    }
  });
  return { images, videos };
}

function extractAdapterPageLinks(html, baseUrl, query, sourceId, limit = 20, options = {}) {
  const $ = cheerio.load(html || '');
  const rows = [];
  const needle = normalizeSearchTerm(query);
  $('a[href]').each((_, el) => {
    const rawHref = $(el).attr('href');
    let url = unwrapSearchResultUrl(rawHref, baseUrl);
    if (sourceId === 'phunforum' && /^\/?threads\//i.test(String(rawHref || ''))) {
      url = new URL(`/${String(rawHref).replace(/^\/+/, '')}`, new URL(baseUrl).origin).toString();
    }
    if (!pageMatchesAdapter(url, sourceId)) return;
    const card = $(el).closest('article, li, figure, [class*="item"], [class*="card"], [class*="thumb"], [class*="result"]');
    const context = [$(el).attr('title'), $(el).text(), card.text(), url].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const matchesQuery = !needle || textMatchesQuery(context, needle);
    if (needle && !options.trustedSearchResults && !matchesQuery) return;
    const nestedImage = $(el).find('img').first();
    const image = nestedImage.length ? nestedImage : card.find('img').first();
    const thumbnail = absolutize(bestMediaCandidate([
      image.attr('data-full'), image.attr('data-large'), image.attr('data-src'), image.attr('data-original'),
      image.attr('data-lazy-src'), image.attr('srcset'), image.attr('data-srcset'), image.attr('src')
    ]), baseUrl);
    rows.push({
      url,
      title: ($(el).attr('title') || $(el).text() || card.text()).replace(/\s+/g, ' ').trim(),
      thumbnail,
      trustedContext: Boolean(options.trustedSearchResults || matchesQuery)
    });
  });
  return dedupeBy(rows, item => item.url).slice(0, limit);
}

function extractMediaFromSourcePage(html, pageUrl, query, sourceId, pageMeta = {}) {
  const $ = cheerio.load(html || '');
  const pageTitle = $('meta[property="og:title"]').attr('content') || $('title').text().trim() || pageMeta.title || `${sourceLabel(sourceId)} media`;
  const adapter = NSFW_ADAPTERS[sourceId];
  const trustedPage = Boolean(pageMeta.trustedContext) || isTrustedIdentityResultPage(pageUrl, pageTitle, query);
  const pageRelevant = adapter?.publicProfileOnly ? trustedPage : (trustedPage || textMatchesQuery(`${pageTitle} ${pageUrl}`, query));
  if (!pageRelevant) return { images: [], videos: [] };
  const poster = absolutize(bestMediaCandidate([
    $('meta[property="og:image"]').attr('content'),
    $('meta[name="twitter:image"]').attr('content'),
    $('video[poster]').first().attr('poster'),
    pageMeta.thumbnail
  ]), pageUrl);
  const structured = extractStructuredMedia(html, pageUrl, query, sourceId);
  const rawImages = extractImagesFromHtml(html, pageUrl, query, sourceId, 80, { trustedContext: pageRelevant })
    .filter(item => !/\/(?:logo|icon|avatar|sprite|favicon)[^/]*\.(?:png|jpe?g|webp|gif)/i.test(item.url))
    .filter(item => !/\.(?:svg|ico)(?:[?#]|$)/i.test(item.url))
    .filter(item => {
      try {
        const basename = decodeURIComponent(new URL(item.url).pathname.split('/').at(-1) || '').replace(/\.[a-z0-9]{2,5}$/i, '');
        const brandKeys = [sourceId, sourceLabel(sourceId), ...sourceDomains(sourceId).map(domain => domain.split('.')[0])].map(compactSearchTerm);
        return !brandKeys.includes(compactSearchTerm(basename));
      } catch {
        return true;
      }
    });
  const rawVideos = extractLinksAsVideos(html, pageUrl, query, sourceId, 50, { trustedContext: pageRelevant })
    .filter(item => /\.(?:mp4|webm|m3u8|mov)(?:[?#]|$)/i.test(item.url) || /\/(?:embed|player)\//i.test(item.url))
    .filter(item => !/\/manifest\.(?:mp4|webm)(?:[?#]|$)/i.test(String(item.url || '')));
  const rescore = (item, kind, thumbnail) => {
    const candidate = { ...item, title: pageTitle, link: pageUrl, thumbnail, trustedContext: pageRelevant };
    delete candidate.confidenceScore;
    delete candidate.confidenceLabel;
    delete candidate.matchReasons;
    return enrichMedia(candidate, query, sourceId, kind);
  };
  const images = rawImages.map(item => rescore(item, 'image', item.thumbnail || poster || item.url));
  const videos = rawVideos.map(item => rescore(item, 'video', item.thumbnail || poster || pageMeta.thumbnail));
  const structuredImages = structured.images.map(item => rescore(item, 'image', item.thumbnail || poster || item.url));
  const structuredVideos = structured.videos.map(item => rescore(item, 'video', item.thumbnail || poster || pageMeta.thumbnail));
  const adapterImages = adapter?.media.includes('image') ? [...structuredImages, ...images] : [];
  let adapterVideos = adapter?.media.includes('video') ? dedupeBy([...structuredVideos, ...videos], item => item.url) : [];
  if (adapter?.media.length === 1 && adapter.media[0] === 'video' && adapterVideos.length > 1) {
    adapterVideos = adapterVideos
      .sort((a, b) => {
        const previewPenalty = value => /\/(?:tmb|thumbs?|previews?|trailers?|samples?)\//i.test(String(value?.url || '')) ? 1 : 0;
        return previewPenalty(a) - previewPenalty(b) || mediaUrlQualityScore(b.url) - mediaUrlQualityScore(a.url);
      })
      .slice(0, 1)
      .map(item => ({
        ...item,
        playback: /\/(?:tmb|thumbs?|previews?|trailers?|samples?)\//i.test(String(item.url || '')) ? 'preview' : item.playback
      }));
  }
  const videoOrientedPage = adapter?.media.length === 1 || /\b(?:video|videos|clip|clips|watch)\b/i.test(`${pageTitle} ${pageMeta.title || ''} ${pageUrl}`);
  if (adapter?.media.includes('video') && adapterVideos.length === 0 && videoOrientedPage && poster && pageMatchesAdapter(pageUrl, sourceId) && pageRelevant) {
    adapterVideos.push(enrichMedia({
      url: pageUrl,
      link: pageUrl,
      thumbnail: poster,
      title: pageTitle,
      duration: 'Ouvrir la source',
      playback: 'external',
      trustedContext: true
    }, query, sourceId, 'video'));
  }
  return {
    images: dedupeBy(adapterImages, item => item.url),
    videos: dedupeBy(adapterVideos, item => item.url)
  };
}

function extractSearchResultPages(html, baseUrl, query, sourceId, limit = 20) {
  const $ = cheerio.load(html || '');
  const rows = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    const url = unwrapSearchResultUrl(href, baseUrl);
    if (!/^https?:\/\//.test(url)) return;
    if (!hostMatchesSource(url, sourceId)) return;
    let pathname = '';
    try { pathname = decodeURIComponent(new URL(url).pathname); } catch { return; }
    if (/\/(?:accounts?|legal|about|directory|challenge|explore)(?:\/|$)/i.test(pathname)) return;
    if (!textMatchesQuery(text, query) && !textMatchesQuery(pathname, query)) return;
    const type = looksLikeVideo(url) ? 'video' : 'page';
    rows.push(enrichMedia({ url, link: url, title: text || `${sourceLabel(sourceId)} page publique`, thumbnail: '' }, query, sourceId, type));
  });
  return dedupeBy(rows, item => item.url).slice(0, limit);
}

function sourceSearchUrls(sourceId, query, options = {}) {
  const encoded = encodeURIComponent(query);
  const username = /^@?[a-z0-9._-]+$/i.test(query) ? encodeURIComponent(query.replace(/^@/, '')) : '';
  const safe = options.safe !== false;
  const direct = {
    duckduckgo: `https://duckduckgo.com/html/?q=${encoded}`,
    bing: `https://www.bing.com/images/search?q=${encoded}&adlt=${safe ? 'strict' : 'off'}`,
    google: `https://www.google.com/search?tbm=isch&q=${encoded}&safe=${safe ? 'active' : 'off'}`,
    brave: `https://search.brave.com/images?q=${encoded}`,
    flickr: `https://www.flickr.com/search/?text=${encoded}`,
    wikimedia: `https://commons.wikimedia.org/w/index.php?search=${encoded}&title=Special:MediaSearch&type=image`,
    youtube: `https://www.youtube.com/results?search_query=${encoded}`,
    reddit: `https://www.reddit.com/search/?q=${encoded}&type=media`,
    vimeo: `https://vimeo.com/search?q=${encoded}`,
    dailymotion: `https://www.dailymotion.com/search/${encoded}/videos`,
    telegram: username ? `https://t.me/s/${username}` : 'https://t.me/',
    instagram: username ? `https://www.instagram.com/${username}/` : 'https://www.instagram.com/',
    facebook: `https://www.facebook.com/search/top?q=${encoded}`,
    tiktok: `https://www.tiktok.com/search?q=${encoded}`,
    x: `https://x.com/search?q=${encoded}&src=typed_query`,
    pinterest: `https://www.pinterest.com/search/pins/?q=${encoded}`,
    freeones: `https://www.freeones.com/search?q=${encoded}`,
    freeonesforum: `https://www.freeones.com/forums/search/?q=${encoded}`,
    babesource: `https://www.babesource.com/search?q=${encoded}`,
    erome: `https://fr.erome.com/search?q=${encoded}`,
    redgifs: `https://www.redgifs.com/browse?query=${encoded}`,
    imagebam: `https://www.imagebam.com/search/${encoded}`,
    imagefap: `https://www.imagefap.com/search/${encoded}`,
    pornpics: `https://www.pornpics.com/?q=${encoded}`,
    babepedia: `https://www.babepedia.com/search/${encoded}`,
    camwhores: `https://www.camwhores.tv/tags/${encoded}/`,
    pornzog: `https://pornzog.com/search/${encoded}`,
    onlyfans: username ? `https://onlyfans.com/${username}` : `https://onlyfans.com/`,
    fansly: username ? `https://fansly.com/${username}` : `https://fansly.com/`,
    mym: username ? `https://mym.fans/${username}` : `https://mym.fans/`,
    xhamster: `https://xhamster.com/search/${encoded}`,
    xvideos: `https://www.xvideos.com/?k=${encoded}`,
    spankbang: `https://spankbang.com/s/${encoded}/`,
    pornhub: `https://www.pornhub.com/video/search?search=${encoded}`,
    youporn: `https://www.youporn.com/search/?query=${encoded}`,
    tube8: `https://www.tube8.com/search.html?q=${encoded}`,
    tnaflix: `https://www.tnaflix.com/search?what=${encoded}`,
    motherless: `https://motherless.com/term/${encoded}`,
    eporner: `https://www.eporner.com/search/${encoded}/`,
    xnxx: `https://www.xnxx.com/search/${encoded}/0`,
    hqporner: `https://hqporner.com/?q=${encoded}`,
    nuvid: `https://www.nuvid.com/search/videos/${encoded}`,
    drtuber: `https://www.drtuber.com/search/videos/${encoded}`,
    pornone: `https://pornone.com/search/?q=${encoded}`,
    youjizz: `https://www.youjizz.com/search/${encoded}-1.html`,
    phunforum: `https://forum.phun.org/search/search?keywords=${encoded}&title_only=1`,
    planetsuzy: `https://www.planetsuzy.org/search.php?query=${encoded}`,
    bellazon: `https://www.bellazon.com/main/search/?q=${encoded}&type=forums_topic&quick=1`
  };
  const urls = [direct[sourceId] || `https://${sourceDomain(sourceId)}/search/${encoded}`];
  if (NSFW_SOURCES.has(sourceId) || SOURCE_META[sourceId]?.category === 'social') {
    const domain = sourceDomain(sourceId);
    urls.push(`https://duckduckgo.com/html/?q=${encodeURIComponent(`${query} site:${domain}`)}`);
    urls.push(`https://www.bing.com/search?q=${encodeURIComponent(`${query} site:${domain}`)}`);
    if (connectionValue('brave', 'apiKey', 'BRAVE_API_KEY')) {
      urls.push(`https://search.brave.com/search?q=${encodeURIComponent(`${query} site:${domain}`)}`);
    }
  }
  return uniq(urls);
}

function parseEpornerApiResults(payload, query, limit = 20) {
  const rows = Array.isArray(payload?.videos) ? payload.videos : [];
  const videos = rows.flatMap(entry => {
    const title = String(entry?.title || '').trim();
    const description = String(entry?.keywords || '').trim();
    const pageUrl = String(entry?.url || '').trim();
    if (!pageUrl || !textMatchesQuery(`${title} ${description} ${pageUrl}`, query)) return [];
    const thumbnails = [entry?.default_thumb, ...(Array.isArray(entry?.thumbs) ? entry.thumbs : [])]
      .filter(thumb => thumb?.src)
      .sort((a, b) => (Number(b.width) * Number(b.height)) - (Number(a.width) * Number(a.height)));
    const bestThumb = thumbnails[0] || {};
    return [enrichMedia({
      url: pageUrl,
      link: pageUrl,
      embedUrl: entry?.embed || '',
      thumbnail: bestThumb.src || '',
      title: title || 'Eporner video',
      description,
      duration: formatDuration(entry?.length_sec),
      width: Number(bestThumb.width) || 0,
      height: Number(bestThumb.height) || 0,
      playback: entry?.embed ? 'embed' : 'external',
      providerVideoId: entry?.id || '',
      apiAdapter: 'eporner-v2'
    }, query, 'eporner', 'video')];
  });
  return dedupeBestMedia(videos).slice(0, Math.max(1, Math.min(Number(limit) || 20, 40)));
}

async function scrapeEpornerApi(query, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.videoLimit) || 20, 40));
  const params = new URLSearchParams({
    query,
    per_page: String(limit),
    page: '1',
    thumbsize: 'big',
    order: 'latest',
    lq: '1',
    format: 'json'
  });
  const endpoint = `https://www.eporner.com/api/v2/video/search/?${params}`;
  const payload = await fetchText(endpoint, { timeout: options.timeout || 14000 });
  const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
  return {
    endpoint,
    totalAvailable: Number(parsed?.total_count) || 0,
    videos: parseEpornerApiResults(parsed, query, limit)
  };
}

async function scrapeNsfwSource(sourceId, query, options = {}) {
  const adapter = NSFW_ADAPTERS[sourceId];
  const images = [];
  const videos = [];
  const discoveredPages = [];
  const notes = [];
  let searchUrls = sourceSearchUrls(sourceId, query, options);
  let directReachable = false;
  let fallbackReachable = false;
  let successfulRequests = 0;
  let blockedResponses = 0;
  let rateLimitedResponses = 0;

  if (adapter.transport === 'public-forum-form') {
    try {
      const forumPage = await fetchPublicForumSearchPage(sourceId, query, options);
      notes.push(`${new URL(forumPage.finalUrl).hostname}: formulaire public HTTP ${forumPage.statusCode}`);
      if (forumPage.statusCode === 429) rateLimitedResponses += 1;
      if ([401, 403, 451].includes(forumPage.statusCode)) blockedResponses += 1;
      if (forumPage.statusCode < 400) {
        successfulRequests += 1;
        directReachable = true;
        discoveredPages.push(...extractAdapterPageLinks(forumPage.html, forumPage.finalUrl, query, sourceId, 24));
      }
    } catch (error) {
      notes.push(`formulaire public: ${error.code || error.message}`);
      if (error.status === 429) rateLimitedResponses += 1;
      if ([401, 403, 451].includes(error.status)) blockedResponses += 1;
    }
    searchUrls = searchUrls.slice(1);
  }

  if (adapter.transport === 'eporner-api-v2') {
    try {
      const apiResult = await scrapeEpornerApi(query, options);
      if (apiResult.videos.length) {
        return {
          images: [],
          videos: apiResult.videos,
          status: {
            success: true,
            available: true,
            directReachable: true,
            fallbackUsed: false,
            adapter: 'eporner-api-v2',
            note: `${apiResult.videos.length} videos via API publique Eporner (${apiResult.totalAvailable} correspondances annoncees)`,
            imagesCount: 0,
            videosCount: apiResult.videos.length,
            pagesDiscovered: apiResult.videos.length,
            pagesCrawled: 0,
            pages: apiResult.videos.map(item => item.link).slice(0, 10),
            accounts: [],
            zeroReason: ''
          }
        };
      }
      notes.push(`api.eporner.com: 0 resultat sur ${apiResult.totalAvailable}`);
      directReachable = true;
      successfulRequests += 1;
    } catch (error) {
      notes.push(`api.eporner.com: ${error.code || error.message}`);
      if (error.status === 429) rateLimitedResponses += 1;
      if ([401, 403, 451].includes(error.status)) blockedResponses += 1;
    }
  }

  for (const [searchIndex, searchUrl] of searchUrls.entries()) {
    try {
      const page = await fetchPage(searchUrl, { timeout: options.timeout || 14000 });
      const searchHost = new URL(searchUrl).hostname;
      notes.push(`${searchHost}: HTTP ${page.statusCode}`);
      if (page.statusCode === 429) rateLimitedResponses += 1;
      if ([401, 403, 451].includes(page.statusCode)) blockedResponses += 1;
      if (page.statusCode >= 400) continue;
      successfulRequests += 1;
      if (searchIndex === 0) directReachable = true;
      else fallbackReachable = true;

      const pageLinks = extractAdapterPageLinks(page.html, page.finalUrl, query, sourceId, 24, {
        trustedSearchResults: searchIndex === 0 && Boolean(adapter.trustSearchResults)
      });
      discoveredPages.push(...pageLinks);

      if (pageMatchesAdapter(page.finalUrl, sourceId)) {
        const directMedia = extractMediaFromSourcePage(page.html, page.finalUrl, query, sourceId, {
          title: `${sourceLabel(sourceId)} recherche ${query}`
        });
        images.push(...directMedia.images);
        videos.push(...directMedia.videos);
      }
    } catch (error) {
      notes.push(`${new URL(searchUrl).hostname}: ${error.code || error.message}`);
      if (error.status === 429) rateLimitedResponses += 1;
      if ([401, 403, 451].includes(error.status)) blockedResponses += 1;
    }
  }

  const uniquePages = dedupeBy(discoveredPages, item => item.url).slice(0, adapter.crawlLimit || 6);
  let crawled = 0;
  for (const pageMeta of uniquePages) {
    try {
      const page = await fetchPage(pageMeta.url, { timeout: options.timeout || 14000 });
      if (page.statusCode >= 400 || !hostMatchesSource(page.finalUrl, sourceId)) {
        notes.push(`detail ${new URL(pageMeta.url).hostname}: HTTP ${page.statusCode}`);
        continue;
      }
      const media = extractMediaFromSourcePage(page.html, page.finalUrl, query, sourceId, pageMeta);
      images.push(...media.images);
      videos.push(...media.videos);
      crawled += 1;
    } catch (error) {
      notes.push(`detail: ${error.message}`);
    }
  }

  const imageLimit = options.imageLimit || 35;
  const videoLimit = options.videoLimit || 20;
  const uniqueImages = dedupeBestMedia(images).slice(0, imageLimit);
  const uniqueVideos = dedupeBestMedia(videos).slice(0, videoLimit);
  const total = uniqueImages.length + uniqueVideos.length;
  const zeroReason = total
    ? ''
    : (uniquePages.length
        ? 'detail_pages_without_public_media'
        : (!successfulRequests
            ? (rateLimitedResponses ? 'rate_limited' : (blockedResponses ? 'access_blocked' : 'source_unreachable'))
            : 'no_matching_public_pages'));
  const profileNote = adapter.publicProfileOnly ? '; profils publics uniquement' : '';
  return {
    images: uniqueImages,
    videos: uniqueVideos,
    status: {
      success: successfulRequests > 0,
      available: successfulRequests > 0,
      directReachable,
      fallbackUsed: !directReachable && fallbackReachable,
      adapter: adapter.transport || 'source-crawl',
      note: `${uniquePages.length} pages correspondantes; ${crawled} ouvertes; ${notes.join('; ')}${profileNote}`,
      imagesCount: uniqueImages.length,
      videosCount: uniqueVideos.length,
      pagesDiscovered: uniquePages.length,
      pagesCrawled: crawled,
      attemptedUrls: searchUrls.length + (adapter.transport === 'public-forum-form' ? 1 : 0),
      blockedResponses,
      rateLimitedResponses,
      pages: uniquePages.map(item => item.url).slice(0, 10),
      accounts: uniquePages.filter(item => isProfileLikeSourcePage(item.url, sourceId)).map(item => item.url).slice(0, 10),
      zeroReason
    }
  };
}

function connectionValue(provider, field, envName) {
  return SESSION_CONNECTIONS.get(provider)?.[field] || process.env[envName] || '';
}

function formatDuration(seconds) {
  const total = Number(seconds) || 0;
  if (!total) return 'Duree inconnue';
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(Math.floor(total % 60)).padStart(2, '0')}`;
}

function parseBingImageResults(html, query, limit = 35) {
  const $ = cheerio.load(html || '');
  const rows = [];
  $('[m]').each((_, element) => {
    let raw;
    try { raw = JSON.parse($(element).attr('m')); } catch { return; }
    const url = raw.murl || raw.imgurl;
    const link = raw.purl || raw.surl;
    const thumbnail = raw.turl || url;
    const title = raw.t || raw.title || $(element).attr('aria-label') || '';
    if (!url || !link || !textMatchesQuery(`${title} ${link} ${url}`, query)) return;
    if (isLikelyUiAsset(url, title)) return;
    rows.push(enrichMedia({ url, thumbnail, link, title: title || query, width: raw.w, height: raw.h }, query, 'bing', 'image'));
  });
  return dedupeBy(rows, item => item.url).slice(0, limit);
}

function parseYoutubeResults(html, query, limit = 20) {
  const rows = [];
  const seen = new Set();
  const idRegex = /"videoId":"([A-Za-z0-9_-]{11})"/g;
  for (const match of String(html || '').matchAll(idRegex)) {
    const id = match[1];
    if (seen.has(id)) continue;
    const context = String(html).slice(match.index, match.index + 1800);
    const titleMatch = context.match(/"title":\{"runs":\[\{"text":"((?:\\.|[^"\\])+)"/);
    let title = '';
    try { title = titleMatch ? JSON.parse(`"${titleMatch[1]}"`) : ''; } catch { title = ''; }
    if (!title || !textMatchesQuery(title, query)) continue;
    seen.add(id);
    const link = `https://www.youtube.com/watch?v=${id}`;
    rows.push(enrichMedia({
      url: link,
      link,
      embedUrl: `https://www.youtube.com/embed/${id}`,
      thumbnail: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
      title,
      duration: 'YouTube'
    }, query, 'youtube', 'video'));
    if (rows.length >= limit) break;
  }
  return rows;
}

function parseDuckDuckGoWebResults(html, query, limit = 8) {
  const $ = cheerio.load(html || '');
  const rows = [];
  $('.result, .web-result').each((_, element) => {
    const anchor = $(element).find('a.result__a, a[href]').first();
    const url = unwrapSearchResultUrl(anchor.attr('href'), 'https://html.duckduckgo.com/html/');
    const title = anchor.text().replace(/\s+/g, ' ').trim();
    const snippet = $(element).find('.result__snippet').text().replace(/\s+/g, ' ').trim();
    const image = $(element).find('img').first();
    const thumbnail = absolutize(bestMediaCandidate([image.attr('data-src'), image.attr('src')]), 'https://html.duckduckgo.com/html/');
    if (!/^https?:\/\//i.test(url) || isSearchPageUrl(url)) return;
    if (!textMatchesQuery(`${title} ${snippet} ${url}`, query)) return;
    rows.push({ url, title: title || query, snippet, thumbnail: looksLikeImage(thumbnail) && !isLikelyUiAsset(thumbnail) ? thumbnail : '' });
  });
  return dedupeBy(rows, row => row.url).slice(0, limit);
}

function parseBingWebResults(html, query, limit = 8) {
  const $ = cheerio.load(html || '');
  const rows = [];
  $('.b_algo, .b_ans').each((_, element) => {
    const anchor = $(element).find('h2 a[href], a[href]').first();
    const url = unwrapSearchResultUrl(anchor.attr('href'), 'https://www.bing.com/search');
    const title = anchor.text().replace(/\s+/g, ' ').trim();
    const snippet = $(element).find('.b_caption p, p').first().text().replace(/\s+/g, ' ').trim();
    const image = $(element).find('img').first();
    const thumbnail = absolutize(bestMediaCandidate([image.attr('data-src'), image.attr('src')]), 'https://www.bing.com/search');
    if (!/^https?:\/\//i.test(url) || isSearchPageUrl(url)) return;
    if (!textMatchesQuery(`${title} ${snippet} ${url}`, query)) return;
    rows.push({ url, title: title || query, snippet, thumbnail: looksLikeImage(thumbnail) && !isLikelyUiAsset(thumbnail) ? thumbnail : '' });
  });
  return dedupeBy(rows, row => row.url).slice(0, limit);
}

function discoveredVideoPageCandidates(pages, query, sourceId) {
  return (pages || []).filter(result => looksLikeVideo(result.url)).map(result => enrichMedia({
    url: result.url,
    link: result.url,
    thumbnail: result.thumbnail || '',
    title: result.title || query,
    description: result.snippet || '',
    duration: 'Ouvrir la source',
    playback: 'external'
  }, query, sourceId, 'video'));
}

function isTrustedIdentityResultPage(rawUrl, pageTitle, query) {
  const queryKey = compactSearchTerm(query);
  if (!queryKey) return false;
  try {
    const parsed = new URL(rawUrl);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const lastSegment = compactSearchTerm(segments.at(-1) || '');
    const identityPath = /\/(?:tags?|users?|profiles?|models?|creators?|channels?|members?)(?:\/|$)/i.test(parsed.pathname);
    const exactProfilePath = segments.length === 1 && lastSegment === queryKey;
    const queryInPath = compactSearchTerm(parsed.pathname).includes(queryKey);
    const queryInTitle = compactSearchTerm(pageTitle).includes(queryKey);
    return (identityPath && queryInPath) || (exactProfilePath && queryInTitle);
  } catch {
    return false;
  }
}

async function crawlWebResultPages(pages, query, sourceId, options = {}) {
  const imageLimit = options.imageLimit || 35;
  const videoLimit = options.videoLimit || 20;
  const images = [];
  const videos = [];
  let crawled = 0;
  for (const result of pages) {
    try {
      const page = await fetchPage(result.url, { timeout: Math.min(Number(options.timeout) || 12000, 15000) });
      if (page.statusCode >= 400 || isSearchPageUrl(page.finalUrl)) continue;
      const $ = cheerio.load(page.html || '');
      const pageTitle = $('title').text().replace(/\s+/g, ' ').trim();
      if (!textMatchesQuery(`${result.title} ${result.snippet} ${pageTitle} ${page.finalUrl}`, query)) continue;
      const trustedIdentityPage = isTrustedIdentityResultPage(page.finalUrl, pageTitle, query);
      images.push(...extractImagesFromHtml(page.html, page.finalUrl, query, sourceId, imageLimit, { trustedContext: trustedIdentityPage, scanEmbeddedUrls: false }));
      videos.push(...extractLinksAsVideos(page.html, page.finalUrl, query, sourceId, videoLimit, { trustedContext: trustedIdentityPage }));
      if (looksLikeVideo(page.finalUrl)) {
        const poster = absolutize(bestMediaCandidate([
          $('meta[property="og:image"]').attr('content'),
          $('meta[name="twitter:image"]').attr('content'),
          $('video[poster]').first().attr('poster')
        ]), page.finalUrl);
        videos.push(enrichMedia({
          url: page.finalUrl,
          link: page.finalUrl,
          thumbnail: looksLikeImage(poster) ? poster : '',
          title: result.title || pageTitle || query,
          duration: 'Ouvrir la source'
        }, query, sourceId, 'video'));
      }
      crawled += 1;
    } catch {
      // A single blocked result must not suppress the other public pages.
    }
  }
  return {
    images: dedupeBestMedia(images).slice(0, imageLimit),
    videos: dedupeBestMedia(videos).slice(0, videoLimit),
    pagesDiscovered: pages.length,
    pagesCrawled: crawled
  };
}

async function scrapeDuckDuckGoHtmlFallback(query, options = {}) {
  const htmlSearch = await fetchPage(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    timeout: Math.min(Number(options.timeout) || 12000, 15000)
  });
  const pages = parseDuckDuckGoWebResults(htmlSearch.html, query, options.riskMode === 'cautious' ? 3 : 5);
  const crawled = await crawlWebResultPages(pages, query, 'duckduckgo', options);
  crawled.videos = dedupeBestMedia([...crawled.videos, ...discoveredVideoPageCandidates(pages, query, 'duckduckgo')]).slice(0, options.videoLimit || 20);
  return { ...crawled, httpStatus: htmlSearch.statusCode, pageSamples: pages.slice(0, 5).map(page => page.url) };
}

async function scrapeBingHtmlFallback(query, options = {}) {
  const safe = options.safe !== false;
  const htmlSearch = await fetchPage(`https://www.bing.com/search?q=${encodeURIComponent(query)}&adlt=${safe ? 'strict' : 'off'}`, {
    timeout: Math.min(Number(options.timeout) || 12000, 15000)
  });
  const pages = parseBingWebResults(htmlSearch.html, query, options.riskMode === 'cautious' ? 3 : 5);
  const crawled = await crawlWebResultPages(pages, query, 'bing', options);
  crawled.videos = dedupeBestMedia([...crawled.videos, ...discoveredVideoPageCandidates(pages, query, 'bing')]).slice(0, options.videoLimit || 20);
  return { ...crawled, httpStatus: htmlSearch.statusCode, pageSamples: pages.slice(0, 5).map(page => page.url) };
}

async function scrapeDedicatedPublicSource(sourceId, query, options = {}) {
  const imageLimit = options.imageLimit || 35;
  const videoLimit = options.videoLimit || 20;
  if (sourceId === 'duckduckgo') {
    let rawResults = [];
    let imageApiNote = '';
    try {
      const landing = await fetchPage(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`);
      const token = landing.html.match(/vqd=["']?([\d-]+)/i)?.[1] || landing.html.match(/vqd%3D([\d-]+)/i)?.[1];
      if (token) {
        const data = await fetchText(`https://duckduckgo.com/i.js?l=fr-fr&o=json&q=${encodeURIComponent(query)}&vqd=${encodeURIComponent(token)}&f=,,,,,&p=${options.safe === false ? '-1' : '1'}`, {
          headers: { referer: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`, accept: 'application/json' }
        });
        rawResults = Array.isArray(data?.results) ? data.results : [];
      } else {
        imageApiNote = `jeton image indisponible (HTTP ${landing.statusCode})`;
      }
    } catch (error) {
      imageApiNote = `endpoint image indisponible (${error.code || error.message})`;
    }
    const images = rawResults.slice(0, imageLimit).map(row => enrichMedia({
      url: row.image,
      thumbnail: row.thumbnail || row.image,
      link: row.url,
      title: row.title,
      width: row.width,
      height: row.height,
      description: row.title
    }, query, 'duckduckgo', 'image')).filter(item => item.url && item.confidenceScore >= 70 && !isLikelyUiAsset(item.url, item.title, item.width, item.height));
    let fallback = { images: [], videos: [], pagesDiscovered: 0, pagesCrawled: 0 };
    if (!images.length) {
      try {
        fallback = await scrapeDuckDuckGoHtmlFallback(query, options);
      } catch (error) {
        imageApiNote = [imageApiNote, `fallback HTML indisponible (${error.code || error.message})`].filter(Boolean).join('; ');
      }
    }
    const combinedImages = dedupeBestMedia([...images, ...fallback.images]).slice(0, imageLimit);
    const combinedVideos = dedupeBestMedia(fallback.videos).slice(0, videoLimit);
    const total = combinedImages.length + combinedVideos.length;
    return {
      images: combinedImages,
      videos: combinedVideos,
      status: {
        success: true,
        adapter: fallback.pagesDiscovered ? 'duckduckgo-images+html-fallback' : 'duckduckgo-images',
        imagesCount: combinedImages.length,
        videosCount: combinedVideos.length,
        rawCount: rawResults.length,
        filteredCount: Math.max(0, Math.min(rawResults.length, imageLimit) - images.length),
        pagesDiscovered: fallback.pagesDiscovered,
        pagesCrawled: fallback.pagesCrawled,
        discoveredPageSamples: fallback.pageSamples || [],
        accounts: fallback.pageSamples || [],
        note: ['Endpoint public DuckDuckGo Images', fallback.pagesDiscovered ? `${fallback.pagesDiscovered} pages web, ${fallback.pagesCrawled} ouvertes` : '', imageApiNote].filter(Boolean).join('; '),
        zeroReason: total ? '' : (rawResults.length ? 'results_filtered_by_relevance' : (fallback.pagesDiscovered ? 'public_pages_without_matching_media' : 'no_upstream_results'))
      }
    };
  }

  if (sourceId === 'reddit') {
    const data = await fetchText(`https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=${Math.min(imageLimit + videoLimit, 50)}&raw_json=1`, { headers: { accept: 'application/json' } });
    const images = [];
    const videos = [];
    for (const child of data?.data?.children || []) {
      const row = child?.data || {};
      if (!textMatchesQuery(`${row.title} ${row.author} ${row.subreddit_name_prefixed}`, query)) continue;
      const link = row.permalink ? `https://www.reddit.com${row.permalink}` : row.url;
      const preview = row.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, '&') || row.thumbnail;
      const videoUrl = row.secure_media?.reddit_video?.fallback_url || row.media?.reddit_video?.fallback_url;
      if (videoUrl) videos.push(enrichMedia({ url: videoUrl, thumbnail: preview, link, title: row.title, accountUrl: row.author ? `https://www.reddit.com/user/${row.author}` : '', duration: formatDuration(row.secure_media?.reddit_video?.duration) }, query, 'reddit', 'video'));
      else if (preview && /^https?:/i.test(preview)) images.push(enrichMedia({ url: preview, thumbnail: preview, link, title: row.title, accountUrl: row.author ? `https://www.reddit.com/user/${row.author}` : '' }, query, 'reddit', 'image'));
    }
    return { images: images.slice(0, imageLimit), videos: videos.slice(0, videoLimit), status: { success: true, adapter: 'reddit-json', imagesCount: images.length, videosCount: videos.length, note: 'Recherche JSON publique Reddit', zeroReason: images.length + videos.length ? '' : 'no_matching_public_media' } };
  }

  if (sourceId === 'wikimedia') {
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=${imageLimit}&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=1200&format=json&origin=*`;
    const data = await fetchText(url);
    const images = Object.values(data?.query?.pages || {}).map(page => {
      const info = page.imageinfo?.[0] || {};
      return enrichMedia({ url: info.url, thumbnail: info.thumburl || info.url, link: info.descriptionurl, title: page.title?.replace(/^File:/i, ''), width: info.width, height: info.height, description: page.title }, query, 'wikimedia', 'image');
    }).filter(item => item.url && item.confidenceScore >= 70);
    return { images, videos: [], status: { success: true, adapter: 'wikimedia-api', imagesCount: images.length, videosCount: 0, note: 'API Wikimedia Commons' } };
  }

  if (sourceId === 'flickr') {
    const apiKey = connectionValue('flickr', 'apiKey', 'FLICKR_API_KEY');
    const url = apiKey
      ? `https://www.flickr.com/services/rest/?method=flickr.photos.search&api_key=${encodeURIComponent(apiKey)}&text=${encodeURIComponent(query)}&per_page=${imageLimit}&extras=url_o,url_k,url_h,url_l,url_c,owner_name,description&format=json&nojsoncallback=1`
      : `https://www.flickr.com/services/feeds/photos_public.gne?tags=${encodeURIComponent(query)}&tagmode=all&format=json&nojsoncallback=1`;
    const data = await fetchText(url);
    const rawRows = apiKey ? (data?.photos?.photo || []) : (data?.items || []);
    const images = rawRows.map(row => {
      const original = row.url_o || row.url_k || row.url_h || row.url_l || row.url_c || row.media?.m;
      const link = row.link || (row.id ? `https://www.flickr.com/photos/${row.owner}/${row.id}` : '');
      const title = row.title || row.ownername || '';
      return enrichMedia({ url: original, thumbnail: original, link, title, description: row.description?._content || row.tags }, query, 'flickr', 'image');
    }).filter(item => item.url && item.confidenceScore >= 70);
    return { images, videos: [], status: { success: true, adapter: apiKey ? 'flickr-api' : 'flickr-public-feed', imagesCount: images.length, videosCount: 0, note: apiKey ? 'API Flickr configuree' : 'Flux public Flickr' } };
  }

  if (sourceId === 'dailymotion') {
    const url = `https://api.dailymotion.com/videos?search=${encodeURIComponent(query)}&fields=id,title,thumbnail_720_url,url,duration&limit=${videoLimit}`;
    const data = await fetchText(url);
    const videos = (data?.list || []).map(row => enrichMedia({ url: row.url, link: row.url, thumbnail: row.thumbnail_720_url, title: row.title, duration: formatDuration(row.duration) }, query, 'dailymotion', 'video')).filter(item => item.confidenceScore >= 70);
    return { images: [], videos, status: { success: true, adapter: 'dailymotion-api', imagesCount: 0, videosCount: videos.length, note: 'API publique Dailymotion' } };
  }

  if (sourceId === 'youtube') {
    const apiKey = connectionValue('youtube', 'apiKey', 'YOUTUBE_API_KEY');
    if (apiKey) {
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=${videoLimit}&q=${encodeURIComponent(query)}&key=${encodeURIComponent(apiKey)}`;
      const data = await fetchText(url);
      const videos = (data?.items || []).map(row => {
        const id = row.id?.videoId;
        const link = `https://www.youtube.com/watch?v=${id}`;
        return enrichMedia({ url: link, link, embedUrl: `https://www.youtube.com/embed/${id}`, thumbnail: row.snippet?.thumbnails?.high?.url, title: row.snippet?.title, description: row.snippet?.description, duration: 'YouTube' }, query, 'youtube', 'video');
      }).filter(item => item.url && item.confidenceScore >= 70);
      return { images: [], videos, status: { success: true, adapter: 'youtube-api', imagesCount: 0, videosCount: videos.length, note: 'YouTube Data API' } };
    }
    const page = await fetchPage(sourceSearchUrls('youtube', query, options)[0]);
    const videos = parseYoutubeResults(page.html, query, videoLimit);
    return { images: [], videos, status: { success: page.statusCode < 400, adapter: 'youtube-public', imagesCount: 0, videosCount: videos.length, note: `Page publique YouTube HTTP ${page.statusCode}`, zeroReason: videos.length ? '' : 'no_matching_public_media' } };
  }

  if (sourceId === 'bing') {
    const page = await fetchPage(sourceSearchUrls('bing', query, options)[0]);
    const images = parseBingImageResults(page.html, query, imageLimit);
    let fallback = { images: [], videos: [], pagesDiscovered: 0, pagesCrawled: 0 };
    if (!images.length) {
      try { fallback = await scrapeBingHtmlFallback(query, options); } catch { /* Diagnostic below remains explicit. */ }
    }
    const combinedImages = dedupeBestMedia([...images, ...fallback.images]).slice(0, imageLimit);
    const combinedVideos = dedupeBestMedia(fallback.videos).slice(0, videoLimit);
    const total = combinedImages.length + combinedVideos.length;
    return {
      images: combinedImages,
      videos: combinedVideos,
      status: {
        success: page.statusCode < 400,
        adapter: fallback.pagesDiscovered ? 'bing-images+web-fallback' : 'bing-images',
        imagesCount: combinedImages.length,
        videosCount: combinedVideos.length,
        pagesDiscovered: fallback.pagesDiscovered,
        pagesCrawled: fallback.pagesCrawled,
        discoveredPageSamples: fallback.pageSamples || [],
        accounts: fallback.pageSamples || [],
        note: [`Bing Images HTTP ${page.statusCode}`, fallback.pagesDiscovered ? `${fallback.pagesDiscovered} pages web, ${fallback.pagesCrawled} ouvertes` : ''].filter(Boolean).join('; '),
        zeroReason: total ? '' : (fallback.pagesDiscovered ? 'public_pages_without_matching_media' : 'no_matching_public_media')
      }
    };
  }

  if (sourceId === 'google') {
    const apiKey = connectionValue('google', 'apiKey', 'GOOGLE_API_KEY');
    const cx = connectionValue('google', 'cx', 'GOOGLE_CX');
    if (!apiKey || !cx) return { images: [], videos: [], status: { success: false, skipped: true, adapter: 'google-cse', imagesCount: 0, videosCount: 0, zeroReason: 'missing_credentials', note: 'Cle Google et CX requis dans Connexions API' } };
    const data = await fetchText(`https://www.googleapis.com/customsearch/v1?searchType=image&num=10&q=${encodeURIComponent(query)}&key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cx)}`);
    const images = (data?.items || []).map(row => enrichMedia({ url: row.link, thumbnail: row.image?.thumbnailLink || row.link, link: row.image?.contextLink, title: row.title, width: row.image?.width, height: row.image?.height, description: row.snippet }, query, 'google', 'image')).filter(item => item.confidenceScore >= 70);
    return { images, videos: [], status: { success: true, adapter: 'google-cse', imagesCount: images.length, videosCount: 0, note: 'Google Custom Search API' } };
  }

  if (sourceId === 'brave') {
    const apiKey = connectionValue('brave', 'apiKey', 'BRAVE_API_KEY');
    if (!apiKey) return { images: [], videos: [], status: { success: false, skipped: true, adapter: 'brave-api', imagesCount: 0, videosCount: 0, zeroReason: 'missing_credentials', note: 'Cle Brave Search API requise' } };
    const data = await fetchText(`https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=${Math.min(imageLimit, 20)}`, { headers: { 'X-Subscription-Token': apiKey, accept: 'application/json' } });
    const images = (data?.results || []).map(row => enrichMedia({ url: row.properties?.url || row.url, thumbnail: row.thumbnail?.src, link: row.source, title: row.title, width: row.properties?.width, height: row.properties?.height }, query, 'brave', 'image')).filter(item => item.url && item.confidenceScore >= 70);
    return { images, videos: [], status: { success: true, adapter: 'brave-api', imagesCount: images.length, videosCount: 0, note: 'Brave Search API' } };
  }

  return null;
}

async function scrapeGenericSource(sourceId, query, options = {}) {
  const dedicated = await scrapeDedicatedPublicSource(sourceId, query, options);
  if (dedicated) return dedicated;
  const images = [];
  const videos = [];
  const pages = [];
  const notes = [];
  const urls = sourceSearchUrls(sourceId, query, options);
  for (const url of urls) {
    const page = await fetchPage(url, { timeout: options.timeout || 14000 });
    notes.push(`${new URL(url).hostname}: HTTP ${page.statusCode}`);
    if (page.statusCode >= 400) continue;
    const $ = cheerio.load(page.html || '');
    const pageTitle = $('meta[property="og:title"]').attr('content') || $('title').text().replace(/\s+/g, ' ').trim();
    const trustedContext = hostMatchesSource(page.finalUrl, sourceId) && isTrustedIdentityResultPage(page.finalUrl, pageTitle, query);
    const isDirectSourcePage = hostMatchesSource(page.finalUrl, sourceId);
    const pageImages = isDirectSourcePage
      ? extractImagesFromHtml(page.html, page.finalUrl, query, sourceId, options.imageLimit || 35, { trustedContext, scanEmbeddedUrls: false })
      : [];
    const pageVideos = isDirectSourcePage
      ? extractLinksAsVideos(page.html, page.finalUrl, query, sourceId, options.videoLimit || 20, { trustedContext })
      : [];
    const pageLinks = extractSearchResultPages(page.html, page.finalUrl, query, sourceId, 20);
    images.push(...pageImages);
    videos.push(...pageVideos);
    pages.push(...pageLinks);
    if (images.length + videos.length >= 8 && !NSFW_SOURCES.has(sourceId)) break;
  }
  const uniquePages = dedupeBy(pages, item => item.url).slice(0, 6);
  const crawled = uniquePages.length
    ? await crawlWebResultPages(uniquePages, query, sourceId, options)
    : { images: [], videos: [], pagesDiscovered: 0, pagesCrawled: 0 };
  images.push(...crawled.images);
  videos.push(...crawled.videos, ...discoveredVideoPageCandidates(uniquePages, query, sourceId));
  const uniqueImages = dedupeBestMedia(images).slice(0, options.imageLimit || 35);
  const uniqueVideos = dedupeBestMedia(videos).slice(0, options.videoLimit || 20);
  const note = uniqueImages.length + uniqueVideos.length
    ? `scan public; ${notes.join('; ')}`
    : `0 media public extractible; ${notes.join('; ')}; site possiblement JS, login ou anti-bot`;
  return { images: uniqueImages, videos: uniqueVideos, status: {
    success: true,
    note,
    imagesCount: uniqueImages.length,
    videosCount: uniqueVideos.length,
    pagesDiscovered: crawled.pagesDiscovered,
    pagesCrawled: crawled.pagesCrawled,
    pageSamples: uniquePages.map(page => ({ url: page.url, title: page.title })).slice(0, 6),
    zeroReason: uniqueImages.length + uniqueVideos.length ? '' : 'no_public_media_extracted'
  } };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const queue = [...items.entries()];
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    while (queue.length) {
      const [index, item] = queue.shift();
      await mapper(item, index);
    }
  });
  await Promise.all(workers);
}

function filterBySearchMode(items, mode = 'strict') {
  const threshold = mode === 'broad' ? 20 : (mode === 'smart' ? 50 : 70);
  return (items || []).filter(item => Number(item.confidenceScore || 0) >= threshold);
}

function filterByMediaMetadata(items, options = {}) {
  return (items || []).filter(item => {
    const width = Number(item.width) || 0;
    const height = Number(item.height) || 0;
    const largestSide = Math.max(width, height);
    if (options.size === 'Small' && largestSide && largestSide > 640) return false;
    if (options.size === 'Medium' && largestSide && (largestSide < 640 || largestSide > 1600)) return false;
    if (options.size === 'Large' && largestSide && largestSide < 1200) return false;
    if (options.size === 'Wallpaper' && width && height && (width < 1600 || width <= height)) return false;
    if (options.type === 'gif' && !/\.gif(?:[?#]|$)/i.test(item.url || '')) return false;
    if (options.type === 'photo' && /\.gif(?:[?#]|$)/i.test(item.url || '')) return false;
    return true;
  });
}

function discoverAliases(query, images = [], videos = [], status = {}) {
  const queryKey = compactSearchTerm(query);
  const aliases = new Map();
  const directProfileSources = new Set(['instagram', 'facebook', 'tiktok', 'x', 'pinterest', 'telegram', 'onlyfans', 'fansly', 'mym']);
  const nestedProfilePrefixes = new Set(['user', 'users', 'u', 'profile', 'profiles', 'channel', 'channels', 'c', 's']);
  const nonProfileSegments = new Set([
    'search', 'results', 'watch', 'video', 'videos', 'embed', 'threads', 'thread', 'topic', 'main',
    'showthread.php', 'p', 'pin', 'reel', 'reels', 'stories', 'explore', 'status', 'photo', 'photos',
    'media', 'groups', 'r', 'home', 'hashtag', 'accounts', 'legal', 'about', 'directory', 'challenge'
  ]);
  const genericLabels = new Set([
    'photo', 'photos', 'video', 'videos', 'media', 'profile', 'profil', 'search', 'result', 'results',
    'instagram', 'facebook', 'tiktok', 'twitter', 'onlyfans', 'fansly', 'reddit', 'pinterest', 'youtube'
  ]);
  const addAlias = (rawValue, kind, sourceId, evidence, confidence) => {
    let value = repairMojibake(String(rawValue || ''))
      .replace(/\s+/g, ' ')
      .replace(/^[\s|\-:]+|[\s|\-:]+$/g, '')
      .trim();
    if (kind === 'username') value = `@${value.replace(/^@+/, '')}`;
    const normalized = normalizeSearchTerm(value.replace(/^@/, ''));
    if (!value || value.length < 2 || value.length > 72 || genericLabels.has(normalized)) return;
    if (!/[a-z0-9]/i.test(value) || /https?:\/\//i.test(value)) return;
    if (kind === 'username' && compactSearchTerm(value) === queryKey) return;
    const key = `${kind}:${normalized}`;
    const current = aliases.get(key) || { value, kind, count: 0, sources: [], evidence: [], confidence: 0 };
    current.count += 1;
    current.confidence = Math.max(current.confidence, confidence);
    current.sources = uniq([...current.sources, sourceId]).slice(0, 8);
    current.evidence = uniq([...current.evidence, evidence]).slice(0, 4);
    aliases.set(key, current);
  };
  const addProfileAlias = (rawUrl, sourceId, evidence, explicitAccountUrl = false) => {
    try {
      const parsed = new URL(String(rawUrl || ''));
      const segments = parsed.pathname.split('/').filter(Boolean);
      const first = decodeURIComponent(segments[0] || '').replace(/^@/, '');
      const candidate = nestedProfilePrefixes.has(first.toLowerCase()) && segments[1]
        ? decodeURIComponent(segments[1]).replace(/^@/, '')
        : first;
      if (candidate && !nonProfileSegments.has(candidate.toLowerCase()) && /^[a-z0-9._-]{2,32}$/i.test(candidate)) {
        addAlias(`@${candidate}`, 'username', sourceId, evidence || rawUrl, explicitAccountUrl ? 88 : 82);
      }
    } catch {
      // Some candidates have no usable public profile URL.
    }
  };

  [...images, ...videos].forEach(item => {
    const sourceId = item.sourceId || normalizeSearchTerm(item.source || 'source');
    const title = String(item.title || '').replace(/\s+/g, ' ').trim();
    const context = `${title} ${item.description || ''} ${item.link || ''} ${item.accountUrl || ''}`;
    if (!textMatchesQuery(context, query)) return;

    const pairedIdentity = title.match(/^(.{2,60}?)\s*\(@([a-z0-9._-]{2,32})\)/i);
    if (pairedIdentity) {
      addAlias(pairedIdentity[1], 'display_name', sourceId, title, compactSearchTerm(pairedIdentity[2]) === queryKey ? 98 : 90);
      addAlias(`@${pairedIdentity[2]}`, 'username', sourceId, title, 94);
    }

    for (const match of context.matchAll(/(?:^|\s)@([a-z0-9._-]{2,32})\b/gi)) {
      addAlias(`@${match[1]}`, 'username', sourceId, title || item.link || item.url, 86);
    }

    const explicitAccountUrl = String(item.accountUrl || '').trim();
    const profileUrl = explicitAccountUrl || (directProfileSources.has(sourceId) ? item.link : '');
    addProfileAlias(profileUrl, sourceId, profileUrl, Boolean(explicitAccountUrl));
  });

  Object.entries(status || {}).forEach(([sourceId, sourceStatus]) => {
    (sourceStatus.pageSamples || []).forEach(sample => {
      const page = typeof sample === 'string' ? { url: sample, title: '' } : sample;
      const title = repairMojibake(String(page.title || '')).replace(/\s+/g, ' ').trim();
      let pathname = '';
      try { pathname = decodeURIComponent(new URL(String(page.url || '')).pathname); } catch { pathname = ''; }
      if (!textMatchesQuery(title, query) && !textMatchesQuery(pathname, query)) return;
      const context = `${title} ${pathname}`;
      const pairedIdentity = title.match(/^(.{2,60}?)\s*\(@([a-z0-9._-]{2,32})\)/i);
      if (pairedIdentity) {
        addAlias(pairedIdentity[1], 'display_name', sourceId, title, compactSearchTerm(pairedIdentity[2]) === queryKey ? 98 : 90);
        addAlias(`@${pairedIdentity[2]}`, 'username', sourceId, title, 94);
      }
      for (const match of context.matchAll(/(?:^|\s)@([a-z0-9._-]{2,32})\b/gi)) {
        addAlias(`@${match[1]}`, 'username', sourceId, title || page.url, 86);
      }
      if (directProfileSources.has(sourceId)) addProfileAlias(page.url, sourceId, title || page.url);
    });
    (sourceStatus.accounts || []).forEach(accountUrl => {
      if (compactSearchTerm(accountUrl).includes(queryKey)) addProfileAlias(accountUrl, sourceId, accountUrl, true);
    });
  });

  return [...aliases.values()]
    .sort((a, b) => b.confidence - a.confidence || b.sources.length - a.sources.length || b.count - a.count)
    .slice(0, 24);
}

function sourceHealthFromStatus(sourceId, sourceStatus) {
  const total = Number(sourceStatus.imagesCount || 0) + Number(sourceStatus.videosCount || 0);
  let state = 'empty';
  if (sourceStatus.skipped) state = 'configuration_required';
  else if (!sourceStatus.success) state = sourceStatus.zeroReason || 'error';
  else if (total && (sourceStatus.fallbackUsed || sourceStatus.directReachable === false)) state = 'degraded';
  else if (total) state = 'operational';
  return {
    sourceId,
    state,
    lastTest: new Date().toISOString(),
    ...sourceStatus
  };
}

async function scrapeImageSearchWithFallback(query, sources, options = {}) {
  const images = [];
  const videos = [];
  const status = {};
  const safe = options.safe !== false;
  const selected = uniq(String(sources || 'duckduckgo').split(',')).filter(Boolean).slice(0, SOURCE_IDS.length);
  const concurrency = options.riskMode === 'balanced' ? 3 : 1;

  await mapWithConcurrency(selected, concurrency, async (sourceId, index) => {
    if (index && options.riskMode !== 'balanced') await new Promise(resolve => setTimeout(resolve, 400));
    if (!SOURCE_META[sourceId]) {
      status[sourceId] = { success: false, error: 'source inconnue', imagesCount: 0, videosCount: 0 };
      return;
    }
    if (safe && NSFW_SOURCES.has(sourceId)) {
      status[sourceId] = { success: false, skipped: true, error: 'bloque par SafeSearch', imagesCount: 0, videosCount: 0 };
      return;
    }
    try {
      const result = NSFW_ADAPTERS[sourceId]
        ? await scrapeNsfwSource(sourceId, query, options)
        : await scrapeGenericSource(sourceId, query, options);
      images.push(...result.images);
      videos.push(...result.videos);
      status[sourceId] = result.status;
    } catch (error) {
      status[sourceId] = { success: false, error: error.message, imagesCount: 0, videosCount: 0, zeroReason: error.status === 429 ? 'rate_limited' : 'request_failed' };
    }
    SOURCE_HEALTH.set(sourceId, sourceHealthFromStatus(sourceId, status[sourceId]));
  });

  mutateStore(store => {
    store.sourceDiagnostics = store.sourceDiagnostics || {};
    Object.entries(status).forEach(([sourceId, sourceStatus]) => {
      store.sourceDiagnostics[sourceId] = sourceHealthFromStatus(sourceId, sourceStatus);
    });
  });

  const relevantImages = filterByMediaMetadata(filterBySearchMode(images, options.matchMode), options);
  const relevantVideos = filterBySearchMode(videos, options.matchMode);

  const uniqueRelevantImages = dedupeBestMedia(relevantImages);
  const uniqueRelevantVideos = dedupeBestMedia(relevantVideos);
  return {
    success: true,
    query,
    images: uniqueRelevantImages,
    videos: uniqueRelevantVideos,
    aliases: discoverAliases(query, uniqueRelevantImages, uniqueRelevantVideos, status),
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
  const text = normalizeSearchTerm([item?.title, item?.description, item?.accountUrl, item?.url, isSearchPageUrl(item?.link) ? '' : item?.link].filter(Boolean).join(' '));
  const identities = uniq([person.displayName, person.name, ...(person.aliases || []), ...(person.usernames || [])]).map(normalizeSearchTerm).filter(Boolean);
  const positives = uniq(person.positiveKeywords || []).map(normalizeSearchTerm).filter(Boolean);
  const negatives = uniq(person.excludeKeywords || []).map(normalizeSearchTerm).filter(Boolean);
  const evidence = [];
  let score = Number(item.confidenceScore || 20);
  const identity = identities.find(term => term && text.includes(term));
  if (identity) {
    score = Math.max(score, 88);
    evidence.push(`identite retrouvee: ${identity}`);
  } else {
    score = Math.min(score, 55);
    evidence.push('identite non confirmee');
  }
  const positiveHits = positives.filter(term => term && text.includes(term));
  if (positiveHits.length) {
    score += Math.min(10, positiveHits.length * 3);
    evidence.push(`contexte associe: ${positiveHits.slice(0, 3).join(', ')}`);
  }
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
    version: APP_VERSION,
    storage: {
      mode: 'json',
      persistent: !IS_VOLATILE_STORAGE,
      warning: IS_VOLATILE_STORAGE ? 'Stockage Vercel temporaire; configurez un volume durable ou utilisez le mode local.' : null,
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
      queue: 'synchronous-worker',
      connections: 'session-or-environment',
      desktop: 'node-standalone-build'
    }
  });
});

app.get('/api/storage/status', (req, res) => {
  const store = readStore();
  res.json({ mode: 'json', persistent: !IS_VOLATILE_STORAGE, volatile: IS_VOLATILE_STORAGE, path: process.env.VERCEL ? null : STORE_PATH, exportDir: process.env.VERCEL ? null : EXPORT_DIR, counts: {
    history: store.history.length,
    collection: store.collection.length,
    persons: store.persons.length,
    personMediaLinks: store.personMediaLinks.length
  } });
});

app.get('/api/search', searchLimiter, async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) return res.status(400).json({ error: 'Parametre q requis' });
  if (query.length > 160) return res.status(400).json({ error: 'Requete trop longue' });
  const sources = uniq(String(req.query.sources || 'duckduckgo').split(',')).filter(source => SOURCE_META[source]).join(',') || 'duckduckgo';
  const options = {
    safe: String(req.query.safe || 'true') !== 'false',
    mediaKind: req.query.media || 'both',
    matchMode: ['strict', 'smart', 'broad'].includes(req.query.mode) ? req.query.mode : 'strict',
    riskMode: req.query.risk === 'balanced' ? 'balanced' : 'cautious',
    size: ['Small', 'Medium', 'Large', 'Wallpaper'].includes(req.query.size) ? req.query.size : '',
    type: ['photo', 'gif'].includes(req.query.type) ? req.query.type : ''
  };
  const cacheKey = stableHash({ version: CACHE_SCHEMA_VERSION, query, sources, ...options });
  const recordHistory = req.query.record !== 'false';
  const store = readStore();
  const cached = store.cache?.[cacheKey];
  if (!req.query.fresh && cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    let historyEntry = null;
    if (recordHistory) {
      historyEntry = { id: makeId('hist'), query, sources: sources.split(','), createdAt: new Date().toISOString(), imagesCount: cached.payload.images.length, videosCount: cached.payload.videos.length, options, cached: true };
      mutateStore(latestStore => {
        latestStore.history.unshift(historyEntry);
        latestStore.history = latestStore.history.slice(0, 200);
      });
    }
    return res.json({ ...cached.payload, cached: true, historyEntry });
  }
  const payload = await scrapeImageSearchWithFallback(query, sources, options);
  filterMediaKind(payload, options.mediaKind);
  let historyEntry = null;
  mutateStore(latestStore => {
    latestStore.cache[cacheKey] = { key: cacheKey, createdAt: Date.now(), query, sources, payload };
    if (recordHistory) {
      historyEntry = { id: makeId('hist'), query, sources: sources.split(','), createdAt: new Date().toISOString(), imagesCount: payload.images.length, videosCount: payload.videos.length, options };
      latestStore.history.unshift(historyEntry);
      latestStore.history = latestStore.history.slice(0, 200);
    }
  });
  res.json({ ...payload, historyEntry });
});

app.get('/api/wayback/hosts', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ domains: [] });
  const blockedDomains = ['bing.com', 'duckduckgo.com', 'google.com', 'search.brave.com', 'youtube.com', 'flickr.com', 'wikimedia.org', 'mediawiki.org', 'gstatic.com', 'googleusercontent.com'];
  const normalizeHost = value => {
    try {
      const candidate = /^https?:\/\//i.test(String(value || '')) ? String(value) : `https://${String(value || '')}`;
      const host = new URL(candidate).hostname.replace(/^www\./, '').toLowerCase();
      if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(host)) return null;
      if (blockedDomains.some(domain => host === domain || host.endsWith(`.${domain}`))) return null;
      return host;
    } catch { return null; }
  };

  let officialDomains = [];
  let officialError = '';
  try {
    const hostData = await fetchText(`https://web.archive.org/__wb/search/host?q=${encodeURIComponent(q)}`, { timeout: 15000 });
    officialDomains = (hostData?.hosts || []).map(host => normalizeHost(host.display_name || host.host || host.url)).filter(Boolean);
  } catch (error) {
    officialError = error.message;
  }

  let engineDomains = [];
  if (!officialDomains.length) {
    const result = await scrapeImageSearchWithFallback(q, 'duckduckgo,bing', { safe: true, matchMode: 'strict', riskMode: 'cautious' });
    engineDomains = [...result.images, ...result.videos].map(item => normalizeHost(item.link || item.url)).filter(Boolean);
  }
  const compactQuery = compactSearchTerm(q);
  const domains = uniq([...officialDomains, ...engineDomains])
    .sort((a, b) => Number(compactSearchTerm(b).includes(compactQuery)) - Number(compactSearchTerm(a).includes(compactQuery)))
    .slice(0, 12);
  res.json({
    query: q,
    domains,
    diagnostics: {
      officialWaybackHosts: officialDomains.length,
      engineCandidates: engineDomains.length,
      engineFallbackUsed: officialDomains.length === 0,
      officialError: officialError || null
    }
  });
});

app.get('/api/wayback/cdx', async (req, res) => {
  const domain = String(req.query.domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  if (!domain) return res.status(400).json({ error: 'domain requis' });
  if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain)) return res.status(400).json({ error: 'domain invalide' });
  try {
    const url = `https://web.archive.org/cdx/search/cdx?url=*.${encodeURIComponent(domain)}/*&output=json&fl=original,timestamp,mimetype&filter=statuscode:200&collapse=urlkey&limit=1000`;
    const rows = await fetchText(url, { timeout: 35000 });
    const parsed = Array.isArray(rows) ? rows.slice(1) : [];
    const images = [];
    const videos = [];
    let filteredUiAssets = 0;
    parsed.forEach(row => {
      const original = row[0];
      const timestamp = row[1];
      const mimetype = row[2] || '';
      if (!original || !timestamp) return;
      if (mimetype.startsWith('image') && isLikelyUiAsset(original, original)) {
        filteredUiAssets += 1;
        return;
      }
      const archived = `https://web.archive.org/web/${timestamp}if_/${original}`;
      const item = enrichMedia({ url: archived, thumbnail: archived, link: `https://web.archive.org/web/${timestamp}/${original}`, title: original, trustedContext: true, archivedDomain: domain }, req.query.q || domain, 'wayback', mimetype.startsWith('video') ? 'video' : 'image');
      if (mimetype.startsWith('video')) videos.push(item); else if (mimetype.startsWith('image')) images.push(item);
    });
    const uniqueImages = dedupeBestMedia(images).slice(0, 1000);
    const uniqueVideos = dedupeBestMedia(videos).slice(0, 250);
    res.json({
      success: true,
      domain,
      images: uniqueImages,
      videos: uniqueVideos,
      diagnostics: {
        rowsReceived: parsed.length,
        snapshotCount: new Set(parsed.map(row => row?.[1]).filter(Boolean)).size,
        filteredUiAssets,
        nameFilterApplied: false,
        truncated: images.length > uniqueImages.length || videos.length > uniqueVideos.length
      }
    });
  } catch (error) {
    const status = /(URL|bloqu|interdit|local|privee|Port)/i.test(error.message) ? 400 : 502;
    res.status(status).json({ success: false, error: error.message, images: [], videos: [] });
  }
});

async function searchArchiveOrg(req, res) {
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
    res.json({ success: true, source: 'archive.org', images, videos });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message, images: [], videos: [] });
  }
}
app.get('/api/archive/search', searchArchiveOrg);
app.get('/api/wayback/archive', (req, res) => {
  res.setHeader('deprecation', 'true');
  return searchArchiveOrg(req, res);
});

app.get('/api/account/scrape', searchLimiter, async (req, res) => {
  const requestedUrl = String(req.query.url || '');
  try {
    const url = await validatePublicMediaUrl(requestedUrl);
    const page = await fetchPage(url, { timeout: 15000 });
    const query = String(req.query.q || '').trim();
    const accountMode = req.query.accountMode === 'strict' ? 'strict' : 'complete';
    const sourceId = SOURCE_IDS.find(id => hostMatchesSource(page.finalUrl, id)) || 'account';
    const extractionQuery = accountMode === 'strict' ? query : '';
    const rescore = item => {
      const candidate = { ...item, trustedContext: accountMode === 'complete', link: page.finalUrl };
      delete candidate.confidenceScore;
      delete candidate.confidenceLabel;
      delete candidate.matchReasons;
      return enrichMedia(candidate, query || new URL(page.finalUrl).hostname, sourceId, inferMediaType(candidate));
    };
    let images = extractImagesFromHtml(page.html, page.finalUrl, extractionQuery, sourceId, 120).map(rescore);
    let videos = extractLinksAsVideos(page.html, page.finalUrl, extractionQuery, sourceId, 80).map(rescore);
    if (accountMode === 'strict') {
      images = filterBySearchMode(images, 'strict');
      videos = filterBySearchMode(videos, 'strict');
    }
    const payload = {
      success: true,
      images,
      videos,
      status: { [sourceId]: { success: true, adapter: 'public-account', imagesCount: images.length, videosCount: videos.length, note: `page publique scannee en mode ${accountMode}` } }
    };
    filterMediaKind(payload, req.query.media || 'both');
    res.json(payload);
  } catch (error) {
    const status = /(URL|bloqu|interdit|local|privee|Port)/i.test(error.message) ? 400 : 502;
    res.status(status).json({ success: false, error: error.message, images: [], videos: [] });
  }
});

app.get('/api/proxy', proxyLimiter, async (req, res) => {
  try {
    const upstream = await requestPublicUrl(req.query.url, {
      responseType: 'stream',
      timeout: 18000,
      redirectLimit: 3,
      maxContentLength: MAX_PROXY_BYTES,
      maxBodyLength: MAX_PROXY_BYTES,
      headers: {
        accept: 'image/avif,image/webp,image/apng,image/*,video/*,*/*;q=0.8'
      }
    });
    if (upstream.status >= 400) return res.status(upstream.status).json({ error: `Media distant HTTP ${upstream.status}` });
    const contentType = String(upstream.headers['content-type'] || 'application/octet-stream').toLowerCase();
    if (!/^(image|video)\//.test(contentType) && contentType !== 'application/octet-stream') {
      upstream.data.destroy();
      return res.status(415).json({ error: 'Type media non supporte' });
    }
    const maxBytes = MAX_PROXY_BYTES;
    let bytes = 0;
    res.setHeader('content-type', contentType);
    res.setHeader('cache-control', 'public, max-age=86400');
    upstream.data.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        upstream.data.destroy();
        res.destroy(new Error('Media trop volumineux'));
      }
    });
    upstream.data.on('error', error => {
      if (!res.headersSent) res.status(502).json({ error: error.message });
    });
    upstream.data.pipe(res);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const CONNECTION_PROVIDERS = {
  youtube: { label: 'YouTube Data API', env: ['YOUTUBE_API_KEY'], unlocks: 'Recherche officielle de videos publiques', fields: [{ name: 'apiKey', label: 'API key', type: 'password', required: true }] },
  flickr: { label: 'Flickr API', env: ['FLICKR_API_KEY'], unlocks: 'Recherche officielle de photos publiques', fields: [{ name: 'apiKey', label: 'API key', type: 'password', required: true }] },
  google: { label: 'Google Custom Search', env: ['GOOGLE_API_KEY', 'GOOGLE_CX'], unlocks: 'Recherche Google Images officielle', fields: [{ name: 'apiKey', label: 'API key', type: 'password', required: true }, { name: 'cx', label: 'Search CX', type: 'text', required: true }] },
  brave: { label: 'Brave Search API', env: ['BRAVE_API_KEY'], unlocks: 'Recherche Brave Images officielle', fields: [{ name: 'apiKey', label: 'API key', type: 'password', required: true }] },
  telegram: { label: 'Telegram', env: [], unlocks: 'Non disponible: OAuth/session MTProto non integre', fields: [], available: false }
};

function providerConfigured(id, definition) {
  if (SESSION_CONNECTIONS.has(id)) return true;
  return definition.env.length > 0 && definition.env.every(name => Boolean(process.env[name]));
}

app.get('/api/connections/providers', (req, res) => {
  res.json({ providers: Object.entries(CONNECTION_PROVIDERS).map(([id, definition]) => ({
    id,
    label: definition.label,
    configured: providerConfigured(id, definition),
    available: definition.available !== false,
    storage: SESSION_CONNECTIONS.has(id) ? 'session-memory' : (providerConfigured(id, definition) ? 'environment' : 'none'),
    unlocks: definition.unlocks,
    fields: definition.fields
  })) });
});

app.post('/api/connections/:id', (req, res) => {
  const definition = CONNECTION_PROVIDERS[req.params.id];
  if (!definition) return res.status(404).json({ error: 'Fournisseur inconnu' });
  if (definition.available === false) return res.status(501).json({ error: definition.unlocks });
  const credentials = {};
  for (const field of definition.fields) {
    const value = String(req.body?.[field.name] || '').trim();
    if (field.required && !value) return res.status(400).json({ error: `${field.label} requis` });
    credentials[field.name] = value;
  }
  SESSION_CONNECTIONS.set(req.params.id, credentials);
  return res.json({ ok: true, provider: req.params.id, storage: 'session-memory', note: 'Identifiants conserves uniquement dans la memoire de cette instance.' });
});

app.post('/api/connections/:id/test', async (req, res) => {
  const id = req.params.id;
  const definition = CONNECTION_PROVIDERS[id];
  if (!definition) return res.status(404).json({ error: 'Fournisseur inconnu' });
  if (definition.available === false) return res.status(501).json({ error: definition.unlocks });
  if (!providerConfigured(id, definition)) return res.status(400).json({ error: 'Configuration absente' });
  try {
    if (id === 'youtube') await fetchText(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=test&key=${encodeURIComponent(connectionValue('youtube', 'apiKey', 'YOUTUBE_API_KEY'))}`);
    if (id === 'flickr') await fetchText(`https://www.flickr.com/services/rest/?method=flickr.test.echo&api_key=${encodeURIComponent(connectionValue('flickr', 'apiKey', 'FLICKR_API_KEY'))}&format=json&nojsoncallback=1`);
    if (id === 'google') await fetchText(`https://www.googleapis.com/customsearch/v1?num=1&q=test&key=${encodeURIComponent(connectionValue('google', 'apiKey', 'GOOGLE_API_KEY'))}&cx=${encodeURIComponent(connectionValue('google', 'cx', 'GOOGLE_CX'))}`);
    if (id === 'brave') await fetchText('https://api.search.brave.com/res/v1/images/search?q=test&count=1', { headers: { 'X-Subscription-Token': connectionValue('brave', 'apiKey', 'BRAVE_API_KEY'), accept: 'application/json' } });
    return res.json({ ok: true, provider: id, testedAt: new Date().toISOString() });
  } catch (error) {
    return res.status(error.status || 502).json({ ok: false, provider: id, error: error.message });
  }
});

app.delete('/api/connections/:id', (req, res) => {
  if (!CONNECTION_PROVIDERS[req.params.id]) return res.status(404).json({ error: 'Fournisseur inconnu' });
  const removed = SESSION_CONNECTIONS.delete(req.params.id);
  return res.json({ ok: true, removed, provider: req.params.id });
});

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
  const query = String(req.body.query || '').trim();
  if (!query) return res.status(400).json({ error: 'Requete requise' });
  const item = { ...req.body, id: makeId('hist'), query, createdAt: new Date().toISOString() };
  store.history.unshift(item);
  writeStore(store);
  res.json(item);
});
app.delete('/api/history', (req, res) => { const store = readStore(); store.history = []; writeStore(store); res.json({ ok: true }); });
app.delete('/api/history/:id', (req, res) => {
  const exists = readStore().history.some(item => item.id === req.params.id);
  if (!exists) return res.status(404).json({ error: 'Historique introuvable' });
  mutateStore(store => { store.history = store.history.filter(item => item.id !== req.params.id); });
  return res.json({ ok: true });
});

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
  if (!req.body?.url && !req.body?.link) return res.status(400).json({ error: 'URL media requise' });
  if (!isSafeHttpUrl(req.body.url || req.body.link)) return res.status(400).json({ error: 'URL media HTTP(S) invalide' });
  const key = req.body.visualSignature || req.body.url || req.body.link;
  const existing = readStore().collection.find(row => (row.visualSignature || row.url || row.link) === key);
  if (existing) {
    const item = { ...existing, ...req.body, id: existing.id, createdAt: existing.createdAt, status: req.body.status || existing.status || 'favorite', updatedAt: new Date().toISOString() };
    mutateStore(store => { store.collection = store.collection.map(row => row.id === existing.id ? item : row); });
    return res.json(item);
  }
  const item = { ...req.body, id: makeId('col'), status: req.body.status || 'favorite', createdAt: new Date().toISOString() };
  mutateStore(store => store.collection.unshift(item));
  res.json(item);
});
app.patch('/api/collection/:id', (req, res) => {
  if (!readStore().collection.some(item => item.id === req.params.id)) return res.status(404).json({ error: 'Element introuvable' });
  let updated;
  mutateStore(store => {
    store.collection = store.collection.map(item => {
      if (item.id !== req.params.id) return item;
      updated = { ...item, ...req.body, id: item.id, createdAt: item.createdAt, updatedAt: new Date().toISOString() };
      return updated;
    });
  });
  res.json(updated);
});
app.post('/api/collection/bulk-update', (req, res) => {
  const ids = new Set(req.body.ids || []);
  if (ids.size === 0 || !req.body.patch || typeof req.body.patch !== 'object') return res.status(400).json({ error: 'IDs et patch requis' });
  const store = readStore();
  let updated = 0;
  store.collection = store.collection.map(item => {
    if (!ids.has(item.id)) return item;
    updated += 1;
    return { ...item, ...req.body.patch, updatedAt: new Date().toISOString() };
  });
  writeStore(store);
  res.json({ ok: true, updated });
});
app.delete('/api/collection', (req, res) => { const store = readStore(); store.collection = []; writeStore(store); res.json({ ok: true }); });
app.delete('/api/collection/:id', (req, res) => {
  if (!readStore().collection.some(item => item.id === req.params.id)) return res.status(404).json({ error: 'Element introuvable' });
  mutateStore(store => { store.collection = store.collection.filter(item => item.id !== req.params.id); });
  return res.json({ ok: true });
});

app.get('/api/monitors', (req, res) => res.json({ items: readStore().monitors || [] }));
app.post('/api/monitors', (req, res) => {
  const query = String(req.body?.query || '').trim();
  if (!query) return res.status(400).json({ error: 'Requete requise' });
  const existing = readStore().monitors.find(item => item.query === query);
  const monitor = { ...existing, ...req.body, id: existing?.id || makeId('monitor'), createdAt: existing?.createdAt || new Date().toISOString(), query, updatedAt: new Date().toISOString() };
  mutateStore(store => { store.monitors = [monitor, ...store.monitors.filter(item => item.id !== monitor.id)].slice(0, 50); });
  return res.json(monitor);
});
app.patch('/api/monitors/:id', (req, res) => {
  if (!readStore().monitors.some(item => item.id === req.params.id)) return res.status(404).json({ error: 'Veille introuvable' });
  let monitor;
  mutateStore(store => {
    store.monitors = store.monitors.map(item => {
      if (item.id !== req.params.id) return item;
      monitor = { ...item, ...req.body, updatedAt: new Date().toISOString() };
      return monitor;
    });
  });
  return res.json(monitor);
});
app.delete('/api/monitors', (req, res) => { mutateStore(store => { store.monitors = []; }); res.json({ ok: true }); });
app.delete('/api/monitors/:id', (req, res) => {
  if (!readStore().monitors.some(item => item.id === req.params.id)) return res.status(404).json({ error: 'Veille introuvable' });
  mutateStore(store => { store.monitors = store.monitors.filter(item => item.id !== req.params.id); });
  return res.json({ ok: true });
});

app.get('/api/sources', (req, res) => res.json({ sources: Object.values(SOURCE_META) }));
app.get('/api/sources/diagnostics', (req, res) => {
  const diagnostics = readStore().sourceDiagnostics || {};
  res.json({ sources: Object.values(SOURCE_META).map(source => ({
    ...source,
    state: diagnostics[source.id]?.state || 'untested',
    lastTest: diagnostics[source.id]?.lastTest || null,
    diagnostics: diagnostics[source.id] || null
  })) });
});
app.get('/api/sources/adapters', (req, res) => res.json({
  adapters: Object.values(SOURCE_META).map(source => {
    const adapter = NSFW_ADAPTERS[source.id];
    return {
      id: source.id,
      label: source.label,
      category: source.category,
      subtype: source.subtype,
      supports: source.supports,
      mode: adapter?.transport || (adapter ? 'source-crawl' : 'public-html-or-api'),
      domains: adapter?.domains || [sourceDomain(source.id)],
      crawlLimit: adapter?.crawlLimit || 0,
      publicProfileOnly: Boolean(adapter?.publicProfileOnly),
      availability: adapter?.transport === 'eporner-api-v2'
        ? 'official-public-api-with-html-fallback'
        : (adapter?.transport === 'public-forum-form'
            ? 'public-form-with-search-engine-fallbacks'
            : (adapter ? 'direct-html-with-search-engine-fallbacks' : 'public-html-or-api')),
      fallbacks: source.nsfw ? ['direct', 'duckduckgo-site', 'bing-site', 'brave-site'] : ['direct']
    };
  })
}));
app.get('/api/sources/:id/test', async (req, res) => {
  const sourceId = String(req.params.id || '').toLowerCase();
  const query = String(req.query.q || '').trim();
  if (!SOURCE_META[sourceId]) return res.status(404).json({ error: 'source inconnue' });
  if (!query) return res.status(400).json({ error: 'parametre q requis' });
  if (SOURCE_META[sourceId].nsfw && String(req.query.safe || 'true') !== 'false') {
    return res.status(400).json({ error: 'safe=false requis pour tester une source NSFW publique' });
  }
  try {
    const testOptions = { imageLimit: 5, videoLimit: 5, safe: String(req.query.safe || 'true') !== 'false', riskMode: 'cautious' };
    const result = NSFW_ADAPTERS[sourceId]
      ? await scrapeNsfwSource(sourceId, query, testOptions)
      : await scrapeGenericSource(sourceId, query, testOptions);
    const health = sourceHealthFromStatus(sourceId, result.status);
    mutateStore(store => {
      store.sourceDiagnostics = store.sourceDiagnostics || {};
      store.sourceDiagnostics[sourceId] = health;
    });
    res.json({
      source: SOURCE_META[sourceId],
      query,
      status: result.status,
      samples: [...result.images, ...result.videos].slice(0, 10).map(item => ({
        type: item.type,
        title: item.title,
        url: item.url,
        thumbnail: item.thumbnail,
        link: item.link,
        confidenceScore: item.confidenceScore
      }))
    });
  } catch (error) {
    const health = sourceHealthFromStatus(sourceId, { success: false, error: error.message, imagesCount: 0, videosCount: 0, zeroReason: error.status === 429 ? 'rate_limited' : 'request_failed' });
    mutateStore(store => {
      store.sourceDiagnostics = store.sourceDiagnostics || {};
      store.sourceDiagnostics[sourceId] = health;
    });
    res.status(502).json({ error: error.message, sourceId });
  }
});

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
  const queries = uniq(req.body?.queries || (req.body?.query ? [req.body.query] : [])).slice(0, 20);
  if (!queries.length) return res.status(400).json({ error: 'Au moins une requete est requise' });
  const job = {
    id: makeId('job'),
    status: 'pending',
    createdAt: new Date().toISOString(),
    queries,
    sources: String(req.body?.sources || 'duckduckgo'),
    safe: req.body?.safe !== false,
    media: req.body?.media || 'both',
    mode: req.body?.mode || 'strict',
    completed: 0,
    total: queries.length,
    results: [],
    errors: []
  };
  mutateStore(store => store.queue.unshift(job));
  res.json(job);
});

async function processQueueJob(jobId) {
  let job = readStore().queue.find(item => item.id === jobId);
  if (!job) throw Object.assign(new Error('Job introuvable'), { status: 404 });
  mutateStore(store => {
    store.queue = store.queue.map(item => item.id === jobId ? { ...item, status: 'running', startedAt: item.startedAt || new Date().toISOString(), updatedAt: new Date().toISOString() } : item);
  });
  for (let index = Number(job.completed || 0); index < job.queries.length; index += 1) {
    job = readStore().queue.find(item => item.id === jobId);
    if (!job || ['paused', 'cancelled'].includes(job.status)) break;
    const query = job.queries[index];
    try {
      const payload = await scrapeImageSearchWithFallback(query, job.sources, { safe: job.safe, mediaKind: job.media, matchMode: job.mode, riskMode: 'cautious' });
      filterMediaKind(payload, job.media);
      mutateStore(store => {
        store.queue = store.queue.map(item => item.id === jobId ? {
          ...item,
          completed: index + 1,
          results: [...(item.results || []), { query, imagesCount: payload.images.length, videosCount: payload.videos.length }],
          updatedAt: new Date().toISOString()
        } : item);
      });
    } catch (error) {
      mutateStore(store => {
        store.queue = store.queue.map(item => item.id === jobId ? {
          ...item,
          completed: index + 1,
          errors: [...(item.errors || []), { query, error: error.message }],
          updatedAt: new Date().toISOString()
        } : item);
      });
    }
  }
  mutateStore(store => {
    store.queue = store.queue.map(item => item.id === jobId && item.status === 'running' ? { ...item, status: 'done', finishedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : item);
  });
  return readStore().queue.find(item => item.id === jobId);
}

app.post('/api/queue/jobs/:id/:action', async (req, res) => {
  const allowedActions = new Set(['start', 'pause', 'resume', 'cancel', 'retry-errors']);
  if (!allowedActions.has(req.params.action)) return res.status(400).json({ error: 'Action inconnue' });
  const existing = readStore().queue.find(job => job.id === req.params.id);
  if (!existing) return res.status(404).json({ error: 'Job introuvable' });
  if (['start', 'resume', 'retry-errors'].includes(req.params.action)) {
    if (req.params.action === 'retry-errors') {
      mutateStore(store => {
        store.queue = store.queue.map(job => job.id === req.params.id ? { ...job, completed: 0, results: [], errors: [], status: 'pending' } : job);
      });
    }
    const job = await processQueueJob(req.params.id);
    return res.json({ ok: true, job });
  }
  const targetStatus = req.params.action === 'pause' ? 'paused' : 'cancelled';
  mutateStore(store => {
    store.queue = store.queue.map(job => job.id === req.params.id ? { ...job, status: targetStatus, updatedAt: new Date().toISOString() } : job);
  });
  return res.json({ ok: true, job: readStore().queue.find(job => job.id === req.params.id) });
});
app.delete('/api/queue/jobs/:id', (req, res) => {
  const before = readStore().queue.length;
  mutateStore(store => { store.queue = store.queue.filter(job => job.id !== req.params.id); });
  if (readStore().queue.length === before) return res.status(404).json({ error: 'Job introuvable' });
  return res.json({ ok: true });
});

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
  const snapshot = { ...req.body, id: makeId('snap'), createdAt: new Date().toISOString() };
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
  if (!readStore().persons.some(person => person.id === req.params.id)) return res.status(404).json({ error: 'Profil introuvable' });
  let updated;
  mutateStore(store => {
    store.persons = store.persons.map(person => {
      if (person.id !== req.params.id) return person;
      updated = { ...person, ...req.body, id: person.id, updatedAt: new Date().toISOString() };
      return updated;
    });
  });
  res.json(updated);
});
app.delete('/api/persons/:id', (req, res) => {
  if (!readStore().persons.some(person => person.id === req.params.id)) return res.status(404).json({ error: 'Profil introuvable' });
  const store = readStore();
  store.persons = store.persons.filter(person => person.id !== req.params.id);
  store.personMediaLinks = store.personMediaLinks.filter(link => link.personId !== req.params.id);
  store.personValidationRules = store.personValidationRules.filter(rule => rule.personId !== req.params.id);
  writeStore(store);
  res.json({ ok: true });
});
app.post('/api/persons/:id/aliases', (req, res) => {
  if (!readStore().persons.some(person => person.id === req.params.id)) return res.status(404).json({ error: 'Profil introuvable' });
  if (!String(req.body.alias || '').trim()) return res.status(400).json({ error: 'Alias requis' });
  const store = readStore();
  store.persons = store.persons.map(person => person.id === req.params.id ? { ...person, aliases: uniq([...(person.aliases || []), req.body.alias]) } : person);
  writeStore(store);
  res.json({ ok: true });
});
app.post('/api/persons/:id/accounts', (req, res) => {
  if (!readStore().persons.some(person => person.id === req.params.id)) return res.status(404).json({ error: 'Profil introuvable' });
  if (!req.body?.url && !req.body?.username) return res.status(400).json({ error: 'Compte public requis' });
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
  const person = readStore().persons.find(item => item.id === req.params.id);
  if (!person) return res.status(404).json({ error: 'Profil introuvable' });
  if (person.publicOnly === false || person.safeMode === false) return res.status(400).json({ error: 'Person Finder exige publicOnly et safeMode actifs' });
  const queries = buildPersonQueries(person, req.body.depth || 'normal').slice(0, Number(req.body.maxQueries || 10));
  if (req.body.dryRun) return res.json({ dryRun: true, queries });
  const created = [];
  for (const query of queries) {
    const payload = await scrapeImageSearchWithFallback(query, req.body.sources || 'duckduckgo,bing,wikimedia,reddit', { safe: true, matchMode: 'strict', riskMode: 'cautious' });
    const items = [...payload.images, ...payload.videos];
    items.forEach(item => {
      const score = scorePersonMedia(person, item);
      if (score.score < Number(req.body.minScore || 30)) return;
      const currentStore = readStore();
      const link = applyPersonRules(currentStore, person.id, {
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
      created.push(link);
    });
  }
  mutateStore(store => {
    store.personMediaLinks = dedupeBy([...created, ...store.personMediaLinks], link => `${link.personId}:${link.media?.visualSignature || link.media?.url}`);
  });
  res.json({ personId: person.id, queries, created: created.length, links: created });
});
app.get('/api/persons/:id/media', (req, res) => {
  const store = readStore();
  if (!store.persons.some(person => person.id === req.params.id)) return res.status(404).json({ error: 'Profil introuvable' });
  return res.json({ links: store.personMediaLinks.filter(link => link.personId === req.params.id) });
});
app.post('/api/persons/:id/media', (req, res) => {
  if (!readStore().persons.some(person => person.id === req.params.id)) return res.status(404).json({ error: 'Profil introuvable' });
  const mediaUrl = req.body?.media?.url || req.body?.url || req.body?.media?.link || req.body?.link;
  if (mediaUrl && !isSafeHttpUrl(mediaUrl)) return res.status(400).json({ error: 'URL media HTTP(S) invalide' });
  const store = readStore();
  const link = { ...req.body, id: makeId('pmedia'), personId: req.params.id, status: 'to_review', createdAt: new Date().toISOString() };
  store.personMediaLinks.unshift(link);
  writeStore(store);
  res.json(link);
});
app.patch('/api/persons/:id/media/:linkId', (req, res) => {
  if (!readStore().personMediaLinks.some(link => link.id === req.params.linkId && link.personId === req.params.id)) return res.status(404).json({ error: 'Media introuvable' });
  const store = readStore();
  store.personMediaLinks = store.personMediaLinks.map(link => link.id === req.params.linkId && link.personId === req.params.id ? { ...link, ...req.body, id: link.id, personId: link.personId, createdAt: link.createdAt, updatedAt: new Date().toISOString() } : link);
  writeStore(store);
  res.json({ ok: true });
});
app.post('/api/persons/:id/media/:linkId/validate', (req, res) => {
  if (!readStore().personMediaLinks.some(link => link.id === req.params.linkId && link.personId === req.params.id)) return res.status(404).json({ error: 'Media introuvable' });
  const allowedStatuses = new Set(['to_review', 'probable', 'confirmed', 'false_positive', 'excluded', 'saved']);
  if (!allowedStatuses.has(req.body.status)) return res.status(400).json({ error: 'Statut invalide' });
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
  const store = readStore();
  if (!store.persons.some(person => person.id === req.params.id)) return res.status(404).json({ error: 'Profil introuvable' });
  let links = store.personMediaLinks.filter(link => link.personId === req.params.id);
  if (req.query.status && req.query.status !== 'all') links = links.filter(link => link.status === req.query.status);
  if (req.query.type && req.query.type !== 'all') links = links.filter(link => link.mediaType === req.query.type);
  if (req.query.q) links = links.filter(link => mediaText(link.media).includes(String(req.query.q).toLowerCase()));
  res.json({ links });
});
app.get('/api/persons/:id/gallery/stats', (req, res) => {
  const store = readStore();
  if (!store.persons.some(person => person.id === req.params.id)) return res.status(404).json({ error: 'Profil introuvable' });
  const links = store.personMediaLinks.filter(link => link.personId === req.params.id);
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
  const store = readStore();
  if (!store.persons.some(person => person.id === req.params.id)) return res.status(404).json({ error: 'Profil introuvable' });
  const links = store.personMediaLinks.filter(link => link.personId === req.params.id);
  res.json({ events: links.length + 1, media: links.length, validated: links.filter(link => link.validatedAt).length });
});
app.get('/api/persons/:id/validation/rules', (req, res) => {
  const store = readStore();
  if (!store.persons.some(person => person.id === req.params.id)) return res.status(404).json({ error: 'Profil introuvable' });
  return res.json({ rules: store.personValidationRules.filter(rule => rule.personId === req.params.id) });
});
app.post('/api/persons/:id/validation/rules', (req, res) => {
  const store = readStore();
  if (!store.persons.some(person => person.id === req.params.id)) return res.status(404).json({ error: 'Profil introuvable' });
  const allowedTypes = new Set(['keyword', 'domain', 'source', 'url', 'title', 'query', 'identity', 'custom']);
  const allowedActions = new Set(['exclude', 'false_positive', 'review', 'probable', 'confirm', 'boost']);
  const value = String(req.body.value || '').trim();
  if (!value) return res.status(400).json({ error: 'Valeur de regle requise' });
  if (!allowedTypes.has(req.body.type || 'keyword') || !allowedActions.has(req.body.action || 'exclude')) return res.status(400).json({ error: 'Regle invalide' });
  const rule = { id: makeId('rule'), personId: req.params.id, type: req.body.type || 'keyword', action: req.body.action || 'exclude', value, createdAt: new Date().toISOString() };
  store.personValidationRules.unshift(rule);
  writeStore(store);
  res.json(rule);
});
app.delete('/api/persons/:id/validation/rules/:ruleId', (req, res) => {
  const store = readStore();
  const exists = store.personValidationRules.some(rule => rule.id === req.params.ruleId && rule.personId === req.params.id);
  if (!exists) return res.status(404).json({ error: 'Regle introuvable' });
  store.personValidationRules = store.personValidationRules.filter(rule => rule.id !== req.params.ruleId || rule.personId !== req.params.id);
  writeStore(store);
  res.json({ ok: true });
});
app.post('/api/persons/:id/validation/apply-rules', (req, res) => {
  const store = readStore();
  if (!store.persons.some(person => person.id === req.params.id)) return res.status(404).json({ error: 'Profil introuvable' });
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

function desktopDiagnostics() {
  const requiredAssets = ['public/index.html', 'public/css/style.css', 'public/js/app.js', 'public/vendor/lucide.min.js', 'public/vendor/jszip.min.js', 'public/vendor/FileSaver.min.js'];
  const assets = requiredAssets.map(relativePath => ({ relativePath, exists: fs.existsSync(path.join(__dirname, relativePath)) }));
  const executablePath = process.pkg
    ? process.execPath
    : path.join(__dirname, ['dist', 'MediaGatherer.exe'].join(path.sep));
  let windowsExecutable = false;
  if (fs.existsSync(executablePath)) {
    const header = fs.readFileSync(executablePath).subarray(0, 2).toString('ascii');
    windowsExecutable = header === 'MZ';
  }
  return {
    assets,
    assetsReady: assets.every(asset => asset.exists),
    windowsExecutable,
    target: 'node24-win-x64'
  };
}

app.get('/api/desktop/status', (req, res) => {
  const diagnostics = desktopDiagnostics();
  res.json({
    ready: diagnostics.assetsReady && !process.env.VERCEL,
    mode: process.env.VERCEL ? 'web-serverless' : 'node-standalone',
    persistentStorage: !IS_VOLATILE_STORAGE,
    windowsExecutable: diagnostics.windowsExecutable,
    exportDir: process.env.VERCEL ? null : EXPORT_DIR
  });
});
app.get('/api/desktop/qa', (req, res) => {
  const diagnostics = desktopDiagnostics();
  res.status(diagnostics.assetsReady ? 200 : 503).json({ ok: diagnostics.assetsReady, ...diagnostics });
});
app.get('/api/desktop/windows', (req, res) => {
  const diagnostics = desktopDiagnostics();
  res.json({ target: diagnostics.target, executable: diagnostics.windowsExecutable, command: 'npm run build:exe' });
});
app.post('/api/desktop/export', (req, res) => {
  if (process.env.VERCEL) return res.status(501).json({ error: 'Export vers un dossier local indisponible sur Vercel' });
  ensureLocalDirs();
  const file = path.join(EXPORT_DIR, `export-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(req.body || {}, null, 2), 'utf8');
  res.json({ ok: true, file });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Route API introuvable' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.status || (error.message === 'Origine CORS non autorisee' ? 403 : 500);
  if (status >= 500) console.error('[API]', error);
  return res.status(status).json({ error: status >= 500 ? 'Erreur interne' : error.message });
});

app.locals.testables = {
  normalizeSearchTerm,
  repairMojibake,
  evaluateMediaMatch,
  enrichMedia,
  canonicalMediaKey,
  dedupeBestMedia,
  isPrivateIp,
  validatePublicMediaUrl,
  extractImagesFromHtml,
  extractLinksAsVideos,
  extractAdapterPageLinks,
  extractSearchResultPages,
  extractMediaFromSourcePage,
  parseDuckDuckGoWebResults,
  parseBingWebResults,
  parseEpornerApiResults,
  sourceSearchUrls,
  pageMatchesAdapter,
  isProfileLikeSourcePage,
  discoveredVideoPageCandidates,
  isTrustedIdentityResultPage,
  discoverAliases,
  filterBySearchMode,
  buildPersonQueries,
  scorePersonMedia,
  desktopDiagnostics
};

if (require.main === module) {
  app.listen(PORT, () => {
    ensureLocalDirs();
    console.log(`MediaGatherer local: http://localhost:${PORT}`);
  });
}

module.exports = app;
