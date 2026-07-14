const EXTENDED_SOURCE_DEFINITIONS = [
  { id: 'wikidata', label: 'Wikidata identite', category: 'identity', supports: ['image', 'page'], adapter: 'wikidata-api', subtype: 'metadata', purpose: 'identity', defaultSelected: true },
  { id: 'tmdb', label: 'TMDB Person', category: 'identity', supports: ['image', 'page'], adapter: 'tmdb-api', subtype: 'metadata', purpose: 'identity', auth: 'api-key' },
  { id: 'internetarchive', label: 'Internet Archive', category: 'normal', supports: ['image', 'video', 'page'], adapter: 'archive-org-api', subtype: 'archive', purpose: 'media', defaultSelected: true },
  { id: 'arquivo', label: 'Arquivo.pt Images', category: 'normal', supports: ['image', 'page'], adapter: 'arquivo-api', subtype: 'archive', purpose: 'media' },
  { id: 'imgur', label: 'Imgur', category: 'normal', supports: ['image', 'video'], adapter: 'imgur-api', subtype: 'platform', purpose: 'media', auth: 'client-id' },
  { id: 'peertube', label: 'PeerTube', category: 'normal', supports: ['video'], adapter: 'peertube-api', subtype: 'video', purpose: 'media' },
  { id: 'bluesky', label: 'Bluesky', category: 'social', supports: ['image', 'video', 'page'], adapter: 'bluesky-api', subtype: 'social', purpose: 'identity', defaultSelected: true },
  { id: 'mastodon', label: 'Mastodon', category: 'social', supports: ['image', 'video', 'page'], adapter: 'mastodon-api', subtype: 'social', purpose: 'identity' },
  { id: 'tumblr', label: 'Tumblr', category: 'social', supports: ['image', 'video', 'page'], adapter: 'tumblr-api', subtype: 'social', purpose: 'identity', auth: 'api-key' },
  { id: 'twitch', label: 'Twitch Clips', category: 'social', supports: ['image', 'video', 'page'], adapter: 'twitch-api', subtype: 'social', purpose: 'identity', auth: 'client-credentials' },
  { id: 'linktree', label: 'Linktree', category: 'identity', supports: ['image', 'page'], adapter: 'public-profile-crawl', subtype: 'link-hub', purpose: 'identity' },
  { id: 'beacons', label: 'Beacons', category: 'identity', supports: ['image', 'page'], adapter: 'public-profile-crawl', subtype: 'link-hub', purpose: 'identity' },
  { id: 'allmylinks', label: 'AllMyLinks', category: 'identity', supports: ['image', 'page'], adapter: 'public-profile-crawl', subtype: 'link-hub', purpose: 'identity' },
  { id: 'carrd', label: 'Carrd', category: 'identity', supports: ['image', 'page'], adapter: 'public-profile-crawl', subtype: 'link-hub', purpose: 'identity' },
  { id: 'stashdb', label: 'StashDB', category: 'nsfw', nsfw: true, supports: ['image', 'page'], adapter: 'stashdb-graphql', subtype: 'metadata', purpose: 'identity', auth: 'api-key' },
  { id: 'iafd', label: 'IAFD', category: 'nsfw', nsfw: true, supports: ['image', 'page'], adapter: 'public-metadata-crawl', subtype: 'metadata', purpose: 'identity' },
  { id: 'adultdatabase', label: 'Adult Database', category: 'nsfw', nsfw: true, supports: ['image', 'page'], adapter: 'public-metadata-crawl', subtype: 'metadata', purpose: 'identity' },
  { id: 'theporndb', label: 'ThePornDB', category: 'nsfw', nsfw: true, supports: ['image', 'page'], adapter: 'public-metadata-crawl', subtype: 'metadata', purpose: 'identity', auth: 'api-key-optional' },
  { id: 'fancentro', label: 'FanCentro public', category: 'nsfw', nsfw: true, supports: ['image', 'page'], adapter: 'public-profile-crawl', subtype: 'platform', purpose: 'identity' },
  { id: 'loyalfans', label: 'LoyalFans public', category: 'nsfw', nsfw: true, supports: ['image', 'page'], adapter: 'public-profile-crawl', subtype: 'platform', purpose: 'identity' },
  { id: 'manyvids', label: 'ManyVids public', category: 'nsfw', nsfw: true, supports: ['image', 'video', 'page'], adapter: 'public-profile-crawl', subtype: 'platform', purpose: 'media' },
  { id: 'clips4sale', label: 'Clips4Sale public', category: 'nsfw', nsfw: true, supports: ['image', 'video', 'page'], adapter: 'public-profile-crawl', subtype: 'platform', purpose: 'media' },
  { id: 'lpsg', label: 'LPSG Forum', category: 'nsfw', nsfw: true, supports: ['image', 'video', 'page'], adapter: 'public-forum-crawl', subtype: 'forum', purpose: 'discovery' },
  { id: 'adultdvdtalk', label: 'Adult DVD Talk Forum', category: 'nsfw', nsfw: true, supports: ['image', 'video', 'page'], adapter: 'public-forum-crawl', subtype: 'forum', purpose: 'discovery' }
];

const EXTENDED_SOURCE_ADAPTERS = {
  linktree: { domains: ['linktr.ee'], pagePatterns: [/^\/[a-z0-9._-]+\/?$/i], media: ['image', 'page'], crawlLimit: 3, publicProfileOnly: true, identityOnly: true },
  beacons: { domains: ['beacons.ai'], pagePatterns: [/^\/[a-z0-9._-]+\/?$/i], media: ['image', 'page'], crawlLimit: 3, publicProfileOnly: true, identityOnly: true },
  allmylinks: { domains: ['allmylinks.com'], pagePatterns: [/^\/[a-z0-9._-]+\/?$/i], media: ['image', 'page'], crawlLimit: 3, publicProfileOnly: true, identityOnly: true },
  carrd: { domains: ['carrd.co'], pagePatterns: [/^\/[a-z0-9._-]+\/?$/i], media: ['image', 'page'], crawlLimit: 3, publicProfileOnly: true, identityOnly: true },
  iafd: { domains: ['iafd.com'], pagePatterns: [/\/person\.rme/i, /\/title\.rme/i], media: ['image', 'page'], crawlLimit: 4, publicProfileOnly: true, identityOnly: true },
  adultdatabase: { domains: ['adultdatabase.com'], pagePatterns: [/\/(?:actor|actress|star|performer|model|profile)s?\//i], media: ['image', 'page'], crawlLimit: 4, publicProfileOnly: true, identityOnly: true },
  theporndb: { domains: ['theporndb.net'], pagePatterns: [/\/(?:performers?|people|scenes?)\//i], media: ['image', 'page'], crawlLimit: 4, publicProfileOnly: true, identityOnly: true },
  fancentro: { domains: ['fancentro.com'], pagePatterns: [/^\/[a-z0-9._-]+\/?$/i, /\/store\//i], media: ['image', 'page'], crawlLimit: 3, publicProfileOnly: true },
  loyalfans: { domains: ['loyalfans.com'], pagePatterns: [/\/(?:creator|model|profile)\//i, /^\/[a-z0-9._-]+\/?$/i], media: ['image', 'page'], crawlLimit: 3, publicProfileOnly: true },
  manyvids: { domains: ['manyvids.com'], pagePatterns: [/\/(?:Profile|Video|Store)\//i], media: ['image', 'video', 'page'], crawlLimit: 4, publicProfileOnly: true },
  clips4sale: { domains: ['clips4sale.com'], pagePatterns: [/\/(?:studio|studios|clip)\//i], media: ['image', 'video', 'page'], crawlLimit: 4, publicProfileOnly: true },
  lpsg: { domains: ['lpsg.com'], pagePatterns: [/\/threads\//i, /\/members\//i], media: ['image', 'video', 'page'], crawlLimit: 4, forum: true, transport: 'public-forum-get' },
  adultdvdtalk: { domains: ['adultdvdtalk.com', 'forum.adultdvdtalk.com'], pagePatterns: [/\/(?:forum|threads?|profile|pornstar)\//i, /forum\.asp/i], media: ['image', 'video', 'page'], crawlLimit: 4, forum: true, transport: 'public-forum-get' }
};

module.exports = {
  EXTENDED_SOURCE_DEFINITIONS,
  EXTENDED_SOURCE_ADAPTERS
};
