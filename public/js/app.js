// ----------------------------------------------------
// STATE VARIABLES
// ----------------------------------------------------
let allImages = [];
let allVideos = [];
let filteredImages = [];
let filteredVideos = [];
let favorites = JSON.parse(localStorage.getItem('aerogatherer_favorites')) || [];
let showingFavorites = false;
let currentVideoIndex = -1;
let currentSearchQuery = '';
let detectedAccounts = [];
let lastSearchConfig = null;
let refreshTimerId = null;
let refreshInProgress = false;
let refreshCycleCount = 0;
let searchHistory = JSON.parse(localStorage.getItem('aerogatherer_history') || '[]');
let savedMonitors = JSON.parse(localStorage.getItem('aerogatherer_monitors') || '[]');
let batchQueue = [];
let currentAliases = [];
let sourceDiagnostics = {};
const API_BASE = window.location.protocol === 'file:' ? 'http://127.0.0.1:3000' : '';

const SOURCE_GROUPS = {
  normal: {
    title: 'Sources normales',
    icon: 'image',
    sources: ['duckduckgo', 'bing', 'google', 'brave', 'flickr', 'wikimedia', 'youtube', 'wayback', 'vimeo', 'dailymotion']
  },
  social: {
    title: 'Réseaux sociaux',
    icon: 'share-2',
    sources: ['reddit', 'telegram', 'instagram', 'facebook', 'tiktok', 'x', 'pinterest']
  },
  nsfw: {
    title: 'Sources NSFW',
    icon: 'badge-alert',
    sources: [
      'freeones', 'freeonesforum', 'babesource', 'erome', 'redgifs', 'imagebam', 'imagefap', 'pornpics',
      'babepedia', 'camwhores', 'pornzog', 'onlyfans', 'fansly', 'mym', 'xhamster', 'xvideos', 'spankbang'
    ]
  }
};

const SOURCE_TO_GROUP = Object.entries(SOURCE_GROUPS).reduce((map, [group, config]) => {
  config.sources.forEach(source => { map[source] = group; });
  return map;
}, {});

function getSourceGroup(source) {
  return SOURCE_TO_GROUP[String(source || '').toLowerCase()] || 'normal';
}

// ----------------------------------------------------
// DOM ELEMENTS
// ----------------------------------------------------
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const statusConsoleWrapper = document.getElementById('status-console-wrapper');
const statusConsole = document.getElementById('status-console');
const btnClearConsole = document.getElementById('btn-clear-console');

const statsBar = document.getElementById('stats-bar');
const countImages = document.getElementById('count-images');
const countVideos = document.getElementById('count-videos');
const filterInput = document.getElementById('filter-input');
const safeSearchToggle = document.getElementById('safe-search-toggle');
const safetyRiskMode = document.getElementById('safety-risk-mode');
const searchMatchMode = document.getElementById('search-match-mode');
const accountScrapeMode = document.getElementById('account-scrape-mode');
const mediaKindMode = document.getElementById('media-kind-mode');

const btnToggleFav = document.getElementById('btn-toggle-fav');
const btnDownloadZip = document.getElementById('btn-download-zip');
const btnExportJson = document.getElementById('btn-export-json');
const autoRefreshInterval = document.getElementById('auto-refresh-interval');
const btnAutoRefresh = document.getElementById('btn-auto-refresh');
const statsDashboard = document.getElementById('stats-dashboard');
const statsBreakdownBars = document.getElementById('stats-breakdown-bars');
const accountsDashboard = document.getElementById('accounts-dashboard');
const accountsList = document.getElementById('accounts-list');
const insightsDashboard = document.getElementById('insights-dashboard');
const confidenceSummary = document.getElementById('confidence-summary');
const aliasList = document.getElementById('alias-list');
const sourceDiagnosticList = document.getElementById('source-diagnostic-list');
const batchInput = document.getElementById('batch-input');
const batchList = document.getElementById('batch-list');
const batchCount = document.getElementById('batch-count');
const btnBatchLoad = document.getElementById('btn-batch-load');
const btnBatchRun = document.getElementById('btn-batch-run');
const btnBatchClear = document.getElementById('btn-batch-clear');
const historyList = document.getElementById('history-list');
const historyCount = document.getElementById('history-count');
const btnHistoryClear = document.getElementById('btn-history-clear');
const monitorList = document.getElementById('monitor-list');
const monitorCount = document.getElementById('monitor-count');
const btnMonitorSave = document.getElementById('btn-monitor-save');
const btnMonitorRun = document.getElementById('btn-monitor-run');
const btnMonitorClear = document.getElementById('btn-monitor-clear');
const appTabs = document.querySelectorAll('.app-tab');
const connectionsSection = document.getElementById('connections-section');
const connectionsGrid = document.getElementById('connections-grid');
const reverseSection = document.getElementById('reverse-section');
const reverseImageUrl = document.getElementById('reverse-image-url');
const btnReverseGoogle = document.getElementById('btn-reverse-google');
const btnReverseBing = document.getElementById('btn-reverse-bing');
const btnReverseYandex = document.getElementById('btn-reverse-yandex');
const btnReverseTinEye = document.getElementById('btn-reverse-tineye');
const personSection = document.getElementById('person-section');
const personForm = document.getElementById('person-form');
const personName = document.getElementById('person-name');
const personType = document.getElementById('person-type');
const personAliases = document.getElementById('person-aliases');
const personUsernames = document.getElementById('person-usernames');
const personAccounts = document.getElementById('person-accounts');
const personPositive = document.getElementById('person-positive');
const personExclude = document.getElementById('person-exclude');
const personNotes = document.getElementById('person-notes');
const personPublicOnly = document.getElementById('person-public-only');
const personSafeMode = document.getElementById('person-safe-mode');
const personList = document.getElementById('person-list');
const personDetail = document.getElementById('person-detail');
const personDepth = document.getElementById('person-depth');
const personMaxQueries = document.getElementById('person-max-queries');
const personMinScore = document.getElementById('person-min-score');
const btnPersonRefresh = document.getElementById('btn-person-refresh');
const btnPersonPlan = document.getElementById('btn-person-plan');
const btnPersonSearch = document.getElementById('btn-person-search');
const personQueryPlan = document.getElementById('person-query-plan');
const personMediaList = document.getElementById('person-media-list');
const personTimelineList = document.getElementById('person-timeline-list');
const personRuleForm = document.getElementById('person-rule-form');
const personRuleValue = document.getElementById('person-rule-value');
const personRuleAction = document.getElementById('person-rule-action');
const personRuleList = document.getElementById('person-rule-list');

let personProfiles = [];
let selectedPersonId = null;

const imagesGrid = document.getElementById('images-grid');
const videosGrid = document.getElementById('videos-grid');
const badgeImagesCount = document.getElementById('badge-images-count');
const badgeVideosCount = document.getElementById('badge-videos-count');

// Lightbox Modal
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxTitle = document.getElementById('lightbox-title');
const lightboxSource = document.getElementById('lightbox-source');
const lightboxResolutionWrapper = document.getElementById('lightbox-resolution-wrapper');
const lightboxResolution = document.getElementById('lightbox-resolution');
const lightboxBtnDownload = document.getElementById('lightbox-btn-download');
const lightboxBtnCopy = document.getElementById('lightbox-btn-copy');
const lightboxBtnSource = document.getElementById('lightbox-btn-source');
const lightboxBtnReverse = document.getElementById('lightbox-btn-reverse');
const lightboxClose = document.getElementById('lightbox-close');

// Video Modal
const videoModal = document.getElementById('video-modal');
const videoModalClose = document.getElementById('video-modal-close');
const videoPlayerContainer = document.getElementById('video-player-container');
const videoTitle = document.getElementById('video-title');
const videoSource = document.getElementById('video-source');
const videoDuration = document.getElementById('video-duration');
const videoBtnLink = document.getElementById('video-btn-link');

// ----------------------------------------------------
// CONSOLE LOGGING HELPER
// ----------------------------------------------------
function addConsoleLog(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  
  const logLine = document.createElement('div');
  logLine.className = `console-line ${type}`;
  
  const timeSpan = document.createElement('span');
  timeSpan.className = 'console-line timestamp';
  timeSpan.textContent = `[${timestamp}]`;
  
  const textSpan = document.createElement('span');
  textSpan.textContent = message;
  
  logLine.appendChild(timeSpan);
  logLine.appendChild(textSpan);
  
  statusConsole.appendChild(logLine);
  statusConsole.scrollTop = statusConsole.scrollHeight;
}

btnClearConsole.addEventListener('click', () => {
  statusConsole.innerHTML = '';
  addConsoleLog('Journal d\'aspiration réinitialisé.', 'info');
});

// ----------------------------------------------------
// APP TABS & API CONNECTIONS
// ----------------------------------------------------
function setActiveTab(tabName) {
  appTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });

  document.querySelectorAll('.workspace-section').forEach(section => {
    section.classList.toggle('tab-hidden', tabName !== 'search');
  });
  if (connectionsSection) {
    connectionsSection.classList.toggle('hidden', tabName !== 'connections');
  }
  if (reverseSection) {
    reverseSection.classList.toggle('hidden', tabName !== 'reverse');
  }
  if (personSection) {
    personSection.classList.toggle('hidden', tabName !== 'persons');
  }
}

appTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    setActiveTab(tab.dataset.tab);
    if (tab.dataset.tab === 'connections') loadConnections();
    if (tab.dataset.tab === 'persons') loadPersons();
  });
});

async function loadConnections() {
  if (!connectionsGrid) return;
  connectionsGrid.innerHTML = '<div class="connection-loading">Chargement des connexions...</div>';
  try {
    const response = await fetch(`${API_BASE}/api/connections/providers`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    renderConnections(data.providers || []);
  } catch (error) {
    connectionsGrid.innerHTML = `<div class="connection-error">Impossible de charger les connexions : ${escapeHtml(error.message)}</div>`;
  }
}

function renderConnections(providers) {
  if (!connectionsGrid) return;
  connectionsGrid.innerHTML = '';
  providers.forEach(provider => {
    const card = document.createElement('form');
    card.className = `connection-card ${provider.configured ? 'configured' : ''}`;
    card.dataset.provider = provider.id;
    const fieldsHtml = (provider.fields || []).map(field => `
      <label class="connection-field">
        <span>${escapeHtml(field.label)}</span>
        <input type="${field.type || 'text'}" name="${escapeHtml(field.name)}" placeholder="${provider.configured ? 'Deja configure' : ''}" autocomplete="off">
      </label>
    `).join('');

    card.innerHTML = `
      <div class="connection-card-header">
        <div>
          <h4>${escapeHtml(provider.label)}</h4>
          <p>${escapeHtml(provider.unlocks || '')}</p>
        </div>
        <span class="connection-state ${provider.configured ? 'ok' : 'idle'}">${provider.configured ? 'Configure' : 'Non configure'}</span>
      </div>
      <div class="connection-fields">${fieldsHtml}</div>
      <div class="connection-actions">
        <button type="submit" class="btn btn-primary btn-small"><i data-lucide="save"></i><span>Enregistrer</span></button>
        <button type="button" class="btn btn-secondary btn-small" data-action="test"><i data-lucide="plug-zap"></i><span>Tester</span></button>
        <button type="button" class="btn btn-secondary btn-small" data-action="clear"><i data-lucide="x"></i><span>Effacer</span></button>
      </div>
      <div class="connection-message"></div>
    `;

    card.addEventListener('submit', (event) => {
      event.preventDefault();
      saveConnection(provider.id, card);
    });
    card.querySelector('[data-action="test"]').addEventListener('click', () => testConnection(provider.id, card));
    card.querySelector('[data-action="clear"]').addEventListener('click', () => clearConnection(provider.id, card));
    connectionsGrid.appendChild(card);
  });
  lucide.createIcons();
}

function readConnectionForm(card) {
  const credentials = {};
  card.querySelectorAll('input[name]').forEach(input => {
    if (input.value.trim()) credentials[input.name] = input.value.trim();
  });
  return credentials;
}

function setConnectionMessage(card, message, type = 'info') {
  const messageEl = card.querySelector('.connection-message');
  if (!messageEl) return;
  messageEl.className = `connection-message ${type}`;
  messageEl.textContent = message;
}

async function saveConnection(provider, card) {
  try {
    const response = await fetch(`${API_BASE}/api/connections/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, credentials: readConnectionForm(card) })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    setConnectionMessage(card, data.configured ? 'Identifiants enregistres pour cette session serveur.' : 'Aucun identifiant saisi.', data.configured ? 'success' : 'warning');
    await loadConnections();
  } catch (error) {
    setConnectionMessage(card, error.message, 'error');
  }
}

async function testConnection(provider, card) {
  try {
    const response = await fetch(`${API_BASE}/api/connections/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
    setConnectionMessage(card, data.message || 'Connexion valide.', 'success');
  } catch (error) {
    setConnectionMessage(card, error.message, 'error');
  }
}

async function clearConnection(provider, card) {
  try {
    const response = await fetch(`${API_BASE}/api/connections/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    setConnectionMessage(card, 'Identifiants effaces pour cette session serveur.', 'info');
    await loadConnections();
  } catch (error) {
    setConnectionMessage(card, error.message, 'error');
  }
}

function getReverseUrl(engine, imageUrl) {
  const encoded = encodeURIComponent(imageUrl);
  if (engine === 'google') return `https://lens.google.com/uploadbyurl?url=${encoded}`;
  if (engine === 'bing') return `https://www.bing.com/images/search?view=detailv2&iss=sbi&form=SBIHMP&sbisrc=UrlPaste&q=imgurl:${encoded}`;
  if (engine === 'yandex') return `https://yandex.com/images/search?rpt=imageview&url=${encoded}`;
  if (engine === 'tineye') return `https://tineye.com/search?url=${encoded}`;
  return imageUrl;
}

function openReverseSearch(engine) {
  const imageUrl = reverseImageUrl?.value?.trim();
  if (!imageUrl) {
    alert('Ajoutez une URL image pour la recherche inversée.');
    return;
  }
  window.open(getReverseUrl(engine, imageUrl), '_blank', 'noopener,noreferrer');
}

function prepareReverseSearch(imageUrl) {
  if (reverseImageUrl) reverseImageUrl.value = imageUrl || '';
  closeLightbox();
  setActiveTab('reverse');
}

if (btnReverseGoogle) btnReverseGoogle.addEventListener('click', () => openReverseSearch('google'));
if (btnReverseBing) btnReverseBing.addEventListener('click', () => openReverseSearch('bing'));
if (btnReverseYandex) btnReverseYandex.addEventListener('click', () => openReverseSearch('yandex'));
if (btnReverseTinEye) btnReverseTinEye.addEventListener('click', () => openReverseSearch('tineye'));

// ----------------------------------------------------
// PERSON FINDER
// ----------------------------------------------------
function splitPersonLines(value) {
  return [...new Set(String(value || '').split(/\r?\n|,|;/).map(item => item.trim()).filter(Boolean))];
}

function readPersonForm() {
  return {
    name: personName?.value.trim() || '',
    displayName: personName?.value.trim() || '',
    type: personType?.value || 'creator',
    aliases: splitPersonLines(personAliases?.value),
    usernames: splitPersonLines(personUsernames?.value),
    accounts: splitPersonLines(personAccounts?.value).map(url => ({ url })),
    positiveKeywords: splitPersonLines(personPositive?.value),
    excludeKeywords: splitPersonLines(personExclude?.value),
    notes: personNotes?.value || '',
    publicOnly: personPublicOnly ? personPublicOnly.checked : true,
    safeMode: personSafeMode ? personSafeMode.checked : true
  };
}

function renderPersonList() {
  if (!personList) return;
  if (!personProfiles.length) {
    personList.innerHTML = '<div class="person-empty">Aucun profil Person Finder.</div>';
    return;
  }
  personList.innerHTML = personProfiles.map(person => `
    <button class="person-card ${person.id === selectedPersonId ? 'active' : ''}" data-person-id="${escapeHtml(person.id)}" type="button">
      <strong>${escapeHtml(person.displayName || person.name)}</strong>
      <span>${escapeHtml(person.type || 'profil public')} · ${(person.aliases || []).length} alias · ${(person.accounts || []).length} comptes</span>
    </button>
  `).join('');
  personList.querySelectorAll('[data-person-id]').forEach(button => {
    button.addEventListener('click', () => selectPerson(button.dataset.personId));
  });
}

async function loadPersons() {
  if (!personList) return;
  personList.innerHTML = '<div class="person-empty">Chargement...</div>';
  try {
    const response = await fetch(`${API_BASE}/api/persons`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    personProfiles = data.persons || [];
    if (!selectedPersonId && personProfiles[0]) selectedPersonId = personProfiles[0].id;
    renderPersonList();
    if (selectedPersonId) await selectPerson(selectedPersonId, false);
  } catch (error) {
    personList.innerHTML = `<div class="person-empty">Erreur Person Finder : ${escapeHtml(error.message)}</div>`;
  }
}

function renderPersonDetail(person) {
  if (!personDetail) return;
  personDetail.classList.remove('empty');
  personDetail.innerHTML = `
    <div class="person-detail-head">
      <div>
        <h4>${escapeHtml(person.displayName || person.name)}</h4>
        <p>${escapeHtml(person.type || '')}</p>
      </div>
      <span class="person-safe-badge">${person.publicOnly !== false && person.safeMode !== false ? 'Public only' : 'Bloque'}</span>
    </div>
    <div class="person-chip-row">
      ${(person.aliases || []).map(alias => `<span>${escapeHtml(alias)}</span>`).join('')}
      ${(person.usernames || []).map(alias => `<span>${escapeHtml(alias)}</span>`).join('')}
    </div>
    <p class="person-note">${escapeHtml(person.notes || 'Pas de note.')}</p>
  `;
}

function renderPersonPlan(queries) {
  if (!personQueryPlan) return;
  personQueryPlan.innerHTML = (queries || []).map(query => `<span class="person-query-chip">${escapeHtml(query)}</span>`).join('') || '<span class="person-empty">Aucune requete generee.</span>';
}

function renderPersonMedia(links) {
  if (!personMediaList) return;
  if (!links.length) {
    personMediaList.innerHTML = '<div class="person-empty">Aucun media lie pour ce profil.</div>';
    return;
  }
  personMediaList.innerHTML = links.map(link => {
    const media = link.media || {};
    const preview = media.thumbnail || media.url || '';
    return `
      <article class="person-media-row">
        ${preview ? `<img src="${escapeHtml(preview)}" loading="lazy" referrerpolicy="no-referrer" alt="">` : '<div class="person-media-placeholder"></div>'}
        <div class="person-media-main">
          <strong>${escapeHtml(media.title || 'Media sans titre')}</strong>
          <span>${escapeHtml(media.source || '')} · score ${Number(link.personScore || media.confidenceScore || 0)} · ${escapeHtml(link.status || 'to_review')}</span>
          <small>${escapeHtml((link.evidence || media.matchReasons || []).slice(0, 3).join(' · '))}</small>
        </div>
        <div class="person-media-actions">
          <button data-person-validate="${escapeHtml(link.id)}" data-status="confirmed" class="btn btn-secondary btn-small" type="button">OK</button>
          <button data-person-validate="${escapeHtml(link.id)}" data-status="probable" class="btn btn-secondary btn-small" type="button">Probable</button>
          <button data-person-validate="${escapeHtml(link.id)}" data-status="false_positive" class="btn btn-secondary btn-small" type="button">Faux</button>
        </div>
      </article>
    `;
  }).join('');
  personMediaList.querySelectorAll('[data-person-validate]').forEach(button => {
    button.addEventListener('click', () => validatePersonMedia(button.dataset.personValidate, button.dataset.status));
  });
}

function renderPersonTimeline(events) {
  if (!personTimelineList) return;
  personTimelineList.innerHTML = (events || []).map(event => `
    <div class="person-timeline-item">
      <span>${escapeHtml(new Date(event.date || Date.now()).toLocaleDateString())}</span>
      <strong>${escapeHtml(event.title || event.type)}</strong>
      <small>${escapeHtml(event.status || event.type || '')}</small>
    </div>
  `).join('') || '<div class="person-empty">Timeline vide.</div>';
}

function renderPersonRules(rules) {
  if (!personRuleList) return;
  personRuleList.innerHTML = (rules || []).map(rule => `
    <div class="person-rule-row">
      <span>${escapeHtml(rule.value)} · ${escapeHtml(rule.action)}</span>
      <button data-rule-delete="${escapeHtml(rule.id)}" class="btn btn-secondary btn-small" type="button"><i data-lucide="trash-2"></i></button>
    </div>
  `).join('') || '<div class="person-empty">Aucune regle.</div>';
  personRuleList.querySelectorAll('[data-rule-delete]').forEach(button => {
    button.addEventListener('click', () => deletePersonRule(button.dataset.ruleDelete));
  });
  lucide.createIcons();
}

async function selectPerson(id, rerenderList = true) {
  selectedPersonId = id;
  if (rerenderList) renderPersonList();
  const [personRes, planRes, galleryRes, timelineRes, rulesRes] = await Promise.all([
    fetch(`${API_BASE}/api/persons/${encodeURIComponent(id)}`),
    fetch(`${API_BASE}/api/persons/${encodeURIComponent(id)}/queries?depth=${encodeURIComponent(personDepth?.value || 'normal')}`),
    fetch(`${API_BASE}/api/persons/${encodeURIComponent(id)}/gallery`),
    fetch(`${API_BASE}/api/persons/${encodeURIComponent(id)}/timeline`),
    fetch(`${API_BASE}/api/persons/${encodeURIComponent(id)}/validation/rules`)
  ]);
  if (personRes.ok) renderPersonDetail(await personRes.json());
  if (planRes.ok) renderPersonPlan((await planRes.json()).queries || []);
  if (galleryRes.ok) renderPersonMedia((await galleryRes.json()).links || []);
  if (timelineRes.ok) renderPersonTimeline((await timelineRes.json()).events || []);
  if (rulesRes.ok) renderPersonRules((await rulesRes.json()).rules || []);
}

async function savePersonProfile(event) {
  event.preventDefault();
  const payload = readPersonForm();
  if (!payload.name) return;
  const response = await fetch(`${API_BASE}/api/persons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    alert('Impossible de creer le profil Person Finder.');
    return;
  }
  const person = await response.json();
  selectedPersonId = person.id;
  personForm.reset();
  if (personPublicOnly) personPublicOnly.checked = true;
  if (personSafeMode) personSafeMode.checked = true;
  await loadPersons();
}

async function previewPersonPlan() {
  if (!selectedPersonId) return;
  const response = await fetch(`${API_BASE}/api/persons/${encodeURIComponent(selectedPersonId)}/search-plan?depth=${encodeURIComponent(personDepth?.value || 'normal')}`);
  if (response.ok) renderPersonPlan((await response.json()).queries || []);
}

async function runPersonSearch() {
  if (!selectedPersonId) return;
  if (personMediaList) personMediaList.innerHTML = '<div class="person-empty">Recherche Person Finder en cours...</div>';
  const response = await fetch(`${API_BASE}/api/persons/${encodeURIComponent(selectedPersonId)}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      depth: personDepth?.value || 'normal',
      maxQueries: Number(personMaxQueries?.value || 10),
      minScore: Number(personMinScore?.value || 35),
      sources: 'duckduckgo,bing,wikimedia,reddit'
    })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    alert(data.error || 'Recherche Person Finder impossible.');
    return;
  }
  await selectPerson(selectedPersonId);
}

async function validatePersonMedia(linkId, status) {
  if (!selectedPersonId) return;
  await fetch(`${API_BASE}/api/persons/${encodeURIComponent(selectedPersonId)}/media/${encodeURIComponent(linkId)}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
  await selectPerson(selectedPersonId);
}

async function savePersonRule(event) {
  event.preventDefault();
  if (!selectedPersonId || !personRuleValue?.value.trim()) return;
  await fetch(`${API_BASE}/api/persons/${encodeURIComponent(selectedPersonId)}/validation/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: personRuleValue.value.trim(), action: personRuleAction?.value || 'exclude' })
  });
  personRuleValue.value = '';
  await selectPerson(selectedPersonId);
}

async function deletePersonRule(ruleId) {
  if (!selectedPersonId) return;
  await fetch(`${API_BASE}/api/persons/${encodeURIComponent(selectedPersonId)}/validation/rules/${encodeURIComponent(ruleId)}`, { method: 'DELETE' });
  await selectPerson(selectedPersonId);
}

if (personForm) personForm.addEventListener('submit', savePersonProfile);
if (btnPersonRefresh) btnPersonRefresh.addEventListener('click', loadPersons);
if (btnPersonPlan) btnPersonPlan.addEventListener('click', previewPersonPlan);
if (btnPersonSearch) btnPersonSearch.addEventListener('click', runPersonSearch);
if (personDepth) personDepth.addEventListener('change', previewPersonPlan);
if (personRuleForm) personRuleForm.addEventListener('submit', savePersonRule);

function getCurrentSearchConfig() {
  const checkedSources = [];
  document.querySelectorAll('.sources-list input[type="checkbox"]').forEach(cb => {
    if (cb.checked) checkedSources.push(cb.value);
  });

  return {
    query: searchInput.value.trim(),
    checkedSources,
    safeSearch: safeSearchToggle ? safeSearchToggle.checked : true,
    riskMode: safetyRiskMode ? safetyRiskMode.value : 'cautious',
    matchMode: searchMatchMode ? searchMatchMode.value : 'strict',
    exactMode: searchMatchMode ? searchMatchMode.value === 'strict' : true,
    accountMode: accountScrapeMode ? accountScrapeMode.value : 'complete',
    mediaKind: mediaKindMode ? mediaKindMode.value : 'both',
    sizeVal: document.getElementById('filter-size').value,
    typeVal: document.getElementById('filter-type').value,
    colorVal: document.getElementById('filter-color').value
  };
}

function buildSearchUrl(config, sources) {
  const freshParams = config.fresh ? `&fresh=true&since=${encodeURIComponent(config.since || '')}` : '';
  return `${API_BASE}/api/search?q=${encodeURIComponent(config.query)}&sources=${encodeURIComponent(sources)}&safe=${config.safeSearch}&risk=${encodeURIComponent(config.riskMode)}&exact=${config.exactMode ? 'true' : 'false'}&mode=${encodeURIComponent(config.matchMode || (config.exactMode ? 'strict' : 'broad'))}&accountMode=${encodeURIComponent(config.accountMode || 'complete')}&media=${encodeURIComponent(config.mediaKind || 'both')}${freshParams}&size=${config.sizeVal}&type=${config.typeVal}&color=${config.colorVal}`;
}

function updateAutoRefreshButton(active) {
  if (!btnAutoRefresh) return;
  btnAutoRefresh.classList.toggle('active', active);
  btnAutoRefresh.innerHTML = active
    ? '<i data-lucide="pause"></i><span>Pause refresh</span>'
    : '<i data-lucide="refresh-cw"></i><span>Activer</span>';
  lucide.createIcons();
}

function stopAutoRefresh() {
  if (refreshTimerId) {
    clearInterval(refreshTimerId);
    refreshTimerId = null;
  }
  updateAutoRefreshButton(false);
}

function startAutoRefresh(options = {}) {
  if (!lastSearchConfig || !lastSearchConfig.query) {
    alert('Lancez une recherche avant dactiver le refresh.');
    return;
  }

  const intervalSeconds = Number(autoRefreshInterval?.value || 0);
  if (!intervalSeconds) {
    stopAutoRefresh();
    return;
  }

  if (!options.keepRefresh) stopAutoRefresh();
  refreshCycleCount = 0;
  refreshTimerId = setInterval(() => runRefreshSearch(), intervalSeconds * 1000);
  updateAutoRefreshButton(true);
  addConsoleLog(`[REFRESH] Surveillance active toutes les ${intervalSeconds}s.`, 'info');
}

async function runRefreshSearch() {
  if (!lastSearchConfig || refreshInProgress) return;
  refreshInProgress = true;
  refreshCycleCount += 1;

  const beforeImages = allImages.length;
  const beforeVideos = allVideos.length;
  const refreshStartedAt = new Date().toISOString();
  const config = { ...lastSearchConfig, fresh: true, since: lastSearchConfig.lastRefreshAt || lastSearchConfig.startedAt || '' };
  const queryWayback = config.checkedSources.includes('wayback');
  const serverSources = config.checkedSources.filter(src => src !== 'wayback');

  try {
    addConsoleLog(`[REFRESH] Cycle ${refreshCycleCount} sur "${config.query}"...`, 'info');
    for (const source of serverSources) {
      try {
        const response = await fetch(buildSearchUrl(config, source));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        mergeSearchData(data);
        if (data.status?.[source]) logSourceStatus(source, data.status[source]);
      } catch (error) {
        addConsoleLog(`[REFRESH:${source.toUpperCase()}] ${error.message}`, 'warning');
      }
    }

    if (queryWayback && refreshCycleCount % 3 === 0) {
      addConsoleLog('[REFRESH:WAYBACK] Scan Wayback espacé pour limiter les appels.', 'info');
      const hostResponse = await fetch(`${API_BASE}/api/wayback/hosts?q=${encodeURIComponent(config.query)}&risk=${encodeURIComponent(config.riskMode)}`);
      const hostData = hostResponse.ok ? await hostResponse.json() : { domains: [] };
      const extractedDomains = extractTargetDomains((hostData.domains || []).map(domain => ({ url: `https://${domain}/` })), config.query);
      const waybackData = await fetchWaybackMachineCDX(config.query, extractedDomains, (partialData) => mergeSearchData(partialData));
      mergeSearchData(waybackData);
    }

    const addedImages = allImages.length - beforeImages;
    const addedVideos = allVideos.length - beforeVideos;
    addConsoleLog(`[REFRESH] Fin du cycle : +${Math.max(addedImages, 0)} photos, +${Math.max(addedVideos, 0)} vidéos.`, addedImages || addedVideos ? 'success' : 'info');
  } catch (error) {
    addConsoleLog(`[REFRESH] Erreur : ${error.message}`, 'error');
  } finally {
    lastSearchConfig.lastRefreshAt = refreshStartedAt;
    refreshInProgress = false;
  }
}

// ----------------------------------------------------
// UTILITY EMPTY STATE / LOADING RENDERERS
// ----------------------------------------------------
function renderLoading() {
  const imgLoadingHTML = `
    <div class="loader-spinner">
      <div class="spinner"></div>
      <p>Aspiration des photos en cours...</p>
    </div>
  `;
  const vidLoadingHTML = `
    <div class="loader-spinner">
      <div class="spinner"></div>
      <p>Aspiration des vidéos en cours...</p>
    </div>
  `;
  
  imagesGrid.innerHTML = imgLoadingHTML;
  videosGrid.innerHTML = vidLoadingHTML;
}

function renderEmptyState(gridEl, type = 'media') {
  const icon = type === 'video' ? 'video-off' : 'image-down';
  const title = "Aucun résultat";
  const desc = "Ajustez vos filtres ou lancez une autre aspiration.";
  
  gridEl.innerHTML = `
    <div class="empty-state animate-fadeIn">
      <i data-lucide="${icon}" class="empty-icon"></i>
      <h3>${title}</h3>
      <p>${desc}</p>
    </div>
  `;
  lucide.createIcons();
}

function dedupeMedia(items) {
  const seen = new Set();
  return (items || []).filter(item => {
    const key = item && (item.visualSignature || item.url || item.thumbnail || item.link);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeForScore(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function scoreMediaItem(item) {
  const needle = normalizeForScore(currentSearchQuery);
  const account = item.accountUrl || '';
  const haystack = normalizeForScore([item.title, item.url, item.thumbnail, item.link, account].filter(Boolean).join(' '));
  if (item.confidenceScore) return item.confidenceScore;
  if (!needle) return item.relevanceScore || 0;
  if (normalizeForScore(account).includes(needle)) return 100;
  if (haystack.includes(needle)) return 80;
  if (account) return 60;
  if ((item.source || '').toLowerCase() === 'wayback') return 50;
  return 20;
}

function prepareMediaItems(items) {
  return (items || []).map(item => ({
    ...item,
    relevanceScore: item.relevanceScore || scoreMediaItem(item),
    confidenceScore: item.confidenceScore || scoreMediaItem(item),
    confidenceLabel: item.confidenceLabel || (scoreMediaItem(item) >= 90 ? 'haute' : (scoreMediaItem(item) >= 70 ? 'moyenne' : 'faible')),
    matchReasons: item.matchReasons || ['analyse locale']
  }));
}

function confidenceClass(item) {
  const score = Number(item?.confidenceScore || item?.relevanceScore || 0);
  if (score >= 90) return 'high';
  if (score >= 70) return 'medium';
  return 'low';
}

function confidenceText(item) {
  const score = Number(item?.confidenceScore || item?.relevanceScore || 0);
  return `${score || '?'} · ${item?.confidenceLabel || confidenceClass(item)}`;
}

function updateSourceDiagnostics(data) {
  Object.entries(data.status || {}).forEach(([source, status]) => {
    sourceDiagnostics[source] = {
      success: Boolean(status.success),
      note: status.note || status.error || '',
      imagesCount: status.imagesCount || 0,
      videosCount: status.videosCount || 0,
      updatedAt: new Date().toISOString()
    };
  });
}

function updateAliases(data) {
  const map = new Map(currentAliases.map(alias => [normalizeForScore(alias.value), alias]));
  (data.aliases || []).forEach(alias => {
    const key = normalizeForScore(alias.value);
    if (!key) return;
    const existing = map.get(key) || { value: alias.value, count: 0, sources: [] };
    existing.count += alias.count || 1;
    existing.sources = [...new Set([...(existing.sources || []), ...(alias.sources || [])])].slice(0, 6);
    map.set(key, existing);
  });
  currentAliases = [...map.values()].sort((a, b) => b.count - a.count).slice(0, 24);
}

function renderInsights() {
  if (!insightsDashboard) return;
  const media = [...allImages, ...allVideos];
  const total = media.length;
  if (!total && currentAliases.length === 0 && Object.keys(sourceDiagnostics).length === 0) {
    insightsDashboard.classList.add('hidden');
    return;
  }

  const buckets = {
    haute: media.filter(item => confidenceClass(item) === 'high').length,
    moyenne: media.filter(item => confidenceClass(item) === 'medium').length,
    faible: media.filter(item => confidenceClass(item) === 'low').length
  };

  if (confidenceSummary) {
    confidenceSummary.innerHTML = Object.entries(buckets).map(([label, count]) => `
      <div class="insight-row confidence-${label}">
        <span>${label}</span>
        <strong>${count}</strong>
      </div>
    `).join('');
  }

  if (aliasList) {
    aliasList.innerHTML = currentAliases.length
      ? currentAliases.map(alias => `
        <button type="button" class="alias-chip" data-alias="${escapeHtml(alias.value)}" title="${escapeHtml((alias.sources || []).join(', '))}">
          ${escapeHtml(alias.value)}
          <span>${alias.count}</span>
        </button>
      `).join('')
      : '<div class="muted-line">Aucun alias infÃ©rÃ© pour le moment.</div>';
    aliasList.querySelectorAll('[data-alias]').forEach(btn => {
      btn.addEventListener('click', () => {
        searchInput.value = btn.dataset.alias;
        addConsoleLog(`[ALIAS] Terme chargÃ© : ${btn.dataset.alias}`, 'info');
      });
    });
  }

  if (sourceDiagnosticList) {
    const entries = Object.entries(sourceDiagnostics);
    sourceDiagnosticList.innerHTML = entries.length
      ? entries.map(([source, item]) => `
        <div class="diagnostic-row ${item.success ? 'ok' : 'fail'}">
          <strong>${escapeHtml(source)}</strong>
          <span>${item.imagesCount || 0} photos · ${item.videosCount || 0} vidÃ©os</span>
          <small>${escapeHtml(item.note || (item.success ? 'OK' : 'Indisponible'))}</small>
        </div>
      `).join('')
      : '<div class="muted-line">Aucun diagnostic encore disponible.</div>';
  }

  insightsDashboard.classList.remove('hidden');
  lucide.createIcons();
}

function saveSearchHistoryEntry() {
  if (!currentSearchQuery) return;
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    query: currentSearchQuery,
    at: new Date().toISOString(),
    images: allImages.length,
    videos: allVideos.length,
    aliases: currentAliases.slice(0, 8),
    config: lastSearchConfig
  };
  searchHistory = [entry, ...searchHistory.filter(item => item.query !== entry.query)].slice(0, 40);
  localStorage.setItem('aerogatherer_history', JSON.stringify(searchHistory));
  renderHistory();
}

function renderHistory() {
  if (!historyList) return;
  if (historyCount) historyCount.textContent = `${searchHistory.length} recherche${searchHistory.length > 1 ? 's' : ''}`;
  historyList.innerHTML = searchHistory.length
    ? searchHistory.map(item => `
      <div class="workflow-row">
        <div>
          <strong>${escapeHtml(item.query)}</strong>
          <span>${new Date(item.at).toLocaleString()} · ${item.images} photos · ${item.videos} vidÃ©os</span>
        </div>
        <button type="button" class="btn btn-secondary btn-small" data-history-run="${escapeHtml(item.id)}">
          <i data-lucide="rotate-cw"></i><span>Relancer</span>
        </button>
      </div>
    `).join('')
    : '<div class="muted-line">Aucun historique.</div>';
  historyList.querySelectorAll('[data-history-run]').forEach(btn => {
    btn.addEventListener('click', () => {
      const entry = searchHistory.find(item => item.id === btn.dataset.historyRun);
      if (!entry) return;
      restoreSearchConfig(entry.config || { query: entry.query });
      searchForm.requestSubmit();
    });
  });
  lucide.createIcons();
}

function restoreSearchConfig(config = {}) {
  if (config.query) searchInput.value = config.query;
  if (safeSearchToggle && typeof config.safeSearch === 'boolean') safeSearchToggle.checked = config.safeSearch;
  if (safetyRiskMode && config.riskMode) safetyRiskMode.value = config.riskMode;
  if (searchMatchMode) searchMatchMode.value = config.matchMode || (config.exactMode === false ? 'broad' : 'strict');
  if (accountScrapeMode && config.accountMode) accountScrapeMode.value = config.accountMode;
  if (mediaKindMode && config.mediaKind) mediaKindMode.value = config.mediaKind;
  document.querySelectorAll('.sources-list input[type="checkbox"]').forEach(cb => {
    cb.checked = (config.checkedSources || []).includes(cb.value);
  });
  initAdultSources();
}

function renderBatchQueue() {
  if (!batchList) return;
  if (batchCount) batchCount.textContent = `${batchQueue.length} terme${batchQueue.length > 1 ? 's' : ''}`;
  batchList.innerHTML = batchQueue.length
    ? batchQueue.map((item, idx) => `
      <div class="workflow-row">
        <div><strong>${escapeHtml(item.query)}</strong><span>${escapeHtml(item.status || 'en attente')}</span></div>
        <button type="button" class="btn btn-secondary btn-small" data-batch-remove="${idx}"><i data-lucide="x"></i></button>
      </div>
    `).join('')
    : '<div class="muted-line">Aucun terme en file.</div>';
  batchList.querySelectorAll('[data-batch-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      batchQueue.splice(Number(btn.dataset.batchRemove), 1);
      renderBatchQueue();
    });
  });
  lucide.createIcons();
}

async function runBatchQueue() {
  if (batchQueue.length === 0) return;
  const baseConfig = getCurrentSearchConfig();
  for (const item of batchQueue) {
    item.status = 'en cours';
    renderBatchQueue();
    searchInput.value = item.query;
    await runSearchWithCurrentControls({ fromBatch: true, baseConfig });
    item.status = `${allImages.length} photos · ${allVideos.length} vidÃ©os`;
    renderBatchQueue();
  }
}

function saveMonitor() {
  if (!lastSearchConfig?.query) {
    alert('Lancez une recherche avant de la sauvegarder en monitoring.');
    return;
  }
  const existing = savedMonitors.find(item => item.query === lastSearchConfig.query);
  const monitor = {
    id: existing?.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    query: lastSearchConfig.query,
    config: lastSearchConfig,
    lastRunAt: new Date().toISOString(),
    lastImages: allImages.length,
    lastVideos: allVideos.length
  };
  savedMonitors = [monitor, ...savedMonitors.filter(item => item.id !== monitor.id)].slice(0, 20);
  localStorage.setItem('aerogatherer_monitors', JSON.stringify(savedMonitors));
  renderMonitors();
}

function renderMonitors() {
  if (!monitorList) return;
  if (monitorCount) monitorCount.textContent = `${savedMonitors.length} veille${savedMonitors.length > 1 ? 's' : ''}`;
  monitorList.innerHTML = savedMonitors.length
    ? savedMonitors.map(item => `
      <div class="workflow-row">
        <div>
          <strong>${escapeHtml(item.query)}</strong>
          <span>${item.lastImages || 0} photos · ${item.lastVideos || 0} vidÃ©os · ${item.lastRunAt ? new Date(item.lastRunAt).toLocaleString() : 'jamais'}</span>
        </div>
        <button type="button" class="btn btn-secondary btn-small" data-monitor-run="${escapeHtml(item.id)}">
          <i data-lucide="refresh-cw"></i><span>VÃ©rifier</span>
        </button>
      </div>
    `).join('')
    : '<div class="muted-line">Aucune veille sauvegardÃ©e.</div>';
  monitorList.querySelectorAll('[data-monitor-run]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const monitor = savedMonitors.find(item => item.id === btn.dataset.monitorRun);
      if (!monitor) return;
      restoreSearchConfig(monitor.config || { query: monitor.query });
      await runSearchWithCurrentControls({ monitorId: monitor.id });
    });
  });
  lucide.createIcons();
}

function attachImageProxyFallback(imgElement, originalUrl) {
  if (!imgElement || !originalUrl) return;
  imgElement.referrerPolicy = 'no-referrer';
  imgElement.addEventListener('error', () => {
    if (imgElement.dataset.proxyRetried === '1') return;
    imgElement.dataset.proxyRetried = '1';
    imgElement.src = `${API_BASE}/api/proxy?url=${encodeURIComponent(originalUrl)}`;
  });
}

function mergeSearchData(data) {
  updateSourceDiagnostics(data);
  updateAliases(data);
  allImages = dedupeMedia([...allImages, ...prepareMediaItems(data.images || [])]).sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  allVideos = dedupeMedia([...allVideos, ...prepareMediaItems(data.videos || [])]).sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  filteredImages = [...allImages];
  filteredVideos = [...allVideos];
  statsBar.classList.remove('hidden');
  registerDetectedAccounts(data);
  renderInsights();
  renderMedia();
}

function logSourceStatus(source, status) {
  const sourceName = source.toUpperCase();
  if (status.success) {
    updateSourceStatusDot(source, 'success');
    const noteSuffix = status.note ? ` - ${status.note}` : '';
    if (source === 'reddit' || source === 'erome' || source === 'wayback' || source === 'telegram') {
      addConsoleLog(`[${sourceName}] Succès : ${status.imagesCount || 0} photos, ${status.videosCount || 0} vidéos trouvées.${noteSuffix}`, 'success');
    } else if (source === 'youtube' || source === 'dailymotion' || source === 'vimeo' || source === 'redgifs' || source === 'xhamster' || source === 'xvideos' || source === 'spankbang') {
      addConsoleLog(`[${sourceName}] Succès : ${status.videosCount || 0} vidéos trouvées.${noteSuffix}`, 'success');
    } else {
      addConsoleLog(`[${sourceName}] Succès : ${status.imagesCount || 0} photos trouvées.${noteSuffix}`, 'success');
    }
  } else {
    updateSourceStatusDot(source, 'error');
    addConsoleLog(`[${sourceName}] Échec : ${status.error || 'source indisponible'}`, 'error');
  }
}

function extractMediaAccount(item) {
  if (item.accountUrl) return item.accountUrl;
  const candidate = item.link || item.url || '';
  if (!candidate) return '';
  try {
    const parsed = new URL(candidate);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('web.archive.org')) {
      const match = parsed.pathname.match(/^\/web\/\d+(?:id_)?\/(https?:\/\/[^/]+)/i);
      return match ? match[1] : '';
    }
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch (error) {
    return '';
  }
}

function classifyDetectedTarget(url) {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch (error) {
    return { type: 'domain', canScrape: true };
  }

  const cdnHosts = ['ytimg.com', 'twimg.com', 'fbcdn.net', 'redd.it', 'redditmedia.com', 'staticflickr.com', 'duckduckgo.com', 'bing.com'];
  if (cdnHosts.some(cdn => host === cdn || host.endsWith(`.${cdn}`))) {
    return { type: 'cdn', canScrape: false };
  }

  const accountHosts = ['t.me', 'telegram.me', 'x.com', 'twitter.com', 'tumblr.com', 'erome.com', 'redgifs.com', 'flickr.com', 'reddit.com', 'babepedia.com', 'camwhores.tv', 'pornzog.com', 'onlyfans.com', 'fansly.com', 'mym.fans'];
  if (accountHosts.some(accountHost => host === accountHost || host.endsWith(`.${accountHost}`))) {
    return { type: 'account', canScrape: true };
  }

  return { type: 'domain', canScrape: true };
}

function registerDetectedAccounts(data) {
  const media = [...(data.images || []), ...(data.videos || [])];
  const explicitAccounts = data.accounts || Object.values(data.status || {}).flatMap(status => status.accounts || []);
  const candidates = [...explicitAccounts, ...media.map(extractMediaAccount)].filter(Boolean);

  candidates.forEach(url => {
    const targetMeta = classifyDetectedTarget(url);
    const existing = detectedAccounts.find(account => account.url === url);
    const count = media.filter(item => extractMediaAccount(item) === url || item.accountUrl === url).length;
    if (existing) {
      existing.count += count;
    } else {
      detectedAccounts.push({ url, count, lastScraped: false, loading: false, ...targetMeta });
    }
  });

  detectedAccounts = detectedAccounts
    .filter((account, idx, arr) => arr.findIndex(other => other.url === account.url) === idx)
    .slice(0, 30);
  renderAccountsDashboard();
}

function renderAccountsDashboard() {
  if (!accountsDashboard || !accountsList) return;
  if (detectedAccounts.length === 0) {
    accountsDashboard.classList.add('hidden');
    return;
  }

  accountsList.innerHTML = '';
  detectedAccounts.forEach(account => {
    const row = document.createElement('div');
    row.className = 'account-row';
    row.innerHTML = `
      <div class="account-main">
        <span class="account-url" title="${escapeHtml(account.url)}">${escapeHtml(account.url)}</span>
        <span class="account-count">${account.type || 'domain'} · ${account.count || 0} mÃ©dias liÃ©s</span>
      </div>
      <div class="account-actions">
        <a href="${account.url}" target="_blank" class="btn btn-secondary btn-small" title="Ouvrir">
          <i data-lucide="external-link"></i>
        </a>
        <button class="btn btn-primary btn-small" data-account-url="${escapeHtml(account.url)}" ${account.loading || account.canScrape === false ? 'disabled' : ''}>
          <i data-lucide="${account.loading ? 'loader-2' : 'download'}"></i>
          <span>${account.canScrape === false ? 'CDN ignoré' : (account.loading ? 'Aspiration...' : 'Aspirer')}</span>
        </button>
      </div>
    `;

    row.querySelector('button[data-account-url]').addEventListener('click', () => scrapeDetectedAccount(account.url));
    accountsList.appendChild(row);
  });

  accountsDashboard.classList.remove('hidden');
  lucide.createIcons();
}

async function scrapeDetectedAccount(accountUrl) {
  const account = detectedAccounts.find(item => item.url === accountUrl);
  if (account) {
    account.loading = true;
    renderAccountsDashboard();
  }

  try {
    addConsoleLog(`[COMPTE] Aspiration ciblÃ©e : ${accountUrl}`, 'info');
    const safeSearch = safeSearchToggle ? safeSearchToggle.checked : true;
    const riskMode = safetyRiskMode ? safetyRiskMode.value : 'cautious';
    const accountMode = accountScrapeMode ? accountScrapeMode.value : 'complete';
    const mediaKind = mediaKindMode ? mediaKindMode.value : 'both';
    const response = await fetch(`${API_BASE}/api/account/scrape?url=${encodeURIComponent(accountUrl)}&safe=${safeSearch}&risk=${encodeURIComponent(riskMode)}&accountMode=${encodeURIComponent(accountMode)}&media=${encodeURIComponent(mediaKind)}`);
    if (!response.ok) throw new Error(`Erreur serveur (${response.status})`);
    const data = await response.json();
    mergeSearchData(data);
    addConsoleLog(`[COMPTE] ${accountUrl} : ${(data.images || []).length} photos, ${(data.videos || []).length} vidÃ©os ajoutÃ©es.`, 'success');
  } catch (error) {
    addConsoleLog(`[COMPTE] Ã‰chec sur ${accountUrl} : ${error.message}`, 'error');
  } finally {
    if (account) {
      account.loading = false;
      account.lastScraped = true;
      renderAccountsDashboard();
    }
  }
}

// Helper: Extract target domains containing the query from returned search results
function extractTargetDomains(mediaList, query) {
  const domains = new Set();
  const blockedHosts = [
    'duckduckgo.com',
    'web.archive.org',
    'archive.org',
    'upload.wikimedia.org',
    'staticflickr.com',
    'redditmedia.com',
    'redd.it',
    'ytimg.com',
    'pinimg.com',
    'fbcdn.net',
    'twimg.com'
  ];
  
  mediaList.forEach(item => {
    [item.link, item.url].forEach(urlStr => {
      if (!urlStr) return;
      try {
        const url = new URL(urlStr);
        const host = url.hostname.toLowerCase();
        if (!host || blockedHosts.some(blocked => host.includes(blocked))) return;
        domains.add(host);
      } catch (e) {
        // Ignore URL parsing errors
      }
    });
  });
  
  return Array.from(domains).slice(0, 10);
}

// Fetch Wayback Machine CDX files directly from browser (bypasses sandbox firewall)
async function fetchWaybackMachineCDX(query, extractedDomains = [], onPartial = null) {
  let domainsToQuery = [...new Set(extractedDomains)].slice(0, 12);
  
  if (domainsToQuery.length === 0) {
    let guessedDomain = query.trim().toLowerCase();
    if (!guessedDomain.includes('.')) {
      guessedDomain = `${guessedDomain}.com`;
    }
    guessedDomain = guessedDomain.replace(/^(https?:\/\/)?(www\.)?/, '');
    domainsToQuery.push(guessedDomain);
  }

  addConsoleLog(`[WAYBACK] Domaines ciblés : ${domainsToQuery.join(', ')}`, 'info');
  const domainResults = [];
  for (let i = 0; i < domainsToQuery.length; i += 2) {
    const batch = domainsToQuery.slice(i, i + 2);
    const batchResults = await Promise.all(batch.map(domain => fetchWaybackDomainCDX(domain, query)));
    domainResults.push(...batchResults);
    if (onPartial) {
      const partialImages = dedupeMedia(batchResults.flatMap(result => result.images));
      const partialVideos = dedupeMedia(batchResults.flatMap(result => result.videos));
      if (partialImages.length || partialVideos.length) {
        onPartial({ images: partialImages, videos: partialVideos });
      }
    }
  }
  const archiveResults = await fetchWaybackArchiveSearch(query);
  const images = dedupeMedia([...domainResults.flatMap(result => result.images), ...archiveResults.images]);
  const videos = dedupeMedia([...domainResults.flatMap(result => result.videos), ...archiveResults.videos]);
  const scannedDomains = domainResults.filter(result => result.scanned).length;

  if (images.length === 0 && videos.length === 0) {
    images.push(...domainsToQuery.map(domain => ({
      url: `https://archive.org/images/glogo.png?domain=${encodeURIComponent(domain)}`,
      thumbnail: 'https://archive.org/images/glogo.png',
      title: `Explorer les snapshots Wayback de ${domain}`,
      source: 'Wayback',
      width: null,
      height: null,
      link: `https://web.archive.org/web/*/${domain}`
    })));
  }

  return { images, videos, success: scannedDomains > 0 || images.length > 0 || videos.length > 0, scannedDomains, domains: domainsToQuery };
  
  const legacyImages = [];
  const legacyVideos = [];
  let success = false;
  
  for (const domain of domainsToQuery) {
    try {
      addConsoleLog(`[WAYBACK] Aspiration CDX en cours pour *.${domain}...`, 'info');
      
      const imgUrl = `https://web.archive.org/cdx/search/cdx?url=*.${domain}/*&output=json&fl=original,timestamp,mimetype&filter=statuscode:200&filter=mimetype:image/.*&limit=100`;
      const vidUrl = `https://web.archive.org/cdx/search/cdx?url=*.${domain}/*&output=json&fl=original,timestamp,mimetype&filter=statuscode:200&filter=mimetype:video/.*&limit=50`;
      
      const [imgRes, vidRes] = await Promise.all([
        fetch(imgUrl).then(r => r.json()).catch(() => null),
        fetch(vidUrl).then(r => r.json()).catch(() => null)
      ]);
      
      // Parse Images (header row at [0])
      if (imgRes && imgRes.length > 1) {
        success = true;
        for (let i = 1; i < imgRes.length; i++) {
          const [original, timestamp, mimetype] = imgRes[i];
          const archiveUrl = `https://web.archive.org/web/${timestamp}/${original}`;
          
          let filename = original.substring(original.lastIndexOf('/') + 1);
          if (filename.includes('?')) filename = filename.substring(0, filename.indexOf('?'));
          const dateStr = new Date(timestamp.substring(0,4) + '-' + timestamp.substring(4,6) + '-' + timestamp.substring(6,8)).toLocaleDateString();
          
          images.push({
            url: archiveUrl,
            thumbnail: archiveUrl,
            title: filename ? `${filename} (${dateStr})` : `Image Wayback (${dateStr})`,
            source: 'Wayback',
            width: null,
            height: null,
            link: `https://web.archive.org/web/${timestamp}/${original}`
          });
        }
      }
      
      // Parse Videos
      if (vidRes && vidRes.length > 1) {
        success = true;
        for (let i = 1; i < vidRes.length; i++) {
          const [original, timestamp, mimetype] = vidRes[i];
          const archiveUrl = `https://web.archive.org/web/${timestamp}/${original}`;
          
          let filename = original.substring(original.lastIndexOf('/') + 1);
          if (filename.includes('?')) filename = filename.substring(0, filename.indexOf('?'));
          const dateStr = new Date(timestamp.substring(0,4) + '-' + timestamp.substring(4,6) + '-' + timestamp.substring(6,8)).toLocaleDateString();
          
          videos.push({
            title: filename ? `${filename} (${dateStr})` : `Vidéo Wayback (${dateStr})`,
            url: archiveUrl,
            embedUrl: '', // Rendered using direct HTML5 player
            thumbnail: 'https://archive.org/images/glogo.png',
            duration: 'Archive',
            source: 'Wayback'
          });
        }
      }
    } catch (err) {
      console.warn(`Wayback search failed for domain ${domain}:`, err.message);
    }
  }
  
  return { images, videos, success };
}

async function fetchWaybackJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const targetUrl = url.startsWith('/api/') ? `${API_BASE}${url}` : url;
    const response = await fetch(targetUrl, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildWaybackRows(data, domain, type) {
  if (!Array.isArray(data) || data.length <= 1) return [];
  return data.slice(1).map(row => {
    const [original, timestamp, mimetype] = row;
    if (!original || !timestamp) return null;
    const archiveUrl = `https://web.archive.org/web/${timestamp}id_/${original}`;
    let filename = original.substring(original.lastIndexOf('/') + 1);
    if (filename.includes('?')) filename = filename.substring(0, filename.indexOf('?'));
    if (!filename) filename = `${domain} snapshot`;
    const dateStr = new Date(timestamp.substring(0,4) + '-' + timestamp.substring(4,6) + '-' + timestamp.substring(6,8)).toLocaleDateString();
    const title = `${filename} (${domain}, ${dateStr})`;

    if (type === 'video') {
      return {
        title,
        url: archiveUrl,
        embedUrl: '',
        thumbnail: 'https://archive.org/images/glogo.png',
        duration: mimetype || 'Archive',
        source: 'Wayback'
      };
    }

    return {
      url: archiveUrl,
      thumbnail: archiveUrl,
      title,
      source: 'Wayback',
      width: null,
      height: null,
      link: `https://web.archive.org/web/${timestamp}/${original}`
    };
  }).filter(Boolean);
}

async function discoverWaybackHostsFrontend(query, riskMode) {
  try {
    // Try browser-direct first
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    addConsoleLog(`[WAYBACK] Recherche directe d'archives pour "${query}"...`, 'info');
    const res = await fetch(`https://web.archive.org/__wb/search/host?q=${encodeURIComponent(query)}`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      const hosts = data?.hosts || [];
      const domains = hosts.map(host => {
        const domain = String(host.display_name || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
        return (domain && domain.includes('.')) ? domain : null;
      }).filter(Boolean);
      if (domains.length > 0) {
        const uniqueDomains = [...new Set(domains)].slice(0, 10);
        addConsoleLog(`[WAYBACK] Domaines découverts (Direct) : ${uniqueDomains.join(', ')}`, 'success');
        return uniqueDomains;
      }
    }
  } catch (err) {
    console.log("Direct browser host search failed/CORS restricted, falling back to server...", err.message);
  }
  
  // Fallback to server endpoint
  try {
    addConsoleLog(`[WAYBACK] Recherche d'archives via le serveur...`, 'info');
    const res = await fetch(`${API_BASE}/api/wayback/hosts?q=${encodeURIComponent(query)}&risk=${encodeURIComponent(riskMode)}`);
    if (res.ok) {
      const data = await res.json();
      return data.domains || [];
    }
  } catch (err) {
    console.warn("Server host search failed:", err.message);
  }
  return [];
}

async function fetchWaybackDomainCDX(domain, query) {
  const result = { domain, images: [], videos: [], scanned: false };
  const riskMode = safetyRiskMode ? safetyRiskMode.value : 'cautious';
  
  // 1. Try browser-direct first (bypasses sandbox firewall)
  try {
    addConsoleLog(`[WAYBACK] Scan direct de *.${domain}...`, 'info');
    const common = `output=json&fl=original,timestamp,mimetype&filter=statuscode:200&collapse=urlkey`;
    const makeUrl = (target, mediaType, limit) => `https://web.archive.org/cdx/search/cdx?url=${target}&${common}&filter=mimetype:${mediaType}/.*&limit=${limit}`;
    const baseDomain = domain.replace(/^www\./, '');
    const domainVariants = [...new Set([domain, baseDomain, `www.${baseDomain}`])];
    const targets = domainVariants.flatMap(item => [`*.${item}/*`, `${item}/*`]);
    
    // We only query the first target to keep browser requests fast
    const target = targets[0]; 
    const imgUrl = makeUrl(target, 'image', 120);
    const vidUrl = makeUrl(target, 'video', 40);
    
    const [imgData, vidData] = await Promise.all([
      fetchWaybackJson(imgUrl, 15000),
      fetchWaybackJson(vidUrl, 15000)
    ]);
    
    const parsedImages = buildWaybackRows(imgData, domain, 'image');
    const parsedVideos = buildWaybackRows(vidData, domain, 'video');
    
    if (parsedImages.length > 0 || parsedVideos.length > 0) {
      result.images.push(...parsedImages);
      result.videos.push(...parsedVideos);
      result.scanned = true;
      addConsoleLog(`[WAYBACK] Scan direct réussi pour ${domain} : ${parsedImages.length} images, ${parsedVideos.length} vidéos.`, 'success');
      return result;
    }
  } catch (err) {
    console.log(`Direct browser CDX fetch failed for ${domain}, trying server fallback...`, err.message);
  }
  
  // 2. Fallback to server endpoint
  try {
    addConsoleLog(`[WAYBACK] Scan via serveur pour ${domain}...`, 'info');
    const data = await fetchWaybackJson(`/api/wayback/cdx?domain=${encodeURIComponent(domain)}&q=${encodeURIComponent(query)}&risk=${encodeURIComponent(riskMode)}`, 35000);
    if (data) {
      result.images.push(...(data.images || []));
      result.videos.push(...(data.videos || []));
      result.scanned = true;
      addConsoleLog(`[WAYBACK] Scan serveur réussi pour ${domain} : ${result.images.length} images, ${result.videos.length} vidéos.`, 'success');
    }
  } catch (error) {
    console.error(`Wayback CDX failed for ${domain} via both browser and server:`, error.message);
  }
  
  return result;
}

async function fetchWaybackArchiveSearch(query) {
  const result = { images: [], videos: [] };
  const riskMode = safetyRiskMode ? safetyRiskMode.value : 'cautious';
  addConsoleLog(`[WAYBACK] Recherche collections Archive.org pour "${query}"...`, 'info');
  
  // 1. Try browser-direct first
  try {
    const searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}+AND+(mediatype:image+OR+mediatype:movies)&fl[]=identifier,title,mediatype,mimetype&rows=50&output=json`;
    const data = await fetchWaybackJson(searchUrl, 10000);
    const docs = data?.response?.docs || [];
    docs.forEach(doc => {
      if (!doc.identifier) return;
      const title = doc.title || 'Média Wayback';
      const thumbnail = `https://archive.org/services/img/${doc.identifier}`;
      if (doc.mediatype === 'movies') {
        result.videos.push({
          title,
          url: `https://archive.org/details/${doc.identifier}`,
          embedUrl: `https://archive.org/embed/${doc.identifier}`,
          thumbnail,
          duration: 'Archive',
          source: 'Wayback'
        });
      } else {
        result.images.push({
          url: thumbnail,
          thumbnail,
          title,
          source: 'Wayback',
          width: null,
          height: null,
          link: `https://archive.org/details/${doc.identifier}`
        });
      }
    });
    if (result.images.length > 0 || result.videos.length > 0) {
      addConsoleLog(`[WAYBACK] Recherche collections directe réussie : ${result.images.length + result.videos.length} médias trouvés.`, 'success');
      return result;
    }
  } catch (err) {
    console.log("Direct archive.org collection search failed, trying server fallback...", err.message);
  }
  
  // 2. Fallback to server endpoint
  try {
    const data = await fetchWaybackJson(`/api/wayback/archive?q=${encodeURIComponent(query)}&risk=${encodeURIComponent(riskMode)}`, 12000);
    if (data) {
      result.images.push(...(data.images || []));
      result.videos.push(...(data.videos || []));
    }
  } catch (err) {
    console.warn("Server archive collection search failed:", err.message);
  }
  return result;
}

// ----------------------------------------------------
// SEARCH FORM SUBMISSION
// ----------------------------------------------------
async function runSearchWithCurrentControls(options = {}) {
  const query = searchInput.value.trim();
  if (!query) return;
  currentSearchQuery = query;
  
  // Read checked sources
  const checkedSources = [];
  const checkboxes = document.querySelectorAll('.sources-list input[type="checkbox"]');
  checkboxes.forEach(cb => {
    if (cb.checked) checkedSources.push(cb.value);
  });
  
  if (checkedSources.length === 0) {
    alert("Veuillez sélectionner au moins une source à interroger.");
    return;
  }
  
  const queryWayback = checkedSources.includes('wayback');
  const serverSources = checkedSources.filter(src => src !== 'wayback');
  
  // Prepare UI
  const safeSearch = safeSearchToggle ? safeSearchToggle.checked : true;
  const riskMode = safetyRiskMode ? safetyRiskMode.value : 'cautious';
  const matchMode = searchMatchMode ? searchMatchMode.value : 'strict';
  const exactMode = matchMode === 'strict';
  const accountMode = accountScrapeMode ? accountScrapeMode.value : 'complete';
  const mediaKind = mediaKindMode ? mediaKindMode.value : 'both';
  const sizeVal = document.getElementById('filter-size').value;
  const typeVal = document.getElementById('filter-type').value;
  const colorVal = document.getElementById('filter-color').value;
  stopAutoRefresh();
  lastSearchConfig = {
    query,
    checkedSources,
    safeSearch,
    riskMode,
    matchMode,
    exactMode,
    accountMode,
    mediaKind,
    startedAt: new Date().toISOString(),
    lastRefreshAt: '',
    sizeVal,
    typeVal,
    colorVal
  };
  
  statusConsoleWrapper.classList.remove('hidden');
  addConsoleLog(`Initialisation de la recherche pour : "${query}"`, 'info');
  addConsoleLog(`Sources sélectionnées : ${checkedSources.join(', ')}`, 'info');
  addConsoleLog(`Filtre adulte (SafeSearch) : ${safeSearch ? 'ACTIVÉ' : 'DÉSACTIVÉ'}`, 'info');
  addConsoleLog(`Mode anti-ban : ${riskMode === 'balanced' ? 'Equilibre' : 'Prudent'}`, 'info');
  addConsoleLog(`Pertinence : ${matchMode} ; comptes : ${accountMode === 'strict' ? 'strict terme' : 'compte complet'}`, 'info');
  addConsoleLog(`MÃ©dias : ${mediaKind === 'photos' ? 'photos seulement' : (mediaKind === 'videos' ? 'vidÃ©os seulement' : 'photos + vidÃ©os')}`, 'info');
  if (sizeVal || typeVal || colorVal) {
    addConsoleLog(`Filtres d'images actifs : taille="${sizeVal || 'toutes'}", type="${typeVal || 'tous'}", couleur="${colorVal || 'toutes'}"`, 'info');
  }
  renderLoading();
  
  // Reset and set status dots to loading
  resetAllStatusDots();
  checkedSources.forEach(src => {
    updateSourceStatusDot(src, 'loading');
  });
  
  // Reset counts
  allImages = [];
  allVideos = [];
  filteredImages = [];
  filteredVideos = [];
  detectedAccounts = [];
  currentAliases = [];
  sourceDiagnostics = {};
  if (accountsDashboard) accountsDashboard.classList.add('hidden');
  if (insightsDashboard) insightsDashboard.classList.add('hidden');
  if (accountsList) accountsList.innerHTML = '';
  badgeImagesCount.textContent = '0';
  badgeVideosCount.textContent = '0';
  statsBar.classList.add('hidden');
  filterInput.value = '';
  document.getElementById('source-filter').value = 'all';
  
  let serverData = { images: [], videos: [], status: {} };
  let waybackData = { images: [], videos: [], success: false };
  let domainSeedData = { images: [], videos: [] };
  
  try {
    const serverTasks = serverSources.map(async (source) => {
      try {
        const response = await fetch(buildSearchUrl(lastSearchConfig, source));
        if (!response.ok) {
          throw new Error(`Erreur serveur (${response.status})`);
        }
        const data = await response.json();
        serverData.images.push(...(data.images || []));
        serverData.videos.push(...(data.videos || []));
        Object.assign(serverData.status, data.status || {});
        domainSeedData = serverData;
        mergeSearchData(data);

        if (data.status?.[source]) {
          logSourceStatus(source, data.status[source]);
        } else {
          logSourceStatus(source, { success: false, error: 'aucun statut retourné' });
        }
      } catch (sourceError) {
        logSourceStatus(source, { success: false, error: sourceError.message });
      }
    });

    let waybackHostDomains = [];
    if (queryWayback) {
      waybackHostDomains = await discoverWaybackHostsFrontend(query, riskMode);
    }

    if (queryWayback && serverTasks.length > 0) {
      await Promise.race([
        Promise.allSettled(serverTasks),
        new Promise(resolve => setTimeout(resolve, 2500))
      ]);
    }

    if (queryWayback && (domainSeedData.images.length + domainSeedData.videos.length === 0)) {
      addConsoleLog('[WAYBACK] Découverte de domaines complémentaires...', 'info');
      const seedResponse = await fetch(buildSearchUrl(lastSearchConfig, 'duckduckgo,wikimedia'));
      if (seedResponse.ok) {
        domainSeedData = await seedResponse.json();
      }
    }
    
    // 2. Fetch Wayback Machine CDX in frontend
    if (queryWayback) {
      // Attempt CDX snapshots for every concrete source domain already found.
      const extractedDomains = dedupeMedia([
        ...waybackHostDomains.map(domain => ({ url: `https://${domain}/` })),
        ...(domainSeedData.images || []),
        ...(domainSeedData.videos || [])
      ]).length > 0
        ? extractTargetDomains([
            ...waybackHostDomains.map(domain => ({ url: `https://${domain}/` })),
            ...(domainSeedData.images || []),
            ...(domainSeedData.videos || [])
          ], query)
        : [];
      waybackData = await fetchWaybackMachineCDX(query, extractedDomains, (partialData) => {
        mergeSearchData(partialData);
      });
      mergeSearchData(waybackData);
    }

    await Promise.allSettled(serverTasks);
    addConsoleLog('=== BILAN DE L\'ASPIRATION ===', 'info');
    
    if (queryWayback) {
      if (waybackData.success) {
        updateSourceStatusDot('wayback', 'success');
        addConsoleLog(`[WAYBACK] Succès : ${waybackData.images.length} photos, ${waybackData.videos.length} vidéos trouvées.`, 'success');
      } else {
        updateSourceStatusDot('wayback', 'error');
        addConsoleLog(`[WAYBACK] Échec de la récupération CDX.`, 'error');
      }
    }

    if (allImages.length === 0 && allVideos.length === 0) {
      statsBar.classList.remove('hidden');
      renderMedia();
    }

    addConsoleLog(`Aspiration terminée. Total: ${allImages.length} photos, ${allVideos.length} vidéos.`, 'success');
    saveSearchHistoryEntry();
    if (options.monitorId) {
      const monitor = savedMonitors.find(item => item.id === options.monitorId);
      if (monitor) {
        monitor.lastRunAt = new Date().toISOString();
        monitor.lastImages = allImages.length;
        monitor.lastVideos = allVideos.length;
        monitor.config = lastSearchConfig;
        localStorage.setItem('aerogatherer_monitors', JSON.stringify(savedMonitors));
        renderMonitors();
      }
    }
    
  } catch (error) {
    const networkHint = error instanceof TypeError || /NetworkError|Failed to fetch|fetch resource/i.test(error.message || '')
      ? ' Impossible de joindre le serveur local. Lancez "npm start" puis ouvrez http://localhost:3000.'
      : '';
    addConsoleLog(`Erreur lors de la recherche : ${error.message}.${networkHint}`, 'error');
    checkedSources.forEach(src => {
      updateSourceStatusDot(src, 'error');
    });
    imagesGrid.innerHTML = '';
    videosGrid.innerHTML = '';
    renderEmptyState(imagesGrid, 'image');
    renderEmptyState(videosGrid, 'video');
  }
}

searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  await runSearchWithCurrentControls();
});

// ----------------------------------------------------
// RENDERING MEDIA CARDS
// ----------------------------------------------------
function renderMedia() {
  // Update stats counts
  countImages.textContent = filteredImages.length;
  countVideos.textContent = filteredVideos.length;
  badgeImagesCount.textContent = filteredImages.length;
  badgeVideosCount.textContent = filteredVideos.length;
  
  // 1. Photos Grid
  if (filteredImages.length === 0) {
    renderEmptyState(imagesGrid, 'image');
  } else {
    imagesGrid.innerHTML = '';
    filteredImages.forEach(img => {
      const isFav = favorites.some(fav => fav.url === img.url);
      const previewUrl = img.thumbnail || img.url;
      const card = document.createElement('div');
      card.className = 'media-card';
      card.innerHTML = `
        <span class="source-badge ${img.source.toLowerCase()}">${img.source}</span>
        <span class="confidence-badge confidence-${confidenceClass(img)}" title="${escapeHtml((img.matchReasons || []).join(' · '))}">${escapeHtml(confidenceText(img))}</span>
        <button class="card-fav-btn ${isFav ? 'active' : ''}" title="${isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}">
          <i data-lucide="heart"></i>
        </button>
        <div class="media-card-img-wrapper">
          <img src="${previewUrl}" alt="${escapeHtml(img.title)}" loading="lazy" referrerpolicy="no-referrer">
          <div class="card-overlay">
            <button class="overlay-btn"><i data-lucide="eye"></i></button>
          </div>
        </div>
        <div class="media-card-details">
          <span class="media-card-title" title="${escapeHtml(img.title)}">${escapeHtml(img.title)}</span>
          <span class="media-card-submeta">${escapeHtml(img.qualityLabel || img.bestQuality || 'Qualité source')} · ${escapeHtml((img.matchReasons || []).slice(0, 2).join(' · '))}</span>
        </div>
      `;
      
      // Toggle favorite click event
      const favBtn = card.querySelector('.card-fav-btn');
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(img, favBtn);
      });

      attachImageProxyFallback(card.querySelector('img'), previewUrl);
      
      // Click event opens Lightbox
      card.addEventListener('click', () => openLightbox(img));
      imagesGrid.appendChild(card);
    });
  }
  
  // 2. Videos Grid
  if (filteredVideos.length === 0) {
    renderEmptyState(videosGrid, 'video');
  } else {
    videosGrid.innerHTML = '';
    filteredVideos.forEach(vid => {
      const isFav = favorites.some(fav => fav.url === vid.url);
      const previewUrl = vid.thumbnail || 'https://www.redditstatic.com/icon.png';
      const card = document.createElement('div');
      card.className = 'media-card';
      card.innerHTML = `
        <span class="source-badge ${vid.source.toLowerCase()}">${vid.source}</span>
        <span class="confidence-badge confidence-${confidenceClass(vid)}" title="${escapeHtml((vid.matchReasons || []).join(' · '))}">${escapeHtml(confidenceText(vid))}</span>
        <span class="duration-badge"><i data-lucide="play"></i> ${vid.duration}</span>
        <button class="card-fav-btn ${isFav ? 'active' : ''}" title="${isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}">
          <i data-lucide="heart"></i>
        </button>
        <div class="media-card-img-wrapper">
          <img src="${previewUrl}" alt="${escapeHtml(vid.title)}" loading="lazy" referrerpolicy="no-referrer">
          <div class="card-overlay">
            <button class="overlay-btn"><i data-lucide="play"></i></button>
          </div>
        </div>
        <div class="media-card-details">
          <span class="media-card-title" title="${escapeHtml(vid.title)}">${escapeHtml(vid.title)}</span>
          <span class="media-card-submeta">${escapeHtml((vid.matchReasons || []).slice(0, 2).join(' · ') || 'Analyse locale')}</span>
        </div>
      `;
      
      // Toggle favorite click event
      const favBtn = card.querySelector('.card-fav-btn');
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(vid, favBtn);
      });

      attachImageProxyFallback(card.querySelector('img'), previewUrl);
      
      // Click event opens Video Modal
      card.addEventListener('click', () => openVideoModal(vid));
      videosGrid.appendChild(card);
    });
  }
  
  // Re-generate Lucide icons for injected items
  lucide.createIcons();
  
  // Update stats breakdown dashboard
  updateStatsDashboard();
}

// Helper: Escape HTML to prevent XSS
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ----------------------------------------------------
// LIVE FILTERING LOGIC
// ----------------------------------------------------
// Combined Filter Logic (Text Search + Dedicated Source Dropdown)
function applyFilters() {
  const textTerm = filterInput.value.toLowerCase().trim();
  const sourceTerm = document.getElementById('source-filter').value.toLowerCase().trim();
  
  // Filter Images
  filteredImages = allImages.filter(img => {
    const matchesText = !textTerm || 
      (img.title && img.title.toLowerCase().includes(textTerm)) || 
      (img.source && img.source.toLowerCase().includes(textTerm));
      
    const matchesSource = sourceTerm === 'all' || 
      (img.source && img.source.toLowerCase() === sourceTerm);
      
    return matchesText && matchesSource;
  });

  // Filter Videos
  filteredVideos = allVideos.filter(vid => {
    const matchesText = !textTerm || 
      (vid.title && vid.title.toLowerCase().includes(textTerm)) || 
      (vid.source && vid.source.toLowerCase().includes(textTerm));
      
    const matchesSource = sourceTerm === 'all' || 
      (vid.source && vid.source.toLowerCase() === sourceTerm);
      
    return matchesText && matchesSource;
  });
  
  renderMedia();
}

filterInput.addEventListener('input', applyFilters);
document.getElementById('source-filter').addEventListener('change', applyFilters);

// ----------------------------------------------------
// LIGHTBOX MODAL OPERATION
// ----------------------------------------------------
function openLightbox(img) {
  lightboxImg.src = img.url;
  lightboxTitle.textContent = img.title || 'Sans titre';
  lightboxSource.textContent = img.source;
  
  if (img.width && img.height) {
    lightboxResolutionWrapper.style.display = 'inline-flex';
    lightboxResolution.textContent = `${img.width} x ${img.height}`;
  } else {
    lightboxResolutionWrapper.style.display = 'none';
  }
  
  lightboxBtnDownload.href = img.url;
  
  // Setup copy to clipboard
  lightboxBtnCopy.onclick = (e) => {
    e.preventDefault();
    navigator.clipboard.writeText(img.url).then(() => {
      const originalText = lightboxBtnCopy.innerHTML;
      lightboxBtnCopy.innerHTML = '<i data-lucide="check"></i> Copié !';
      lucide.createIcons();
      setTimeout(() => {
        lightboxBtnCopy.innerHTML = originalText;
        lucide.createIcons();
      }, 1500);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
    });
  };
  
  if (img.link) {
    lightboxBtnSource.style.display = 'inline-flex';
    lightboxBtnSource.href = img.link;
  } else {
    lightboxBtnSource.style.display = 'none';
  }
  if (lightboxBtnReverse) {
    lightboxBtnReverse.onclick = () => prepareReverseSearch(img.url);
  }
  
  lightbox.classList.remove('hidden');
}

function closeLightbox() {
  lightbox.classList.add('hidden');
  lightboxImg.src = '';
}

lightboxClose.addEventListener('click', closeLightbox);

// Close Lightbox clicking background
lightbox.addEventListener('click', (e) => {
  if (e.target === lightbox) closeLightbox();
});

// ----------------------------------------------------
// VIDEO MODAL OPERATION
// ----------------------------------------------------
function openVideoModal(vid) {
  videoTitle.textContent = vid.title || 'Sans titre';
  videoSource.textContent = vid.source;
  videoDuration.textContent = vid.duration;
  videoBtnLink.href = vid.url;
  
  videoPlayerContainer.innerHTML = '';
  
  if (vid.embedUrl) {
    // Iframe embed (e.g. YouTube)
    const iframe = document.createElement('iframe');
    iframe.src = vid.embedUrl + "?autoplay=1";
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    iframe.allowFullscreen = true;
    videoPlayerContainer.appendChild(iframe);
  } else if (vid.url) {
    // HTML5 Direct Video player (e.g. Reddit mp4 fallback)
    const video = document.createElement('video');
    video.src = vid.url;
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    videoPlayerContainer.appendChild(video);
  } else {
    videoPlayerContainer.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">
        <i data-lucide="video-off" style="width:3rem;height:3rem;margin-bottom:1rem;"></i>
        <p>Impossible de lire cette vidéo directement.</p>
      </div>
    `;
    lucide.createIcons();
  }
  
  // Playlist navigation controls
  currentVideoIndex = filteredVideos.findIndex(v => v.url === vid.url);
  const btnPrev = document.getElementById('video-btn-prev');
  const btnNext = document.getElementById('video-btn-next');
  
  if (currentVideoIndex <= 0) {
    btnPrev.classList.add('disabled');
  } else {
    btnPrev.classList.remove('disabled');
  }
  
  if (currentVideoIndex === -1 || currentVideoIndex >= filteredVideos.length - 1) {
    btnNext.classList.add('disabled');
  } else {
    btnNext.classList.remove('disabled');
  }
  
  btnPrev.onclick = (e) => {
    e.stopPropagation();
    if (currentVideoIndex > 0) {
      openVideoModal(filteredVideos[currentVideoIndex - 1]);
    }
  };
  
  btnNext.onclick = (e) => {
    e.stopPropagation();
    if (currentVideoIndex < filteredVideos.length - 1) {
      openVideoModal(filteredVideos[currentVideoIndex + 1]);
    }
  };
  
  videoModal.classList.remove('hidden');
}

function closeVideoModal() {
  videoModal.classList.add('hidden');
  videoPlayerContainer.innerHTML = ''; // Stop video and audio instantly
}

videoModalClose.addEventListener('click', closeVideoModal);

// Close Video Modal clicking background
videoModal.addEventListener('click', (e) => {
  if (e.target === videoModal) closeVideoModal();
});

// ----------------------------------------------------
// KEYBOARD CONTROLS (ESCAPE KEY)
// ----------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeLightbox();
    closeVideoModal();
  }
});

// ----------------------------------------------------
// FAVORITES OPERATIONS
// ----------------------------------------------------
function toggleFavorite(item, btnEl) {
  const index = favorites.findIndex(fav => fav.url === item.url);
  if (index === -1) {
    favorites.push(item);
    btnEl.classList.add('active');
    btnEl.title = "Retirer des favoris";
    addConsoleLog(`Ajouté aux favoris : "${item.title}"`, 'success');
  } else {
    favorites.splice(index, 1);
    btnEl.classList.remove('active');
    btnEl.title = "Ajouter aux favoris";
    addConsoleLog(`Retiré des favoris : "${item.title}"`, 'info');
    
    // If currently displaying favorites, re-render immediately
    if (showingFavorites) {
      filteredImages = favorites.filter(img => !img.duration);
      filteredVideos = favorites.filter(vid => vid.duration);
      renderMedia();
    }
  }
  localStorage.setItem('aerogatherer_favorites', JSON.stringify(favorites));
  lucide.createIcons();
}

btnToggleFav.addEventListener('click', () => {
  showingFavorites = !showingFavorites;
  if (showingFavorites) {
    btnToggleFav.classList.add('active');
    btnToggleFav.innerHTML = '<i data-lucide="heart-off"></i> <span>Résultats</span>';
    
    // Load favorites split into images (no duration) and videos (has duration)
    filteredImages = favorites.filter(img => !img.duration);
    filteredVideos = favorites.filter(vid => vid.duration);
    
    statsBar.classList.remove('hidden');
    addConsoleLog('Affichage de votre collection de favoris.', 'info');
  } else {
    btnToggleFav.classList.remove('active');
    btnToggleFav.innerHTML = '<i data-lucide="heart"></i> <span>Mes Favoris</span>';
    
    // Restore search results
    const filterTerm = filterInput.value.toLowerCase().trim();
    if (!filterTerm) {
      filteredImages = [...allImages];
      filteredVideos = [...allVideos];
    } else {
      filteredImages = allImages.filter(img => 
        (img.title && img.title.toLowerCase().includes(filterTerm)) ||
        (img.source && img.source.toLowerCase().includes(filterTerm))
      );
      filteredVideos = allVideos.filter(vid => 
        (vid.title && vid.title.toLowerCase().includes(filterTerm)) ||
        (vid.source && vid.source.toLowerCase().includes(filterTerm))
      );
    }
    addConsoleLog('Retour aux résultats de recherche.', 'info');
  }
  renderMedia();
  lucide.createIcons();
});

// ----------------------------------------------------
// STATISTICS DASHBOARD
// ----------------------------------------------------
function updateStatsDashboard() {
  const totalCount = filteredImages.length + filteredVideos.length;
  if (totalCount === 0) {
    statsDashboard.classList.add('hidden');
    return;
  }
  
  // Count media by source
  const sourceCounts = {};
  
  // Initialize checked sources with 0 so they always show up in the dashboard
  const checkboxes = document.querySelectorAll('.sources-list input[type="checkbox"]');
  checkboxes.forEach(cb => {
    if (cb.checked) {
      sourceCounts[cb.value] = 0;
    }
  });
  
  const allMedia = [...filteredImages, ...filteredVideos];
  allMedia.forEach(item => {
    const src = item.source.toLowerCase();
    // If the source is in our counts, increment it
    sourceCounts[src] = (sourceCounts[src] || 0) + 1;
  });
  
  // Render source progress bars
  statsBreakdownBars.innerHTML = '';
  const currentFilter = document.getElementById('source-filter').value.toLowerCase().trim();
  
  if (currentFilter && currentFilter !== 'all') {
    statsBreakdownBars.classList.add('has-active-filter');
  } else {
    statsBreakdownBars.classList.remove('has-active-filter');
  }
  
  const groupedSources = {
    normal: [],
    social: [],
    nsfw: []
  };

  Object.keys(sourceCounts).forEach(source => {
    groupedSources[getSourceGroup(source)].push(source);
  });

  Object.entries(SOURCE_GROUPS).forEach(([groupKey, config]) => {
    const sources = groupedSources[groupKey] || [];
    if (sources.length === 0) return;

    const drawer = document.createElement('details');
    drawer.className = `stats-drawer stats-drawer-${groupKey}`;
    drawer.open = groupKey !== 'nsfw';
    drawer.innerHTML = `
      <summary class="stats-drawer-summary">
        <span>
          <i data-lucide="${config.icon}"></i>
          ${config.title}
        </span>
        <span>${sources.reduce((sum, source) => sum + (sourceCounts[source] || 0), 0)} médias</span>
      </summary>
      <div class="stats-drawer-body"></div>
    `;
    const body = drawer.querySelector('.stats-drawer-body');

    sources.forEach(source => {
    const count = sourceCounts[source];
    const percent = totalCount > 0 ? Math.round((count / totalCount) * 100) : 0;
    const isActive = currentFilter === source;
    
    const barContainer = document.createElement('div');
    barContainer.className = `stat-bar-container ${source} source-group-${groupKey}${isActive ? ' active' : ''}`;
    barContainer.innerHTML = `
      <div class="stat-bar-label">
        <span class="source-name">${source}</span>
        <span class="source-percent">${count} médias (${percent}%)</span>
      </div>
      <div class="stat-bar-bg">
        <div class="stat-bar-fill ${source}" style="width: ${percent}%;"></div>
      </div>
    `;
    
    // Clicking toggles filtering by this source
    barContainer.addEventListener('click', () => {
      const sourceSelect = document.getElementById('source-filter');
      if (sourceSelect.value === source) {
        sourceSelect.value = 'all';
      } else {
        sourceSelect.value = source;
      }
      applyFilters();
    });
    
      body.appendChild(barContainer);
    });

    statsBreakdownBars.appendChild(drawer);
  });
  
  statsDashboard.classList.remove('hidden');
  lucide.createIcons();
}

// ----------------------------------------------------
// BULK ZIP DOWNLOAD
// ----------------------------------------------------
btnDownloadZip.addEventListener('click', async () => {
  if (filteredImages.length === 0) {
    alert("Aucune photo disponible à télécharger.");
    return;
  }
  
  const originalBtnText = btnDownloadZip.innerHTML;
  btnDownloadZip.disabled = true;
  btnDownloadZip.innerHTML = '<span class="loader-spinner" style="padding:0;display:inline-block;vertical-align:middle;margin-right:0.5rem;"><span class="spinner" style="width:1rem;height:1rem;border-width:2px;margin:0;"></span></span> Compression...';
  
  addConsoleLog(`Démarrage de la génération de l'archive ZIP pour ${filteredImages.length} images...`, 'info');
  
  const zip = new JSZip();
  const folder = zip.folder("aerogatherer_photos");
  
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < filteredImages.length; i++) {
    const img = filteredImages[i];
    const fileUrl = img.url;
    
    // Create clean file name
    let fileName = img.title ? img.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'photo';
    fileName = `${fileName.substring(0, 30)}_${i}`;
    
    let ext = 'jpg';
    const matchExt = fileUrl.match(/\.(jpg|jpeg|png|gif|webp)/i);
    if (matchExt) ext = matchExt[1].toLowerCase();
    fileName = `${fileName}.${ext}`;
    
    try {
      // Fetch image through CORS bypass proxy
      const proxyUrl = `${API_BASE}/api/proxy?url=${encodeURIComponent(fileUrl)}`;
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      const blob = await res.blob();
      folder.file(fileName, blob);
      successCount++;
      
      if (successCount % 5 === 0 || successCount === filteredImages.length) {
        addConsoleLog(`ZIP : téléchargement en cours... (${successCount}/${filteredImages.length} images)`, 'info');
      }
    } catch (err) {
      console.warn(`Failed to package image ${fileUrl}:`, err.message);
      failCount++;
    }
  }
  
  if (successCount > 0) {
    try {
      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, "aerogatherer_photos.zip");
      addConsoleLog(`ZIP généré avec succès ! ${successCount} images archivées (${failCount} échecs).`, 'success');
    } catch (err) {
      addConsoleLog(`Erreur de génération ZIP : ${err.message}`, 'error');
    }
  } else {
    addConsoleLog(`Échec : aucune image n'a pu être récupérée pour le ZIP.`, 'error');
    alert("Impossible de générer le ZIP : toutes les images ont échoué au téléchargement.");
  }
  
  btnDownloadZip.disabled = false;
  btnDownloadZip.innerHTML = originalBtnText;
});

if (btnExportJson) {
  btnExportJson.addEventListener('click', () => {
    const payload = {
      query: currentSearchQuery,
      generatedAt: new Date().toISOString(),
      images: allImages,
      videos: allVideos,
      accounts: detectedAccounts
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeName = (currentSearchQuery || 'recherche').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    link.href = url;
    link.download = `aerogatherer_${safeName}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    addConsoleLog(`Export JSON gÃ©nÃ©rÃ© : ${allImages.length} photos, ${allVideos.length} vidÃ©os, ${detectedAccounts.length} comptes/sites.`, 'success');
  });
}

if (btnAutoRefresh) {
  btnAutoRefresh.addEventListener('click', () => {
    if (refreshTimerId) {
      stopAutoRefresh();
      addConsoleLog('[REFRESH] Surveillance mise en pause.', 'info');
    } else {
      startAutoRefresh();
    }
  });
}

if (autoRefreshInterval) {
  autoRefreshInterval.addEventListener('change', () => {
    if (refreshTimerId) startAutoRefresh();
  });
}

if (btnBatchLoad) {
  btnBatchLoad.addEventListener('click', () => {
    const terms = (batchInput?.value || '')
      .split(/\r?\n|,/)
      .map(item => item.trim())
      .filter(Boolean);
    batchQueue = [...batchQueue, ...terms.map(query => ({ query, status: 'en attente' }))].slice(0, 50);
    if (batchInput) batchInput.value = '';
    renderBatchQueue();
  });
}

if (btnBatchRun) {
  btnBatchRun.addEventListener('click', () => {
    runBatchQueue();
  });
}

if (btnBatchClear) {
  btnBatchClear.addEventListener('click', () => {
    batchQueue = [];
    renderBatchQueue();
  });
}

if (btnHistoryClear) {
  btnHistoryClear.addEventListener('click', () => {
    searchHistory = [];
    localStorage.removeItem('aerogatherer_history');
    renderHistory();
  });
}

if (btnMonitorSave) btnMonitorSave.addEventListener('click', saveMonitor);

if (btnMonitorRun) {
  btnMonitorRun.addEventListener('click', async () => {
    for (const monitor of savedMonitors) {
      restoreSearchConfig(monitor.config || { query: monitor.query });
      await runSearchWithCurrentControls({ monitorId: monitor.id });
    }
  });
}

if (btnMonitorClear) {
  btnMonitorClear.addEventListener('click', () => {
    savedMonitors = [];
    localStorage.removeItem('aerogatherer_monitors');
    renderMonitors();
  });
}

renderHistory();
renderBatchQueue();
renderMonitors();

// ----------------------------------------------------
// UI STATUS DOTS & ADULT SOURCES & GRID SELECTOR INITIALIZATION
// ----------------------------------------------------
function createSourceDrawer(groupKey, config, chips) {
  const drawer = document.createElement('details');
  drawer.className = `source-drawer source-drawer-${groupKey}`;
  drawer.dataset.sourceGroup = groupKey;
  drawer.open = groupKey !== 'nsfw';

  const summary = document.createElement('summary');
  summary.className = 'source-drawer-summary';
  summary.innerHTML = `
    <span class="drawer-title">
      <i data-lucide="${config.icon}"></i>
      <span>${config.title}</span>
      <span class="drawer-count" data-drawer-count="${groupKey}">0/0</span>
    </span>
    <span class="drawer-actions">
      <button type="button" class="drawer-action" data-drawer-select="${groupKey}">Tout</button>
      <button type="button" class="drawer-action" data-drawer-clear="${groupKey}">Aucun</button>
    </span>
  `;

  const body = document.createElement('div');
  body.className = 'source-drawer-body';
  chips.forEach(chip => {
    chip.classList.add(`source-group-${groupKey}`);
    chip.dataset.sourceGroup = groupKey;
    body.appendChild(chip);
  });

  drawer.appendChild(summary);
  drawer.appendChild(body);
  return drawer;
}

function updateSourceDrawerCounts() {
  document.querySelectorAll('.source-drawer').forEach(drawer => {
    const countEl = drawer.querySelector('[data-drawer-count]');
    const visibleInputs = [...drawer.querySelectorAll('.source-chip:not(.hidden) input[type="checkbox"]')];
    const checked = visibleInputs.filter(input => input.checked).length;
    if (countEl) countEl.textContent = `${checked}/${visibleInputs.length}`;
  });
}

function initializeSourceDrawers() {
  const sourcesList = document.querySelector('.sources-list');
  if (!sourcesList || sourcesList.dataset.grouped === 'true') return;

  const allChips = [...sourcesList.querySelectorAll('.source-chip')];
  const groupedChips = {
    normal: [],
    social: [],
    nsfw: []
  };

  allChips.forEach(chip => {
    const input = chip.querySelector('input[type="checkbox"]');
    if (!input) return;
    groupedChips[getSourceGroup(input.value)].push(chip);
  });

  sourcesList.innerHTML = '';
  Object.entries(SOURCE_GROUPS).forEach(([groupKey, config]) => {
    sourcesList.appendChild(createSourceDrawer(groupKey, config, groupedChips[groupKey] || []));
  });

  sourcesList.addEventListener('click', event => {
    const selectGroup = event.target.closest('[data-drawer-select]')?.dataset.drawerSelect;
    const clearGroup = event.target.closest('[data-drawer-clear]')?.dataset.drawerClear;
    const targetGroup = selectGroup || clearGroup;
    if (!targetGroup) return;

    event.preventDefault();
    const drawer = sourcesList.querySelector(`.source-drawer[data-source-group="${targetGroup}"]`);
    const shouldCheck = Boolean(selectGroup);
    drawer?.querySelectorAll('.source-chip:not(.hidden) input[type="checkbox"]').forEach(input => {
      input.checked = shouldCheck;
    });
    updateSourceDrawerCounts();
  });

  sourcesList.addEventListener('change', updateSourceDrawerCounts);
  sourcesList.dataset.grouped = 'true';
  updateSourceDrawerCounts();
}

function updateSourceStatusDot(source, state) {
  const dot = document.getElementById(`dot-${source}`);
  if (dot) {
    dot.className = `source-status-dot ${state}`;
    if (state === 'idle') dot.title = "En attente";
    else if (state === 'loading') dot.title = "Aspiration en cours...";
    else if (state === 'success') dot.title = "Aspiration réussie !";
    else if (state === 'error') dot.title = "Échec ou indisponible";
  }
}

function resetAllStatusDots() {
  const checkboxes = document.querySelectorAll('.sources-list input[type="checkbox"]');
  checkboxes.forEach(cb => {
    updateSourceStatusDot(cb.value, 'idle');
  });
}

// Toggle Adult sources visibility based on SafeSearch checkbox
if (safeSearchToggle) {
  safeSearchToggle.addEventListener('change', () => {
    const adultChips = document.querySelectorAll('.source-chip.adult-source');
    const nsfwDrawer = document.querySelector('.source-drawer-nsfw');
    adultChips.forEach(chip => {
      if (safeSearchToggle.checked) {
        chip.classList.add('hidden');
        const cb = chip.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = false;
      } else {
        chip.classList.remove('hidden');
      }
    });
    if (nsfwDrawer) {
      nsfwDrawer.classList.toggle('hidden', safeSearchToggle.checked);
      if (!safeSearchToggle.checked) nsfwDrawer.open = true;
    }
    updateSourceDrawerCounts();
  });
}

// Initial adult source display setup
function initAdultSources() {
  if (safeSearchToggle) {
    const adultChips = document.querySelectorAll('.source-chip.adult-source');
    const nsfwDrawer = document.querySelector('.source-drawer-nsfw');
    adultChips.forEach(chip => {
      if (safeSearchToggle.checked) {
        chip.classList.add('hidden');
        const cb = chip.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = false;
      } else {
        chip.classList.remove('hidden');
      }
    });
    if (nsfwDrawer) {
      nsfwDrawer.classList.toggle('hidden', safeSearchToggle.checked);
      if (!safeSearchToggle.checked) nsfwDrawer.open = true;
    }
    updateSourceDrawerCounts();
  }
}
initializeSourceDrawers();
initAdultSources();

// Grid layout size selector
const layoutButtons = document.querySelectorAll('.btn-layout');
layoutButtons.forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    layoutButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    const size = btn.getAttribute('data-size');
    imagesGrid.className = `media-grid grid-${size}`;
    videosGrid.className = `media-grid grid-${size}`;
  });
});
