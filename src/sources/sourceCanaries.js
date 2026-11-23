const { SOURCE_META } = require('./sourceRegistry');

const EXACT_CANARIES = Object.freeze({
  telegram: { query: 'durov', inputType: 'username', expected: 'public_profile_or_media' },
  github: { query: 'torvalds', inputType: 'username', expected: 'public_profile' },
  bluesky: { query: 'nasa.bsky.social', inputType: 'handle', expected: 'public_profile_or_media' },
  mastodon: { query: 'Gargron', inputType: 'username', expected: 'public_profile_or_media' },
  tmdb: { query: 'Tom Hanks', inputType: 'display_name', expected: 'identity_metadata' },
  musicbrainz: { query: 'David Bowie', inputType: 'display_name', expected: 'identity_metadata' },
  wikidata: { query: 'Douglas Adams', inputType: 'display_name', expected: 'identity_metadata' },
  wayback: { query: 'nasa.gov', inputType: 'domain', expected: 'archive_capture_or_media' },
  internetarchive: { query: 'NASA', inputType: 'keyword', expected: 'archive_item_or_media' },
  commoncrawl: { query: 'nasa.gov', inputType: 'domain', expected: 'archive_record_or_media' },
  arquivo: { query: 'nasa.gov', inputType: 'domain', expected: 'archive_record_or_media' },
  coomer: { query: 'amouranth', inputType: 'username', expected: 'public_identity_metadata' },
  gelbooru: { query: 'landscape', inputType: 'tag', expected: 'public_media' },
  danbooru: { query: 'landscape', inputType: 'tag', expected: 'public_media' },
  wikipedia: { query: 'Douglas Adams', inputType: 'display_name', expected: 'identity_metadata' },
  tvmaze: { query: 'Tom Hanks', inputType: 'display_name', expected: 'identity_metadata' },
  openlibrary: { query: 'Douglas Adams', inputType: 'display_name', expected: 'identity_metadata' },
  nasalibrary: { query: 'Apollo', inputType: 'keyword', expected: 'public_media' },
  loc: { query: 'NASA', inputType: 'keyword', expected: 'public_media' },
  metmuseum: { query: 'sunflowers', inputType: 'keyword', expected: 'public_media' },
  safebooru: { query: 'landscape', inputType: 'tag', expected: 'public_media' },
  yandere: { query: 'landscape', inputType: 'tag', expected: 'public_media' },
  konachan: { query: 'landscape', inputType: 'tag', expected: 'public_media' },
  yandex: { query: 'NASA', inputType: 'keyword', expected: 'public_media' },
  bingvideos: { query: 'NASA', inputType: 'keyword', expected: 'public_media' },
  civitai: { query: 'cyberpunk', inputType: 'keyword', expected: 'public_media' },
  redtube: { query: 'mia khalifa', inputType: 'keyword', expected: 'public_media' },
  e621: { query: 'landscape', inputType: 'tag', expected: 'public_media' },
  porntrex: { query: 'mia khalifa', inputType: 'keyword', expected: 'public_media' }
});

function defaultCanary(source = {}) {
  if (source.nsfw) {
    return {
      query: 'mia khalifa',
      inputType: source.purpose === 'identity' ? 'display_name' : 'keyword',
      expected: source.purpose === 'identity' ? 'public_identity_metadata_or_profile' : 'public_media_or_empty'
    };
  }
  if (source.category === 'identity' || source.purpose === 'identity') {
    return { query: 'Douglas Adams', inputType: 'display_name', expected: 'public_identity_metadata_or_profile' };
  }
  return { query: 'NASA', inputType: 'keyword', expected: 'public_media_or_empty' };
}

function sourceCanary(sourceOrId) {
  const source = typeof sourceOrId === 'string' ? SOURCE_META[sourceOrId] : sourceOrId;
  if (!source?.id) return null;
  return {
    sourceId: source.id,
    ...(EXACT_CANARIES[source.id] || defaultCanary(source)),
    safe: source.nsfw !== true,
    adultConfirmed: source.nsfw === true,
    publicOnly: true
  };
}

function allSourceCanaries() {
  return Object.values(SOURCE_META).map(sourceCanary);
}

module.exports = {
  EXACT_CANARIES,
  sourceCanary,
  allSourceCanaries
};
