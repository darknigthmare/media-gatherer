function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function normalizeIdentityText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function textMatchesAllQueryTokens(value, query) {
  const haystack = normalizeIdentityText(value);
  const needle = normalizeIdentityText(query);
  if (!needle) return true;
  if (haystack.includes(needle)) return true;

  const compactHaystack = haystack.replace(/\s+/g, '');
  const compactNeedle = needle.replace(/\s+/g, '');
  if (compactNeedle.length >= 3 && compactHaystack.includes(compactNeedle)) return true;

  const tokens = needle.split(/\s+/).filter(token => token.length >= 2);
  return tokens.length > 0 && tokens.every(token => haystack.includes(token));
}

function textContainsQueryPhrase(value, query) {
  const haystack = normalizeIdentityText(value);
  const needle = normalizeIdentityText(query);
  if (!needle) return true;
  if (haystack.includes(needle)) return true;
  const compactNeedle = needle.replace(/\s+/g, '');
  return compactNeedle.length >= 3 && haystack.replace(/\s+/g, '').includes(compactNeedle);
}

function uniqueAliasCandidates(candidates = []) {
  const map = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.kind || 'display_name'}:${normalizeIdentityText(String(candidate.value || '').replace(/^@/, ''))}`;
    if (!key.endsWith(':') && !map.has(key)) map.set(key, candidate);
  }
  return [...map.values()];
}

function claimEntityIds(entity, property) {
  return (entity?.claims?.[property] || [])
    .map(claim => claim?.mainsnak?.datavalue?.value?.id || claim?.mainsnak?.datavalue?.value)
    .filter(value => typeof value === 'string');
}

function claimYear(entity, property) {
  const time = entity?.claims?.[property]?.[0]?.mainsnak?.datavalue?.value?.time;
  const match = String(time || '').match(/[+-](\d{4,})-/);
  return match ? Number(match[1]) : null;
}

function claimTextValues(entity, property) {
  return (entity?.claims?.[property] || []).map(claim => {
    const value = claim?.mainsnak?.datavalue?.value;
    if (typeof value === 'string') return value;
    return typeof value?.text === 'string' ? value.text : '';
  }).filter(Boolean);
}

function selectWikidataEntity(searchRows = [], entities = {}, query = '', identityContext = {}) {
  const queryKey = normalizeIdentityText(query);
  const positiveKeywords = (identityContext.positiveKeywords || []).map(normalizeIdentityText).filter(Boolean);
  const excludeKeywords = (identityContext.excludeKeywords || []).map(normalizeIdentityText).filter(Boolean);
  const expectedBirthYear = Number(identityContext.birthYear) || null;
  const socialProperties = ['P2002', 'P2003', 'P7085', 'P5797', 'P8604'];

  const ranked = searchRows.map((row, index) => {
    const entity = entities[row.id];
    if (!entity || entity.missing) return null;
    const label = entity.labels?.fr?.value || entity.labels?.en?.value || row.label || '';
    const labelKey = normalizeIdentityText(label);
    const matchKey = normalizeIdentityText(row.match?.text);
    const description = entity.descriptions?.fr?.value || entity.descriptions?.en?.value || row.description || '';
    const contextText = normalizeIdentityText(`${label} ${description}`);
    const instanceOf = claimEntityIds(entity, 'P31');
    const birthYear = claimYear(entity, 'P569');
    let score = Math.max(0, 28 - (index * 3));

    if (labelKey === queryKey) score += 110;
    else if (labelKey.includes(queryKey) || queryKey.includes(labelKey)) score += 45;
    if (matchKey === queryKey) score += 30;
    if (instanceOf.includes('Q5')) score += 24;
    if (instanceOf.includes('Q4167410')) score -= 220;
    if (entity.claims?.P18?.length) score += 10;
    score += Math.min(50, Math.floor(Object.keys(entity.sitelinks || {}).length / 3));
    score += Math.min(15, socialProperties.filter(property => entity.claims?.[property]?.length).length * 3);

    if (expectedBirthYear && birthYear === expectedBirthYear) score += 100;
    else if (expectedBirthYear && birthYear && birthYear !== expectedBirthYear) score -= 35;
    positiveKeywords.forEach(keyword => { if (contextText.includes(keyword)) score += 35; });
    excludeKeywords.forEach(keyword => { if (contextText.includes(keyword)) score -= 90; });

    return { row, entity, label, description, score, birthYear };
  }).filter(Boolean).sort((a, b) => b.score - a.score);

  return ranked[0] || null;
}

function selectTmdbPerson(results = [], query = '', identityContext = {}) {
  const queryKey = normalizeIdentityText(query);
  const positiveKeywords = (identityContext.positiveKeywords || []).map(normalizeIdentityText).filter(Boolean);
  const excludeKeywords = (identityContext.excludeKeywords || []).map(normalizeIdentityText).filter(Boolean);
  return results.map((person, index) => {
    const nameKey = normalizeIdentityText(person.name);
    const contextText = normalizeIdentityText(`${person.name || ''} ${(person.known_for || []).map(row => `${row.title || row.name || ''} ${row.overview || ''}`).join(' ')}`);
    let score = Math.max(0, 25 - (index * 2));
    if (nameKey === queryKey) score += 110;
    else if (nameKey.includes(queryKey) || queryKey.includes(nameKey)) score += 40;
    score += Math.min(70, Number(person.popularity || 0));
    if (person.profile_path) score += 8;
    positiveKeywords.forEach(keyword => { if (contextText.includes(keyword)) score += 25; });
    excludeKeywords.forEach(keyword => { if (contextText.includes(keyword)) score -= 75; });
    return { person, score };
  }).sort((a, b) => b.score - a.score)[0] || null;
}

function parseBlueskyResults(payload = {}, query = '') {
  const media = [];
  const aliases = [];
  const accounts = [];
  for (const post of payload.posts || []) {
    const author = post.author || {};
    const handle = String(author.handle || '').trim();
    const displayName = String(author.displayName || '').trim();
    const postId = String(post.uri || '').split('/').pop();
    const link = handle && postId ? `https://bsky.app/profile/${handle}/post/${postId}` : `https://bsky.app/profile/${handle}`;
    const title = [displayName, handle ? `@${handle}` : '', post.record?.text].filter(Boolean).join(' - ');
    if (query && !textContainsQueryPhrase(`${displayName} ${handle} ${post.record?.text || ''}`, query)) continue;
    if (handle) {
      accounts.push(`https://bsky.app/profile/${handle}`);
      aliases.push({ value: `@${handle}`, kind: 'username', confidence: 96, evidence: [link] });
    }
    if (displayName) aliases.push({ value: displayName, kind: 'display_name', confidence: 88, evidence: [link] });
    const embed = post.embed || {};
    for (const image of embed.images || []) {
      media.push({ type: 'image', url: image.fullsize || image.thumb, thumbnail: image.thumb || image.fullsize, link, title: image.alt || title, description: post.record?.text, accountUrl: handle ? `https://bsky.app/profile/${handle}` : '' });
    }
    if (embed.playlist || embed.video?.playlist) {
      media.push({ type: 'video', url: embed.playlist || embed.video.playlist, thumbnail: embed.thumbnail || embed.video?.thumbnail || '', link, title, description: post.record?.text, accountUrl: handle ? `https://bsky.app/profile/${handle}` : '', playback: 'stream' });
    }
  }
  return { media, aliases, accounts: unique(accounts) };
}

function parseTumblrResults(payload = {}) {
  const media = [];
  const aliases = [];
  const accounts = [];
  for (const post of payload.response || []) {
    const blogName = post.blog_name || post.blog?.name || '';
    const accountUrl = post.blog?.url || (blogName ? `https://${blogName}.tumblr.com/` : '');
    const link = post.post_url || post.blog?.url || accountUrl;
    const title = post.summary || post.caption || post.title || `${blogName} Tumblr`;
    if (blogName) aliases.push({ value: `@${blogName}`, kind: 'username', confidence: 90, evidence: [link] });
    if (accountUrl) accounts.push(accountUrl);
    for (const photo of post.photos || []) {
      const original = photo.original_size || {};
      const bestAlt = (photo.alt_sizes || []).sort((a, b) => (Number(b.width) * Number(b.height)) - (Number(a.width) * Number(a.height)))[0] || {};
      media.push({ type: 'image', url: original.url || bestAlt.url, thumbnail: bestAlt.url || original.url, width: original.width, height: original.height, link, title, description: post.summary, accountUrl });
    }
    for (const block of post.content || []) {
      if (block.type === 'image') {
        const best = (block.media || []).sort((a, b) => (Number(b.width) * Number(b.height)) - (Number(a.width) * Number(a.height)))[0] || {};
        media.push({ type: 'image', url: best.url, thumbnail: best.url, width: best.width, height: best.height, link, title: block.alt_text || title, accountUrl });
      }
      if (block.type === 'video') {
        media.push({ type: 'video', url: block.url || block.media?.url, thumbnail: block.poster?.[0]?.url || '', link, title, accountUrl, playback: 'external' });
      }
    }
    if (post.video_url) media.push({ type: 'video', url: post.video_url, thumbnail: post.thumbnail_url || '', link, title, accountUrl, playback: 'external' });
  }
  return { media: media.filter(item => item.url), aliases, accounts: unique(accounts) };
}

function parseImgurResults(payload = {}) {
  const media = [];
  const rows = Array.isArray(payload.data) ? payload.data : (Array.isArray(payload) ? payload : []);
  for (const entry of rows) {
    const images = Array.isArray(entry.images) ? entry.images : [entry];
    for (const image of images) {
      const link = image.link || entry.link;
      if (!link) continue;
      const isVideo = Boolean(image.animated || image.mp4 || /^video\//i.test(image.type || ''));
      media.push({
        type: isVideo ? 'video' : 'image',
        url: isVideo ? (image.mp4 || link) : link,
        thumbnail: isVideo ? (link.replace(/\.gifv?(?:[?#]|$)/i, '.jpg')) : link,
        link: entry.link || link,
        title: entry.title || image.title || entry.description || 'Imgur media',
        description: entry.description || image.description || '',
        width: image.width,
        height: image.height,
        playback: isVideo ? 'direct' : undefined
      });
    }
  }
  return { media };
}

function parsePeerTubeResults(payload = {}, instanceUrl) {
  const media = [];
  for (const video of payload.data || []) {
    const link = video.url || `${instanceUrl}/w/${video.uuid || video.shortUUID}`;
    const thumbnail = video.previewPath || video.thumbnailPath;
    media.push({
      type: 'video',
      url: link,
      link,
      thumbnail: thumbnail ? new URL(thumbnail, instanceUrl).toString() : '',
      title: video.name,
      description: video.description || video.shortDescription || '',
      durationSeconds: video.duration,
      accountUrl: video.account?.url || video.channel?.url || '',
      playback: 'external'
    });
  }
  return { media };
}

function parseArquivoResults(payload = {}) {
  const rows = payload.responseItems || payload.items || payload.results || [];
  return {
    media: rows.map(row => ({
      type: 'image',
      url: row.imgLinkToArchive || row.imgSrc || row.imageUrl || row.url,
      thumbnail: row.imgThumbnail || row.thumbnail || row.imgSrc || row.imageUrl,
      link: row.pageLinkToArchive || row.pageLink || row.originalPage || row.url,
      title: row.pageTitle || row.title || row.alt || 'Arquivo.pt image',
      width: row.imgWidth || row.width,
      height: row.imgHeight || row.height,
      archivedAt: row.tstamp || row.timestamp || row.date
    })).filter(item => item.url)
  };
}

function parseOpenverseResults(payload = {}) {
  return {
    media: (payload.results || []).map(row => ({
      type: 'image',
      url: row.url,
      thumbnail: row.thumbnail || row.url,
      link: row.foreign_landing_url || row.detail_url || row.url,
      title: row.title || row.creator || 'Openverse image',
      description: [row.creator ? `Creator: ${row.creator}` : '', row.license ? `License: ${row.license}` : ''].filter(Boolean).join(' - '),
      width: row.width,
      height: row.height,
      provider: row.provider || '',
      license: row.license || ''
    })).filter(item => item.url)
  };
}

function statusFor(id, adapter, images, videos, extra = {}) {
  const total = images.length + videos.length;
  return {
    success: extra.success !== false,
    available: extra.available !== false,
    skipped: extra.zeroReason === 'missing_credentials',
    adapter,
    imagesCount: images.length,
    videosCount: videos.length,
    zeroReason: total ? '' : (extra.zeroReason || 'no_matching_public_media'),
    note: extra.note || `${total} media public`,
    accounts: extra.accounts || [],
    identityAliases: extra.identityAliases || [],
    pageSamples: extra.pageSamples || []
  };
}

function normalizeRaw(raw, query, sourceId, deps) {
  const images = [];
  const videos = [];
  for (const item of raw.media || []) {
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

async function runWikidata(query, deps) {
  const search = await deps.fetchText(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=fr&uselang=fr&type=item&limit=8&format=json&origin=*`);
  const searchRows = search.search || [];
  const ids = searchRows.map(row => row.id).filter(Boolean);
  if (!ids.length) return { images: [], videos: [], status: statusFor('wikidata', 'wikidata-api', [], [], { note: 'Aucune entite Wikidata' }) };
  const entityPayload = await deps.fetchText(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(ids.join('|'))}&props=labels|aliases|descriptions|claims|sitelinks&languages=fr|en&format=json&origin=*`);
  const raw = { media: [] };
  const identityAliases = [];
  const accounts = [];
  const pageSamples = searchRows.map(row => ({ url: `https://www.wikidata.org/wiki/${row.id}`, title: row.label || row.id, description: row.description || '' }));
  const socialClaims = {
    P2002: value => ({ value: `@${value}`, kind: 'username', account: `https://x.com/${value}` }),
    P2003: value => ({ value: `@${value}`, kind: 'username', account: `https://www.instagram.com/${value}/` }),
    P7085: value => ({ value: `@${value}`, kind: 'username', account: `https://www.tiktok.com/@${value}` }),
    P5797: value => ({ value: `@${value}`, kind: 'username', account: `https://www.twitch.tv/${value}` }),
    P8604: value => ({ value: `@${value}`, kind: 'username', account: `https://onlyfans.com/${value}` })
  };
  const selected = selectWikidataEntity(searchRows, entityPayload.entities || {}, query, deps.identityContext || {});
  if (!selected) return { images: [], videos: [], status: statusFor('wikidata', 'wikidata-api', [], [], { note: 'Aucune entite Wikidata exploitable', pageSamples }) };

  const { row, entity, label, description } = selected;
  const entityUrl = `https://www.wikidata.org/wiki/${row.id}`;
  if (label && !/^Q\d+$/i.test(label)) identityAliases.push({ value: label, kind: 'display_name', confidence: 96, evidence: [entityUrl] });
  for (const alias of [...(entity.aliases?.fr || []), ...(entity.aliases?.en || [])]) {
    if (alias.value && !/^Q\d+$/i.test(alias.value)) identityAliases.push({ value: alias.value, kind: 'display_name', confidence: 90, evidence: [entityUrl] });
  }
  const identityNameClaims = {
    P1477: 94,
    P742: 94,
    P1448: 90,
    P1449: 84,
    P1559: 84,
    P2561: 88
  };
  for (const [property, confidence] of Object.entries(identityNameClaims)) {
    for (const value of claimTextValues(entity, property)) {
      if (value && !/^Q\d+$/i.test(value)) identityAliases.push({ value, kind: 'display_name', confidence, evidence: [entityUrl] });
    }
  }
  const imageName = entity.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  if (imageName) raw.media.push({ type: 'image', url: `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(imageName)}`, link: entityUrl, title: label, description, trustedContext: true });
  for (const [property, mapper] of Object.entries(socialClaims)) {
    for (const claim of entity.claims?.[property] || []) {
      const value = claim?.mainsnak?.datavalue?.value;
      if (!value) continue;
      const mapped = mapper(String(value));
      identityAliases.push({ value: mapped.value, kind: mapped.kind, confidence: 96, evidence: [entityUrl, mapped.account] });
      accounts.push(mapped.account);
    }
  }
  const normalized = normalizeRaw(raw, query, 'wikidata', deps);
  return { ...normalized, status: statusFor('wikidata', 'wikidata-api', normalized.images, normalized.videos, { note: `Entite retenue: ${label} (${row.id}), ${ids.length} candidates analyses`, identityAliases: uniqueAliasCandidates(identityAliases), accounts: unique(accounts), pageSamples }) };
}

async function runTmdb(query, deps) {
  const apiKey = deps.connectionValue('tmdb', 'apiKey', 'TMDB_API_KEY');
  if (!apiKey) return { images: [], videos: [], status: statusFor('tmdb', 'tmdb-api', [], [], { success: false, available: false, zeroReason: 'missing_credentials', note: 'Cle TMDB requise dans Connexions API' }) };
  const payload = await deps.fetchText(`https://api.themoviedb.org/3/search/person?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&include_adult=${deps.adultConfirmed === true}&language=fr-FR&page=1`);
  const selected = selectTmdbPerson((payload.results || []).slice(0, 20), query, deps.identityContext || {});
  if (!selected) return { images: [], videos: [], status: statusFor('tmdb', 'tmdb-api', [], [], { note: 'Aucune personne TMDB correspondante' }) };
  let details = selected.person;
  try {
    details = await deps.fetchText(`https://api.themoviedb.org/3/person/${encodeURIComponent(selected.person.id)}?api_key=${encodeURIComponent(apiKey)}&append_to_response=images%2Cexternal_ids&language=fr-FR`);
  } catch {
    details = selected.person;
  }
  const raw = { media: [] };
  const identityAliases = [];
  const pageSamples = [];
  const accounts = [];
  const link = `https://www.themoviedb.org/person/${selected.person.id}`;
  pageSamples.push({ url: link, title: details.name || selected.person.name });
  identityAliases.push({ value: details.name || selected.person.name, kind: 'display_name', confidence: 96, evidence: [link] });
  for (const alias of details.also_known_as || []) identityAliases.push({ value: alias, kind: 'display_name', confidence: 90, evidence: [link] });
  const externalIds = details.external_ids || {};
  if (externalIds.instagram_id) accounts.push(`https://www.instagram.com/${externalIds.instagram_id}/`);
  if (externalIds.twitter_id) accounts.push(`https://x.com/${externalIds.twitter_id}`);
  if (externalIds.tiktok_id) accounts.push(`https://www.tiktok.com/@${externalIds.tiktok_id}`);
  const profiles = details.images?.profiles || [];
  const profileRows = profiles.length ? profiles : [{ file_path: details.profile_path || selected.person.profile_path }];
  for (const profile of profileRows.slice(0, deps.imageLimit)) {
    if (!profile.file_path) continue;
    raw.media.push({ type: 'image', url: `https://image.tmdb.org/t/p/original${profile.file_path}`, thumbnail: `https://image.tmdb.org/t/p/w500${profile.file_path}`, width: profile.width, height: profile.height, link, title: details.name || selected.person.name, description: details.biography || (selected.person.known_for || []).map(row => row.title || row.name).filter(Boolean).join(', '), trustedContext: true });
  }
  const normalized = normalizeRaw(raw, query, 'tmdb', deps);
  return { ...normalized, status: statusFor('tmdb', 'tmdb-api', normalized.images, normalized.videos, { note: `Personne TMDB retenue: ${details.name || selected.person.name}`, identityAliases: uniqueAliasCandidates(identityAliases), accounts: unique(accounts), pageSamples }) };
}

async function runInternetArchive(query, deps) {
  const archiveQuery = `(${query}) AND mediatype:(movies OR image)`;
  const search = await deps.fetchText(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(archiveQuery)}&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=description&fl%5B%5D=mediatype&rows=6&page=1&output=json`);
  const raw = { media: [] };
  const pageSamples = [];
  for (const doc of search.response?.docs || []) {
    const identifier = doc.identifier;
    if (!identifier) continue;
    const link = `https://archive.org/details/${encodeURIComponent(identifier)}`;
    pageSamples.push({ url: link, title: doc.title || identifier });
    const metadata = await deps.fetchText(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
    const files = (metadata.files || []).filter(file => file.name && Number(file.size || 0) <= 150 * 1024 * 1024);
    for (const file of files) {
      const encodedName = String(file.name).split('/').map(encodeURIComponent).join('/');
      const url = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodedName}`;
      const common = { link, title: doc.title || file.title || file.name, description: doc.description || '', width: file.width, height: file.height, trustedContext: true };
      if (/\.(?:jpe?g|png|gif|webp)$/i.test(file.name) && !/(?:thumb|spectrogram|waveform|__ia_thumb)/i.test(file.name)) raw.media.push({ ...common, type: 'image', url, thumbnail: url });
      if (/\.(?:mp4|webm|ogv|mov)$/i.test(file.name) && !/(?:thumb|sample|trailer)/i.test(file.name)) raw.media.push({ ...common, type: 'video', url, thumbnail: `https://archive.org/services/img/${encodeURIComponent(identifier)}`, playback: 'direct' });
      if (raw.media.length >= deps.imageLimit + deps.videoLimit) break;
    }
  }
  const normalized = normalizeRaw(raw, query, 'internetarchive', deps);
  return { ...normalized, status: statusFor('internetarchive', 'archive-org-api', normalized.images, normalized.videos, { note: `${pageSamples.length} collections publiques analysees`, pageSamples }) };
}

async function runOpenverse(query, deps) {
  const params = new URLSearchParams({
    q: query,
    page_size: String(Math.min(deps.imageLimit, 20)),
    mature: deps.adultConfirmed === true ? 'true' : 'false'
  });
  const payload = await deps.fetchText(`https://api.openverse.org/v1/images/?${params.toString()}`, {
    headers: { accept: 'application/json' }
  });
  const raw = parseOpenverseResults(payload);
  const normalized = normalizeRaw(raw, query, 'openverse', deps);
  return {
    ...normalized,
    status: statusFor('openverse', 'openverse-api', normalized.images, normalized.videos, {
      note: `API publique Openverse; ${Number(payload.result_count || 0)} correspondances annoncees`
    })
  };
}

async function runExtendedApiSource(sourceId, query, options = {}, deps = {}) {
  const scoped = { ...deps, imageLimit: options.imageLimit || 35, videoLimit: options.videoLimit || 20, adultConfirmed: options.adultConfirmed === true, identityContext: options.identityContext || {} };
  if (sourceId === 'wikidata') return runWikidata(query, scoped);
  if (sourceId === 'tmdb') return runTmdb(query, scoped);
  if (sourceId === 'openverse') return runOpenverse(query, scoped);
  if (sourceId === 'internetarchive') return runInternetArchive(query, scoped);

  if (sourceId === 'bluesky') {
    const payload = await deps.fetchText(`https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&limit=${Math.min(scoped.imageLimit + scoped.videoLimit, 50)}`);
    const raw = parseBlueskyResults(payload, query);
    const normalized = normalizeRaw(raw, query, sourceId, scoped);
    return { ...normalized, status: statusFor(sourceId, 'bluesky-public-api', normalized.images, normalized.videos, { note: 'API publique Bluesky', identityAliases: raw.aliases, accounts: raw.accounts }) };
  }

  if (sourceId === 'mastodon') {
    const instanceValue = deps.connectionValue('mastodon', 'instance', 'MASTODON_INSTANCE') || 'mastodon.social';
    const instance = /^https?:\/\//i.test(instanceValue) ? instanceValue.replace(/\/+$/, '') : `https://${instanceValue.replace(/\/+$/, '')}`;
    const accessToken = deps.connectionValue('mastodon', 'accessToken', 'MASTODON_ACCESS_TOKEN');
    const headers = accessToken ? { authorization: `Bearer ${accessToken}`, accept: 'application/json' } : { accept: 'application/json' };
    const resolveParam = accessToken ? '&resolve=true' : '';
    const search = await deps.fetchText(`${instance}/api/v2/search?q=${encodeURIComponent(query)}&type=accounts&limit=8${resolveParam}`, { headers });
    const raw = { media: [] };
    const identityAliases = [];
    const accounts = [];
    for (const account of search.accounts || []) {
      const accountUrl = account.url || `${instance}/@${account.acct}`;
      const accountContext = `${account.acct || ''} ${account.display_name || ''}`;
      if (!textMatchesAllQueryTokens(accountContext, query)) continue;
      accounts.push(accountUrl);
      identityAliases.push({ value: `@${account.acct}`, kind: 'username', confidence: 92, evidence: [accountUrl] });
      if (account.display_name) identityAliases.push({ value: account.display_name, kind: 'display_name', confidence: 84, evidence: [accountUrl] });
      const statuses = await deps.fetchText(`${instance}/api/v1/accounts/${encodeURIComponent(account.id)}/statuses?exclude_replies=true&exclude_reblogs=true&limit=12`, { headers });
      for (const status of statuses || []) {
        for (const attachment of status.media_attachments || []) {
          raw.media.push({ type: attachment.type === 'video' || attachment.type === 'gifv' ? 'video' : 'image', url: attachment.url || attachment.remote_url, thumbnail: attachment.preview_url, link: status.url, title: `${account.display_name || account.acct} - ${String(status.content || '').replace(/<[^>]+>/g, ' ')}`, accountUrl, width: attachment.meta?.original?.width, height: attachment.meta?.original?.height, trustedContext: true });
        }
      }
    }
    const normalized = normalizeRaw(raw, query, sourceId, scoped);
    return { ...normalized, status: statusFor(sourceId, 'mastodon-api', normalized.images, normalized.videos, { note: `${accounts.length} comptes publics Mastodon correspondants`, identityAliases, accounts: unique(accounts) }) };
  }

  if (sourceId === 'tumblr') {
    const apiKey = deps.connectionValue('tumblr', 'apiKey', 'TUMBLR_API_KEY');
    if (!apiKey) return { images: [], videos: [], status: statusFor(sourceId, 'tumblr-api', [], [], { success: false, available: false, zeroReason: 'missing_credentials', note: 'Cle Tumblr requise dans Connexions API' }) };
    const payload = await deps.fetchText(`https://api.tumblr.com/v2/tagged?tag=${encodeURIComponent(query)}&limit=${Math.min(scoped.imageLimit + scoped.videoLimit, 40)}&api_key=${encodeURIComponent(apiKey)}`);
    const raw = parseTumblrResults(payload);
    const normalized = normalizeRaw(raw, query, sourceId, scoped);
    return { ...normalized, status: statusFor(sourceId, 'tumblr-api', normalized.images, normalized.videos, { note: 'API officielle Tumblr', identityAliases: raw.aliases, accounts: raw.accounts }) };
  }

  if (sourceId === 'imgur') {
    const clientId = deps.connectionValue('imgur', 'clientId', 'IMGUR_CLIENT_ID');
    if (!clientId) return { images: [], videos: [], status: statusFor(sourceId, 'imgur-api', [], [], { success: false, available: false, zeroReason: 'missing_credentials', note: 'Client ID Imgur requis dans Connexions API' }) };
    const payload = await deps.fetchText(`https://api.imgur.com/3/gallery/search/time/all/0?q=${encodeURIComponent(query)}`, { headers: { authorization: `Client-ID ${clientId}`, accept: 'application/json' } });
    const raw = parseImgurResults(payload);
    const normalized = normalizeRaw(raw, query, sourceId, scoped);
    return { ...normalized, status: statusFor(sourceId, 'imgur-api', normalized.images, normalized.videos, { note: 'API officielle Imgur' }) };
  }

  if (sourceId === 'arquivo') {
    const payload = await deps.fetchText(`https://arquivo.pt/imagesearch?q=${encodeURIComponent(query)}&maxItems=${Math.min(scoped.imageLimit, 50)}`, { timeout: 35000 });
    const raw = parseArquivoResults(payload);
    const normalized = normalizeRaw(raw, query, sourceId, scoped);
    return { ...normalized, status: statusFor(sourceId, 'arquivo-image-api', normalized.images, normalized.videos, { note: 'Recherche images archivees Arquivo.pt' }) };
  }

  if (sourceId === 'peertube') {
    const instanceValue = deps.connectionValue('peertube', 'instance', 'PEERTUBE_INSTANCE') || 'https://peertube.tv';
    const instance = /^https?:\/\//i.test(instanceValue) ? instanceValue.replace(/\/+$/, '') : `https://${instanceValue.replace(/\/+$/, '')}`;
    const payload = await deps.fetchText(`${instance}/api/v1/search/videos?search=${encodeURIComponent(query)}&count=${Math.min(scoped.videoLimit, 25)}&start=0&sort=-match`);
    const raw = parsePeerTubeResults(payload, instance);
    raw.media = raw.media.filter(item => textMatchesAllQueryTokens(`${item.title || ''} ${item.description || ''} ${item.accountUrl || ''} ${item.link || ''}`, query));
    const normalized = normalizeRaw(raw, query, sourceId, scoped);
    normalized.videos = normalized.videos.map(item => ({ ...item, duration: deps.formatDuration(item.durationSeconds) }));
    return { ...normalized, status: statusFor(sourceId, 'peertube-api', normalized.images, normalized.videos, { note: `API publique ${new URL(instance).hostname}` }) };
  }

  if (sourceId === 'twitch') {
    const clientId = deps.connectionValue('twitch', 'clientId', 'TWITCH_CLIENT_ID');
    const clientSecret = deps.connectionValue('twitch', 'clientSecret', 'TWITCH_CLIENT_SECRET');
    if (!clientId || !clientSecret) return { images: [], videos: [], status: statusFor(sourceId, 'twitch-helix', [], [], { success: false, available: false, zeroReason: 'missing_credentials', note: 'Client ID et secret Twitch requis' }) };
    const tokenResponse = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`, { method: 'POST' });
    if (!tokenResponse.ok) throw new Error(`Twitch OAuth HTTP ${tokenResponse.status}`);
    const token = (await tokenResponse.json()).access_token;
    const headers = { authorization: `Bearer ${token}`, 'client-id': clientId, accept: 'application/json' };
    const users = await deps.fetchText(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(query.replace(/^@/, ''))}`, { headers });
    const account = users.data?.[0];
    if (!account) return { images: [], videos: [], status: statusFor(sourceId, 'twitch-helix', [], [], { note: 'Aucun compte Twitch exact' }) };
    const clips = await deps.fetchText(`https://api.twitch.tv/helix/clips?broadcaster_id=${encodeURIComponent(account.id)}&first=${Math.min(scoped.videoLimit, 100)}`, { headers });
    const raw = { media: (clips.data || []).map(clip => ({ type: 'video', url: clip.url, link: clip.url, embedUrl: clip.embed_url, thumbnail: clip.thumbnail_url, title: clip.title, durationSeconds: clip.duration, accountUrl: `https://www.twitch.tv/${account.login}`, playback: 'embed' })) };
    const normalized = normalizeRaw(raw, query, sourceId, scoped);
    const identityAliases = [{ value: `@${account.login}`, kind: 'username', confidence: 98, evidence: [`https://www.twitch.tv/${account.login}`] }, { value: account.display_name, kind: 'display_name', confidence: 94, evidence: [`https://www.twitch.tv/${account.login}`] }];
    return { ...normalized, status: statusFor(sourceId, 'twitch-helix', normalized.images, normalized.videos, { note: 'API officielle Twitch Helix', identityAliases, accounts: [`https://www.twitch.tv/${account.login}`] }) };
  }

  if (sourceId === 'stashdb') {
    const apiKey = deps.connectionValue('stashdb', 'apiKey', 'STASHDB_API_KEY');
    if (!apiKey) return { images: [], videos: [], status: statusFor(sourceId, 'stashdb-graphql', [], [], { success: false, available: false, zeroReason: 'missing_credentials', note: 'Cle personnelle StashDB requise; aucun compte partage n est utilise' }) };
    const graphResponse = await fetch('https://stashdb.org/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: apiKey },
      body: JSON.stringify({
        query: 'query FindPerformers($filter: FindFilterType, $performer_filter: PerformerFilterType) { findPerformers(filter: $filter, performer_filter: $performer_filter) { performers { id name aliases image_path } } }',
        variables: { filter: { per_page: 20 }, performer_filter: { name: { value: query, modifier: 'INCLUDES' } } }
      })
    });
    if (!graphResponse.ok) throw new Error(`StashDB HTTP ${graphResponse.status}`);
    const payload = await graphResponse.json();
    if (payload.errors?.length) throw new Error(payload.errors[0].message || 'Erreur GraphQL StashDB');
    const performers = payload.data?.findPerformers?.performers || [];
    const raw = { media: performers.filter(row => row.image_path).map(row => ({ type: 'image', url: row.image_path, thumbnail: row.image_path, link: `https://stashdb.org/performers/${row.id}`, title: row.name, trustedContext: true })) };
    const identityAliases = performers.flatMap(row => [{ value: row.name, kind: 'display_name', confidence: 96, evidence: [`https://stashdb.org/performers/${row.id}`] }, ...(row.aliases || []).map(alias => ({ value: alias, kind: 'display_name', confidence: 90, evidence: [`https://stashdb.org/performers/${row.id}`] }))]);
    const normalized = normalizeRaw(raw, query, sourceId, scoped);
    return { ...normalized, status: statusFor(sourceId, 'stashdb-graphql', normalized.images, normalized.videos, { note: `${performers.length} performers StashDB`, identityAliases, pageSamples: performers.map(row => ({ url: `https://stashdb.org/performers/${row.id}`, title: row.name })) }) };
  }

  return null;
}

module.exports = {
  textMatchesAllQueryTokens,
  runExtendedApiSource,
  selectWikidataEntity,
  selectTmdbPerson,
  parseBlueskyResults,
  parseTumblrResults,
  parseImgurResults,
  parsePeerTubeResults,
  parseArquivoResults,
  parseOpenverseResults
};
