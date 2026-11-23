const cheerio = require('cheerio');

const APP_USER_AGENT = 'MediaGatherer/1.9.0 (https://github.com/darknigthmare/media-gatherer)';

let redgifsTokenCache = { token: '', expiresAt: 0 };

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

function booruTag(query) {
  return normalize(query).replace(/\s+/g, '_');
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

function parseWikipediaResults(payload = {}, query = '') {
  const pages = Object.values(payload?.query?.pages || {})
    .sort((a, b) => Number(a.index || 999) - Number(b.index || 999));
  const media = [];
  const aliases = [];
  const pageSamples = [];
  const accounts = [];
  for (const page of pages) {
    const title = String(page.title || '').trim();
    const extract = String(page.extract || '').trim();
    const link = page.fullurl || (title ? `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}` : '');
    if (!title || !matchesQuery(`${title} ${extract}`, query)) continue;
    if (link) {
      pageSamples.push({ url: link, title, description: extract.slice(0, 240) });
      accounts.push(link);
    }
    aliases.push({ value: title, kind: 'display_name', confidence: 94, evidence: [link].filter(Boolean) });
    const originalUrl = page.original?.source || '';
    const thumbUrl = page.thumbnail?.source || '';
    if (originalUrl || thumbUrl) {
      media.push({
        type: 'image',
        url: originalUrl || thumbUrl,
        thumbnail: thumbUrl || originalUrl,
        link,
        title,
        description: extract.slice(0, 280),
        width: Number(page.original?.width || page.thumbnail?.width || 0),
        height: Number(page.original?.height || page.thumbnail?.height || 0),
        originalConfirmed: Boolean(originalUrl),
        trustedContext: true
      });
    }
  }
  return { media, aliases, accounts: unique(accounts), pageSamples };
}

function parseTvmazePeople(rows = [], query = '') {
  const media = [];
  const aliases = [];
  const accounts = [];
  const pageSamples = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const person = row?.person || row;
    const name = String(person?.name || '').trim();
    if (!name || !matchesQuery(name, query)) continue;
    const link = person.url || (person.id ? `https://www.tvmaze.com/people/${person.id}` : '');
    const details = [
      person.country?.name ? `Pays: ${person.country.name}` : '',
      person.birthday ? `Naissance: ${person.birthday}` : '',
      person.gender ? `Genre: ${person.gender}` : ''
    ].filter(Boolean).join(' - ');
    if (link) {
      pageSamples.push({ url: link, title: name, description: details });
      accounts.push(link);
    }
    aliases.push({ value: name, kind: 'display_name', confidence: 95, evidence: [link].filter(Boolean) });
    const original = person.image?.original || '';
    const medium = person.image?.medium || '';
    if (original || medium) {
      media.push({
        type: 'image',
        url: original || medium,
        thumbnail: medium || original,
        link,
        title: name,
        description: details,
        originalConfirmed: Boolean(original),
        trustedContext: true
      });
    }
  }
  return { media, aliases, accounts: unique(accounts), pageSamples };
}

function parseOpenLibraryAuthors(payload = {}, query = '') {
  const media = [];
  const aliases = [];
  const accounts = [];
  const pageSamples = [];
  for (const doc of payload?.docs || []) {
    const name = String(doc.name || '').trim();
    const alternateNames = Array.isArray(doc.alternate_names) ? doc.alternate_names : [];
    const context = `${name} ${alternateNames.join(' ')} ${(doc.top_work || '')}`;
    if (!name || !matchesQuery(context, query)) continue;
    const key = String(doc.key || '').replace(/^\/authors\//, '').trim();
    const link = key ? `https://openlibrary.org/authors/${encodeURIComponent(key)}` : '';
    const description = [
      doc.birth_date ? `Naissance: ${doc.birth_date}` : '',
      doc.death_date ? `Deces: ${doc.death_date}` : '',
      doc.top_work ? `Oeuvre: ${doc.top_work}` : ''
    ].filter(Boolean).join(' - ');
    if (link) {
      pageSamples.push({ url: link, title: name, description });
      accounts.push(link);
    }
    aliases.push({ value: name, kind: 'display_name', confidence: 94, evidence: [link].filter(Boolean) });
    for (const alt of alternateNames.slice(0, 8)) {
      const cleanAlt = String(alt || '').trim();
      if (cleanAlt && cleanAlt.length >= 2 && cleanAlt.length <= 80 && !/,/.test(cleanAlt)) {
        aliases.push({ value: cleanAlt, kind: 'display_name', confidence: 82, evidence: [link].filter(Boolean) });
      }
    }
    if (key) {
      const portrait = `https://covers.openlibrary.org/a/olid/${encodeURIComponent(key)}-L.jpg?default=false`;
      const thumb = `https://covers.openlibrary.org/a/olid/${encodeURIComponent(key)}-M.jpg?default=false`;
      media.push({
        type: 'image',
        url: portrait,
        thumbnail: thumb,
        link,
        title: name,
        description,
        bestDeclared: true,
        trustedContext: true
      });
    }
  }
  return { media, aliases, accounts: unique(accounts), pageSamples };
}

function parseNasaLibraryResults(payload = {}, query = '') {
  const media = [];
  const pageSamples = [];
  for (const item of payload?.collection?.items || []) {
    const data = Array.isArray(item.data) ? (item.data[0] || {}) : {};
    const title = String(data.title || '').trim();
    const description = String(data.description || data.description_508 || '').trim();
    const keywords = Array.isArray(data.keywords) ? data.keywords.join(' ') : '';
    if (!matchesQuery(`${title} ${description} ${keywords} ${data.nasa_id || ''}`, query)) continue;
    const links = Array.isArray(item.links) ? item.links : [];
    const preview = links.find(l => l.rel === 'preview' && l.href)?.href || links[0]?.href || '';
    const canonical = links.find(l => l.rel === 'canonical' && l.href)?.href || '';
    const nasaId = data.nasa_id || '';
    const pageUrl = nasaId ? `https://images.nasa.gov/details/${encodeURIComponent(nasaId)}` : (preview || '');
    if (pageUrl) pageSamples.push({ url: pageUrl, title: title || nasaId });
    if (data.media_type === 'video' && pageUrl) {
      media.push({
        type: 'video',
        url: pageUrl,
        link: pageUrl,
        thumbnail: preview,
        title: title || nasaId || 'NASA video',
        description: description.slice(0, 280),
        duration: 'NASA Library',
        playback: 'external',
        trustedContext: true
      });
    } else if (canonical || preview) {
      media.push({
        type: 'image',
        url: canonical || preview,
        thumbnail: preview || canonical,
        link: pageUrl,
        title: title || nasaId || 'NASA image',
        description: description.slice(0, 280),
        bestDeclared: true,
        trustedContext: true
      });
    }
  }
  return { media, pageSamples };
}

function parseLocResults(payload = {}, query = '') {
  const media = [];
  const pageSamples = [];
  for (const row of payload?.results || []) {
    const title = String(row.title || '').trim();
    const desc = Array.isArray(row.description) ? row.description.join(' ') : String(row.description || '');
    const subjects = Array.isArray(row.subject) ? row.subject.join(' ') : '';
    if (!matchesQuery(`${title} ${desc} ${subjects}`, query)) continue;
    const link = String(row.url || row.id || '').trim();
    const imageList = (Array.isArray(row.image_url) ? row.image_url : [])
      .map(url => String(url || '').split('#', 1)[0])
      .filter(url => /^https?:\/\//i.test(url) && !/\.svg(?:[?#]|$)/i.test(url));
    if (!imageList.length) continue;
    const best = imageList[imageList.length - 1];
    const thumb = imageList[0] || best;
    if (link) pageSamples.push({ url: link, title });
    media.push({
      type: 'image',
      url: best,
      thumbnail: thumb,
      link: link || best,
      title: title || 'Library of Congress',
      description: desc.slice(0, 280),
      bestDeclared: imageList.length > 1,
      trustedContext: true
    });
  }
  return { media, pageSamples };
}

function parseMetMuseumObject(obj = {}, query = '') {
  if (!obj || !obj.objectID) return null;
  const original = String(obj.primaryImage || '').trim();
  const small = String(obj.primaryImageSmall || '').trim();
  if (!original && !small) return null;
  const title = String(obj.title || `Met object ${obj.objectID}`).trim();
  const artist = String(obj.artistDisplayName || '').trim();
  const description = [artist, obj.objectDate, obj.medium, obj.department].filter(Boolean).join(' - ');
  if (query && !matchesQuery(`${title} ${description} ${obj.objectName || ''} ${obj.culture || ''}`, query)) return null;
  const link = obj.objectURL || `https://www.metmuseum.org/art/collection/search/${obj.objectID}`;
  return {
    type: 'image',
    url: original || small,
    thumbnail: small || original,
    link,
    title: artist ? `${title} - ${artist}` : title,
    description,
    originalConfirmed: Boolean(original),
    trustedContext: true
  };
}

function parseSafebooruPosts(rows = []) {
  const list = Array.isArray(rows) ? rows : (rows?.post || []);
  return {
    media: list.map(row => {
      const fileUrl = row.file_url || (row.directory && row.image ? `https://safebooru.org/images/${row.directory}/${row.image}` : '');
      const sampleUrl = row.sample_url || fileUrl;
      const previewUrl = row.preview_url || sampleUrl || fileUrl;
      const fullTags = String(row.tags || '').trim();
      return {
        type: 'image',
        url: fileUrl || sampleUrl,
        thumbnail: previewUrl,
        link: row.id ? `https://safebooru.org/index.php?page=post&s=view&id=${row.id}` : (fileUrl || ''),
        title: fullTags.split(/\s+/).slice(0, 12).join(' ') || `Safebooru ${row.id || ''}`.trim(),
        description: [fullTags.slice(0, 400), row.source || ''].filter(Boolean).join(' - '),
        width: Number(row.width || 0),
        height: Number(row.height || 0),
        originalConfirmed: Boolean(fileUrl),
        trustedContext: true
      };
    }).filter(item => item.url)
  };
}

function parseMoebooruPosts(rows = [], baseDomain = 'yande.re') {
  const list = Array.isArray(rows) ? rows : [];
  return {
    media: list.map(row => {
      const fileUrl = String(row.file_url || row.sample_url || '').trim();
      const previewUrl = String(row.preview_url || row.sample_url || fileUrl).trim();
      if (!fileUrl) return null;
      return {
        type: 'image',
        url: fileUrl,
        thumbnail: previewUrl,
        link: row.id ? `https://${baseDomain}/post/show/${row.id}` : fileUrl,
        title: String(row.tags || '').split(/\s+/).slice(0, 12).join(' ') || `${baseDomain} ${row.id || ''}`.trim(),
        description: row.source || (row.author ? `Author: ${row.author}` : ''),
        width: Number(row.width || 0),
        height: Number(row.height || 0),
        rating: row.rating || '',
        originalConfirmed: Boolean(row.file_url),
        trustedContext: true
      };
    }).filter(Boolean)
  };
}

function parseRedgifsApiResults(payload = {}, query = '', limit = 20) {
  const gifs = Array.isArray(payload?.gifs) ? payload.gifs : [];
  const media = [];
  const aliases = [];
  const accounts = [];
  const pageSamples = [];
  for (const gif of gifs) {
    const id = String(gif.id || '').trim();
    const userName = String(gif.userName || '').trim();
    const tags = Array.isArray(gif.tags) ? gif.tags : [];
    const description = String(gif.description || '').trim();
    const title = [tags.slice(0, 6).join(', '), userName ? `@${userName}` : ''].filter(Boolean).join(' - ') || `RedGIFs ${id}`;
    const context = `${tags.join(' ')} ${userName} ${description} ${id}`;
    if (query && !matchesQuery(context, query)) continue;
    const videoUrl = gif.urls?.hd || gif.urls?.sd || '';
    const thumbnail = gif.urls?.poster || gif.urls?.thumbnail || '';
    const link = id ? `https://www.redgifs.com/watch/${encodeURIComponent(id)}` : videoUrl;
    if (!videoUrl && !link) continue;
    if (link) pageSamples.push({ url: link, title });
    if (userName) {
      const accountUrl = `https://www.redgifs.com/users/${encodeURIComponent(userName)}`;
      accounts.push(accountUrl);
      aliases.push({ value: `@${userName}`, kind: 'username', confidence: 86, evidence: [accountUrl, link].filter(Boolean) });
    }
    media.push({
      type: 'video',
      url: videoUrl || link,
      link,
      embedUrl: gif.urls?.html || (id ? `https://www.redgifs.com/ifr/${encodeURIComponent(id)}` : ''),
      thumbnail,
      title,
      description: tags.join(', '),
      width: Number(gif.width || 0),
      height: Number(gif.height || 0),
      durationSeconds: Number(gif.duration || 0),
      playback: videoUrl ? 'direct' : 'embed',
      bestDeclared: Boolean(gif.urls?.hd),
      trustedContext: true
    });
    if (media.length >= limit) break;
  }
  return { media, aliases, accounts: unique(accounts), pageSamples };
}

async function getRedgifsGuestToken(fetchText) {
  if (redgifsTokenCache.token && redgifsTokenCache.expiresAt > Date.now()) {
    return redgifsTokenCache.token;
  }
  const auth = await fetchText('https://api.redgifs.com/v2/auth/temporary', {
    timeout: 8000,
    headers: { accept: 'application/json', 'user-agent': APP_USER_AGENT }
  });
  const token = String(auth?.token || '').trim();
  if (!token) throw new Error('Jeton temporaire RedGIFs absent');
  redgifsTokenCache = { token, expiresAt: Date.now() + (20 * 60 * 1000) };
  return token;
}

async function runRedgifsApi(query, options = {}, deps = {}) {
  const limit = Math.max(1, Math.min(Number(options.videoLimit || 20), 40));
  const token = await getRedgifsGuestToken(deps.fetchText);
  const params = new URLSearchParams({
    query: String(query || '').trim(),
    count: String(Math.min(40, Math.max(limit * 2, 20))),
    order: 'trending'
  });
  const payload = await deps.fetchText(`https://api.redgifs.com/v2/gifs/search?${params}`, {
    timeout: Math.min(Number(options.timeout) || 12000, 14000),
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'user-agent': APP_USER_AGENT
    }
  });
  const parsed = parseRedgifsApiResults(payload, query, limit);
  const normalized = normalizeRaw(parsed, query, 'redgifs', {
    ...deps,
    imageLimit: Number(options.imageLimit || 35),
    videoLimit: limit
  });
  normalized.videos = normalized.videos.map(item => ({
    ...item,
    duration: item.durationSeconds ? deps.formatDuration(item.durationSeconds) : (item.duration || 'RedGIFs')
  }));
  return {
    ...normalized,
    totalAvailable: Number(payload?.total || parsed.media.length || 0),
    aliases: parsed.aliases,
    accounts: parsed.accounts,
    pageSamples: parsed.pageSamples
  };
}

async function runWikipedia(query, deps) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: String(Math.min(deps.imageLimit, 10)),
    prop: 'pageimages|extracts|info',
    piprop: 'original|thumbnail',
    pithumbsize: '600',
    exintro: '1',
    explaintext: '1',
    inprop: 'url',
    format: 'json'
  });
  const payload = await deps.fetchText(`https://en.wikipedia.org/w/api.php?${params}`, {
    timeout: 10000,
    headers: { accept: 'application/json', 'user-agent': APP_USER_AGENT }
  });
  const parsed = parseWikipediaResults(payload, query);
  const normalized = normalizeRaw(parsed, query, 'wikipedia', deps);
  return {
    ...normalized,
    status: statusFor('wikipedia-api', normalized.images, normalized.videos, {
      note: `API publique Wikipedia (${parsed.pageSamples.length} articles)`,
      identityAliases: parsed.aliases,
      accounts: parsed.accounts,
      pageSamples: parsed.pageSamples
    })
  };
}

async function runTvmaze(query, deps) {
  const payload = await deps.fetchText(`https://api.tvmaze.com/search/people?q=${encodeURIComponent(query)}`, {
    timeout: 10000,
    headers: { accept: 'application/json', 'user-agent': APP_USER_AGENT }
  });
  const parsed = parseTvmazePeople(payload, query);
  const normalized = normalizeRaw(parsed, query, 'tvmaze', deps);
  return {
    ...normalized,
    status: statusFor('tvmaze-api', normalized.images, normalized.videos, {
      note: `API publique TVMaze (${parsed.pageSamples.length} profils)`,
      identityAliases: parsed.aliases,
      accounts: parsed.accounts,
      pageSamples: parsed.pageSamples
    })
  };
}

async function runOpenLibrary(query, deps) {
  let payload;
  try {
    payload = await deps.fetchText(`https://openlibrary.org/search/authors.json?q=${encodeURIComponent(query)}&limit=8`, {
      timeout: 15000,
      headers: { accept: 'application/json', 'user-agent': APP_USER_AGENT }
    });
  } catch (error) {
    return {
      images: [],
      videos: [],
      status: statusFor('openlibrary-api', [], [], {
        success: false,
        available: false,
        directReachable: false,
        zeroReason: error.status === 429 ? 'rate_limited' : 'source_unreachable',
        note: `Open Library temporairement indisponible: ${error.message}`
      })
    };
  }
  const parsed = parseOpenLibraryAuthors(payload, query);
  const normalized = normalizeRaw(parsed, query, 'openlibrary', deps);
  return {
    ...normalized,
    status: statusFor('openlibrary-api', normalized.images, normalized.videos, {
      note: `API publique Open Library (${parsed.pageSamples.length} auteurs, ${parsed.aliases.length} alias)`,
      identityAliases: parsed.aliases,
      accounts: parsed.accounts,
      pageSamples: parsed.pageSamples
    })
  };
}

async function runNasaLibrary(query, deps) {
  const params = new URLSearchParams({
    q: query,
    page_size: String(Math.min(deps.imageLimit + deps.videoLimit, 25))
  });
  const payload = await deps.fetchText(`https://images-api.nasa.gov/search?${params}`, {
    timeout: 10000,
    headers: { accept: 'application/json', 'user-agent': APP_USER_AGENT }
  });
  const parsed = parseNasaLibraryResults(payload, query);
  const normalized = normalizeRaw(parsed, query, 'nasalibrary', deps);
  return {
    ...normalized,
    status: statusFor('nasa-images-api', normalized.images, normalized.videos, {
      note: `API publique NASA Images & Video Library`,
      pageSamples: parsed.pageSamples
    })
  };
}

async function runLoc(query, deps) {
  const params = new URLSearchParams({
    q: query,
    fo: 'json',
    c: String(Math.min(deps.imageLimit, 20))
  });
  const payload = await deps.fetchText(`https://www.loc.gov/photos/?${params}`, {
    timeout: 12000,
    headers: { accept: 'application/json', 'user-agent': APP_USER_AGENT }
  });
  const parsed = parseLocResults(payload, query);
  const normalized = normalizeRaw(parsed, query, 'loc', deps);
  return {
    ...normalized,
    status: statusFor('loc-api', normalized.images, normalized.videos, {
      note: `Collections numeriques Library of Congress`,
      pageSamples: parsed.pageSamples
    })
  };
}

async function runMetMuseum(query, deps) {
  const search = await deps.fetchText(`https://collectionapi.metmuseum.org/public/collection/v1.1/search?hasImages=true&q=${encodeURIComponent(query)}`, {
    timeout: 10000,
    headers: { accept: 'application/json', 'user-agent': APP_USER_AGENT }
  });
  const ids = (Array.isArray(search?.objectIDs) ? search.objectIDs : []).slice(0, Math.min(deps.imageLimit, 8));
  const raw = { media: [] };
  const pageSamples = [];
  const settled = await Promise.allSettled(ids.map(id => deps.fetchText(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${encodeURIComponent(id)}`, {
    timeout: 8000,
    headers: { accept: 'application/json', 'user-agent': APP_USER_AGENT }
  })));
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    const item = parseMetMuseumObject(result.value, query);
    if (!item) continue;
    raw.media.push(item);
    pageSamples.push({ url: item.link, title: item.title });
  }
  const normalized = normalizeRaw(raw, query, 'metmuseum', deps);
  return {
    ...normalized,
    status: statusFor('metmuseum-api', normalized.images, normalized.videos, {
      note: `API Open Access Metropolitan Museum (${Number(search?.total || 0)} objets)`,
      pageSamples
    })
  };
}

async function runSafebooru(query, deps) {
  const params = new URLSearchParams({
    page: 'dapi',
    s: 'post',
    q: 'index',
    json: '1',
    tags: booruTag(query),
    limit: String(Math.min(deps.imageLimit, 40))
  });
  const payload = await deps.fetchText(`https://safebooru.org/index.php?${params}`, {
    timeout: 10000,
    headers: { accept: 'application/json', 'user-agent': APP_USER_AGENT }
  });
  const parsed = parseSafebooruPosts(payload);
  const normalized = normalizeRaw(parsed, query, 'safebooru', deps);
  return {
    ...normalized,
    status: statusFor('safebooru-dapi', normalized.images, normalized.videos, {
      note: 'Safebooru DAPI publique'
    })
  };
}

async function runMoebooru(sourceId, baseDomain, query, deps) {
  const params = new URLSearchParams({
    tags: booruTag(query),
    limit: String(Math.min(deps.imageLimit, 40))
  });
  const payload = await deps.fetchText(`https://${baseDomain}/post.json?${params}`, {
    timeout: 10000,
    headers: { accept: 'application/json', 'user-agent': APP_USER_AGENT }
  });
  const parsed = parseMoebooruPosts(payload, baseDomain);
  const normalized = normalizeRaw(parsed, query, sourceId, deps);
  return {
    ...normalized,
    status: statusFor(`${sourceId}-api`, normalized.images, normalized.videos, {
      note: `API publique ${baseDomain}`
    })
  };
}

function parseYandexImageResults(html = '', query = '', limit = 35) {
  const $ = cheerio.load(String(html || ''));
  const media = [];
  const pageSamples = [];
  const seen = new Set();
  $('[data-state]').each((_, element) => {
    let state;
    try {
      state = JSON.parse($(element).attr('data-state') || '{}');
    } catch {
      return;
    }
    const entities = state?.initialState?.serpList?.items?.entities || {};
    for (const entity of Object.values(entities)) {
      const previews = Array.isArray(entity?.viewerData?.preview) ? entity.viewerData.preview : [];
      const dups = Array.isArray(entity?.viewerData?.dups) ? entity.viewerData.dups : [];
      const best = [...previews, ...dups]
        .filter(candidate => candidate?.url && /^https?:\/\//i.test(candidate.url))
        .sort((left, right) => (Number(right.w || 0) * Number(right.h || 0)) - (Number(left.w || 0) * Number(left.h || 0)))[0] || {};
      const rawThumb = String(entity?.viewerData?.thumb?.url || entity?.thumb?.url || '').trim();
      const thumbnail = rawThumb.startsWith('//') ? `https:${rawThumb}` : rawThumb;
      const url = best.url || thumbnail;
      if (!url || seen.has(url)) continue;
      const snippet = entity?.snippet || entity?.viewerData?.snippet || {};
      const title = String(snippet.title || entity?.alt || query || 'Yandex image').replace(/\s+/g, ' ').trim();
      const link = String(snippet.url || url).trim();
      const description = String(snippet.text || '').replace(/\s+/g, ' ').trim();
      if (query && !matchesQuery(`${title} ${description} ${link} ${url}`, query)) continue;
      seen.add(url);
      if (/^https?:\/\//i.test(link)) pageSamples.push({ url: link, title });
      media.push({
        type: 'image',
        url,
        thumbnail: thumbnail || url,
        link,
        title,
        description,
        width: Number(best.w || 0),
        height: Number(best.h || 0),
        bestDeclared: Boolean(best.url),
        trustedContext: false
      });
      if (media.length >= limit) break;
    }
  });
  return { media, pageSamples: pageSamples.slice(0, 12) };
}

function parseBingVideoResults(html = '', query = '', limit = 25) {
  const $ = cheerio.load(String(html || ''));
  const media = [];
  const accounts = [];
  const pageSamples = [];
  const seen = new Set();
  $('.mc_vtvc').each((_, element) => {
    const vrhmRaw = $(element).find('[vrhm]').first().attr('vrhm') || $(element).attr('vrhm') || '';
    let meta = {};
    if (vrhmRaw) {
      try { meta = JSON.parse(vrhmRaw); } catch { meta = {}; }
    }
    const url = String(meta.murl || '').trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
    const title = String($(element).find('.mc_vtvc_title').text() || meta.vt || $(element).find('a').first().attr('title') || '').replace(/\s+/g, ' ').trim();
    const img = $(element).find('img').first();
    const thumbCandidates = [img.attr('data-src-hq'), img.attr('data-src'), img.attr('src'), meta.turl]
      .map(v => String(v || '').trim())
      .filter(v => /^https?:\/\//i.test(v));
    const thumbnail = thumbCandidates[0] || (meta.thid ? `https://tse1.mm.bing.net/th?id=${encodeURIComponent(meta.thid)}` : '');
    const duration = String(meta.du || $(element).find('.mc_bc_rc').first().text() || 'Bing Video').trim();
    let channelUrl = '';
    if (meta.purl) {
      try {
        const parsedPurl = new URL(meta.purl, 'https://www.bing.com');
        const ch = parsedPurl.searchParams.get('churl');
        if (ch && /^https?:\/\//i.test(ch)) channelUrl = ch;
      } catch {}
    }
    if (query && !matchesQuery(`${title} ${url} ${channelUrl}`, query)) return;
    seen.add(url);
    pageSamples.push({ url, title: title || url });
    if (channelUrl) accounts.push(channelUrl);
    media.push({
      type: 'video',
      url,
      link: url,
      thumbnail: /^https?:\/\//i.test(thumbnail) ? thumbnail : '',
      title: title || 'Bing Video',
      duration,
      accountUrl: channelUrl,
      playback: 'external'
    });
    if (media.length >= limit) return false;
  });
  return { media, accounts: unique(accounts), pageSamples: pageSamples.slice(0, 12) };
}

function parseCivitaiResults(payload = {}, query = '', allowNsfw = false) {
  const media = [];
  const accounts = [];
  const aliases = [];
  const pageSamples = [];
  for (const model of payload?.items || []) {
    const name = String(model.name || '').trim();
    const creator = String(model.creator?.username || '').trim();
    const tags = Array.isArray(model.tags) ? model.tags.join(' ') : '';
    const context = `${name} ${creator} ${tags} ${model.description || ''}`;
    if (query && !matchesQuery(context, query)) continue;
    const link = model.id ? `https://civitai.com/models/${model.id}` : '';
    const creatorUrl = creator ? `https://civitai.com/user/${encodeURIComponent(creator)}` : '';
    if (link) pageSamples.push({ url: link, title: name });
    if (creatorUrl) {
      accounts.push(creatorUrl);
      aliases.push({ value: `@${creator}`, kind: 'username', confidence: 86, evidence: [creatorUrl, link].filter(Boolean) });
    }
    const versions = Array.isArray(model.modelVersions) ? model.modelVersions : [];
    for (const version of versions.slice(0, 1)) {
      for (const img of (version.images || []).slice(0, 3)) {
        if (!img?.url || (!allowNsfw && Number(img.nsfwLevel || 0) > 2)) continue;
        const isVideo = img.type === 'video' || /\.(?:mp4|webm)(?:[?#]|$)/i.test(img.url);
        media.push({
          type: isVideo ? 'video' : 'image',
          url: img.url,
          thumbnail: img.url,
          link: link || img.url,
          title: name || `Civitai ${model.id}`,
          description: [creator ? `Creator: @${creator}` : '', tags].filter(Boolean).join(' - '),
          width: Number(img.width || 0),
          height: Number(img.height || 0),
          accountUrl: creatorUrl,
          originalConfirmed: /original=true/i.test(img.url),
          playback: isVideo ? 'direct' : undefined,
          trustedContext: true
        });
      }
    }
  }
  return { media, accounts: unique(accounts), aliases, pageSamples: pageSamples.slice(0, 12) };
}

function parseRedtubeApiResults(payload = {}, query = '', limit = 20) {
  const rows = Array.isArray(payload?.videos) ? payload.videos : [];
  const media = [];
  const pageSamples = [];
  for (const row of rows) {
    const video = row?.video || row;
    const title = String(video?.title || '').trim();
    const tags = Array.isArray(video?.tags) ? video.tags.map(t => t?.tag_name || t).filter(Boolean).join(' ') : '';
    const pageUrl = String(video?.url || '').trim();
    if (!pageUrl || (query && !matchesQuery(`${title} ${tags} ${pageUrl}`, query))) continue;
    const thumbs = Array.isArray(video?.thumbs) ? video.thumbs : [];
    const bestThumb = thumbs
      .filter(t => t?.src)
      .sort((a, b) => (Number(b.width || 0) * Number(b.height || 0)) - (Number(a.width || 0) * Number(a.height || 0)))[0];
    const thumbnail = bestThumb?.src || video.default_thumb || video.thumb || '';
    pageSamples.push({ url: pageUrl, title });
    media.push({
      type: 'video',
      url: pageUrl,
      link: pageUrl,
      embedUrl: video.embed_url || (video.video_id ? `https://embed.redtube.com/?id=${encodeURIComponent(video.video_id)}` : ''),
      thumbnail,
      title: title || `RedTube ${video.video_id || ''}`.trim(),
      description: tags,
      duration: String(video.duration || 'RedTube'),
      width: Number(bestThumb?.width || 0),
      height: Number(bestThumb?.height || 0),
      playback: video.embed_url || video.video_id ? 'embed' : 'external',
      bestDeclared: Boolean(bestThumb?.src),
      trustedContext: true
    });
    if (media.length >= limit) break;
  }
  return { media, pageSamples };
}

function parseE621Posts(payload = {}, query = '') {
  const rows = Array.isArray(payload) ? payload : (Array.isArray(payload?.posts) ? payload.posts : []);
  const needleTokens = normalize(query).split(/\s+/).filter(Boolean);
  return {
    media: rows.map(row => {
      const origUrl = row?.files?.original?.url || row?.file?.url || '';
      const previewUrl = row?.files?.preview?.jpg || row?.files?.preview?.webp || row?.preview?.url || row?.sample?.url || origUrl;
      if (!origUrl) return null;
      const ext = String(row?.files?.meta?.ext || row?.file?.ext || '').toLowerCase();
      const isVideo = ['mp4', 'webm', 'mov'].includes(ext) || /\.(?:mp4|webm|mov)(?:[?#]|$)/i.test(origUrl);
      const rawTags = (Array.isArray(row?.tags)
        ? row.tags
        : Object.values(row?.tags || {}).flat()).filter(Boolean);
      const prioritized = needleTokens.length
        ? [...rawTags].sort((a, b) => {
            const am = needleTokens.some(t => normalize(a).includes(t)) ? 1 : 0;
            const bm = needleTokens.some(t => normalize(b).includes(t)) ? 1 : 0;
            return bm - am;
          })
        : rawTags;
      const tagStr = prioritized.join(' ');
      return {
        type: isVideo ? 'video' : 'image',
        url: origUrl,
        thumbnail: previewUrl || origUrl,
        link: row.id ? `https://e621.net/posts/${row.id}` : origUrl,
        title: prioritized.slice(0, 12).join(' ') || `e621 ${row.id || ''}`.trim(),
        description: tagStr.slice(0, 900),
        width: Number(row?.files?.original?.width || row?.file?.width || 0),
        height: Number(row?.files?.original?.height || row?.file?.height || 0),
        durationSeconds: Number(row?.files?.meta?.duration || row?.duration || 0),
        rating: row.rating || '',
        originalConfirmed: true,
        playback: isVideo ? 'direct' : undefined,
        trustedContext: true
      };
    }).filter(Boolean)
  };
}

async function fetchYandexImageSearch(fetchQuery, matchQuery, options = {}, limit = 35, fetchPageFn) {
  const safe = options.safe !== false;
  const url = `https://yandex.com/images/search?text=${encodeURIComponent(fetchQuery)}&family=${safe ? 'yes' : 'no'}`;
  const page = await fetchPageFn(url, {
    timeout: Math.min(Number(options.timeout) || 12000, 14000),
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      referer: ''
    }
  });
  if (page.statusCode >= 400) return { media: [], pageSamples: [], statusCode: page.statusCode, captcha: false };
  const captcha = /are you not a robot|smartcaptcha|showcaptcha/i.test(String(page.html || '').slice(0, 6000));
  if (captcha) return { media: [], pageSamples: [], statusCode: page.statusCode, captcha: true };
  const parsed = parseYandexImageResults(page.html, matchQuery, limit);
  return { ...parsed, statusCode: page.statusCode, captcha: false };
}

async function fetchBingVideoSearch(fetchQuery, matchQuery, options = {}, limit = 25, fetchPageFn) {
  const safe = options.safe !== false;
  const url = `https://www.bing.com/videos/search?q=${encodeURIComponent(fetchQuery)}&adlt=${safe ? 'strict' : 'off'}`;
  const page = await fetchPageFn(url, { timeout: Math.min(Number(options.timeout) || 12000, 14000) });
  if (page.statusCode >= 400) return { media: [], accounts: [], pageSamples: [], statusCode: page.statusCode };
  const parsed = parseBingVideoResults(page.html, matchQuery, limit);
  return { ...parsed, statusCode: page.statusCode };
}

async function runYandexImages(query, options, deps) {
  const result = await fetchYandexImageSearch(query, query, options, deps.imageLimit, deps.fetchPage);
  if (result.captcha) {
    return {
      images: [],
      videos: [],
      status: statusFor('yandex-images', [], [], {
        success: false,
        available: false,
        directReachable: false,
        zeroReason: 'access_blocked',
        note: 'Yandex SmartCaptcha actif sur cette adresse IP'
      })
    };
  }
  const normalized = normalizeRaw({ media: result.media }, query, 'yandex', deps);
  return {
    ...normalized,
    status: statusFor('yandex-images', normalized.images, normalized.videos, {
      success: result.statusCode < 400,
      note: `Yandex Images HTTP ${result.statusCode}`,
      pageSamples: result.pageSamples
    })
  };
}

async function runBingVideos(query, options, deps) {
  const result = await fetchBingVideoSearch(query, query, options, deps.videoLimit, deps.fetchPage);
  const normalized = normalizeRaw({ media: result.media }, query, 'bingvideos', deps);
  return {
    ...normalized,
    status: statusFor('bing-videos', normalized.images, normalized.videos, {
      success: result.statusCode < 400,
      note: `Bing Videos HTTP ${result.statusCode}`,
      accounts: result.accounts,
      pageSamples: result.pageSamples
    })
  };
}

async function runCivitai(query, options, deps) {
  const allowNsfw = options.safe === false && deps.adultConfirmed === true;
  const params = new URLSearchParams({
    query: String(query || '').trim(),
    limit: String(Math.min(deps.imageLimit, 12)),
    nsfw: allowNsfw ? 'true' : 'false'
  });
  const payload = await deps.fetchText(`https://civitai.com/api/v1/models?${params}`, {
    timeout: 12000,
    headers: { accept: 'application/json', 'user-agent': APP_USER_AGENT }
  });
  const parsed = parseCivitaiResults(payload, query, allowNsfw);
  const normalized = normalizeRaw(parsed, query, 'civitai', deps);
  return {
    ...normalized,
    status: statusFor('civitai-api', normalized.images, normalized.videos, {
      note: `API communautaire Civitai (${parsed.pageSamples.length} modeles)`,
      accounts: parsed.accounts,
      identityAliases: parsed.aliases,
      pageSamples: parsed.pageSamples
    })
  };
}

async function runRedtubeApi(query, options, deps) {
  const limit = Math.max(1, Math.min(Number(options.videoLimit || 20), 40));
  const params = new URLSearchParams({
    data: 'redtube.Videos.searchVideos',
    output: 'json',
    search: String(query || '').trim(),
    thumbsize: 'big'
  });
  const payload = await deps.fetchText(`https://api.redtube.com/?${params}`, {
    timeout: 12000,
    headers: { accept: 'application/json', 'user-agent': APP_USER_AGENT }
  });
  const parsed = parseRedtubeApiResults(payload, query, limit);
  const normalized = normalizeRaw(parsed, query, 'redtube', deps);
  return {
    ...normalized,
    status: statusFor('redtube-api', normalized.images, normalized.videos, {
      note: `API publique RedTube (${parsed.media.length} videos)`,
      pageSamples: parsed.pageSamples
    })
  };
}

async function runE621(query, deps) {
  const params = new URLSearchParams({
    tags: booruTag(query),
    limit: String(Math.min(deps.imageLimit + deps.videoLimit, 30))
  });
  const payload = await deps.fetchText(`https://e621.net/posts.json?${params}`, {
    timeout: 10000,
    headers: { accept: 'application/json', 'user-agent': APP_USER_AGENT }
  });
  const parsed = parseE621Posts(payload, query);
  const normalized = normalizeRaw(parsed, query, 'e621', deps);
  normalized.videos = normalized.videos.map(item => ({
    ...item,
    duration: item.durationSeconds ? deps.formatDuration(item.durationSeconds) : (item.duration || 'e621')
  }));
  return {
    ...normalized,
    status: statusFor('e621-api', normalized.images, normalized.videos, {
      note: 'API communautaire publique e621'
    })
  };
}

async function runPublicCatalogSource(sourceId, query, options = {}, deps = {}) {
  const scoped = {
    ...deps,
    imageLimit: Number(options.imageLimit || 35),
    videoLimit: Number(options.videoLimit || 20),
    adultConfirmed: options.adultConfirmed === true
  };
  if (sourceId === 'wikipedia') return runWikipedia(query, scoped);
  if (sourceId === 'tvmaze') return runTvmaze(query, scoped);
  if (sourceId === 'openlibrary') return runOpenLibrary(query, scoped);
  if (sourceId === 'nasalibrary') return runNasaLibrary(query, scoped);
  if (sourceId === 'loc') return runLoc(query, scoped);
  if (sourceId === 'metmuseum') return runMetMuseum(query, scoped);
  if (sourceId === 'safebooru') return runSafebooru(query, scoped);
  if (sourceId === 'yandere') return runMoebooru('yandere', 'yande.re', query, scoped);
  if (sourceId === 'konachan') return runMoebooru('konachan', 'konachan.com', query, scoped);
  if (sourceId === 'yandex') return runYandexImages(query, options, scoped);
  if (sourceId === 'bingvideos') return runBingVideos(query, options, scoped);
  if (sourceId === 'civitai') return runCivitai(query, options, scoped);
  if (sourceId === 'redtube') return runRedtubeApi(query, options, scoped);
  if (sourceId === 'e621') return runE621(query, scoped);
  return null;
}

module.exports = {
  APP_USER_AGENT,
  runPublicCatalogSource,
  runRedgifsApi,
  fetchYandexImageSearch,
  fetchBingVideoSearch,
  parseWikipediaResults,
  parseTvmazePeople,
  parseOpenLibraryAuthors,
  parseNasaLibraryResults,
  parseLocResults,
  parseMetMuseumObject,
  parseSafebooruPosts,
  parseMoebooruPosts,
  parseRedgifsApiResults,
  parseYandexImageResults,
  parseBingVideoResults,
  parseCivitaiResults,
  parseRedtubeApiResults,
  parseE621Posts
};
