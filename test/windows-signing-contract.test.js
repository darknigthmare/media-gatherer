const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const scriptPath = path.join(root, 'scripts', 'sign-windows.ps1');
const documentationPath = path.join(root, 'docs', 'WINDOWS_SIGNING.md');
const workflowPath = path.join(root, '.github', 'workflows', 'ci.yml');
const script = fs.readFileSync(scriptPath, 'utf8');
const documentation = fs.readFileSync(documentationPath, 'utf8');
const workflow = fs.readFileSync(workflowPath, 'utf8');

test('le script exige un PFX et un mot de passe par parametre ou environnement', () => {
  assert.match(script, /\[string\]\$PfxPath = \$env:MEDIA_GATHERER_SIGNING_PFX/);
  assert.match(script, /\[System\.Security\.SecureString\]\$PfxPassword/);
  assert.match(script, /\$env:MEDIA_GATHERER_SIGNING_PASSWORD/);
  assert.match(script, /Un fichier PFX est requis/);
  assert.match(script, /Un mot de passe PFX est requis/);
});

test('signtool signe et horodate exclusivement en SHA-256', () => {
  assert.match(script, /Get-Command -Name 'signtool\.exe'/);
  assert.match(
    script,
    /& \$resolvedSignTool sign \/f \$resolvedPfx \/p \$plainPassword \/fd SHA256 \/tr \$TimestampUrl \/td SHA256 \$resolvedExecutable/
  );
  assert.match(script, /TimestampUrl doit etre une URL HTTPS absolue/);
  assert.match(script, /https:\/\/timestamp\.digicert\.com/);
});

test('les erreurs natives sont controlees et la signature est verifiee', () => {
  assert.match(script, /Set-StrictMode -Version Latest/);
  assert.match(script, /\$ErrorActionPreference = 'Stop'/);
  assert.match(script, /\$signExitCode = \$LASTEXITCODE/);
  assert.match(script, /if \(\$signExitCode -ne 0\)[\s\S]*throw/);
  assert.match(script, /& \$resolvedSignTool verify \/pa \/all \$resolvedExecutable/);
  assert.match(script, /\$verifyExitCode = \$LASTEXITCODE/);
  assert.match(script, /if \(\$verifyExitCode -ne 0\)[\s\S]*throw/);
  assert.doesNotMatch(script, /SilentlyContinue/);
});

test('aucun certificat ni secret ne sont crees ou imprimes', () => {
  assert.doesNotMatch(
    script,
    /New-SelfSignedCertificate|makecert|certreq|Export-PfxCertificate/i
  );
  assert.doesNotMatch(
    script,
    /Write-(?:Host|Output|Information|Verbose|Debug|Warning)[^\r\n]*(?:plainPassword|PfxPassword|MEDIA_GATHERER_SIGNING_PASSWORD)/i
  );
  assert.match(script, /ZeroFreeBSTR\(\$passwordPointer\)/);
  assert.match(documentation, /Il ne cree, ne genere et n'exporte aucun certificat/);
  assert.match(documentation, /Read-Host[\s\S]*-AsSecureString/);
  assert.match(documentation, /Le script n'imprime jamais le mot de passe/);
  assert.match(documentation, /Aucun certificat de test ou[\s\S]*auto-signe n'est cree/);
});

test('la CI signe seulement avec les deux secrets et nettoie le PFX temporaire', () => {
  assert.match(workflow, /WINDOWS_CERTIFICATE_BASE64: \$\{\{ secrets\.WINDOWS_CERTIFICATE_BASE64 \}\}/);
  assert.match(workflow, /MEDIA_GATHERER_SIGNING_PASSWORD: \$\{\{ secrets\.WINDOWS_CERTIFICATE_PASSWORD \}\}/);
  assert.match(workflow, /if \(-not \$certificateConfigured -and -not \$passwordConfigured\)/);
  assert.match(workflow, /if \(-not \$certificateConfigured -or -not \$passwordConfigured\)/);
  assert.match(workflow, /FromBase64String\(\$env:WINDOWS_CERTIFICATE_BASE64\)/);
  assert.match(workflow, /scripts\\sign-windows\.ps1/);
  assert.match(workflow, /Remove-Item -LiteralPath \$certificatePath -Force/);
  assert.doesNotMatch(workflow, /build-exe-windows:[\s\S]*?timeout-minutes: 20\s+env:/);
});
