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

test('la recherche active est annulable et protegee par controleur et jeton', () => {
  assert.match(html, /id="btn-cancel-search"[^>]*type="button"|type="button"[^>]*id="btn-cancel-search"/);
  assert.match(app, /let activeSearchController = null;/);
  assert.match(app, /let activeSearchToken = 0;/);

  const begin = functionBody('beginSearchSession');
  assert.match(begin, /activeSearchController\?\.abort\(\)/);
  assert.match(begin, /new AbortController\(\)/);
  assert.match(begin, /activeSearchToken = token/);

  const search = functionBody('runSearchWithCurrentControls');
  assert.match(search, /beginSearchSession\(\)/);
  assert.match(search, /fetch\(buildSearchUrl\(searchConfig, source\), \{ signal \}\)/);
  assert.match(search, /assertActiveSearch\(token, signal\)/);
  assert.match(app, /btnCancelSearch\.addEventListener\('click', cancelActiveSearch\)/);
});

test('le statut de stockage precede les profils et le fallback volatile est fusionne', () => {
  const init = functionBody('initializeRuntimeAndPersons');
  assert.ok(init.indexOf('await ensureRuntimeStatus()') < init.indexOf('await loadPersons()'));

  const load = functionBody('loadPersons');
  assert.match(load, /if \(!runtimeStatusResolved\) await ensureRuntimeStatus\(\)/);
  assert.match(load, /mergePersonProfileFallback\(serverProfiles, fallbackProfiles\)/);
  assert.match(load, /personProfiles = fallbackProfiles/);
  assert.doesNotMatch(app, /\nloadRuntimeStatus\(\);\s*\n/);
});

test('les profils imposent les garde-fous et disposent du mode edition PATCH', () => {
  assert.match(html, /id="person-public-only"[^>]*required/);
  assert.match(html, /id="person-safe-mode"[^>]*required/);
  assert.match(html, /id="btn-person-cancel-edit"/);
  assert.match(app, /data-person-edit=/);

  const save = functionBody('savePersonProfile');
  assert.match(save, /!payload\.publicOnly \|\| !payload\.safeMode/);
  assert.match(save, /const method = targetId \? 'PATCH' : 'POST'/);
  assert.match(save, /api\/persons\/\$\{encodeURIComponent\(targetId\)\}/);
  assert.match(app, /btnPersonCancelEdit\.addEventListener\('click', resetPersonFormMode\)/);
});

test('favoris et resultats utilisent exactement les memes filtres', () => {
  const base = functionBody('currentFilterBase');
  assert.match(base, /if \(!showingFavorites\) return \{ images: allImages, videos: allVideos \}/);
  assert.match(base, /favorites\.filter/);

  const filters = functionBody('applyFilters');
  assert.match(filters, /const base = currentFilterBase\(\)/);
  assert.match(filters, /base\.images\.filter\(matchesActiveFilters\)/);
  assert.match(filters, /base\.videos\.filter\(matchesActiveFilters\)/);
  assert.match(filters, /mediaSourceId\(item\) === sourceTerm/);
  assert.match(app, /setShowingFavorites\(!showingFavorites\)/);
});

test('les exports utilisent seulement les medias actuellement filtres', () => {
  const exportHandlerStart = app.indexOf("btnExportJson.addEventListener('click'");
  const exportHandlerEnd = app.indexOf('if (btnAutoRefresh)', exportHandlerStart);
  const exportHandler = app.slice(exportHandlerStart, exportHandlerEnd);
  assert.match(exportHandler, /filteredImages\.map/);
  assert.match(exportHandler, /filteredVideos\.map/);
  assert.match(exportHandler, /JSON\.stringify\(\{ images: exportImages, videos: exportVideos \}\)/);
  assert.doesNotMatch(exportHandler, /allImages\.map|allVideos\.map/);
});

test('les actions Person Finder critiques ferment toujours leurs etats occupes', () => {
  [
    'selectPerson',
    'savePersonProfile',
    'deletePersonProfile',
    'resolvePersonIdentity',
    'runPersonSearch',
    'validatePersonMedia',
    'savePersonRule',
    'deletePersonRule'
  ].forEach(name => {
    const body = functionBody(name);
    assert.match(body, /\btry\s*\{/);
    assert.match(body, /\bcatch\s*\(/);
    assert.match(body, /\bfinally\s*\{/);
  });
});

test('les connexions declarent les champs requis et testent la saisie courante', () => {
  const render = functionBody('renderConnections');
  assert.match(render, /field\.required \? ' required aria-required="true"'/);
  assert.match(render, /\$\{requiredAttributes\}/);

  const connectionTest = functionBody('testConnection');
  assert.match(connectionTest, /readConnectionForm\(card\)/);
  assert.match(connectionTest, /storeConnectionValues\(provider, card\)/);
  assert.match(connectionTest, /body: JSON\.stringify\(credentials\)/);
});

test('les echecs fetch alimentent aussi les diagnostics de sources', () => {
  const record = functionBody('recordSourceFetchError');
  assert.match(record, /zeroReason: 'fetch-error'/);
  assert.match(record, /fetchError: true/);

  const search = functionBody('runSearchWithCurrentControls');
  assert.match(search, /recordSourceFetchError\(source, sourceError\)/);
  assert.match(search, /if \(!sourceDiagnostics\[src\]\)/);
});

test('les modales exposent des noms accessibles et ne ferment que la modale ouverte', () => {
  const lightbox = functionBody('openLightbox');
  assert.match(lightbox, /lightboxImg\.alt = accessibleTitle/);
  assert.match(app, /iframe\.title = `Lecture vidéo :/);
  assert.match(app, /let lastLightboxTrigger = null/);
  assert.match(app, /let lastVideoModalTrigger = null/);

  const closeImage = functionBody('closeLightbox');
  const closeVideo = functionBody('closeVideoModal');
  assert.match(closeImage, /if \(!isOpenModal\(lightbox\)\) return false/);
  assert.match(closeVideo, /if \(!isOpenModal\(videoModal\)\) return false/);
  assert.match(app, /if \(isOpenModal\(videoModal\)\) closeVideoModal\(\);\s*else if \(isOpenModal\(lightbox\)\) closeLightbox\(\);/);
});

test('les controles statiques sans texte visible possedent un label', () => {
  [
    'person-rule-value',
    'person-rule-action',
    'search-input',
    'filter-size',
    'filter-type',
    'filter-input',
    'auto-refresh-interval',
    'batch-input'
  ].forEach(id => {
    assert.match(html, new RegExp(`<label[^>]+for="${id}"`), `label manquant pour ${id}`);
  });
});

test('le responsive couvre explicitement les ecrans inferieurs a 392px', () => {
  assert.match(css, /@media \(max-width: 391px\)/);
  assert.match(css, /#reverse-image-url,[\s\S]*min-width: 0 !important/);
  assert.match(css, /\.media-grid\.grid-large[\s\S]*grid-template-columns: minmax\(0, 1fr\) !important/);
  assert.match(css, /\.connections-grid[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
});

test('Person Finder affiche la couverture reelle par identite et source', () => {
  const render = functionBody('renderPersonPlan');
  assert.match(render, /coverageByIdentity/);
  assert.match(render, /person-coverage-scroll/);
  assert.match(render, /state-\$\{escapeHtml\(row\.state/);
  assert.match(render, /row\.results/);
  const select = functionBody('selectPerson');
  assert.match(select, /\/search-coverage/);
  assert.match(css, /\.person-coverage-scroll\s*\{[^}]*overflow-y:\s*auto;/s);
});

test('la qualite media distingue miniature variante et original puis mesure le rendu', () => {
  const prepare = functionBody('prepareMediaItems');
  const tracking = functionBody('trackRenderedImageQuality');
  const lightbox = functionBody('openLightbox');
  assert.match(prepare, /inferClientMediaQuality/);
  assert.match(tracking, /naturalWidth/);
  assert.match(tracking, /qualityVerifiedAt/);
  assert.match(lightbox, /qualityStateText\(img\)/);
  assert.match(app, /original_confirmed: 'Original confirm/);
  assert.match(app, /thumbnail_only: 'Miniature seulement'/);
});

test('la veille locale planifie seulement les recherches dues sans chevauchement', () => {
  const scheduler = functionBody('checkDueMonitors');
  const run = functionBody('runSavedMonitor');
  assert.match(scheduler, /monitorSchedulerRunning \|\| document\.hidden \|\| navigator\.onLine === false/);
  assert.match(scheduler, /api\/monitors\?due=true/);
  assert.match(scheduler, /dueItems\[0\]/);
  assert.match(run, /api\/monitors\/\$\{encodeURIComponent\(id\)\}\/run/);
  assert.match(app, /setInterval\(\(\) => void checkDueMonitors\(\), 30000\)/);
  assert.match(app, /void loadMonitors\(\)\.then\(startMonitorScheduler\)/);
  assert.match(css, /\.monitor-controls\s*\{/);
});
