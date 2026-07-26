const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'js', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'css', 'style.css'), 'utf8');

function functionBody(name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(app);
  assert.ok(match, `fonction ${name} introuvable`);
  const signatureEnd = /\)\s*\{/.exec(app.slice(match.index));
  assert.ok(signatureEnd, `signature de ${name} incomplete`);
  const openingBrace = match.index + signatureEnd.index + signatureEnd[0].lastIndexOf('{');
  let depth = 0;
  for (let index = openingBrace; index < app.length; index += 1) {
    if (app[index] === '{') depth += 1;
    if (app[index] === '}') depth -= 1;
    if (depth === 0) return app.slice(match.index, index + 1);
  }
  assert.fail(`corps de ${name} incomplet`);
}

test('le controle compact expose un champ secret labelle et des actions Lucide', () => {
  const form = html.match(/<form class="write-session-control"[\s\S]*?<\/form>/)?.[0] || '';
  assert.ok(form, 'controle de session absent');
  assert.match(form, /<label[^>]+for="write-session-token"/);
  assert.match(form, /id="write-session-token"[^>]+type="password"/);
  assert.match(form, /autocomplete="current-password"/);
  assert.match(form, /id="btn-write-session-unlock"[\s\S]*data-lucide="unlock"[\s\S]*Déverrouiller/);
  assert.match(form, /id="btn-write-session-lock"[\s\S]*data-lucide="lock"[\s\S]*Verrouiller/);
  assert.match(form, /id="write-session-configured"/);
  assert.match(form, /id="write-session-state"/);
  assert.match(form, /id="write-session-message"[^>]+aria-live="polite"/);
  assert.doesNotMatch(form, /connection-card|<p[\s>]/);
});

test('le statut utilise le contrat GET et distingue les trois etats attendus', () => {
  const load = functionBody('loadWriteSessionStatus');
  const render = functionBody('renderWriteSessionStatus');
  assert.match(load, /\/api\/session\/status/);
  assert.match(load, /credentials: 'same-origin'/);
  assert.match(load, /\btry\s*\{/);
  assert.match(load, /\bcatch\s*\(/);
  assert.match(load, /\bfinally\s*\{/);
  assert.match(render, /configured \? 'Configuré' : 'Non configuré'/);
  assert.match(render, /unlocked \? 'Déverrouillé' : 'Verrouillé'/);
  assert.match(render, /writeSessionBusy/);
});

test('le deverrouillage transmet uniquement le token en memoire et le purge toujours', () => {
  const unlock = functionBody('unlockWriteSession');
  assert.match(unlock, /\/api\/session\/unlock/);
  assert.match(unlock, /method: 'POST'/);
  assert.match(unlock, /credentials: 'same-origin'/);
  assert.match(unlock, /body: JSON\.stringify\(\{ token \}\)/);
  assert.match(unlock, /headers: \{ 'Content-Type': 'application\/json' \}/);
  assert.match(unlock, /\bcatch\s*\(/);
  assert.match(unlock, /\bfinally\s*\{[\s\S]*writeSessionToken\.value = ''[\s\S]*setWriteSessionBusy\(false\)/);
  assert.doesNotMatch(unlock, /localStorage|sessionStorage|textContent\s*=\s*token|innerHTML\s*=\s*token/);
});

test('le verrouillage utilise DELETE et restaure les controles meme en erreur', () => {
  const lock = functionBody('lockWriteSession');
  assert.match(lock, /\/api\/session\/lock/);
  assert.match(lock, /method: 'DELETE'/);
  assert.match(lock, /credentials: 'same-origin'/);
  assert.match(lock, /\bcatch\s*\(/);
  assert.match(lock, /\bfinally\s*\{[\s\S]*setWriteSessionBusy\(false\)/);
  assert.doesNotMatch(lock, /localStorage|sessionStorage/);
  assert.match(css, /\.write-session-control\s*\{[\s\S]*grid-template-columns:/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.write-session-control\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
});
