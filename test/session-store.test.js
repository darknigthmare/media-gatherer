const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(baseUrl, child) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Serveur de test arrete avec le code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Server startup is still in progress.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timeout au demarrage du serveur de test');
}

function sessionCookie(response) {
  return String(response.headers.get('set-cookie') || '').split(';')[0];
}

test('isole les donnees Vercel de deux sessions navigateur', async t => {
  const port = await freePort();
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediagatherer-session-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      VERCEL: '1',
      NODE_ENV: 'test',
      MEDIAGATHERER_DATA_DIR: dataDirectory,
      KV_REST_API_URL: '',
      KV_REST_API_TOKEN: '',
      UPSTASH_REDIS_REST_URL: '',
      UPSTASH_REDIS_REST_TOKEN: '',
      APP_WRITE_TOKEN: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await new Promise(resolve => child.once('exit', resolve));
    }
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, child);
  const firstSessionResponse = await fetch(`${baseUrl}/api/health`);
  const secondSessionResponse = await fetch(`${baseUrl}/api/health`);
  const firstCookie = sessionCookie(firstSessionResponse);
  const secondCookie = sessionCookie(secondSessionResponse);
  assert.match(firstCookie, /^mg_session=[a-f0-9]{32}$/);
  assert.match(secondCookie, /^mg_session=[a-f0-9]{32}$/);
  assert.notEqual(firstCookie, secondCookie);

  const createHistory = (cookie, query) => fetch(`${baseUrl}/api/history`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ query })
  });
  assert.equal((await createHistory(firstCookie, 'session alpha')).status, 200, stderr);
  assert.equal((await createHistory(secondCookie, 'session beta')).status, 200, stderr);

  const firstHistory = await fetch(`${baseUrl}/api/history`, {
    headers: { cookie: firstCookie }
  }).then(response => response.json());
  const secondHistory = await fetch(`${baseUrl}/api/history`, {
    headers: { cookie: secondCookie }
  }).then(response => response.json());
  assert.deepEqual(firstHistory.items.map(item => item.query), ['session alpha']);
  assert.deepEqual(secondHistory.items.map(item => item.query), ['session beta']);

  const health = await fetch(`${baseUrl}/api/health`, {
    headers: { cookie: firstCookie }
  }).then(response => response.json());
  assert.equal(health.security.writeMode, 'isolated-browser-session');
  assert.equal(health.storage.scope, 'isolated-browser-session');
  assert.match(health.storage.remote.key, /session:<isolated>$/);
  assert.doesNotMatch(JSON.stringify(health), new RegExp(firstCookie.split('=')[1]));
});
