const { CORE_SOURCE_DEFINITIONS } = require('./coreSources');
const { EXTENDED_SOURCE_DEFINITIONS, EXTENDED_SOURCE_ADAPTERS } = require('./extendedSources');

const DEFAULT_SELECTED_SOURCES = new Set([
  'duckduckgo', 'bing', 'bingvideos', 'flickr', 'wikimedia', 'youtube', 'reddit',
  'wayback', 'vimeo', 'dailymotion', 'wikidata', 'wikipedia', 'internetarchive', 'bluesky'
]);

const SOURCE_IDS = [
  'duckduckgo', 'bing', 'google', 'brave', 'flickr', 'wikimedia', 'youtube', 'reddit', 'telegram',
  'instagram', 'facebook', 'tiktok', 'x', 'pinterest', 'snapchat', 'threads', 'wayback', 'vimeo', 'dailymotion',
  'freeones', 'freeonesforum', 'babesource', 'erome', 'redgifs', 'imagebam', 'imagefap', 'pornpics',
  'babepedia', 'camwhores', 'pornzog', 'onlyfans', 'fansly', 'mym', 'xhamster', 'xvideos', 'spankbang',
  'pornhub', 'youporn', 'tube8', 'tnaflix', 'motherless', 'eporner', 'xnxx', 'hqporner', 'nuvid',
  'drtuber', 'pornone', 'youjizz', 'phunforum', 'planetsuzy', 'bellazon',
  ...EXTENDED_SOURCE_DEFINITIONS.map(source => source.id)
];

const NSFW_SOURCES = new Set([
  'freeones', 'freeonesforum', 'babesource', 'erome', 'redgifs', 'imagebam', 'imagefap', 'pornpics',
  'babepedia', 'camwhores', 'pornzog', 'onlyfans', 'fansly', 'mym', 'xhamster', 'xvideos', 'spankbang',
  'pornhub', 'youporn', 'tube8', 'tnaflix', 'motherless', 'eporner', 'xnxx', 'hqporner', 'nuvid',
  'drtuber', 'pornone', 'youjizz', 'phunforum', 'planetsuzy', 'bellazon',
  ...EXTENDED_SOURCE_DEFINITIONS.filter(source => source.nsfw).map(source => source.id)
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
  bellazon: 'Bellazon Forum',
  ...Object.fromEntries(EXTENDED_SOURCE_DEFINITIONS.map(source => [source.id, source.label]))
};

const SOURCE_CRAWL_ADAPTERS = {
  freeones: { domains: ['freeones.com'], pagePatterns: [/\/html\//i, /\/forums\//i], media: ['image', 'page'] },
  freeonesforum: { domains: ['freeones.com'], pagePatterns: [/\/forums\//i, /\/threads\//i], media: ['image', 'page'] },
  babesource: { domains: ['babesource.com'], pagePatterns: [/\/(?:model|babe|gallery|video)\//i], media: ['image', 'video'] },
  erome: { domains: ['erome.com'], pagePatterns: [/\/a\//i, /\/i\//i], media: ['image', 'video'], crawlLimit: 8 },
  redgifs: { domains: ['redgifs.com'], pagePatterns: [/\/watch\//i, /\/gifs\//i], media: ['video'], crawlLimit: 8, transport: 'redgifs-api-v2' },
  imagebam: { domains: ['imagebam.com'], pagePatterns: [/\/(?:gallery|image)\//i], media: ['image'], crawlLimit: 8 },
  imagefap: { domains: ['imagefap.com'], pagePatterns: [/\/(?:gallery|photo|pictures)\//i], media: ['image'], crawlLimit: 8 },
  pornpics: { domains: ['pornpics.com'], pagePatterns: [/\/(?:galleries|gallery|photos?)\//i], media: ['image'], crawlLimit: 8 },
  babepedia: { domains: ['babepedia.com'], pagePatterns: [/\/babe\//i, /\/gallery\//i], media: ['image'], crawlLimit: 8 },
  camwhores: { domains: ['camwhores.tv', 'camwhores.video', 'camwhoreshd.com'], pagePatterns: [/\/(?:videos?|models?|tags?)\//i], media: ['image', 'video'], crawlLimit: 6 },
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
  hqporner: { domains: ['hqporner.com'], pagePatterns: [/\/hdporn\/[^/]+\.html/i], media: ['video'], crawlLimit: 5, trustSearchResults: true },
  nuvid: { domains: ['nuvid.com'], pagePatterns: [/\/video\/\d+\//i], media: ['video'], crawlLimit: 5 },
  drtuber: { domains: ['drtuber.com'], pagePatterns: [/\/video\/\d+\//i], media: ['video'], crawlLimit: 5 },
  pornone: { domains: ['pornone.com'], pagePatterns: [/\/[^/]+\/[^/]*video-\d+\/\d+\/?$/i], media: ['video'], crawlLimit: 5 },
  youjizz: { domains: ['youjizz.com'], pagePatterns: [/\/videos\/[^/]+\.html/i], media: ['video'], crawlLimit: 5 },
  phunforum: { domains: ['forum.phun.org', 'phun.org'], pagePatterns: [/\/threads\/[^/]+\.\d+\/?/i], media: ['image', 'video'], crawlLimit: 4, forum: true, transport: 'public-forum-get' },
  planetsuzy: { domains: ['planetsuzy.org'], pagePatterns: [/\/showthread\.php\?.*\bt=\d+/i, /\/t\d+[^/]*\.html/i], media: ['image', 'video'], crawlLimit: 4, forum: true, transport: 'public-forum-form' },
  bellazon: { domains: ['bellazon.com'], pagePatterns: [/\/main\/topic\/\d+-[^/]+\/?/i], media: ['image', 'video'], crawlLimit: 4, forum: true, transport: 'public-forum-get' },
  ...EXTENDED_SOURCE_ADAPTERS
};

const SOURCE_META = SOURCE_IDS.reduce((map, id) => {
  const definition = CORE_SOURCE_DEFINITIONS[id] || EXTENDED_SOURCE_DEFINITIONS.find(source => source.id === id) || {};
  const nsfw = definition.nsfw === true || NSFW_SOURCES.has(id);
  map[id] = {
    id,
    label: SOURCE_LABELS[id] || id.replace(/\b\w/g, char => char.toUpperCase()),
    category: definition.category || (nsfw ? 'nsfw' : (['reddit', 'telegram', 'instagram', 'facebook', 'tiktok', 'x', 'pinterest'].includes(id) ? 'social' : 'normal')),
    nsfw,
    enabled: true,
    supports: definition.supports || SOURCE_CRAWL_ADAPTERS[id]?.media || (id === 'youtube' || id === 'vimeo' || id === 'dailymotion' ? ['video'] : ['image', 'video', 'page']),
    adapter: definition.adapter || (SOURCE_CRAWL_ADAPTERS[id] ? 'source-crawl' : 'generic-public'),
    publicOnly: true,
    subtype: definition.subtype || (SOURCE_CRAWL_ADAPTERS[id]?.forum ? 'forum' : (nsfw ? 'platform' : 'general')),
    purpose: definition.purpose || 'media',
    auth: definition.auth || 'none',
    defaultSelected: definition.defaultSelected === true || DEFAULT_SELECTED_SOURCES.has(id)
  };
  return map;
}, {});

module.exports = {
  DEFAULT_SELECTED_SOURCES,
  SOURCE_IDS,
  NSFW_SOURCES,
  SOURCE_LABELS,
  SOURCE_CRAWL_ADAPTERS,
  SOURCE_META
};
