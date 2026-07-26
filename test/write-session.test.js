const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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

function responseCookie(response, name) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')];
  for (const value of values) {
    const match = String(value || '').match(new RegExp(`(?:^|,\\s*)(${name}=[^;,\\s]*)`));
    if (match) return match[1];
  }
  return '';
}

function readDirectoryText(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).map(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? readDirectoryText(target) : fs.readFileSync(target, 'utf8');
  }).join('\n');
}

test('verrouille les ecritures et garde le jeton hors du stockage', async t => {
  const port = await freePort();
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediagatherer-write-session-'));
  const writeToken = 'test-only-write-token-7f89';
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
      APP_WRITE_TOKEN: writeToken
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
  const statusResponse = await fetch(`${baseUrl}/api/session/status`);
  const sessionCookie = responseCookie(statusResponse, 'mg_session');
  const status = await statusResponse.json();
  assert.match(sessionCookie, /^mg_session=[a-f0-9]{32}$/);
  assert.deepEqual(
    { configured: status.configured, required: status.required, unlocked: status.unlocked },
    { configured: true, required: true, unlocked: false }
  );

  const createHistory = (headers, query) => fetch(`${baseUrl}/api/history`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ query })
  });
  assert.equal((await createHistory({ cookie: sessionCookie }, 'blocked')).status, 401);

  const wrongUnlock = await fetch(`${baseUrl}/api/session/unlock`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify({ token: 'wrong-token' })
  });
  assert.equal(wrongUnlock.status, 401);

  const unlockResponse = await fetch(`${baseUrl}/api/session/unlock`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify({ token: writeToken })
  });
  assert.equal(unlockResponse.status, 200, stderr);
  const writeCookie = responseCookie(unlockResponse, 'mg_write');
  assert.match(writeCookie, /^mg_write=\d{13}\.[a-f0-9]{64}$/);
  const unlockBody = await unlockResponse.text();
  assert.doesNotMatch(unlockBody, new RegExp(writeToken));

  const browserCookies = `${sessionCookie}; ${writeCookie}`;
  assert.equal((await createHistory({ cookie: browserCookies }, 'browser unlocked')).status, 200, stderr);
  assert.equal((await createHistory({ cookie: sessionCookie, 'x-app-token': writeToken }, 'header unlocked')).status, 200, stderr);

  const sessionId = sessionCookie.split('=')[1];
  const expiredAt = Date.now() - 1000;
  const expiredSignature = crypto.createHmac('sha256', writeToken)
    .update(`write:${sessionId}:${expiredAt}`)
    .digest('hex');
  const expiredCookie = `${sessionCookie}; mg_write=${expiredAt}.${expiredSignature}`;
  assert.equal((await createHistory({ cookie: expiredCookie }, 'expired cookie')).status, 401);

  const lockResponse = await fetch(`${baseUrl}/api/session/lock`, {
    method: 'DELETE',
    headers: { cookie: browserCookies }
  });
  assert.equal(lockResponse.status, 200);
  assert.match(responseCookie(lockResponse, 'mg_write'), /^mg_write=$/);
  assert.equal((await createHistory({ cookie: sessionCookie }, 'blocked again')).status, 401);

  const history = await fetch(`${baseUrl}/api/history`, {
    headers: { cookie: sessionCookie }
  }).then(response => response.json());
  assert.deepEqual(history.items.map(item => item.query), ['header unlocked', 'browser unlocked']);
  assert.doesNotMatch(JSON.stringify(history), new RegExp(writeToken));
  assert.doesNotMatch(readDirectoryText(dataDirectory), new RegExp(writeToken));
});
