const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lucide = require('lucide');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediagatherer-test-'));
process.env.MEDIAGATHERER_DATA_DIR = testDataDir;
process.env.NODE_ENV = 'test';

const app = require('../server');
const {
  normalizeSearchTerm,
  repairMojibake,
  evaluateMediaMatch,
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
  mergeIdentityEvidence,
  searchModeThreshold,
  filterBySearchMode,
  collectSourceStatusUrls,
  guessWaybackDomains,
  buildWaybackCdxUrls,
  normalizeWaybackCdxPayload,
  buildPersonQueries,
  adultSearchGuard,
  hammingDistance,
  parseBlueskyResults,
  parseTumblrResults,
  parseImgurResults,
  parsePeerTubeResults,
  parseArquivoResults,
  selectWikidataEntity,
  selectTmdbPerson
} = app.locals.testables;

const extendedFixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'extended-sources.json'), 'utf8'));

let server;
let baseUrl;

test.before(async () => {
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

test('normalise les accents et exige une preuve textuelle', () => {
  assert.equal(normalizeSearchTerm(' Sxÿsindy '), 'sxysindy');
  assert.equal(evaluateMediaMatch({ title: 'Sxysindy official gallery' }, 'sxysindy').score, 96);
  assert.equal(evaluateMediaMatch({ title: 'Random image', url: 'https://cdn.test/random.jpg', link: 'https://google.com/search?q=sxysindy' }, 'sxysindy').score, 20);
  assert.equal(evaluateMediaMatch({ title: 'Random filename', trustedContext: true }, 'sxysindy').score, 68);
});

test('repare les titres UTF-8 interpretes en latin1', () => {
  assert.equal(repairMojibake('Amazing Five â» Mia'), 'Amazing Five ※ Mia');
  assert.equal(repairMojibake('Titre français normal'), 'Titre français normal');
});

test('rejette les assets UI et les cartes hors sujet sur une page de recherche', () => {
  const html = `
    <html><head><title>Search results</title></head><body>
      <img src="/logo.png" alt="Logo" width="64" height="32">
      <article><h2>Sxysindy gallery</h2><img src="https://cdn.example/full-sxysindy.jpg" alt="Sxysindy portrait" width="1200" height="1600"></article>
      <article><h2>Another person</h2><img src="https://cdn.example/random.jpg" alt="Random portrait" width="1200" height="1600"></article>
      <video src="https://cdn.example/random.mp4"></video>
      <article><a href="/video/sxysindy">Sxysindy video</a><img src="/sxysindy-poster.jpg" alt="Sxysindy"></article>
    </body></html>`;
  const images = extractImagesFromHtml(html, 'https://erome.com/search?q=sxysindy', 'sxysindy', 'erome');
  const videos = extractLinksAsVideos(html, 'https://erome.com/search?q=sxysindy', 'sxysindy', 'erome');
  assert.equal(images.length, 2);
  assert.ok(images.every(item => /sxysindy/i.test(item.url) || /sxysindy/i.test(item.title)));
  assert.ok(images.some(item => /full-sxysindy\.jpg/.test(item.url)));
  assert.equal(videos.length, 1);
  assert.match(videos[0].url, /video\/sxysindy/);
});

test('extrait tout le media d une page de compte publique validee', () => {
  const html = '<html><head><title>Public profile</title></head><body><img src="https://cdn.example/random-file.jpg" width="1400" height="1000"><video src="https://cdn.example/random-file.mp4" poster="https://cdn.example/poster.jpg"></video></body></html>';
  const images = extractImagesFromHtml(html, 'https://erome.com/a/public-profile', 'sxysindy', 'erome', 35, { trustedContext: true });
  const videos = extractLinksAsVideos(html, 'https://erome.com/a/public-profile', 'sxysindy', 'erome', 20, { trustedContext: true });
  assert.equal(images.length, 2);
  assert.equal(videos.length, 1);
  assert.equal(videos[0].confidenceScore, 68);
  assert.match(videos[0].thumbnail, /poster\.jpg/);
});

test('valide un profil ou tag public exact avant extraction complete', () => {
  assert.equal(isTrustedIdentityResultPage('https://example.com/tags/sxysindy/', 'Sxysindy videos', 'sxysindy'), true);
  assert.equal(isTrustedIdentityResultPage('https://example.com/sxysindy/', 'Sxysindy public profile', 'sxysindy'), true);
  assert.equal(isTrustedIdentityResultPage('https://example.com/tags/another/', 'Another profile', 'sxysindy'), false);
  const images = extractImagesFromHtml('<img src="https://cdn.example/random-name.jpg" width="1200" height="900">', 'https://example.com/tags/sxysindy/', 'sxysindy', 'bing', 35, { trustedContext: true });
  assert.equal(images.length, 1);
  assert.equal(images[0].trustedContext, true);
});

test('applique les seuils strict et profond', () => {
  const rows = [
    { confidenceScore: 96, title: 'exact' },
    { confidenceScore: 68, title: 'trusted' },
    { confidenceScore: 20, title: 'noise' }
  ];
  assert.deepEqual(filterBySearchMode(rows, 'strict').map(row => row.title), ['exact']);
  assert.deepEqual(filterBySearchMode(rows, 'smart').map(row => row.title), ['exact', 'trusted']);
  assert.deepEqual(filterBySearchMode(rows).map(row => row.title), ['exact', 'trusted']);
  assert.equal(searchModeThreshold(), 50);
});

test('construit une recherche Wayback rapide par domaine et exploite les pages decouvertes', () => {
  const urls = buildWaybackCdxUrls('sxysindy.com');
  assert.match(urls[0], /url=sxysindy\.com/);
  assert.match(urls[0], /matchType=domain/);
  assert.doesNotMatch(urls[0], /%2A/);
  assert.deepEqual(normalizeWaybackCdxPayload('[["original","timestamp","mimetype"]]'), [['original', 'timestamp', 'mimetype']]);
  assert.deepEqual(collectSourceStatusUrls({
    bing: {
      accounts: ['https://example.com/sxysindy'],
      pageSamples: [{ url: 'https://sxysindy.com/' }]
    }
  }), ['https://example.com/sxysindy', 'https://sxysindy.com/']);
  assert.deepEqual(guessWaybackDomains('sxysindy').slice(0, 3), [
    'sxysindy.com',
    'sxysindy.tumblr.com',
    'thesxysindy.weebly.com'
  ]);
});

test('lit les fallbacks web DuckDuckGo et Bing', () => {
  const duck = parseDuckDuckGoWebResults('<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fsxysindy">Sxysindy profile</a><div class="result__snippet">Public media</div></div>', 'sxysindy');
  const bing = parseBingWebResults('<li class="b_algo"><h2><a href="https://example.com/video/sxysindy">Sxysindy video</a></h2><div class="b_caption"><p>Public media</p></div></li>', 'sxysindy');
  assert.equal(duck[0].url, 'https://example.com/sxysindy');
  assert.equal(bing[0].url, 'https://example.com/video/sxysindy');
  const candidates = discoveredVideoPageCandidates(bing, 'sxysindy', 'bing');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].playback, 'external');
  assert.equal(candidates[0].thumbnail, '');
});

test('normalise l API Eporner et conserve la meilleure miniature', () => {
  const videos = parseEpornerApiResults({
    videos: [{
      id: 'abc123',
      title: 'Mia public video',
      keywords: 'mia creator',
      url: 'https://www.eporner.com/video-abc123/mia-public-video/',
      embed: 'https://www.eporner.com/embed/abc123/',
      length_sec: 125,
      default_thumb: { src: 'https://cdn.example/640.jpg', width: 640, height: 360 },
      thumbs: [{ src: 'https://cdn.example/1280.jpg', width: 1280, height: 720 }]
    }, {
      id: 'noise',
      title: 'Unrelated result',
      keywords: 'another person',
      url: 'https://www.eporner.com/video-noise/unrelated/'
    }]
  }, 'mia', 10);
  assert.equal(videos.length, 1);
  assert.equal(videos[0].thumbnail, 'https://cdn.example/1280.jpg');
  assert.equal(videos[0].embedUrl, 'https://www.eporner.com/embed/abc123/');
  assert.equal(videos[0].duration, '2:05');
});

test('enregistre les nouvelles routes de recherche NSFW publiques', () => {
  assert.match(sourceSearchUrls('xnxx', 'mia')[0], /xnxx\.com\/search\/mia\/0/);
  assert.match(sourceSearchUrls('hqporner', 'mia')[0], /hqporner\.com\/\?q=mia/);
  assert.match(sourceSearchUrls('youjizz', 'mia')[0], /youjizz\.com\/search\/mia-1\.html/);
  assert.match(sourceSearchUrls('phunforum', 'mia')[0], /forum\.phun\.org\/search/);
  assert.match(sourceSearchUrls('planetsuzy', 'mia')[0], /planetsuzy\.org\/search\.php/);
  assert.match(sourceSearchUrls('bellazon', 'mia')[0], /bellazon\.com\/main\/search/);
  assert.equal(pageMatchesAdapter('https://www.xnxx.com/video-abc/mia-public-video', 'xnxx'), true);
  assert.equal(pageMatchesAdapter('https://hqporner.com/hdporn/123_mia.html', 'hqporner'), true);
  assert.equal(pageMatchesAdapter('https://pornone.com/category/pornone-sex-video-123/123/', 'pornone'), true);
  assert.equal(pageMatchesAdapter('https://example.com/video-abc/mia', 'xnxx'), false);
  assert.equal(pageMatchesAdapter('https://forum.phun.org/threads/mia-public-gallery.12345/', 'phunforum'), true);
  assert.equal(pageMatchesAdapter('https://www.planetsuzy.org/showthread.php?t=12345', 'planetsuzy'), true);
  assert.equal(pageMatchesAdapter('https://www.bellazon.com/main/topic/126814-mia-khalifa/', 'bellazon'), true);
  assert.equal(isProfileLikeSourcePage('https://www.xnxx.com/porn-maker/mia', 'xnxx'), true);
  assert.equal(isProfileLikeSourcePage('https://www.xnxx.com/video-abc/mia', 'xnxx'), false);

  const trustedHqRows = extractAdapterPageLinks(
    '<section><a href="/hdporn/123_related-result.html"><img src="/thumb.jpg">Related result</a></section>',
    'https://hqporner.com/?q=mia',
    'mia',
    'hqporner',
    5,
    { trustedSearchResults: true }
  );
  assert.equal(trustedHqRows.length, 1);
  assert.equal(trustedHqRows[0].trustedContext, true);
  assert.equal(trustedHqRows[0].thumbnail, 'https://hqporner.com/thumb.jpg');

  const unrelatedHqRows = extractAdapterPageLinks(
    '<section><a href="/hdporn/123_related-result.html"><img src="/thumb.jpg">Related result</a></section>',
    'https://hqporner.com/?q=sxysindy',
    'sxysindy',
    'hqporner',
    5
  );
  assert.equal(unrelatedHqRows.length, 0);
});

test('ne compte pas les logos de profils JS ni plusieurs apercus pour une seule video', () => {
  const shell = '<html><head><title>Fansly.com</title><meta property="og:image" content="/assets/twitter-card-image.png"></head><body><img src="/assets/fansly_dark_v3.webp"></body></html>';
  const shellMedia = extractMediaFromSourcePage(shell, 'https://fansly.com/sxysindy', 'sxysindy', 'fansly');
  assert.equal(shellMedia.images.length, 0);

  const detail = `<html><head><title>Sxysindy Webcam Striptease</title><meta property="og:image" content="https://cdn.example/poster.jpg"></head><body>
    <video src="https://cdn.example/media/videos/tmb/1/1.mp4"></video>
    <video src="https://cdn.example/media/videos/tmb/2/2.mp4"></video>
  </body></html>`;
  const detailMedia = extractMediaFromSourcePage(detail, 'https://www.drtuber.com/video/123/sxysindy-webcam-striptease', 'sxysindy', 'drtuber', { trustedContext: true });
  assert.equal(detailMedia.videos.length, 1);
  assert.equal(detailMedia.videos[0].playback, 'preview');
  assert.match(detailMedia.videos[0].thumbnail, /poster\.jpg/);
});

test('deduit les noms publics et usernames seulement avec une preuve de profil', () => {
  const aliases = discoverAliases('sxysindy', [{
    sourceId: 'instagram',
    title: 'SxySindy (@sxysindy) • Photos et vidéos Instagram',
    link: 'https://www.instagram.com/sxysindy/'
  }, {
    sourceId: 'x',
    title: 'Sxy Sindy (@sindy_alt)',
    link: 'https://x.com/sindy_alt'
  }, {
    sourceId: 'bing',
    title: 'Unrelated person',
    link: 'https://example.com/random'
  }], [], {});
  assert.ok(aliases.some(alias => alias.kind === 'display_name' && alias.value === 'SxySindy'));
  assert.ok(aliases.some(alias => alias.kind === 'username' && alias.value === '@sindy_alt'));
  assert.ok(!aliases.some(alias => /unrelated/i.test(alias.value)));

  const forumAliases = discoverAliases('mia khalifa', [{
    sourceId: 'bellazon',
    title: 'Mia Khalifa',
    link: 'https://www.bellazon.com/main/topic/126814-mia-khalifa/'
  }, {
    sourceId: 'planetsuzy',
    title: 'Mia Khalifa',
    link: 'http://www.planetsuzy.org/showthread.php?t=756611'
  }], [], {});
  assert.deepEqual(forumAliases, []);

  const accountAliases = discoverAliases('sxysindy', [{
    sourceId: 'reddit',
    title: 'Sxysindy public post',
    accountUrl: 'https://www.reddit.com/user/sxysindy_alt'
  }, {
    sourceId: 'instagram',
    title: 'Sxysindy public profile',
    link: 'https://www.instagram.com/sxysindy_alt/'
  }], [], {});
  assert.ok(accountAliases.some(alias => alias.value === '@sxysindy_alt'));
  assert.ok(!accountAliases.some(alias => alias.value === '@user'));

  const discoveredPageAliases = discoverAliases('sxysindy', [], [], {
    instagram: {
      pageSamples: [{
        title: 'SxySindy (@sxysindy) - Photos et videos Instagram',
        url: 'https://www.instagram.com/sxysindy/'
      }]
    }
  });
  assert.ok(discoveredPageAliases.some(alias => alias.kind === 'display_name' && alias.value === 'SxySindy'));

  const technicalAliases = discoverAliases('sxysindy', [], [], {
    instagram: {
      pageSamples: [{
        title: 'Mot de passe oublie ?',
        url: 'https://www.instagram.com/accounts/password/reset/?next=https%3A%2F%2Fwww.instagram.com%2Fsxysindy%2F'
      }, {
        title: 'Confidentialite',
        url: 'https://www.instagram.com/legal/privacy/?next=https%3A%2F%2Fwww.instagram.com%2Fsxysindy%2F'
      }]
    }
  });
  assert.deepEqual(technicalAliases, []);

  const technicalPages = extractSearchResultPages(
    '<a href="/accounts/password/reset/?next=https%3A%2F%2Fwww.instagram.com%2Fsxysindy%2F">Mot de passe oublie ?</a><a href="/sxysindy/">SxySindy (@sxysindy)</a>',
    'https://www.instagram.com/sxysindy/',
    'sxysindy',
    'instagram'
  );
  assert.equal(technicalPages.length, 1);
  assert.equal(technicalPages[0].url, 'https://www.instagram.com/sxysindy/');
});

test('normalise les nouveaux adaptateurs API avec medias et preuves identite', () => {
  const bluesky = parseBlueskyResults(extendedFixtures.bluesky);
  assert.equal(bluesky.media.length, 1);
  assert.equal(bluesky.media[0].type, 'image');
  assert.ok(bluesky.aliases.some(alias => alias.value === '@sxysindy.bsky.social'));

  const tumblr = parseTumblrResults(extendedFixtures.tumblr);
  assert.equal(tumblr.media[0].url, 'https://64.media.tumblr.com/photo.jpg');
  assert.ok(tumblr.aliases.some(alias => alias.value === '@sxysindy'));

  const imgur = parseImgurResults(extendedFixtures.imgur);
  assert.deepEqual(imgur.media.map(item => item.type), ['image', 'video']);
  assert.equal(imgur.media[1].url, 'https://i.imgur.com/clip.mp4');

  const peertube = parsePeerTubeResults(extendedFixtures.peertube, 'https://peertube.example');
  assert.equal(peertube.media[0].thumbnail, 'https://peertube.example/lazy-static/previews/video.jpg');

  const arquivo = parseArquivoResults(extendedFixtures.arquivo);
  assert.equal(arquivo.media[0].width, 1280);
});

test('selectionne une seule identite Wikidata et rejette les homonymes', () => {
  const rows = [
    { id: 'QENGINEER', label: 'Douglas Adams', description: 'ingenieur americain', match: { text: 'Douglas Adams' } },
    { id: 'Q42', label: 'Douglas Adams', description: 'ecrivain britannique', match: { text: 'Douglas Adams' } },
    { id: 'QDISAMBIG', label: 'Douglas Adams', description: 'page homonymie', match: { text: 'Douglas Adams' } }
  ];
  const entities = {
    QENGINEER: { labels: { fr: { value: 'Douglas Adams' } }, descriptions: { fr: { value: 'ingenieur americain' } }, claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }] }, sitelinks: { enwiki: {} } },
    Q42: {
      labels: { fr: { value: 'Douglas Adams' } },
      descriptions: { fr: { value: 'ecrivain de science-fiction britannique' } },
      claims: {
        P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }],
        P569: [{ mainsnak: { datavalue: { value: { time: '+1952-03-11T00:00:00Z' } } } }],
        P18: [{ mainsnak: { datavalue: { value: 'Douglas adams portrait cropped.jpg' } } }]
      },
      sitelinks: Object.fromEntries(Array.from({ length: 90 }, (_, index) => [`wiki${index}`, {}]))
    },
    QDISAMBIG: { labels: { fr: { value: 'Douglas Adams' } }, claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q4167410' } } } }] }, sitelinks: {} }
  };
  const selected = selectWikidataEntity(rows, entities, 'Douglas Adams', { birthYear: 1952, positiveKeywords: ['science-fiction'] });
  assert.equal(selected.row.id, 'Q42');
  assert.ok(selected.score > 200);

  const tmdb = selectTmdbPerson([
    { id: 1, name: 'Alex Smith', popularity: 2, known_for: [{ title: 'News' }] },
    { id: 2, name: 'Alex Smith', popularity: 80, profile_path: '/alex.jpg', known_for: [{ title: 'Science Fiction Story' }] }
  ], 'Alex Smith', { positiveKeywords: ['science fiction'] });
  assert.equal(tmdb.person.id, 2);
});

test('fusionne les preuves identite et applique le garde-fou adulte', () => {
  const aliases = mergeIdentityEvidence('sxysindy', [], {
    wikidata: { identityAliases: [{ value: 'Sxy Sindy', kind: 'display_name', confidence: 91, evidence: ['Q1'] }] },
    bluesky: { identityAliases: [{ value: '@sindy-alt', kind: 'username', confidence: 94, evidence: ['bsky'] }] }
  });
  assert.ok(aliases.some(alias => alias.value === 'Sxy Sindy'));
  assert.ok(aliases.some(alias => alias.value === '@sindy-alt'));
  const nsfwSources = new Set(['erome']);
  assert.equal(adultSearchGuard({ safe: false, selectedSources: ['erome'], nsfwSources, adultConfirmed: false }).allowed, false);
  assert.equal(adultSearchGuard({ safe: false, selectedSources: ['erome'], nsfwSources, adultConfirmed: true }).allowed, true);
  assert.equal(adultSearchGuard({ safe: true, selectedSources: ['wikidata'], nsfwSources, adultConfirmed: false }).allowed, true);
});

test('calcule la distance de Hamming des empreintes perceptuelles', () => {
  assert.equal(hammingDistance('0000000000000000', '0000000000000000'), 0);
  assert.equal(hammingDistance('0000000000000000', 'ffffffffffffffff'), 64);
  assert.equal(hammingDistance('invalid', 'ffffffffffffffff'), Number.POSITIVE_INFINITY);
});

test('conserve l original plutot que sa miniature', () => {
  const extracted = extractImagesFromHtml(
    '<img src="https://cdn.example/photo.thumb.jpg" data-full-image="https://cdn.example/photo-original.jpg" alt="Mia portrait" width="300" height="300">',
    'https://example.com/topic/mia',
    'mia',
    'bellazon',
    10,
    { trustedContext: true }
  );
  assert.equal(extracted[0].url, 'https://cdn.example/photo-original.jpg');

  const rows = dedupeBestMedia([
    { type: 'image', url: 'https://cdn.example/album/thumbs/photo.jpg' },
    { type: 'image', url: 'https://cdn.example/album/photo.jpg' }
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, 'https://cdn.example/album/photo.jpg');

  const forumRows = dedupeBestMedia([
    { type: 'image', url: 'https://www.bellazon.com/main/uploads/photo.thumb.jpg.aaaaaaaa.jpg' },
    { type: 'image', url: 'https://www.bellazon.com/main/uploads/photo.jpg.bbbbbbbb.jpg' }
  ]);
  assert.equal(forumRows.length, 1);
  assert.equal(forumRows[0].url, 'https://www.bellazon.com/main/uploads/photo.jpg.bbbbbbbb.jpg');
});

test('bloque les plages privees et les URLs locales', async () => {
  ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.1.1', '::1', '::ffff:127.0.0.1'].forEach(address => assert.equal(isPrivateIp(address), true));
  assert.equal(isPrivateIp('8.8.8.8'), false);
  await assert.rejects(() => validatePublicMediaUrl('http://127.0.0.1/private'), /privee/);
  await assert.rejects(() => validatePublicMediaUrl('http://localhost/private'), /local/);
  await assert.rejects(() => validatePublicMediaUrl('file:///etc/passwd'), /http/);
});

test('construit un plan Person Finder borne et sans doublon', () => {
  const queries = buildPersonQueries({ displayName: 'Sxysindy', aliases: ['Sxysindy', 'AliasX'], usernames: ['sxysindy'], positiveKeywords: ['creator'], accounts: [] }, 'deep');
  assert.ok(queries.length <= 32);
  assert.equal(new Set(queries).size, queries.length);
  assert.ok(queries.some(query => query.includes('AliasX')));
});

test('expose des contrats API coherents', async () => {
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).app, 'MediaGatherer');

  const missingQuery = await fetch(`${baseUrl}/api/search`);
  assert.equal(missingQuery.status, 400);

  const unknownApi = await fetch(`${baseUrl}/api/does-not-exist`);
  assert.equal(unknownApi.status, 404);
  assert.match(unknownApi.headers.get('content-type'), /application\/json/);

  const blockedProxy = await fetch(`${baseUrl}/api/proxy?url=${encodeURIComponent('http://127.0.0.1/private')}`);
  assert.equal(blockedProxy.status, 400);

  const blockedAccount = await fetch(`${baseUrl}/api/account/scrape?url=${encodeURIComponent('http://127.0.0.1/private')}`);
  assert.equal(blockedAccount.status, 400);

  const blockedAdultWayback = await fetch(`${baseUrl}/api/wayback/hosts?q=sxysindy&safe=false`);
  assert.equal(blockedAdultWayback.status, 403);

  const unknownJob = await fetch(`${baseUrl}/api/queue/jobs/not-found/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(unknownJob.status, 404);

  const rejectedCollection = await fetch(`${baseUrl}/api/collection`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'javascript:alert(1)' }) });
  assert.equal(rejectedCollection.status, 400);

  const history = await fetch(`${baseUrl}/api/history`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'client-controlled', createdAt: '2000-01-01', query: 'sxysindy' }) });
  const historyItem = await history.json();
  assert.equal(history.status, 200);
  assert.notEqual(historyItem.id, 'client-controlled');
  assert.notEqual(historyItem.createdAt, '2000-01-01');

  const corsRejected = await fetch(`${baseUrl}/api/health`, { headers: { origin: 'https://attacker.invalid' } });
  assert.equal(corsRejected.status, 403);

  const desktopQa = await fetch(`${baseUrl}/api/desktop/qa`);
  assert.equal(desktopQa.status, 200);
  assert.equal((await desktopQa.json()).assetsReady, true);

  const adapters = await fetch(`${baseUrl}/api/sources/adapters`).then(response => response.json());
  const eporner = adapters.adapters.find(adapter => adapter.id === 'eporner');
  assert.equal(eporner.mode, 'eporner-api-v2');
  assert.equal(eporner.availability, 'official-public-api-with-html-fallback');
  assert.equal(adapters.adapters.find(adapter => adapter.id === 'phunforum').subtype, 'forum');
});

test('garde les contrats DOM et le registre de sources synchronises', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  const htmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const duplicateIds = htmlIds.filter((id, index) => htmlIds.indexOf(id) !== index);
  assert.deepEqual(duplicateIds, []);

  const requiredIds = [...client.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map(match => match[1]);
  const missingIds = [...new Set(requiredIds)].filter(id => !htmlIds.includes(id));
  assert.deepEqual(missingIds, []);

  const sourcePayload = await fetch(`${baseUrl}/api/sources`).then(response => response.json());
  const sourceIds = sourcePayload.sources.map(source => source.id);
  assert.match(client, /fetch\(`\$\{API_BASE\}\/api\/sources`\)/);
  assert.match(client, /createSourceChip\(source\)/);
  assert.match(client, /populateSourceFilter\(\)/);
  assert.match(html, /<option value="smart" selected>Intelligent<\/option>/);
  assert.match(client, /mediagatherer-search-cache-v1/);
  assert.match(client, /restoreSearchSnapshot\(lastSearchConfig\)/);
  assert.ok(sourcePayload.sources.every(source => ['normal', 'social', 'identity', 'nsfw'].includes(source.category)));
  assert.equal(new Set(sourceIds).size, sourceIds.length);
});

test('chaque source expose un contrat de transport public testable', async () => {
  const sourcePayload = await fetch(`${baseUrl}/api/sources`).then(response => response.json());
  const adapterPayload = await fetch(`${baseUrl}/api/sources/adapters`).then(response => response.json());
  assert.equal(adapterPayload.adapters.length, sourcePayload.sources.length);
  for (const source of sourcePayload.sources) {
    const adapter = adapterPayload.adapters.find(row => row.id === source.id);
    assert.ok(adapter, `adaptateur absent: ${source.id}`);
    assert.ok(Array.isArray(adapter.supports) && adapter.supports.length > 0, `supports absents: ${source.id}`);
    assert.ok(Array.isArray(adapter.domains) && adapter.domains.length > 0, `domaine absent: ${source.id}`);
    const urls = sourceSearchUrls(source.id, 'test');
    assert.ok(urls.length > 0 && urls.every(url => /^https:\/\//.test(url)), `transport invalide: ${source.id}`);
  }
});

test('utilise uniquement des icones Lucide disponibles', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const iconNames = [...html.matchAll(/data-lucide="([^"]+)"/g)].map(match => match[1]);
  const toPascalCase = value => value.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  const missing = [...new Set(iconNames)].filter(name => !lucide.icons[toPascalCase(name)]);
  assert.deepEqual(missing, []);
});

test('exporte les resultats en CSV et Markdown', async () => {
  const payload = { images: [{ title: 'Sxysindy photo', url: 'https://example.com/photo.jpg' }], videos: [] };
  const csv = await fetch(`${baseUrl}/api/exports/results?format=csv`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition'), /results\.csv/);
  assert.match(await csv.text(), /Sxysindy photo/);

  const markdown = await fetch(`${baseUrl}/api/exports/results?format=markdown`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  assert.equal(markdown.status, 200);
  assert.match(await markdown.text(), /Sxysindy photo/);
});
