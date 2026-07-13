const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediagatherer-test-'));
process.env.MEDIAGATHERER_DATA_DIR = testDataDir;
process.env.NODE_ENV = 'test';

const app = require('../server');
const {
  normalizeSearchTerm,
  evaluateMediaMatch,
  dedupeBestMedia,
  isPrivateIp,
  validatePublicMediaUrl,
  extractImagesFromHtml,
  extractLinksAsVideos,
  parseDuckDuckGoWebResults,
  parseBingWebResults,
  filterBySearchMode,
  buildPersonQueries
} = app.locals.testables;

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
  const images = extractImagesFromHtml(html, 'https://erome.com/a/public-profile', 'sxysindy', 'erome');
  const videos = extractLinksAsVideos(html, 'https://erome.com/a/public-profile', 'sxysindy', 'erome');
  assert.equal(images.length, 2);
  assert.equal(videos.length, 1);
  assert.equal(videos[0].confidenceScore, 68);
  assert.match(videos[0].thumbnail, /poster\.jpg/);
});

test('applique les seuils strict et profond', () => {
  const rows = [
    { confidenceScore: 96, title: 'exact' },
    { confidenceScore: 68, title: 'trusted' },
    { confidenceScore: 20, title: 'noise' }
  ];
  assert.deepEqual(filterBySearchMode(rows, 'strict').map(row => row.title), ['exact']);
  assert.deepEqual(filterBySearchMode(rows, 'smart').map(row => row.title), ['exact', 'trusted']);
});

test('lit les fallbacks web DuckDuckGo et Bing', () => {
  const duck = parseDuckDuckGoWebResults('<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fsxysindy">Sxysindy profile</a><div class="result__snippet">Public media</div></div>', 'sxysindy');
  const bing = parseBingWebResults('<li class="b_algo"><h2><a href="https://example.com/video/sxysindy">Sxysindy video</a></h2><div class="b_caption"><p>Public media</p></div></li>', 'sxysindy');
  assert.equal(duck[0].url, 'https://example.com/sxysindy');
  assert.equal(bing[0].url, 'https://example.com/video/sxysindy');
});

test('conserve l original plutot que sa miniature', () => {
  const rows = dedupeBestMedia([
    { type: 'image', url: 'https://cdn.example/album/thumbs/photo.jpg' },
    { type: 'image', url: 'https://cdn.example/album/photo.jpg' }
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, 'https://cdn.example/album/photo.jpg');
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
