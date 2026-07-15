const CORE_SOURCE_DEFINITIONS = {
  duckduckgo: { category: 'normal', supports: ['image', 'video', 'page'], adapter: 'duckduckgo-images', subtype: 'search-engine', purpose: 'media', auth: 'none', defaultSelected: true },
  bing: { category: 'normal', supports: ['image', 'video', 'page'], adapter: 'bing-images', subtype: 'search-engine', purpose: 'media', auth: 'none', defaultSelected: true },
  google: { category: 'normal', supports: ['image'], adapter: 'google-cse', subtype: 'search-engine', purpose: 'media', auth: 'api-key' },
  brave: { category: 'normal', supports: ['image'], adapter: 'brave-images-api', subtype: 'search-engine', purpose: 'media', auth: 'api-key' },
  flickr: { category: 'normal', supports: ['image'], adapter: 'flickr-public-feed', subtype: 'image', purpose: 'media', auth: 'api-key-optional', defaultSelected: true },
  wikimedia: { category: 'normal', supports: ['image'], adapter: 'wikimedia-api', subtype: 'image', purpose: 'media', auth: 'none', defaultSelected: true },
  youtube: { category: 'normal', supports: ['video'], adapter: 'youtube-public', subtype: 'video', purpose: 'media', auth: 'api-key-optional', defaultSelected: true },
  reddit: { category: 'social', supports: ['image', 'video', 'page'], adapter: 'reddit-json', subtype: 'social', purpose: 'media', auth: 'none', defaultSelected: true },
  telegram: { category: 'social', supports: ['image', 'video', 'page'], adapter: 'public-profile-crawl', subtype: 'social', purpose: 'identity', auth: 'none' },
  instagram: { category: 'social', supports: ['image', 'video', 'page'], adapter: 'public-profile-crawl', subtype: 'social', purpose: 'identity', auth: 'none' },
  facebook: { category: 'social', supports: ['image', 'video', 'page'], adapter: 'public-search-crawl', subtype: 'social', purpose: 'identity', auth: 'none' },
  tiktok: { category: 'social', supports: ['image', 'video', 'page'], adapter: 'public-search-crawl', subtype: 'social', purpose: 'identity', auth: 'none' },
  x: { category: 'social', supports: ['image', 'video', 'page'], adapter: 'public-search-crawl', subtype: 'social', purpose: 'identity', auth: 'none' },
  pinterest: { category: 'social', supports: ['image', 'video', 'page'], adapter: 'public-search-crawl', subtype: 'social', purpose: 'media', auth: 'none' },
  snapchat: { category: 'social', supports: ['image', 'video', 'page'], adapter: 'public-profile-crawl', subtype: 'social', purpose: 'identity', auth: 'none' },
  threads: { category: 'social', supports: ['image', 'video', 'page'], adapter: 'public-profile-crawl', subtype: 'social', purpose: 'identity', auth: 'none' },
  wayback: { category: 'normal', supports: ['image', 'video', 'page'], adapter: 'wayback-cdx', subtype: 'archive', purpose: 'media', auth: 'none', defaultSelected: true },
  vimeo: { category: 'normal', supports: ['video'], adapter: 'public-search-crawl', subtype: 'video', purpose: 'media', auth: 'none' },
  dailymotion: { category: 'normal', supports: ['video'], adapter: 'dailymotion-api', subtype: 'video', purpose: 'media', auth: 'none' }
};

module.exports = { CORE_SOURCE_DEFINITIONS };
