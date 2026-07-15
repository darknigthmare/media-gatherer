const zlib = require('node:zlib');

let commonCrawlCollectionCache = null;
const MAX_WARC_OUTPUT_BYTES = 12 * 1024 * 1024;

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matchesQuery(value, query) {
  const haystack = normalize(value);
  const needle = normalize(query);
  if (!needle) return true;
  if (haystack.includes(needle)) return true;
  const compactNeedle = needle.replace(/\s+/g, '');
  if (compactNeedle.length >= 3 && haystack.replace(/\s+/g, '').includes(compactNeedle)) return true;
  const tokens = needle.split(/\s+/).filter(token => token.length >= 2);
  return tokens.length > 0 && tokens.every(token => haystack.includes(token));
}

function absoluteUrl(value, base) {
  try { return new URL(String(value || ''), base).toString(); } catch { return ''; }
}

function instanceUrl(value, fallback) {
  const raw = String(value || fallback || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function statusFor(adapter, images, videos, extra = {}) {
  const total = images.length + videos.length;
  return {
    success: extra.success !== false,
    available: extra.available !== false,
    skipped: extra.zeroReason === 'missing_credentials' || extra.zeroReason === 'missing_configuration',
    adapter,
    imagesCount: images.length,
    videosCount: videos.length,
    zeroReason: total ? '' : (extra.zeroReason || 'no_matching_public_media'),
    note: extra.note || `${total} media public`,
    accounts: extra.accounts || [],
    identityAliases: extra.identityAliases || [],
    pageSamples: extra.pageSamples || [],
    pagesDiscovered: Number(extra.pagesDiscovered || 0),
    pagesCrawled: Number(extra.pagesCrawled || 0),
    fallbackUsed: extra.fallbackUsed === true,
    directReachable: extra.directReachable !== false
  };
}

function normalizeRaw(raw, query, sourceId, deps) {
  const images = [];
  const videos = [];
  for (const item of raw.media || []) {
    if (!item?.url) continue;
    const kind = item.type === 'video' ? 'video' : 'image';
    const normalized = deps.enrichMedia(item, query, sourceId, kind);
    if (kind === 'video') videos.push(normalized);
    else images.push(normalized);
  }
  return {
    images: deps.dedupeBestMedia(images).slice(0, deps.imageLimit),
    videos: deps.dedupeBestMedia(videos).slice(0, deps.videoLimit)
  };
}

function parseSearxngResults(payload = {}, query = '') {
  const media = [];
  const pages = [];
  for (const row of payload.results || []) {
    const title = row.title || row.content || row.url || '';
    const context = `${title} ${row.content || ''} ${row.url || ''}`;
    if (!matchesQuery(context, query)) continue;
    const link = row.url || '';
    const image = row.img_src || row.image_src || row.thumbnail_src || row.thumbnail || '';
    const category = String(row.category || '').toLowerCase();
    const looksVideo = category.includes('video') || /\.(?:mp4|webm|mov|m3u8)(?:[?#]|$)/i.test(link);
    if (looksVideo && link) {
      media.push({ type: 'video', url: link, link, thumbnail: image, title, description: row.content, playback: 'external', trustedContext: true });
    } else if (image) {
      media.push({ type: 'image', url: absoluteUrl(row.img_src || row.image_src || image, link || 'https://example.invalid/'), thumbnail: absoluteUrl(image, link || 'https://example.invalid/'), link, title, description: row.content, trustedContext: true });
    }
    if (link) pages.push({ url: link, title });
  }
  return { media: media.filter(item => item.url), pages };
}

function parseLemmyResults(payload = {}, query = '', instance = 'https://lemmy.world') {
  const media = [];
  const aliases = [];
  const accounts = [];
  const pages = [];
  const rows = payload.posts || payload.results || payload.post_views || payload.items || [];
  for (const row of rows) {
    const post = row.post || row.post_view?.post || row;
    const creator = row.creator || row.post_view?.creator || post.creator || {};
    const title = post.name || post.title || '';
    const description = post.body || post.alt_text || '';
    const context = `${title} ${description} ${creator.name || ''} ${post.url || ''}`;
    if (!matchesQuery(context, query)) continue;
    const link = post.ap_id || post.id_url || `${instance}/post/${post.id}`;
    const candidate = post.url || post.thumbnail_url || '';
    const thumbnail = post.thumbnail_url || (/\.(?:jpe?g|png|gif|webp)(?:[?#]|$)/i.test(candidate) ? candidate : '');
    if (/\.(?:mp4|webm|mov|m3u8)(?:[?#]|$)/i.test(candidate)) {
      media.push({ type: 'video', url: candidate, thumbnail, link, title, description, playback: 'direct', trustedContext: true });
    } else if (candidate && (/\.(?:jpe?g|png|gif|webp)(?:[?#]|$)/i.test(candidate) || thumbnail)) {
      media.push({ type: 'image', url: /\.(?:jpe?g|png|gif|webp)(?:[?#]|$)/i.test(candidate) ? candidate : thumbnail, thumbnail: thumbnail || candidate, link, title, description, trustedContext: true });
    }
    if (link) pages.push({ url: link, title });
    if (creator.name) {
      const account = creator.actor_id || `${instance}/u/${creator.name}`;
      accounts.push(account);
      aliases.push({ value: `@${creator.name}`, kind: 'username', confidence: 84, evidence: [account, link].filter(Boolean) });
      if (creator.display_name) aliases.push({ value: creator.display_name, kind: 'display_name', confidence: 78, evidence: [account] });
    }
  }
  for (const row of payload.users || payload.persons || []) {
    const person = row.person || row;
    if (!matchesQuery(`${person.name || ''} ${person.display_name || ''} ${person.bio || ''}`, query)) continue;
    const account = person.actor_id || `${instance}/u/${person.name}`;
    accounts.push(account);
    if (person.name) aliases.push({ value: `@${person.name}`, kind: 'username', confidence: 92, evidence: [account] });
    if (person.display_name) aliases.push({ value: person.display_name, kind: 'display_name', confidence: 86, evidence: [account] });
    if (person.avatar) media.push({ type: 'image', url: person.avatar, thumbnail: person.avatar, link: account, title: person.display_name || person.name, description: person.bio, accountUrl: account, trustedContext: true });
  }
  return { media, aliases, accounts: unique(accounts), pages };
}

function parseGithubUsers(rows = [], query = '') {
  const media = [];
  const aliases = [];
  const accounts = [];
  const pages = [];
  for (const user of rows) {
    const context = `${user.login || ''} ${user.name || ''} ${user.bio || ''} ${user.company || ''}`;
    if (!matchesQuery(context, query)) continue;
    const link = user.html_url || `https://github.com/${user.login}`;
    accounts.push(link);
    pages.push({ url: link, title: user.name || user.login, description: user.bio || '' });
    if (user.login) aliases.push({ value: `@${user.login}`, kind: 'username', confidence: 94, evidence: [link] });
    if (user.name) aliases.push({ value: user.name, kind: 'display_name', confidence: 90, evidence: [link] });
    if (user.twitter_username) aliases.push({ value: `@${user.twitter_username}`, kind: 'username', confidence: 82, evidence: [link, `https://x.com/${user.twitter_username}`] });
    if (user.avatar_url) media.push({ type: 'image', url: user.avatar_url, thumbnail: user.avatar_url, link, title: user.name || user.login, description: user.bio, accountUrl: link, trustedContext: true });
  }
  return { media, aliases, accounts, pages };
}

function odyseeUrl(value) {
  const canonical = String(value || '').replace(/^lbry:\/\//i, '').replace(/#/g, ':');
  return canonical ? `https://odysee.com/${canonical}` : '';
}

function parseOdyseeClaims(payload = {}, query = '') {
  const media = [];
  const aliases = [];
  const accounts = [];
  const pages = [];
  for (const claim of payload.result?.items || payload.items || []) {
    const value = claim.value || {};
    const title = value.title || claim.name || '';
    const description = value.description || '';
    const channel = claim.signing_channel || {};
    const context = `${title} ${description} ${channel.name || ''}`;
    if (!matchesQuery(context, query)) continue;
    const link = odyseeUrl(claim.canonical_url || claim.permanent_url || claim.short_url);
    const thumbnail = absoluteUrl(value.thumbnail?.url || value.thumbnail_url || '', link || 'https://odysee.com/');
    if (link) {
      media.push({ type: 'video', url: link, link, thumbnail, title, description, playback: 'external', trustedContext: true });
      pages.push({ url: link, title });
    }
    const channelUrl = odyseeUrl(channel.canonical_url || channel.permanent_url || channel.short_url);
    if (channelUrl) accounts.push(channelUrl);
    if (channel.name) aliases.push({ value: channel.name.startsWith('@') ? channel.name : `@${channel.name}`, kind: 'username', confidence: 88, evidence: [channelUrl || link].filter(Boolean) });
  }
  return { media, aliases, accounts: unique(accounts), pages };
}

function parseGdeltArticles(payload = {}, query = '') {
  const media = [];
  const pages = [];
  for (const article of payload.articles || []) {
    const title = article.title || '';
    const context = `${title} ${article.domain || ''} ${article.url || ''}`;
    if (!matchesQuery(context, query)) continue;
    const link = article.url || '';
    const image = article.socialimage || article.image || '';
    if (image) media.push({ type: 'image', url: image, thumbnail: image, link, title, description: `${article.domain || ''} ${article.seendate || ''}`.trim(), archivedAt: article.seendate, trustedContext: true });
    if (link) pages.push({ url: link, title });
  }
  return { media, pages };
}

function parsePodcastFeeds(payload = {}, query = '') {
  const media = [];
  const aliases = [];
  const accounts = [];
  const pages = [];
  for (const feed of payload.feeds || []) {
    const title = feed.title || feed.originalTitle || '';
    const description = feed.description || feed.author || feed.ownerName || '';
    if (!matchesQuery(`${title} ${description}`, query)) continue;
    const link = feed.link || feed.url || '';
    const image = feed.artwork || feed.image || feed.itunesImage || '';
    if (image) media.push({ type: 'image', url: image, thumbnail: image, link, title, description, trustedContext: true });
    if (link) pages.push({ url: link, title, description });
    if (feed.author) aliases.push({ value: feed.author, kind: 'display_name', confidence: 72, evidence: [link].filter(Boolean) });
    if (link) accounts.push(link);
  }
  return { media, aliases, accounts: unique(accounts), pages };
}

function parsePexelsResults(photoPayload = {}, videoPayload = {}) {
  const media = [];
  for (const photo of photoPayload.photos || []) {
    const original = photo.src?.original || photo.src?.large2x || photo.src?.large;
    if (!original) continue;
    media.push({ type: 'image', url: original, thumbnail: photo.src?.medium || photo.src?.small || original, link: photo.url, title: photo.alt || `Photo ${photo.id}`, description: photo.photographer ? `Photographer: ${photo.photographer}` : '', width: photo.width, height: photo.height, trustedContext: true });
  }
  for (const video of videoPayload.videos || []) {
    const best = [...(video.video_files || [])].filter(file => file.link).sort((a, b) => (Number(b.width) * Number(b.height)) - (Number(a.width) * Number(a.height)))[0];
    if (!best?.link) continue;
    media.push({ type: 'video', url: best.link, thumbnail: video.image, link: video.url, title: `Pexels video ${video.id}`, width: best.width, height: best.height, durationSeconds: video.duration, playback: 'direct', trustedContext: true });
  }
  return { media };
}

function parseGiphyResults(payload = {}) {
  return {
    media: (payload.data || []).map(row => {
      const original = row.images?.original || {};
      const preview = row.images?.fixed_width || row.images?.downsized || original;
      return { type: 'image', url: original.url, thumbnail: preview.url || original.url, link: row.url, title: row.title || row.username || 'GIPHY', description: row.username ? `Creator: ${row.username}` : '', width: original.width, height: original.height, trustedContext: true };
    }).filter(item => item.url)
  };
}

function parseGelbooruPosts(payload = {}) {
  const rows = Array.isArray(payload) ? payload : (payload.post || []);
  return {
    media: rows.map(row => {
      const original = absoluteUrl(row.file_url || row.sample_url, 'https://gelbooru.com/');
      const video = /\.(?:mp4|webm|mov)(?:[?#]|$)/i.test(original);
      return {
        type: video ? 'video' : 'image',
        url: original,
        thumbnail: absoluteUrl(row.preview_url || row.sample_url || row.file_url, 'https://gelbooru.com/'),
        link: row.id ? `https://gelbooru.com/index.php?page=post&s=view&id=${row.id}` : row.source,
        title: String(row.tags || '').split(/\s+/).slice(0, 12).join(' '),
        description: row.source || '',
        width: row.width,
        height: row.height,
        rating: row.rating,
        playback: video ? 'direct' : undefined,
        trustedContext: true
      };
    }).filter(item => item.url)
  };
}

function parseDanbooruPosts(rows = []) {
  return {
    media: rows.map(row => {
      const original = row.large_file_url || row.file_url || row.source;
      const video = ['mp4', 'webm', 'mov'].includes(String(row.file_ext || '').toLowerCase()) || /\.(?:mp4|webm|mov)(?:[?#]|$)/i.test(original);
      return {
        type: video ? 'video' : 'image',
        url: original,
        thumbnail: row.preview_file_url || row.large_file_url || row.file_url,
        link: row.id ? `https://danbooru.donmai.us/posts/${row.id}` : row.source,
        title: [row.tag_string_character, row.tag_string_artist].filter(Boolean).join(' - ') || row.tag_string_general,
        description: row.source || '',
        width: row.image_width,
        height: row.image_height,
        rating: row.rating,
        playback: video ? 'direct' : undefined,
        trustedContext: true
      };
    }).filter(item => item.url)
  };
}

function findHeaderBoundary(buffer, start = 0) {
  const crlf = buffer.indexOf(Buffer.from('\r\n\r\n'), start);
  const lf = buffer.indexOf(Buffer.from('\n\n'), start);
  if (crlf < 0) return lf < 0 ? null : { index: lf, length: 2 };
  if (lf < 0 || crlf <= lf) return { index: crlf, length: 4 };
  return { index: lf, length: 2 };
}

function decodeWarcHtml(compressed) {
  const record = zlib.gunzipSync(Buffer.from(compressed), { maxOutputLength: MAX_WARC_OUTPUT_BYTES });
  const warcBoundary = findHeaderBoundary(record);
  if (!warcBoundary) return '';
  const httpStart = warcBoundary.index + warcBoundary.length;
  const httpBoundary = findHeaderBoundary(record, httpStart);
  if (!httpBoundary) return '';
  const headers = record.subarray(httpStart, httpBoundary.index).toString('latin1');
  let body = record.subarray(httpBoundary.index + httpBoundary.length);
  try {
    if (/^content-encoding:\s*gzip/im.test(headers)) body = zlib.gunzipSync(body, { maxOutputLength: MAX_WARC_OUTPUT_BYTES });
    else if (/^content-encoding:\s*br/im.test(headers)) body = zlib.brotliDecompressSync(body, { maxOutputLength: MAX_WARC_OUTPUT_BYTES });
    else if (/^content-encoding:\s*deflate/im.test(headers)) body = zlib.inflateSync(body, { maxOutputLength: MAX_WARC_OUTPUT_BYTES });
  } catch {
    return '';
  }
  return body.toString('utf8');
}

function parseCdxLines(payload) {
  if (Array.isArray(payload)) return payload;
  return String(payload || '').split(/\r?\n/).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

async function latestCommonCrawlCollection(deps) {
  if (commonCrawlCollectionCache && commonCrawlCollectionCache.expiresAt > Date.now()) return commonCrawlCollectionCache.collection;
  const rows = await deps.fetchText('https://index.commoncrawl.org/collinfo.json', { timeout: 10000 });
  const latest = Array.isArray(rows) ? rows[0] : null;
  if (!latest?.id) throw new Error('Index Common Crawl indisponible');
  const collection = {
    id: latest.id,
    endpoint: latest['cdx-api'] || `https://index.commoncrawl.org/${latest.id}-index`
  };
  commonCrawlCollectionCache = { collection, expiresAt: Date.now() + (6 * 60 * 60 * 1000) };
  return collection;
}

async function runCommonCrawl(query, deps) {
  const candidates = (await deps.discoverArchivePages(query, 4)).filter(page => /^https?:\/\//i.test(page.url));
  if (!candidates.length) return { images: [], videos: [], status: statusFor('commoncrawl-warc', [], [], { note: 'Aucune URL publique a rechercher dans Common Crawl', zeroReason: 'no_candidate_urls', pagesDiscovered: 0 }) };
  let collection;
  try {
    collection = await latestCommonCrawlCollection(deps);
  } catch (error) {
    const rateLimited = error.status === 429;
    return {
      images: [],
      videos: [],
      status: statusFor('commoncrawl-warc', [], [], {
        success: false,
        available: !rateLimited,
        directReachable: false,
        zeroReason: rateLimited ? 'rate_limited' : 'source_unreachable',
        note: `Index Common Crawl indisponible: ${error.message}`,
        pagesDiscovered: candidates.length
      })
    };
  }
  const raw = { media: [] };
  const pageSamples = [];
  const failures = [];
  let captures = 0;
  let pagesCrawled = 0;
  for (const page of candidates.slice(0, 3)) {
    try {
      const params = new URLSearchParams({ url: page.url, output: 'json', limit: '1', collapse: 'digest' });
      params.append('filter', 'status:200');
      params.append('filter', 'mime:text/html');
      const indexPayload = await deps.fetchText(`${collection.endpoint}?${params.toString()}`, { timeout: 10000 });
      const capture = parseCdxLines(indexPayload).at(-1);
      if (!capture?.filename || !capture?.offset || !capture?.length) continue;
      captures += 1;
      const compressed = await deps.fetchBinaryRange(`https://data.commoncrawl.org/${capture.filename}`, Number(capture.offset), Number(capture.length), { timeout: 12000 });
      const html = decodeWarcHtml(compressed);
      if (!html) {
        failures.push({ url: page.url, error: 'WARC sans reponse HTML extractible' });
        continue;
      }
      pagesCrawled += 1;
      const extracted = deps.extractArchivedMedia(html, page.url, query, 'commoncrawl');
      raw.media.push(...extracted.images.map(item => ({ ...item, type: 'image', archivedAt: capture.timestamp })), ...extracted.videos.map(item => ({ ...item, type: 'video', archivedAt: capture.timestamp })));
      pageSamples.push({ url: page.url, title: page.title || page.url, archivedAt: capture.timestamp, collection: collection.id });
    } catch (error) {
      failures.push({ url: page.url, status: error.status || 0, error: error.message });
    }
  }
  const normalized = normalizeRaw(raw, query, 'commoncrawl', deps);
  const rateLimited = failures.some(failure => failure.status === 429);
  return {
    ...normalized,
    status: statusFor('commoncrawl-warc', normalized.images, normalized.videos, {
      success: !rateLimited,
      available: !rateLimited,
      note: `${captures} captures trouvees, ${pagesCrawled} WARC ouvertes dans ${collection.id}${failures.length ? `; ${failures.length} essais ignores` : ''}`,
      pageSamples,
      pagesDiscovered: candidates.length,
      pagesCrawled,
      zeroReason: rateLimited ? 'rate_limited' : (captures ? 'archived_pages_without_matching_media' : 'no_commoncrawl_capture')
    })
  };
}

async function runSearxng(query, deps) {
  const configured = deps.connectionValue('searxng', 'instance', 'SEARXNG_INSTANCE');
  if (!configured) return { images: [], videos: [], status: statusFor('searxng-api', [], [], { success: false, available: false, zeroReason: 'missing_configuration', note: 'Renseignez une instance SearXNG avec sortie JSON dans Connexions API' }) };
  const base = instanceUrl(configured);
  const endpoint = new URL('/search', `${base}/`);
  endpoint.search = new URLSearchParams({ q: query, format: 'json', categories: 'images,videos', safesearch: deps.adultConfirmed ? '0' : '2', language: 'all' }).toString();
  const payload = await deps.fetchText(endpoint.toString(), { headers: { accept: 'application/json' } });
  if (typeof payload === 'string') throw new Error('Instance SearXNG sans sortie JSON activee');
  const parsed = parseSearxngResults(payload, query);
  const normalized = normalizeRaw(parsed, query, 'searxng', deps);
  return { ...normalized, status: statusFor('searxng-api', normalized.images, normalized.videos, { note: `Instance ${new URL(base).hostname}`, pageSamples: parsed.pages }) };
}

async function runLemmy(query, deps) {
  const base = instanceUrl(deps.connectionValue('lemmy', 'instance', 'LEMMY_INSTANCE'), 'https://lemmy.world');
  const token = deps.connectionValue('lemmy', 'accessToken', 'LEMMY_ACCESS_TOKEN');
  const headers = { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const limit = String(Math.min(deps.imageLimit + deps.videoLimit, 30));
  const params = new URLSearchParams({ search_term: query, type_: 'posts', listing_type: 'all', show_nsfw: String(deps.adultConfirmed), limit });
  let payload;
  try {
    payload = await deps.fetchText(`${base}/api/v4/search?${params}`, { headers });
  } catch {
    const legacyParams = new URLSearchParams({ q: query, type_: 'Posts', listing_type: 'All', show_nsfw: String(deps.adultConfirmed), limit });
    payload = await deps.fetchText(`${base}/api/v3/search?${legacyParams}`, { headers });
  }
  let people = {};
  const personParams = new URLSearchParams({ search_term: query, type_: 'users', listing_type: 'all', limit: '8' });
  try { people = await deps.fetchText(`${base}/api/v4/search?${personParams}`, { headers }); } catch {
    const legacyPersonParams = new URLSearchParams({ q: query, type_: 'Users', listing_type: 'All', limit: '8' });
    try { people = await deps.fetchText(`${base}/api/v3/search?${legacyPersonParams}`, { headers }); } catch { people = {}; }
  }
  const parsed = parseLemmyResults({ ...payload, users: people.users || people.persons || people.items || [] }, query, base);
  const normalized = normalizeRaw(parsed, query, 'lemmy', deps);
  return { ...normalized, status: statusFor('lemmy-api', normalized.images, normalized.videos, { note: `API publique ${new URL(base).hostname}`, identityAliases: parsed.aliases, accounts: parsed.accounts, pageSamples: parsed.pages }) };
}

async function runGithub(query, deps) {
  const token = deps.connectionValue('github', 'token', 'GITHUB_TOKEN');
  const headers = { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const search = await deps.fetchText(`https://api.github.com/search/users?q=${encodeURIComponent(query)}&per_page=5`, { headers });
  const details = [];
  for (const row of (search.items || []).slice(0, 4)) {
    try { details.push(await deps.fetchText(`https://api.github.com/users/${encodeURIComponent(row.login)}`, { headers })); } catch { details.push(row); }
  }
  const parsed = parseGithubUsers(details, query);
  const normalized = normalizeRaw(parsed, query, 'github', deps);
  return { ...normalized, status: statusFor('github-users-api', normalized.images, normalized.videos, { note: token ? 'API GitHub avec jeton personnel' : 'API GitHub publique non authentifiee', identityAliases: parsed.aliases, accounts: parsed.accounts, pageSamples: parsed.pages }) };
}

async function runOdysee(query, deps) {
  const payload = await deps.postJson('https://api.na-backend.odysee.com/api/v1/proxy', {
    jsonrpc: '2.0',
    id: 1,
    method: 'claim_search',
    params: { text: query, page: 1, page_size: Math.min(deps.videoLimit, 20), claim_type: ['stream'], stream_types: ['video'], order_by: ['release_time'] }
  });
  const parsed = parseOdyseeClaims(payload, query);
  const normalized = normalizeRaw(parsed, query, 'odysee', deps);
  return { ...normalized, status: statusFor('odysee-claims-api', normalized.images, normalized.videos, { note: 'Index public de claims Odysee/LBRY', identityAliases: parsed.aliases, accounts: parsed.accounts, pageSamples: parsed.pages }) };
}

async function runMusicBrainz(query, deps) {
  const headers = { accept: 'application/json', 'user-agent': deps.userAgent };
  const search = await deps.fetchText(`https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(query)}&limit=8&fmt=json`, { headers });
  const artists = (search.artists || []).filter(artist => matchesQuery(`${artist.name || ''} ${(artist.aliases || []).map(alias => alias.name).join(' ')}`, query));
  const selected = artists.sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
  if (!selected) return { images: [], videos: [], status: statusFor('musicbrainz-api', [], [], { note: 'Aucun artiste MusicBrainz correspondant' }) };
  let details = selected;
  try { details = await deps.fetchText(`https://musicbrainz.org/ws/2/artist/${encodeURIComponent(selected.id)}?inc=aliases+url-rels&fmt=json`, { headers }); } catch { details = selected; }
  const link = `https://musicbrainz.org/artist/${selected.id}`;
  const aliases = [{ value: details.name || selected.name, kind: 'display_name', confidence: 96, evidence: [link] }];
  for (const alias of details.aliases || selected.aliases || []) if (alias.name) aliases.push({ value: alias.name, kind: 'display_name', confidence: alias.primary ? 94 : 86, evidence: [link] });
  const accounts = unique((details.relations || []).map(relation => relation.url?.resource));
  return { images: [], videos: [], status: statusFor('musicbrainz-api', [], [], { note: `Artiste MusicBrainz: ${details.name || selected.name}`, zeroReason: 'identity_metadata_only', identityAliases: aliases, accounts, pageSamples: [{ url: link, title: details.name || selected.name, description: details.disambiguation || selected.disambiguation || '' }] }) };
}

async function runGdelt(query, deps) {
  const params = new URLSearchParams({ query: `"${query}"`, mode: 'ArtList', maxrecords: String(Math.min(deps.imageLimit, 50)), format: 'json', sort: 'HybridRel' });
  let payload;
  try {
    payload = await deps.fetchText(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, { timeout: 20000, headers: { accept: 'application/json' } });
  } catch (error) {
    const rateLimited = error.status === 429;
    return {
      images: [],
      videos: [],
      status: statusFor('gdelt-doc-api', [], [], {
        success: false,
        available: !rateLimited,
        directReachable: false,
        zeroReason: rateLimited ? 'rate_limited' : 'source_unreachable',
        note: `GDELT indisponible: ${error.message}`
      })
    };
  }
  let gdeltPayload;
  try {
    gdeltPayload = typeof payload === 'string' ? JSON.parse(payload) : payload;
  } catch {
    return {
      images: [],
      videos: [],
      status: statusFor('gdelt-doc-api', [], [], {
        success: false,
        available: false,
        directReachable: false,
        zeroReason: 'source_unreachable',
        note: 'GDELT a renvoye une reponse non JSON'
      })
    };
  }
  const parsed = parseGdeltArticles(gdeltPayload, query);
  const normalized = normalizeRaw(parsed, query, 'gdelt', deps);
  return { ...normalized, status: statusFor('gdelt-doc-api', normalized.images, normalized.videos, { note: 'Articles publics GDELT DOC 2.0', pageSamples: parsed.pages }) };
}

async function runPodcastIndex(query, deps) {
  const apiKey = deps.connectionValue('podcastindex', 'apiKey', 'PODCAST_INDEX_API_KEY');
  const apiSecret = deps.connectionValue('podcastindex', 'apiSecret', 'PODCAST_INDEX_API_SECRET');
  if (!apiKey || !apiSecret) return { images: [], videos: [], status: statusFor('podcast-index-api', [], [], { success: false, available: false, zeroReason: 'missing_credentials', note: 'Cle et secret Podcast Index requis dans Connexions API' }) };
  const authDate = String(Math.floor(Date.now() / 1000));
  const headers = { 'X-Auth-Date': authDate, 'X-Auth-Key': apiKey, Authorization: deps.sha1(`${apiKey}${apiSecret}${authDate}`), 'User-Agent': deps.userAgent, accept: 'application/json' };
  const payload = await deps.fetchText(`https://api.podcastindex.org/api/1.0/search/byterm?q=${encodeURIComponent(query)}&max=20&clean=true`, { headers });
  const parsed = parsePodcastFeeds(payload, query);
  const normalized = normalizeRaw(parsed, query, 'podcastindex', deps);
  return { ...normalized, status: statusFor('podcast-index-api', normalized.images, normalized.videos, { note: 'Recherche officielle Podcast Index', identityAliases: parsed.aliases, accounts: parsed.accounts, pageSamples: parsed.pages }) };
}

async function runPixelfed(query, deps) {
  const base = instanceUrl(deps.connectionValue('pixelfed', 'instance', 'PIXELFED_INSTANCE'), 'https://pixelfed.social');
  const token = deps.connectionValue('pixelfed', 'accessToken', 'PIXELFED_ACCESS_TOKEN');
  const headers = { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const search = await deps.fetchText(`${base}/api/v2/search?q=${encodeURIComponent(query)}&type=accounts&limit=8${token ? '&resolve=true' : ''}`, { headers });
  const raw = { media: [] };
  const aliases = [];
  const accounts = [];
  for (const account of search.accounts || []) {
    if (!matchesQuery(`${account.acct || ''} ${account.display_name || ''}`, query)) continue;
    const accountUrl = account.url || `${base}/@${account.acct}`;
    accounts.push(accountUrl);
    aliases.push({ value: `@${account.acct}`, kind: 'username', confidence: 92, evidence: [accountUrl] });
    if (account.display_name) aliases.push({ value: account.display_name, kind: 'display_name', confidence: 84, evidence: [accountUrl] });
    const statuses = await deps.fetchText(`${base}/api/v1/accounts/${encodeURIComponent(account.id)}/statuses?exclude_replies=true&limit=16`, { headers });
    for (const status of statuses || []) {
      for (const attachment of status.media_attachments || []) {
        raw.media.push({ type: ['video', 'gifv'].includes(attachment.type) ? 'video' : 'image', url: attachment.url || attachment.remote_url, thumbnail: attachment.preview_url, link: status.url, title: `${account.display_name || account.acct} - ${String(status.content || '').replace(/<[^>]+>/g, ' ')}`, accountUrl, width: attachment.meta?.original?.width, height: attachment.meta?.original?.height, trustedContext: true });
      }
    }
  }
  const normalized = normalizeRaw(raw, query, 'pixelfed', deps);
  return { ...normalized, status: statusFor('pixelfed-api', normalized.images, normalized.videos, { note: `${accounts.length} comptes publics sur ${new URL(base).hostname}`, identityAliases: aliases, accounts }) };
}

async function runPexels(query, deps) {
  const apiKey = deps.connectionValue('pexels', 'apiKey', 'PEXELS_API_KEY');
  if (!apiKey) return { images: [], videos: [], status: statusFor('pexels-api', [], [], { success: false, available: false, zeroReason: 'missing_credentials', note: 'Cle Pexels requise dans Connexions API' }) };
  const headers = { authorization: apiKey, accept: 'application/json' };
  const [photos, videos] = await Promise.all([
    deps.fetchText(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${Math.min(deps.imageLimit, 40)}`, { headers }),
    deps.fetchText(`https://api.pexels.com/v1/videos/search?query=${encodeURIComponent(query)}&per_page=${Math.min(deps.videoLimit, 40)}`, { headers })
  ]);
  const parsed = parsePexelsResults(photos, videos);
  const normalized = normalizeRaw(parsed, query, 'pexels', deps);
  normalized.videos = normalized.videos.map(item => ({ ...item, duration: deps.formatDuration(item.durationSeconds) }));
  return { ...normalized, status: statusFor('pexels-api', normalized.images, normalized.videos, { note: 'API officielle Pexels photos et videos' }) };
}

async function runGiphy(query, deps) {
  const apiKey = deps.connectionValue('giphy', 'apiKey', 'GIPHY_API_KEY');
  if (!apiKey) return { images: [], videos: [], status: statusFor('giphy-api', [], [], { success: false, available: false, zeroReason: 'missing_credentials', note: 'Cle GIPHY requise dans Connexions API' }) };
  const payload = await deps.fetchText(`https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(query)}&limit=${Math.min(deps.imageLimit, 40)}&rating=${deps.adultConfirmed ? 'r' : 'pg-13'}&lang=fr`);
  const parsed = parseGiphyResults(payload);
  const normalized = normalizeRaw(parsed, query, 'giphy', deps);
  return { ...normalized, status: statusFor('giphy-api', normalized.images, normalized.videos, { note: 'API officielle GIPHY' }) };
}

async function runGelbooru(query, deps) {
  const params = new URLSearchParams({ page: 'dapi', s: 'post', q: 'index', json: '1', limit: String(Math.min(deps.imageLimit, 100)), tags: normalize(query).replace(/\s+/g, '_') });
  const apiKey = deps.connectionValue('gelbooru', 'apiKey', 'GELBOORU_API_KEY');
  const userId = deps.connectionValue('gelbooru', 'userId', 'GELBOORU_USER_ID');
  if (apiKey) params.set('api_key', apiKey);
  if (userId) params.set('user_id', userId);
  let payload;
  try {
    payload = await deps.fetchText(`https://gelbooru.com/index.php?${params}`, { headers: { accept: 'application/json' } });
  } catch (error) {
    if ([401, 403].includes(error.status)) {
      return {
        images: [],
        videos: [],
        status: statusFor('gelbooru-dapi', [], [], {
          success: false,
          available: false,
          zeroReason: apiKey && userId ? 'invalid_credentials' : 'missing_credentials',
          note: apiKey && userId ? `Gelbooru refuse les identifiants personnels: HTTP ${error.status}` : 'Gelbooru exige actuellement un API key et un User ID personnels'
        })
      };
    }
    throw error;
  }
  let gelbooruPayload;
  try {
    gelbooruPayload = typeof payload === 'string' ? JSON.parse(payload) : payload;
  } catch {
    const blocked = /(?:<html|captcha|cloudflare|just a moment)/i.test(String(payload || ''));
    return {
      images: [],
      videos: [],
      status: statusFor('gelbooru-dapi', [], [], {
        success: false,
        available: false,
        directReachable: false,
        zeroReason: blocked ? 'access_blocked' : 'source_unreachable',
        note: blocked ? 'Gelbooru a renvoye une page anti-bot' : 'Gelbooru a renvoye une reponse non JSON'
      })
    };
  }
  const parsed = parseGelbooruPosts(gelbooruPayload);
  const normalized = normalizeRaw(parsed, query, 'gelbooru', deps);
  return { ...normalized, status: statusFor('gelbooru-dapi', normalized.images, normalized.videos, { note: apiKey ? 'Gelbooru DAPI avec cle personnelle' : 'Gelbooru DAPI publique' }) };
}

async function runDanbooru(query, deps) {
  const params = new URLSearchParams({ tags: normalize(query).replace(/\s+/g, '_'), limit: String(Math.min(deps.imageLimit, 100)) });
  const login = deps.connectionValue('danbooru', 'login', 'DANBOORU_LOGIN');
  const apiKey = deps.connectionValue('danbooru', 'apiKey', 'DANBOORU_API_KEY');
  if (login) params.set('login', login);
  if (apiKey) params.set('api_key', apiKey);
  const payload = await deps.fetchText(`https://danbooru.donmai.us/posts.json?${params}`, { headers: { accept: 'application/json' } });
  const parsed = parseDanbooruPosts(Array.isArray(payload) ? payload : []);
  const normalized = normalizeRaw(parsed, query, 'danbooru', deps);
  return { ...normalized, status: statusFor('danbooru-api', normalized.images, normalized.videos, { note: apiKey ? 'Danbooru API avec cle personnelle' : 'Danbooru API publique' }) };
}

async function runDiscoverySource(sourceId, query, options = {}, deps = {}) {
  const scoped = {
    ...deps,
    imageLimit: Number(options.imageLimit || 35),
    videoLimit: Number(options.videoLimit || 20),
    adultConfirmed: options.adultConfirmed === true
  };
  if (sourceId === 'commoncrawl') return runCommonCrawl(query, scoped);
  if (sourceId === 'searxng') return runSearxng(query, scoped);
  if (sourceId === 'lemmy') {
    try { return await runLemmy(query, scoped); } catch { return null; }
  }
  if (sourceId === 'github') return runGithub(query, scoped);
  if (sourceId === 'odysee') return runOdysee(query, scoped);
  if (sourceId === 'musicbrainz') return runMusicBrainz(query, scoped);
  if (sourceId === 'gdelt') return runGdelt(query, scoped);
  if (sourceId === 'podcastindex') return runPodcastIndex(query, scoped);
  if (sourceId === 'pixelfed') {
    try { return await runPixelfed(query, scoped); } catch { return null; }
  }
  if (sourceId === 'pexels') return runPexels(query, scoped);
  if (sourceId === 'giphy') return runGiphy(query, scoped);
  if (sourceId === 'gelbooru') return runGelbooru(query, scoped);
  if (sourceId === 'danbooru') return runDanbooru(query, scoped);
  return null;
}

module.exports = {
  runDiscoverySource,
  parseSearxngResults,
  parseLemmyResults,
  parseGithubUsers,
  parseOdyseeClaims,
  parseGdeltArticles,
  parsePodcastFeeds,
  parsePexelsResults,
  parseGiphyResults,
  parseGelbooruPosts,
  parseDanbooruPosts,
  decodeWarcHtml
};
