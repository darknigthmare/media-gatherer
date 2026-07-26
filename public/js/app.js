// ----------------------------------------------------
// STATE VARIABLES
// ----------------------------------------------------
function readLocalArray(keys) {
  for (const key of keys) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      if (Array.isArray(value)) return value;
    } catch {
      localStorage.removeItem(key);
    }
  }
  return [];
}

function normalizeSearchTerm(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

let allImages = [];
let allVideos = [];
let filteredImages = [];
let filteredVideos = [];
let favorites = readLocalArray(['mediagatherer_favorites', 'aerogatherer_favorites']);
let showingFavorites = false;
let currentVideoIndex = -1;
let lastLightboxTrigger = null;
let lastVideoModalTrigger = null;
let currentSearchQuery = '';
let detectedAccounts = [];
let lastSearchConfig = null;
let activeSearchController = null;
let activeSearchToken = 0;
let refreshSearchController = null;
let refreshTimerId = null;
let refreshInProgress = false;
let refreshCycleCount = 0;
let searchHistory = readLocalArray(['mediagatherer_history', 'aerogatherer_history']);
let savedMonitors = readLocalArray(['mediagatherer_monitors', 'aerogatherer_monitors']);
let batchQueue = [];
let activeBatchJobId = null;
let activeBatchJob = null;
let batchLoopActive = false;
let batchPaused = false;
let batchCancelled = false;
let currentAliases = [];
let selectedAliasCandidate = null;
let aliasActionFeedback = null;
let aliasCandidatePersistTimer = null;
const pendingAliasCandidates = new Map();
const rejectedAliasKeys = new Set(readLocalArray(['mediagatherer_alias_rejections']));
let sourceDiagnostics = {};
let runtimePersistentStorage = false;
let runtimeStatusResolved = false;
let runtimeStatusPromise = null;
const perceptualHashCache = new Map();
const searchConfigGuards = new WeakMap();
let perceptualPassRunning = false;
const API_BASE = window.location.protocol === 'file:' ? 'http://127.0.0.1:3000' : '';
let sourceCatalog = [];
let sourceCatalogById = new Map();
const SEARCH_SNAPSHOT_DB = 'mediagatherer-search-cache-v1';
const SEARCH_SNAPSHOT_STORE = 'snapshots';
const SEARCH_SNAPSHOT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
let searchSnapshotWriteTimer = null;

function searchSnapshotKey(config = {}) {
  const sources = [...(config.checkedSources || [])].map(String).sort();
  return JSON.stringify({
    query: normalizeSearchTerm(config.query),
    sources,
    safe: config.safeSearch !== false,
    adult: config.adultConfirmed === true,
    media: config.mediaKind || 'both',
    account: config.accountMode || 'complete',
    size: config.sizeVal || '',
    type: config.typeVal || ''
  });
}

function openSearchSnapshotDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB indisponible'));
    const request = window.indexedDB.open(SEARCH_SNAPSHOT_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SEARCH_SNAPSHOT_STORE)) {
        db.createObjectStore(SEARCH_SNAPSHOT_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Ouverture IndexedDB impossible'));
  });
}

async function readSearchSnapshot(config) {
  let db;
  try {
    db = await openSearchSnapshotDb();
    const key = searchSnapshotKey(config);
    const snapshot = await new Promise((resolve, reject) => {
      const request = db.transaction(SEARCH_SNAPSHOT_STORE, 'readonly').objectStore(SEARCH_SNAPSHOT_STORE).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    if (snapshot && Date.now() - Number(snapshot.updatedAt || 0) > SEARCH_SNAPSHOT_TTL_MS) return null;
    return snapshot;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

async function writeSearchSnapshot(snapshot) {
  let db;
  try {
    db = await openSearchSnapshotDb();
    await new Promise((resolve, reject) => {
      const request = db.transaction(SEARCH_SNAPSHOT_STORE, 'readwrite').objectStore(SEARCH_SNAPSHOT_STORE).put(snapshot);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    return true;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

function filterSnapshotItems(items, matchMode) {
  const threshold = matchMode === 'broad' ? 20 : (matchMode === 'strict' ? 70 : 50);
  return (items || []).filter(item => Number(item.confidenceScore || item.relevanceScore || 0) >= threshold);
}

async function persistCurrentSearchSnapshot(config = lastSearchConfig) {
  if (!config?.query) return false;
  const snapshotConfig = { ...config, checkedSources: [...(config.checkedSources || [])] };
  const currentImages = [...allImages];
  const currentVideos = [...allVideos];
  const aliases = [...currentAliases];
  const previous = await readSearchSnapshot(snapshotConfig);
  const images = dedupeMedia([...(previous?.images || []), ...currentImages])
    .sort((a, b) => Number(b.relevanceScore || b.confidenceScore || 0) - Number(a.relevanceScore || a.confidenceScore || 0))
    .slice(0, 2500);
  const videos = dedupeMedia([...(previous?.videos || []), ...currentVideos])
    .sort((a, b) => Number(b.relevanceScore || b.confidenceScore || 0) - Number(a.relevanceScore || a.confidenceScore || 0))
    .slice(0, 750);
  return writeSearchSnapshot({
    key: searchSnapshotKey(snapshotConfig),
    updatedAt: Date.now(),
    query: snapshotConfig.query,
    images,
    videos,
    aliases: aliases.slice(0, 100)
  });
}

function scheduleSearchSnapshotSave(delay = 700) {
  if (!lastSearchConfig?.query) return;
  clearTimeout(searchSnapshotWriteTimer);
  searchSnapshotWriteTimer = setTimeout(() => {
    searchSnapshotWriteTimer = null;
    void persistCurrentSearchSnapshot();
  }, delay);
}

async function restoreSearchSnapshot(config, options = {}) {
  const isActive = options.isActive || searchConfigGuards.get(config);
  const snapshot = await readSearchSnapshot(config);
  if (isActive && !isActive()) return { images: 0, videos: 0 };
  if (!snapshot) return { images: 0, videos: 0 };
  let images = filterSnapshotItems(snapshot.images, config.matchMode || 'smart');
  let videos = filterSnapshotItems(snapshot.videos, config.matchMode || 'smart');
  if (config.mediaKind === 'photos') videos = [];
  if (config.mediaKind === 'videos') images = [];
  if (!images.length && !videos.length) return { images: 0, videos: 0 };
  if (isActive && !isActive()) return { images: 0, videos: 0 };
  mergeSearchData({ images, videos, aliases: snapshot.aliases || [], restoredSnapshot: true }, { skipSnapshot: true });
  return { images: images.length, videos: videos.length, updatedAt: snapshot.updatedAt };
}

const SOURCE_GROUPS = {
  normal: {
    title: 'Sources normales',
    icon: 'image'
  },
  social: {
    title: 'Réseaux sociaux',
    icon: 'share-2'
  },
  identity: {
    title: 'Identité et alias',
    icon: 'contact'
  },
  nsfw: {
    title: 'Sources NSFW',
    icon: 'badge-alert'
  }
};

function getSourceGroup(source) {
  return sourceCatalogById.get(String(source || '').toLowerCase())?.category || 'normal';
}

// ----------------------------------------------------
// DOM ELEMENTS
// ----------------------------------------------------
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const btnSearchSubmit = document.getElementById('btn-search-submit');
const btnCancelSearch = document.getElementById('btn-cancel-search');
const statusConsoleWrapper = document.getElementById('status-console-wrapper');
const runtimeStatus = document.getElementById('runtime-status');
const statusConsole = document.getElementById('status-console');
const btnClearConsole = document.getElementById('btn-clear-console');

const statsBar = document.getElementById('stats-bar');
const countImages = document.getElementById('count-images');
const countVideos = document.getElementById('count-videos');
const filterInput = document.getElementById('filter-input');
const safeSearchToggle = document.getElementById('safe-search-toggle');
const adultConfirmedToggle = document.getElementById('adult-confirmed-toggle');
const safetyRiskMode = document.getElementById('safety-risk-mode');
const searchMatchMode = document.getElementById('search-match-mode');
const accountScrapeMode = document.getElementById('account-scrape-mode');
const mediaKindMode = document.getElementById('media-kind-mode');
const btnNsfwPreset = document.getElementById('btn-nsfw-preset');
const nsfwModeNote = document.getElementById('nsfw-mode-note');

const btnToggleFav = document.getElementById('btn-toggle-fav');
const btnDownloadZip = document.getElementById('btn-download-zip');
const btnExportJson = document.getElementById('btn-export-json');
const exportFormat = document.getElementById('export-format');
const autoRefreshInterval = document.getElementById('auto-refresh-interval');
const btnAutoRefresh = document.getElementById('btn-auto-refresh');
const statsDashboard = document.getElementById('stats-dashboard');
const statsBreakdownBars = document.getElementById('stats-breakdown-bars');
const accountsDashboard = document.getElementById('accounts-dashboard');
const accountsList = document.getElementById('accounts-list');
const insightsDashboard = document.getElementById('insights-dashboard');
const confidenceSummary = document.getElementById('confidence-summary');
const aliasList = document.getElementById('alias-list');
const aliasActionPanel = document.getElementById('alias-action-panel');
const sourceDiagnosticList = document.getElementById('source-diagnostic-list');
const sourceDiagnosticFilter = document.getElementById('source-diagnostic-filter');
const sourceDiagnosticSummary = document.getElementById('source-diagnostic-summary');
const sourceBreakdownSummary = document.getElementById('source-breakdown-summary');
const batchInput = document.getElementById('batch-input');
const batchList = document.getElementById('batch-list');
const batchCount = document.getElementById('batch-count');
const btnBatchLoad = document.getElementById('btn-batch-load');
const btnBatchRun = document.getElementById('btn-batch-run');
const btnBatchPause = document.getElementById('btn-batch-pause');
const btnBatchResume = document.getElementById('btn-batch-resume');
const btnBatchCancel = document.getElementById('btn-batch-cancel');
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
const writeSessionForm = document.getElementById('write-session-form');
const writeSessionToken = document.getElementById('write-session-token');
const writeSessionConfigured = document.getElementById('write-session-configured');
const writeSessionState = document.getElementById('write-session-state');
const writeSessionMessage = document.getElementById('write-session-message');
const btnWriteSessionUnlock = document.getElementById('btn-write-session-unlock');
const btnWriteSessionLock = document.getElementById('btn-write-session-lock');
const reverseSection = document.getElementById('reverse-section');
const reverseImageUrl = document.getElementById('reverse-image-url');
const btnReverseGoogle = document.getElementById('btn-reverse-google');
const btnReverseBing = document.getElementById('btn-reverse-bing');
const btnReverseYandex = document.getElementById('btn-reverse-yandex');
const btnReverseTinEye = document.getElementById('btn-reverse-tineye');
const personSection = document.getElementById('person-section');
const personForm = document.getElementById('person-form');
const personFormTitle = document.getElementById('person-form-title');
const btnPersonSave = document.getElementById('btn-person-save');
const btnPersonCancelEdit = document.getElementById('btn-person-cancel-edit');
const personName = document.getElementById('person-name');
const personType = document.getElementById('person-type');
const personBirthYear = document.getElementById('person-birth-year');
const personAliases = document.getElementById('person-aliases');
const personUsernames = document.getElementById('person-usernames');
const personAccounts = document.getElementById('person-accounts');
const personPositive = document.getElementById('person-positive');
const personExclude = document.getElementById('person-exclude');
const personNotes = document.getElementById('person-notes');
const personPublicOnly = document.getElementById('person-public-only');
const personSafeMode = document.getElementById('person-safe-mode');
const personAdultConfirmed = document.getElementById('person-adult-confirmed');
const personList = document.getElementById('person-list');
const personDetail = document.getElementById('person-detail');
const personAliasDrawer = document.getElementById('person-alias-drawer');
const personAliasSummary = document.getElementById('person-alias-summary');
const personAliasCandidates = document.getElementById('person-alias-candidates');
const personDepth = document.getElementById('person-depth');
const personMaxQueries = document.getElementById('person-max-queries');
const personMinScore = document.getElementById('person-min-score');
const personIncludeNsfw = document.getElementById('person-include-nsfw');
const btnPersonRefresh = document.getElementById('btn-person-refresh');
const btnPersonPlan = document.getElementById('btn-person-plan');
const btnPersonResolve = document.getElementById('btn-person-resolve');
const btnPersonSearch = document.getElementById('btn-person-search');
const btnPersonReport = document.getElementById('btn-person-report');
const btnPersonGraph = document.getElementById('btn-person-graph');
const personQueryPlan = document.getElementById('person-query-plan');
const personMediaList = document.getElementById('person-media-list');
const btnPersonGalleryExport = document.getElementById('btn-person-gallery-export');
const personGalleryQuery = document.getElementById('person-gallery-query');
const personGalleryType = document.getElementById('person-gallery-type');
const personGalleryStatus = document.getElementById('person-gallery-status');
const personGallerySort = document.getElementById('person-gallery-sort');
const personMediaDetailsDrawer = document.getElementById('person-media-details-drawer');
const personMediaDetailsSummary = document.getElementById('person-media-details-summary');
const personMediaDetails = document.getElementById('person-media-details');
const personAnalysisDrawer = document.getElementById('person-analysis-drawer');
const personAnalysisSummary = document.getElementById('person-analysis-summary');
const personAnalysisContent = document.getElementById('person-analysis-content');
const personTimelineList = document.getElementById('person-timeline-list');
const personRuleForm = document.getElementById('person-rule-form');
const personRuleValue = document.getElementById('person-rule-value');
const personRuleType = document.getElementById('person-rule-type');
const personRuleAction = document.getElementById('person-rule-action');
const personRuleList = document.getElementById('person-rule-list');

let personProfiles = readLocalArray(['mediagatherer_persons']);
let selectedPersonId = null;
let editingPersonId = null;
let activePersonAliasCandidates = [];
let activePersonGalleryLinks = [];
let personSearchGalleryTimer = null;

function updatePersonActions() {
  const disabled = !selectedPersonId;
  if (btnPersonPlan) btnPersonPlan.disabled = disabled;
  if (btnPersonResolve) btnPersonResolve.disabled = disabled;
  if (btnPersonSearch) btnPersonSearch.disabled = disabled;
  if (btnPersonReport) btnPersonReport.disabled = disabled;
  if (btnPersonGraph) btnPersonGraph.disabled = disabled;
  if (btnPersonGalleryExport) btnPersonGalleryExport.disabled = disabled;
  const selected = personProfiles.find(person => person.id === selectedPersonId);
  if (personIncludeNsfw) {
    personIncludeNsfw.disabled = disabled || selected?.adultConfirmed !== true;
    if (personIncludeNsfw.disabled) personIncludeNsfw.checked = false;
  }
  if (personRuleForm) personRuleForm.querySelectorAll('input, select, button').forEach(control => { control.disabled = disabled; });
}

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

async function loadRuntimeStatus() {
  try {
    const response = await fetch(`${API_BASE}/api/health`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const persistent = data.storage?.persistent !== false;
    runtimePersistentStorage = persistent;
    if (runtimeStatus) {
      runtimeStatus.classList.remove('error');
      runtimeStatus.classList.toggle('warning', !persistent);
      runtimeStatus.querySelector('span:last-child').textContent = persistent
        ? 'Stockage durable actif'
        : 'Stockage Vercel temporaire';
      runtimeStatus.title = data.storage?.warning || 'API et stockage disponibles';
    }
    return persistent;
  } catch (error) {
    runtimePersistentStorage = false;
    if (runtimeStatus) {
      runtimeStatus.classList.add('error');
      runtimeStatus.querySelector('span:last-child').textContent = 'Serveur indisponible';
      runtimeStatus.title = error.message;
    }
    return false;
  } finally {
    runtimeStatusResolved = true;
  }
}

function ensureRuntimeStatus() {
  if (!runtimeStatusPromise) runtimeStatusPromise = loadRuntimeStatus();
  return runtimeStatusPromise;
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
    const isActive = tab.dataset.tab === tabName;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    tab.tabIndex = isActive ? 0 : -1;
  });

  document.querySelectorAll('.workspace-section').forEach(section => {
    section.classList.toggle('tab-hidden', tabName !== 'search');
  });
  document.querySelectorAll('[data-app-view]').forEach(section => {
    const isActive = section.dataset.appView === tabName;
    section.classList.toggle('hidden', !isActive);
    section.setAttribute('aria-hidden', isActive ? 'false' : 'true');
  });

  if (tabName !== 'search') stopAutoRefresh();
}

appTabs.forEach(tab => {
  tab.addEventListener('click', async () => {
    setActiveTab(tab.dataset.tab);
    if (tab.dataset.tab === 'connections') await loadConnections();
    if (tab.dataset.tab === 'persons') {
      await ensureRuntimeStatus();
      await loadPersons();
    }
  });
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...appTabs];
    const current = tabs.indexOf(tab);
    const targetIndex = event.key === 'Home' ? 0 : (event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length);
    tabs[targetIndex].focus();
    tabs[targetIndex].click();
  });
});

let currentWriteSessionStatus = { configured: false, unlocked: false };
let writeSessionStatusKnown = false;
let writeSessionBusy = false;

function setWriteSessionMessage(message = '', type = 'info') {
  if (!writeSessionMessage) return;
  writeSessionMessage.className = `connection-message write-session-message ${type}`;
  writeSessionMessage.textContent = message;
  writeSessionMessage.setAttribute('role', type === 'error' ? 'alert' : 'status');
}

function renderWriteSessionStatus() {
  const configured = Boolean(currentWriteSessionStatus.configured);
  const unlocked = Boolean(currentWriteSessionStatus.unlocked);

  if (writeSessionConfigured) {
    writeSessionConfigured.textContent = writeSessionStatusKnown
      ? (configured ? 'Configuré' : 'Non configuré')
      : 'État indisponible';
    writeSessionConfigured.className = `connection-state ${writeSessionStatusKnown && configured ? 'ok' : 'warning'}`;
  }
  if (writeSessionState) {
    writeSessionState.textContent = writeSessionStatusKnown
      ? (unlocked ? 'Déverrouillé' : 'Verrouillé')
      : 'État inconnu';
    writeSessionState.className = `connection-state ${writeSessionStatusKnown && unlocked ? 'ok' : 'warning'}`;
  }

  const canUnlock = writeSessionStatusKnown && configured && !unlocked;
  const canLock = writeSessionStatusKnown && configured && unlocked;
  if (writeSessionToken) writeSessionToken.disabled = writeSessionBusy || !canUnlock;
  if (btnWriteSessionUnlock) btnWriteSessionUnlock.disabled = writeSessionBusy || !canUnlock;
  if (btnWriteSessionLock) btnWriteSessionLock.disabled = writeSessionBusy || !canLock;
}

function setWriteSessionBusy(busy) {
  writeSessionBusy = Boolean(busy);
  writeSessionForm?.setAttribute('aria-busy', writeSessionBusy ? 'true' : 'false');
  writeSessionForm?.classList.toggle('is-busy', writeSessionBusy);
  renderWriteSessionStatus();
}

async function loadWriteSessionStatus() {
  if (!writeSessionForm) return;
  setWriteSessionBusy(true);
  setWriteSessionMessage();
  try {
    const response = await fetch(`${API_BASE}/api/session/status`, {
      credentials: 'same-origin'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    currentWriteSessionStatus = {
      configured: Boolean(data.configured),
      unlocked: Boolean(data.unlocked)
    };
    writeSessionStatusKnown = true;
  } catch (error) {
    writeSessionStatusKnown = false;
    setWriteSessionMessage(`État des écritures indisponible : ${error.message}`, 'error');
  } finally {
    setWriteSessionBusy(false);
  }
}

async function unlockWriteSession() {
  if (!writeSessionForm || !writeSessionToken || writeSessionBusy) return;
  if (!writeSessionForm.reportValidity()) return;
  const token = writeSessionToken.value;
  setWriteSessionBusy(true);
  setWriteSessionMessage();
  try {
    const response = await fetch(`${API_BASE}/api/session/unlock`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    currentWriteSessionStatus = {
      configured: Boolean(data.configured),
      unlocked: Boolean(data.unlocked)
    };
    writeSessionStatusKnown = true;
    setWriteSessionMessage('Écritures déverrouillées pour cette session.', 'success');
  } catch (error) {
    setWriteSessionMessage(error.message || 'Déverrouillage impossible.', 'error');
  } finally {
    writeSessionToken.value = '';
    setWriteSessionBusy(false);
  }
}

async function lockWriteSession() {
  if (!writeSessionForm || writeSessionBusy) return;
  setWriteSessionBusy(true);
  setWriteSessionMessage();
  try {
    const response = await fetch(`${API_BASE}/api/session/lock`, {
      method: 'DELETE',
      credentials: 'same-origin'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    currentWriteSessionStatus = {
      configured: Boolean(data.configured),
      unlocked: Boolean(data.unlocked)
    };
    writeSessionStatusKnown = true;
    setWriteSessionMessage('Écritures verrouillées pour cette session.', 'success');
  } catch (error) {
    setWriteSessionMessage(error.message || 'Verrouillage impossible.', 'error');
  } finally {
    if (writeSessionToken) writeSessionToken.value = '';
    setWriteSessionBusy(false);
  }
}

writeSessionForm?.addEventListener('submit', event => {
  event.preventDefault();
  void unlockWriteSession();
});
btnWriteSessionLock?.addEventListener('click', () => {
  void lockWriteSession();
});

async function loadConnections() {
  if (!connectionsGrid) return;
  await loadWriteSessionStatus();
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
    card.dataset.configured = provider.configured ? 'true' : 'false';
    const fieldsHtml = (provider.fields || []).map(field => {
      const presetValue = field.type === 'password' ? '' : String(field.defaultValue || '');
      const placeholder = presetValue ? 'Moteur preconfigure' : (provider.configured ? 'Deja configure' : '');
      const requiredAttributes = field.required ? ' required aria-required="true"' : '';
      return `
        <label class="connection-field">
          <span>${escapeHtml(field.label)}</span>
          <input type="${field.type || 'text'}" name="${escapeHtml(field.name)}" value="${escapeHtml(presetValue)}" data-preset="${escapeHtml(presetValue)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off"${requiredAttributes}>
        </label>
      `;
    }).join('');

    card.innerHTML = `
      <div class="connection-card-header">
        <div>
          <h4>${escapeHtml(provider.label)}</h4>
          <p>${escapeHtml(provider.unlocks || '')}</p>
        </div>
        <span class="connection-state ${provider.configured ? 'ok' : (provider.available === false ? 'warning' : 'idle')}">${provider.configured ? 'Configuré' : (provider.available === false ? 'Indisponible' : 'Non configuré')}</span>
      </div>
      <div class="connection-fields">${fieldsHtml}</div>
      <div class="connection-actions">
        <button type="submit" class="btn btn-primary btn-small" ${provider.available === false ? 'disabled' : ''}><i data-lucide="save"></i><span>Enregistrer</span></button>
        <button type="button" class="btn btn-secondary btn-small" data-action="test" ${provider.available === false ? 'disabled' : ''}><i data-lucide="plug-zap"></i><span>Tester</span></button>
        <button type="button" class="btn btn-secondary btn-small" data-action="clear" ${provider.available === false ? 'disabled' : ''}><i data-lucide="x"></i><span>Effacer</span></button>
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
  if (!card.reportValidity()) return;
  try {
    const data = await storeConnectionValues(provider, card);
    card.dataset.configured = 'true';
    card.classList.add('configured');
    const state = card.querySelector('.connection-state');
    if (state) {
      state.className = 'connection-state ok';
      state.textContent = 'Configuré';
    }
    setConnectionMessage(card, data.note || data.message || 'Configuration recue pour cette session serveur.', data.ok === false ? 'warning' : 'success');
  } catch (error) {
    setConnectionMessage(card, error.message, 'error');
  }
}

async function storeConnectionValues(provider, card) {
  const response = await fetch(`${API_BASE}/api/connections/${encodeURIComponent(provider)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(readConnectionForm(card))
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function testConnection(provider, card) {
  try {
    const inputs = [...card.querySelectorAll('input[name]')];
    const hasEditedValues = inputs.some(input => input.value.trim() && input.value.trim() !== String(input.dataset.preset || ''));
    if (hasEditedValues || card.dataset.configured !== 'true') {
      if (!card.reportValidity()) return;
      await storeConnectionValues(provider, card);
      card.dataset.configured = 'true';
      card.classList.add('configured');
    }
    const credentials = readConnectionForm(card);
    const response = await fetch(`${API_BASE}/api/connections/${encodeURIComponent(provider)}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || data.message || `HTTP ${response.status}`);
    setConnectionMessage(card, data.message || data.note || 'Connexion valide.', 'success');
  } catch (error) {
    setConnectionMessage(card, error.message, 'error');
  }
}

async function clearConnection(provider, card) {
  try {
    const response = await fetch(`${API_BASE}/api/connections/${encodeURIComponent(provider)}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    card.dataset.configured = 'false';
    card.classList.remove('configured');
    card.querySelectorAll('input[name]').forEach(input => { input.value = input.dataset.preset || ''; });
    const state = card.querySelector('.connection-state');
    if (state) {
      state.className = 'connection-state idle';
      state.textContent = 'Non configuré';
    }
    setConnectionMessage(card, data.note || data.message || 'Identifiants effaces pour cette session serveur.', 'info');
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
  const publicImageUrl = safeHttpUrl(imageUrl);
  if (!publicImageUrl) {
    alert('Utilisez une URL publique HTTP(S) valide.');
    return;
  }
  window.open(getReverseUrl(engine, publicImageUrl), '_blank', 'noopener,noreferrer');
}

function prepareReverseSearch(imageUrl) {
  if (reverseImageUrl) reverseImageUrl.value = imageUrl || '';
  closeLightbox(false);
  setActiveTab('reverse');
  reverseImageUrl?.focus();
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
    birthYear: personBirthYear?.value ? Number(personBirthYear.value) : null,
    aliases: splitPersonLines(personAliases?.value),
    usernames: splitPersonLines(personUsernames?.value),
    accounts: splitPersonLines(personAccounts?.value).map(url => ({ url })),
    positiveKeywords: splitPersonLines(personPositive?.value),
    excludeKeywords: splitPersonLines(personExclude?.value),
    notes: personNotes?.value || '',
    publicOnly: personPublicOnly ? personPublicOnly.checked : true,
    safeMode: personSafeMode ? personSafeMode.checked : true,
    adultConfirmed: personAdultConfirmed ? personAdultConfirmed.checked : false
  };
}

function personProfileKey(person = {}) {
  return String(person.id || `name:${normalizeSearchTerm(person.displayName || person.name)}`);
}

function mergePersonProfileFallback(serverProfiles = [], fallbackProfiles = []) {
  const merged = new Map();
  fallbackProfiles.forEach(person => merged.set(personProfileKey(person), person));
  serverProfiles.forEach(person => {
    const key = personProfileKey(person);
    merged.set(key, { ...(merged.get(key) || {}), ...person });
  });
  return [...merged.values()].slice(0, 100);
}

function resetPersonFormMode() {
  editingPersonId = null;
  personForm?.reset();
  if (personPublicOnly) personPublicOnly.checked = true;
  if (personSafeMode) personSafeMode.checked = true;
  if (personAdultConfirmed) personAdultConfirmed.checked = false;
  if (personFormTitle) personFormTitle.textContent = 'Nouvelle fiche personne';
  const saveLabel = btnPersonSave?.querySelector('span');
  if (saveLabel) saveLabel.textContent = 'Créer le profil';
  btnPersonCancelEdit?.classList.add('hidden');
}

function editPersonProfile(person) {
  if (!person || !personForm) return;
  editingPersonId = person.id;
  personName.value = person.displayName || person.name || '';
  personType.value = person.type || 'creator';
  personBirthYear.value = person.birthYear || '';
  personAliases.value = (person.aliases || []).join('\n');
  personUsernames.value = (person.usernames || []).join('\n');
  personAccounts.value = (person.accounts || []).map(account => typeof account === 'string' ? account : account.url).filter(Boolean).join('\n');
  personPositive.value = (person.positiveKeywords || []).join('\n');
  personExclude.value = (person.excludeKeywords || []).join('\n');
  personNotes.value = person.notes || '';
  personPublicOnly.checked = person.publicOnly !== false;
  personSafeMode.checked = person.safeMode !== false;
  personAdultConfirmed.checked = person.adultConfirmed === true;
  if (personFormTitle) personFormTitle.textContent = `Modifier ${person.displayName || person.name}`;
  const saveLabel = btnPersonSave?.querySelector('span');
  if (saveLabel) saveLabel.textContent = 'Enregistrer les modifications';
  btnPersonCancelEdit?.classList.remove('hidden');
  personForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  personName.focus();
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
  if (!runtimeStatusResolved) await ensureRuntimeStatus();
  const fallbackProfiles = [...personProfiles];
  personList.innerHTML = '<div class="person-empty">Chargement...</div>';
  try {
    const response = await fetch(`${API_BASE}/api/persons`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const serverProfiles = data.persons || [];
    personProfiles = runtimePersistentStorage
      ? serverProfiles
      : mergePersonProfileFallback(serverProfiles, fallbackProfiles);
    localStorage.setItem('mediagatherer_persons', JSON.stringify(personProfiles));
    if (selectedPersonId && !personProfiles.some(person => person.id === selectedPersonId)) selectedPersonId = null;
    if (!selectedPersonId && personProfiles[0]) selectedPersonId = personProfiles[0].id;
    updatePersonActions();
    renderPersonList();
    if (selectedPersonId) await selectPerson(selectedPersonId, false);
  } catch (error) {
    personProfiles = fallbackProfiles;
    renderPersonList();
    if (!personProfiles.length) personList.innerHTML = `<div class="person-empty">Erreur Person Finder : ${escapeHtml(error.message)}</div>`;
    addConsoleLog(`[PERSON] Chargement impossible, profils locaux conservés : ${error.message}`, 'warning');
  } finally {
    updatePersonActions();
  }
}

function renderPersonDetail(person) {
  if (!personDetail) return;
  const searchableAliases = [
    ...(person.aliases || []).map(value => ({ value, kind: 'display_name' })),
    ...(person.usernames || []).map(value => ({ value: `@${String(value).replace(/^@/, '')}`, kind: 'username' }))
  ];
  const publicAccounts = (person.accounts || []).map(account => typeof account === 'string' ? { url: account } : account).filter(Boolean);
  personDetail.classList.remove('empty');
  personDetail.innerHTML = `
    <div class="person-detail-head">
      <div>
        <h4>${escapeHtml(person.displayName || person.name)}</h4>
        <p>${escapeHtml(person.type || '')}</p>
      </div>
      <div class="person-detail-actions">
        <span class="person-safe-badge">${person.publicOnly !== false && person.safeMode !== false ? 'Public only' : 'Bloque'}</span>
        ${person.adultConfirmed ? '<span class="person-safe-badge person-adult-badge">18+ confirmé</span>' : ''}
        <button type="button" class="btn btn-secondary btn-small" data-person-edit="${escapeHtml(person.id)}"><i data-lucide="pencil"></i><span>Modifier</span></button>
        <button type="button" class="btn btn-danger btn-small" data-person-delete="${escapeHtml(person.id)}"><i data-lucide="trash-2"></i><span>Supprimer</span></button>
      </div>
    </div>
    <div class="person-chip-row">
      ${searchableAliases.map((alias, index) => `<button type="button" class="person-alias-chip" data-person-detail-alias="${index}" title="Rechercher cet alias dans Media Finder">${escapeHtml(alias.value)}</button>`).join('')}
    </div>
    <div class="person-account-list">
      ${publicAccounts.map(account => {
        const url = safeHttpUrl(account.url || '');
        const label = account.username ? `@${account.username}` : (account.platform || account.url || 'Compte public');
        return `<div class="person-account-row">
          ${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}<i data-lucide="external-link"></i></a>` : `<span>${escapeHtml(label)}</span>`}
          ${account.id ? `<button type="button" class="icon-btn" data-person-account-delete="${escapeHtml(account.id)}" title="Supprimer ce compte" aria-label="Supprimer le compte ${escapeHtml(label)}"><i data-lucide="trash-2"></i></button>` : ''}
        </div>`;
      }).join('')}
    </div>
    <p class="person-note">${escapeHtml(person.notes || 'Pas de note.')}</p>
  `;
  personDetail.querySelector('[data-person-edit]')?.addEventListener('click', () => editPersonProfile(person));
  personDetail.querySelector('[data-person-delete]')?.addEventListener('click', () => deletePersonProfile(person.id));
  personDetail.querySelectorAll('[data-person-detail-alias]').forEach(button => {
    button.addEventListener('click', () => searchPersonAliasCandidate(searchableAliases[Number(button.dataset.personDetailAlias)]));
  });
  personDetail.querySelectorAll('[data-person-account-delete]').forEach(button => {
    button.addEventListener('click', () => deletePersonAccount(person.id, button.dataset.personAccountDelete));
  });
  lucide.createIcons();
}

async function deletePersonAccount(personId, accountId) {
  if (!personId || !accountId) return;
  try {
    const response = await fetch(`${API_BASE}/api/persons/${encodeURIComponent(personId)}/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    addConsoleLog('[PERSON] Compte public supprimé.', 'success');
    await loadPersons();
  } catch (error) {
    addConsoleLog(`[PERSON] Suppression du compte impossible : ${error.message}`, 'error');
  }
}

function renderPersonAliasCandidates(candidates = []) {
  if (!personAliasDrawer || !personAliasCandidates || !personAliasSummary) return;
  activePersonAliasCandidates = [...candidates].sort((a, b) => {
    const statusOrder = { to_review: 0, probable: 1, confirmed: 2, merged: 3, rejected: 4 };
    return (statusOrder[a.status] ?? 5) - (statusOrder[b.status] ?? 5) || Number(b.confidence || 0) - Number(a.confidence || 0);
  });
  if (!selectedPersonId) {
    personAliasDrawer.classList.add('hidden');
    personAliasCandidates.innerHTML = '';
    personAliasSummary.textContent = '0 candidat';
    return;
  }
  personAliasDrawer.classList.remove('hidden');
  const pendingCount = activePersonAliasCandidates.filter(candidate => ['to_review', 'probable'].includes(candidate.status)).length;
  personAliasSummary.textContent = `${pendingCount} a valider · ${activePersonAliasCandidates.length} total`;
  personAliasCandidates.innerHTML = activePersonAliasCandidates.length
    ? activePersonAliasCandidates.map(candidate => `
      <div class="person-alias-row" data-person-alias-id="${escapeHtml(candidate.id)}">
        <div class="person-alias-main">
          <strong>${escapeHtml(candidate.value)}</strong>
          <small><span class="alias-status-${escapeHtml(candidate.status || 'to_review')}">${escapeHtml(aliasStatusLabel(candidate.status))}</span> · confiance ${Number(candidate.confidence || 0)}% · ${(candidate.sources || []).length} source(s)</small>
          ${(candidate.evidence || []).length ? `<details class="alias-evidence"><summary>Voir les preuves</summary><div class="alias-evidence-list">${aliasEvidenceHtml(candidate)}</div></details>` : ''}
        </div>
        <div class="person-alias-actions">
          <button type="button" class="btn btn-secondary btn-small" data-person-alias-search title="Rechercher cet alias"><i data-lucide="search"></i><span>Rechercher</span></button>
          ${candidate.status !== 'confirmed' ? '<button type="button" class="btn btn-secondary btn-small" data-person-alias-status="confirmed"><i data-lucide="check"></i><span>Confirmer</span></button>' : ''}
          ${candidate.status !== 'rejected' ? '<button type="button" class="btn btn-secondary btn-small" data-person-alias-status="rejected"><i data-lucide="ban"></i><span>Rejeter</span></button>' : ''}
          <button type="button" class="icon-btn" data-person-alias-delete title="Supprimer ce candidat" aria-label="Supprimer ${escapeHtml(candidate.value)}"><i data-lucide="trash-2"></i></button>
        </div>
      </div>
    `).join('')
    : '<div class="person-empty">Aucun alias candidat pour cette fiche.</div>';
  personAliasCandidates.querySelectorAll('[data-person-alias-id]').forEach(row => {
    const candidate = activePersonAliasCandidates.find(item => item.id === row.dataset.personAliasId);
    row.querySelector('[data-person-alias-search]')?.addEventListener('click', () => searchPersonAliasCandidate(candidate));
    row.querySelectorAll('[data-person-alias-status]').forEach(button => {
      button.addEventListener('click', () => updatePersonAliasCandidate(candidate.id, button.dataset.personAliasStatus));
    });
    row.querySelector('[data-person-alias-delete]')?.addEventListener('click', () => deletePersonAliasCandidate(candidate.id));
  });
  lucide.createIcons();
}

async function updatePersonAliasCandidate(candidateId, status) {
  if (!candidateId || !selectedPersonId) return;
  const row = personAliasCandidates?.querySelector(`[data-person-alias-id="${CSS.escape(candidateId)}"]`);
  row?.querySelectorAll('button').forEach(button => { button.disabled = true; });
  try {
    const response = await fetch(`${API_BASE}/api/aliases/candidates/${encodeURIComponent(candidateId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, personId: selectedPersonId })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    addConsoleLog(`[ALIAS] ${data.value} : ${aliasStatusLabel(data.status)}.`, 'success');
    await selectPerson(selectedPersonId, false);
  } catch (error) {
    addConsoleLog(`[ALIAS] Validation impossible : ${error.message}`, 'error');
  } finally {
    row?.querySelectorAll('button').forEach(button => { button.disabled = false; });
  }
}

async function deletePersonAliasCandidate(candidateId) {
  if (!candidateId || !selectedPersonId) return;
  try {
    const response = await fetch(`${API_BASE}/api/aliases/candidates/${encodeURIComponent(candidateId)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    addConsoleLog('[ALIAS] Candidat supprime de la fiche personne.', 'success');
    await selectPerson(selectedPersonId, false);
  } catch (error) {
    addConsoleLog(`[ALIAS] Suppression impossible : ${error.message}`, 'error');
  }
}

function searchPersonAliasCandidate(candidate) {
  if (!candidate?.value) return;
  setActiveTab('search');
  searchInput.value = candidate.value;
  searchForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  addConsoleLog(`[ALIAS] Recherche lancee depuis Person Finder : ${candidate.value}`, 'info');
  searchForm.requestSubmit();
}

function renderPersonPlan(plan) {
  if (!personQueryPlan) return;
  const queries = Array.isArray(plan) ? plan : (plan?.queries || []);
  const sources = Array.isArray(plan?.sources) ? plan.sources : [];
  personQueryPlan.innerHTML = `
    ${sources.length ? `<span class="person-query-source-summary">${sources.length} sources: ${escapeHtml(sources.join(', '))}</span>` : ''}
    ${queries.map(query => `<span class="person-query-chip">${escapeHtml(query)}</span>`).join('') || '<span class="person-empty">Aucune requête générée.</span>'}
  `;
}

function renderPersonMedia(links) {
  if (!personMediaList) return;
  activePersonGalleryLinks = [...(links || [])];
  if (!links.length) {
    personMediaList.innerHTML = '<div class="person-empty">Aucun media lie pour ce profil.</div>';
    return;
  }
  personMediaList.innerHTML = links.map(link => {
    const media = link.media || {};
    const preview = safeHttpUrl(media.thumbnail || (link.mediaType === 'image' ? media.url : '') || '');
    const sourceUrl = safeHttpUrl(media.link || media.url || '');
    return `
      <article class="person-media-row" data-person-media-id="${escapeHtml(link.id)}">
        ${preview
          ? `<img src="${escapeHtml(preview)}" loading="lazy" referrerpolicy="no-referrer" alt="${escapeHtml(media.title || 'Aperçu média')}">`
          : `<div class="person-media-placeholder" aria-label="${link.mediaType === 'video' ? 'Vidéo sans miniature' : 'Média sans miniature'}"><i data-lucide="${link.mediaType === 'video' ? 'video' : 'file'}"></i></div>`}
        <div class="person-media-main">
          <strong>${escapeHtml(media.title || 'Media sans titre')}</strong>
          <span>${escapeHtml(media.source || '')} · score ${Number(link.personScore || media.confidenceScore || 0)} · ${escapeHtml(link.status || 'to_review')}</span>
          <small>${escapeHtml((link.evidence || media.matchReasons || []).slice(0, 3).join(' · '))}</small>
        </div>
        <div class="person-media-actions">
          <label class="sr-only" for="person-media-status-${escapeHtml(link.id)}">Statut de validation</label>
          <select id="person-media-status-${escapeHtml(link.id)}" data-person-status="${escapeHtml(link.id)}">
            ${[
              ['to_review', 'À vérifier'],
              ['probable', 'Probable'],
              ['confirmed', 'Confirmé'],
              ['saved', 'Sauvegardé'],
              ['false_positive', 'Faux positif'],
              ['excluded', 'Exclu']
            ].map(([value, label]) => `<option value="${value}" ${link.status === value ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
          <button data-person-details="${escapeHtml(link.id)}" class="icon-btn" type="button" title="Voir les preuves" aria-label="Voir les preuves"><i data-lucide="badge-check"></i></button>
          ${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" class="icon-btn" target="_blank" rel="noopener noreferrer" title="Ouvrir la source" aria-label="Ouvrir la source"><i data-lucide="external-link"></i></a>` : ''}
        </div>
      </article>
    `;
  }).join('');
  personMediaList.querySelectorAll('[data-person-status]').forEach(select => {
    select.addEventListener('change', () => validatePersonMedia(select.dataset.personStatus, select.value));
  });
  personMediaList.querySelectorAll('[data-person-details]').forEach(button => {
    button.addEventListener('click', () => showPersonMediaDetails(button.dataset.personDetails));
  });
  lucide.createIcons();
}

function personGalleryUrl(personId = selectedPersonId) {
  const params = new URLSearchParams();
  if (personGalleryQuery?.value.trim()) params.set('q', personGalleryQuery.value.trim());
  if (personGalleryType?.value && personGalleryType.value !== 'all') params.set('type', personGalleryType.value);
  if (personGalleryStatus?.value && personGalleryStatus.value !== 'all') params.set('status', personGalleryStatus.value);
  if (personGallerySort?.value) params.set('sort', personGallerySort.value);
  return `${API_BASE}/api/persons/${encodeURIComponent(personId)}/gallery?${params}`;
}

async function loadPersonGallery(personId = selectedPersonId, options = {}) {
  if (!personId) return [];
  try {
    const response = await fetch(personGalleryUrl(personId));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (personId === selectedPersonId) renderPersonMedia(data.links || []);
    return data.links || [];
  } catch (error) {
    if (!options.silent) addConsoleLog(`[PERSON] Galerie impossible à charger : ${error.message}`, 'error');
    return [];
  }
}

async function showPersonMediaDetails(linkId) {
  if (!selectedPersonId || !linkId || !personMediaDetailsDrawer || !personMediaDetails) return;
  personMediaDetailsDrawer.classList.remove('hidden');
  personMediaDetailsDrawer.open = true;
  personMediaDetailsSummary.textContent = 'Chargement...';
  personMediaDetails.innerHTML = '<div class="person-empty">Chargement des preuves...</div>';
  try {
    const response = await fetch(`${API_BASE}/api/persons/${encodeURIComponent(selectedPersonId)}/media/${encodeURIComponent(linkId)}/details`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    const link = data.link || {};
    const media = link.media || {};
    const sourceUrl = safeHttpUrl(data.proof?.url || media.link || media.url || '');
    personMediaDetailsSummary.textContent = media.source || link.status || '';
    personMediaDetails.innerHTML = `
      <div class="person-proof-grid">
        <div><span>Titre</span><strong>${escapeHtml(media.title || 'Sans titre')}</strong></div>
        <div><span>Statut</span><strong>${escapeHtml(link.status || 'to_review')}</strong></div>
        <div><span>Score personne</span><strong>${Number(link.personScore || 0)}%</strong></div>
        <div><span>Requête</span><strong>${escapeHtml(data.proof?.query || link.query || 'Non renseignée')}</strong></div>
      </div>
      <div class="person-proof-list">
        ${(data.proof?.evidence || link.evidence || []).map(reason => `<span><i data-lucide="check"></i>${escapeHtml(reason)}</span>`).join('') || '<span>Aucune preuve textuelle enregistrée.</span>'}
      </div>
      ${sourceUrl ? `<a class="btn btn-secondary" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer"><i data-lucide="external-link"></i><span>Ouvrir la source publique</span></a>` : ''}
    `;
    lucide.createIcons();
  } catch (error) {
    personMediaDetailsSummary.textContent = 'Erreur';
    personMediaDetails.innerHTML = `<div class="person-empty">${escapeHtml(error.message)}</div>`;
  }
}

async function showPersonAnalysis(kind) {
  if (!selectedPersonId || !personAnalysisDrawer || !personAnalysisContent) return;
  personAnalysisDrawer.classList.remove('hidden');
  personAnalysisDrawer.open = true;
  personAnalysisSummary.textContent = 'Chargement...';
  personAnalysisContent.innerHTML = '<div class="person-empty">Analyse en cours...</div>';
  try {
    const response = await fetch(`${API_BASE}/api/persons/${encodeURIComponent(selectedPersonId)}/${kind}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (kind === 'report') {
      const stats = data.stats || {};
      personAnalysisSummary.textContent = `${stats.media?.validated || 0}/${stats.media?.total || 0} médias validés`;
      personAnalysisContent.innerHTML = `
        <div class="person-proof-grid">
          <div><span>Médias</span><strong>${Number(stats.media?.total || 0)}</strong></div>
          <div><span>Validés</span><strong>${Number(stats.media?.validated || 0)}</strong></div>
          <div><span>À vérifier</span><strong>${Number(stats.media?.needsReview || 0)}</strong></div>
          <div><span>Alias confirmés</span><strong>${Number(stats.aliases?.confirmed || 0)}</strong></div>
          <div><span>Comptes confirmés</span><strong>${Number(stats.accounts?.confirmed || 0)}</strong></div>
          <div><span>Sources</span><strong>${Number(stats.sources?.length || 0)}</strong></div>
        </div>
        <div class="person-source-report">${(stats.sources || []).map(source => `<span>${escapeHtml(source.label || source.id)} · ${Number(source.validated || 0)}/${Number(source.total || 0)}</span>`).join('') || '<span>Aucune source.</span>'}</div>
        <a class="btn btn-secondary" href="${API_BASE}/api/exports/person-report?personId=${encodeURIComponent(selectedPersonId)}&format=json"><i data-lucide="download"></i><span>Exporter le rapport JSON</span></a>
      `;
    } else {
      const counts = (data.nodes || []).reduce((map, node) => {
        map[node.type] = (map[node.type] || 0) + 1;
        return map;
      }, {});
      personAnalysisSummary.textContent = `${(data.nodes || []).length} nœuds · ${(data.edges || []).length} relations`;
      personAnalysisContent.innerHTML = `
        <div class="person-graph-summary">${Object.entries(counts).map(([type, count]) => `<span><strong>${Number(count)}</strong>${escapeHtml(type)}</span>`).join('')}</div>
        <div class="person-relation-list">${(data.edges || []).slice(0, 60).map(edge => `<span>${escapeHtml(edge.type)} · ${escapeHtml(edge.from)} → ${escapeHtml(edge.to)}</span>`).join('') || '<span>Aucune relation publique.</span>'}</div>
      `;
    }
    lucide.createIcons();
  } catch (error) {
    personAnalysisSummary.textContent = 'Erreur';
    personAnalysisContent.innerHTML = `<div class="person-empty">${escapeHtml(error.message)}</div>`;
  }
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
      <button data-rule-delete="${escapeHtml(rule.id)}" class="btn btn-secondary btn-small" type="button" aria-label="Supprimer la règle"><i data-lucide="trash-2"></i></button>
    </div>
  `).join('') || '<div class="person-empty">Aucune regle.</div>';
  personRuleList.querySelectorAll('[data-rule-delete]').forEach(button => {
    button.addEventListener('click', () => deletePersonRule(button.dataset.ruleDelete));
  });
  lucide.createIcons();
}

async function selectPerson(id, rerenderList = true) {
  if (!id) return;
  selectedPersonId = id;
  updatePersonActions();
  if (rerenderList) renderPersonList();
  const localPerson = personProfiles.find(person => person.id === id);
  if (localPerson) renderPersonDetail(localPerson);
  personSection?.setAttribute('aria-busy', 'true');
  try {
    const [personRes, planRes, galleryRes, timelineRes, rulesRes, aliasesRes] = await Promise.all([
      fetch(`${API_BASE}/api/persons/${encodeURIComponent(id)}`),
      fetch(`${API_BASE}/api/persons/${encodeURIComponent(id)}/search-plan?depth=${encodeURIComponent(personDepth?.value || 'normal')}`),
      fetch(personGalleryUrl(id)),
      fetch(`${API_BASE}/api/persons/${encodeURIComponent(id)}/timeline`),
      fetch(`${API_BASE}/api/persons/${encodeURIComponent(id)}/validation/rules`),
      fetch(`${API_BASE}/api/aliases/candidates?personId=${encodeURIComponent(id)}`)
    ]);
    if (selectedPersonId !== id) return;
    if (personRes.ok) {
      const latestPerson = await personRes.json();
      personProfiles = personProfiles.map(person => person.id === latestPerson.id ? latestPerson : person);
      localStorage.setItem('mediagatherer_persons', JSON.stringify(personProfiles));
      renderPersonList();
      renderPersonDetail(latestPerson);
    }
    if (planRes.ok) renderPersonPlan(await planRes.json());
    if (galleryRes.ok) renderPersonMedia((await galleryRes.json()).links || []);
    if (timelineRes.ok) renderPersonTimeline((await timelineRes.json()).events || []);
    if (rulesRes.ok) renderPersonRules((await rulesRes.json()).rules || []);
    if (aliasesRes.ok) renderPersonAliasCandidates((await aliasesRes.json()).candidates || []);
  } catch (error) {
    addConsoleLog(`[PERSON] Impossible de charger tous les détails : ${error.message}`, 'error');
  } finally {
    personSection?.removeAttribute('aria-busy');
    updatePersonActions();
  }
}

async function savePersonProfile(event) {
  event.preventDefault();
  const payload = readPersonForm();
  if (!payload.name) return;
  if (!payload.publicOnly || !payload.safeMode) {
    alert('Public only et Safe mode sont obligatoires pour toute fiche Person Finder.');
    (!payload.publicOnly ? personPublicOnly : personSafeMode)?.focus();
    return;
  }
  const targetId = editingPersonId;
  const method = targetId ? 'PATCH' : 'POST';
  const endpoint = targetId
    ? `${API_BASE}/api/persons/${encodeURIComponent(targetId)}`
    : `${API_BASE}/api/persons`;
  if (btnPersonSave) btnPersonSave.disabled = true;
  personForm?.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    const person = data;
    personProfiles = [person, ...personProfiles.filter(item => item.id !== person.id)].slice(0, 100);
    localStorage.setItem('mediagatherer_persons', JSON.stringify(personProfiles));
    selectedPersonId = person.id;
    resetPersonFormMode();
    addConsoleLog(`[PERSON] Profil ${targetId ? 'modifié' : 'créé'} : ${person.displayName || person.name}.`, 'success');
    await loadPersons();
  } catch (error) {
    addConsoleLog(`[PERSON] Enregistrement impossible : ${error.message}`, 'error');
    alert(`Impossible d'enregistrer le profil Person Finder : ${error.message}`);
  } finally {
    personForm?.removeAttribute('aria-busy');
    if (btnPersonSave) btnPersonSave.disabled = false;
  }
}

async function deletePersonProfile(id) {
  const person = personProfiles.find(item => item.id === id);
  if (!person || !window.confirm(`Supprimer le profil ${person.displayName || person.name} et ses liens associés ?`)) return;
  personSection?.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch(`${API_BASE}/api/persons/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    addConsoleLog(`[PERSON] Suppression serveur impossible : ${error.message}`, 'warning');
  } finally {
    personProfiles = personProfiles.filter(item => item.id !== id);
    localStorage.setItem('mediagatherer_persons', JSON.stringify(personProfiles));
    if (editingPersonId === id) resetPersonFormMode();
    selectedPersonId = personProfiles[0]?.id || null;
    updatePersonActions();
    renderPersonList();
    if (selectedPersonId) await selectPerson(selectedPersonId, false);
    else if (personDetail) {
      personDetail.className = 'person-detail empty';
      personDetail.textContent = 'Selectionne ou cree une fiche personne.';
      renderPersonMedia([]);
      renderPersonAliasCandidates([]);
      renderPersonTimeline([]);
      renderPersonRules([]);
    }
    personSection?.removeAttribute('aria-busy');
  }
}

async function previewPersonPlan() {
  if (!selectedPersonId) return;
  try {
    const response = await fetch(`${API_BASE}/api/persons/${encodeURIComponent(selectedPersonId)}/search-plan?depth=${encodeURIComponent(personDepth?.value || 'normal')}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    renderPersonPlan(data);
  } catch (error) {
    addConsoleLog(`[PERSON] Plan impossible à charger : ${error.message}`, 'error');
  }
}

async function resolvePersonIdentity() {
  if (!selectedPersonId) return;
  const selected = personProfiles.find(person => person.id === selectedPersonId);
  if (selected?.publicOnly === false || selected?.safeMode === false) {
    alert('Modifiez cette fiche pour activer Public only et Safe mode avant la résolution.');
    editPersonProfile(selected);
    return;
  }
  const includeNsfw = Boolean(personIncludeNsfw?.checked);
  if (includeNsfw && selected?.adultConfirmed !== true) {
    alert('Confirmez d abord que la fiche concerne une personne adulte.');
    return;
  }
  if (btnPersonResolve) btnPersonResolve.disabled = true;
  try {
    const response = await fetch(`${API_BASE}/api/persons/${encodeURIComponent(selectedPersonId)}/identity/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ includeNsfw })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    addConsoleLog(`[IDENTITE] ${data.aliases?.length || 0} alias et ${data.accounts?.length || 0} comptes publics vérifiés.`, 'success');
    await loadPersons();
  } catch (error) {
    alert(error.message);
  } finally {
    updatePersonActions();
  }
}

async function runPersonSearch() {
  if (!selectedPersonId) return;
  const selected = personProfiles.find(person => person.id === selectedPersonId);
  if (selected?.publicOnly === false || selected?.safeMode === false) {
    alert('Modifiez cette fiche pour activer Public only et Safe mode avant toute recherche.');
    editPersonProfile(selected);
    return;
  }
  const includeNsfw = Boolean(personIncludeNsfw?.checked);
  if (includeNsfw && selected?.adultConfirmed !== true) {
    alert('La confirmation adulte est requise sur cette fiche.');
    return;
  }
  const birthYear = Number(selected?.birthYear || 0);
  if (includeNsfw && birthYear && birthYear >= new Date().getFullYear() - 18) {
    alert('Les sources 18+ sont interdites lorsque la majorité est impossible à confirmer avec l’année renseignée.');
    return;
  }
  if (personMediaList) personMediaList.innerHTML = '<div class="person-empty">Recherche Person Finder en cours...</div>';
  const depth = personDepth?.value || 'normal';
  const adultSources = ['stashdb', 'iafd', 'babepedia', 'erome', 'redgifs', 'eporner', 'phunforum', 'planetsuzy', 'bellazon'];
  if (['deep', 'archive'].includes(depth)) adultSources.push('fanvue', 'indexxx', 'boobpedia', 'chaturbate', 'stripchat', 'camsoda', 'livejasmin');
  const identitySources = ['wikidata', 'github', 'musicbrainz', 'bluesky', 'mastodon', 'linktree', 'beacons', 'allmylinks', 'carrd'];
  if (includeNsfw) identitySources.push('stashdb', 'iafd', 'theporndb', 'fanvue', 'indexxx', 'boobpedia');
  if (btnPersonSearch) btnPersonSearch.disabled = true;
  personSection?.setAttribute('aria-busy', 'true');
  try {
    const planResponse = await fetch(`${API_BASE}/api/persons/${encodeURIComponent(selectedPersonId)}/search-plan?depth=${encodeURIComponent(depth)}`);
    const plan = await planResponse.json().catch(() => ({}));
    if (!planResponse.ok) throw new Error(plan.error || `HTTP ${planResponse.status}`);
    const sources = [...new Set([...(plan.sources || []), ...(includeNsfw ? adultSources : [])])];
    renderPersonPlan({ ...plan, sources });
    clearInterval(personSearchGalleryTimer);
    personSearchGalleryTimer = setInterval(() => {
      void loadPersonGallery(selectedPersonId, { silent: true });
    }, 1500);
    const response = await fetch(`${API_BASE}/api/persons/${encodeURIComponent(selectedPersonId)}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        depth,
        maxQueries: Math.max(1, Math.min(40, Number(personMaxQueries?.value || 10))),
        minScore: Number(personMinScore?.value || 35),
        sources: sources.join(','),
        identitySources: identitySources.join(','),
        adultConfirmed: includeNsfw && selected?.adultConfirmed === true,
        resolveIdentity: true
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Recherche Person Finder impossible.');
    addConsoleLog(`[PERSON] ${data.created || 0} médias liés; ${data.completedQueries || 0}/${data.queries?.length || 0} requêtes terminées${data.failedQueries ? `; ${data.failedQueries} échec(s)` : ''}.`, data.failedQueries ? 'warning' : 'success');
    await selectPerson(selectedPersonId);
  } catch (error) {
    addConsoleLog(`[PERSON] Recherche impossible : ${error.message}`, 'error');
    alert(error.message);
  } finally {
    clearInterval(personSearchGalleryTimer);
    personSearchGalleryTimer = null;
    personSection?.removeAttribute('aria-busy');
    updatePersonActions();
  }
}

async function validatePersonMedia(linkId, status) {
  if (!selectedPersonId) return;
  personSection?.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch(`${API_BASE}/api/persons/${encodeURIComponent(selectedPersonId)}/media/${encodeURIComponent(linkId)}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    await selectPerson(selectedPersonId);
  } catch (error) {
    addConsoleLog(`[PERSON] Validation média impossible : ${error.message}`, 'error');
  } finally {
    personSection?.removeAttribute('aria-busy');
    updatePersonActions();
  }
}

async function savePersonRule(event) {
  event.preventDefault();
  if (!selectedPersonId || !personRuleValue?.value.trim()) return;
  personRuleForm?.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch(`${API_BASE}/api/persons/${encodeURIComponent(selectedPersonId)}/validation/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        value: personRuleValue.value.trim(),
        type: personRuleType?.value || 'keyword',
        action: personRuleAction?.value || 'exclude'
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    personRuleValue.value = '';
    await selectPerson(selectedPersonId);
  } catch (error) {
    addConsoleLog(`[PERSON] Règle non enregistrée : ${error.message}`, 'error');
  } finally {
    personRuleForm?.removeAttribute('aria-busy');
    updatePersonActions();
  }
}

async function deletePersonRule(ruleId) {
  if (!selectedPersonId) return;
  personRuleForm?.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch(`${API_BASE}/api/persons/${encodeURIComponent(selectedPersonId)}/validation/rules/${encodeURIComponent(ruleId)}`, { method: 'DELETE' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    await selectPerson(selectedPersonId);
  } catch (error) {
    addConsoleLog(`[PERSON] Suppression de règle impossible : ${error.message}`, 'error');
  } finally {
    personRuleForm?.removeAttribute('aria-busy');
    updatePersonActions();
  }
}

if (personForm) personForm.addEventListener('submit', savePersonProfile);
if (btnPersonCancelEdit) btnPersonCancelEdit.addEventListener('click', resetPersonFormMode);
if (btnPersonRefresh) btnPersonRefresh.addEventListener('click', loadPersons);
if (btnPersonPlan) btnPersonPlan.addEventListener('click', previewPersonPlan);
if (btnPersonResolve) btnPersonResolve.addEventListener('click', resolvePersonIdentity);
if (btnPersonSearch) btnPersonSearch.addEventListener('click', runPersonSearch);
if (btnPersonReport) btnPersonReport.addEventListener('click', () => showPersonAnalysis('report'));
if (btnPersonGraph) btnPersonGraph.addEventListener('click', () => showPersonAnalysis('graph'));
if (btnPersonGalleryExport) btnPersonGalleryExport.addEventListener('click', () => {
  if (selectedPersonId) window.location.assign(`${API_BASE}/api/exports/person-gallery?personId=${encodeURIComponent(selectedPersonId)}&format=json`);
});
if (personDepth) personDepth.addEventListener('change', previewPersonPlan);
if (personRuleForm) personRuleForm.addEventListener('submit', savePersonRule);
let personGalleryFilterTimer = null;
[personGalleryQuery, personGalleryType, personGalleryStatus, personGallerySort].forEach(control => {
  if (!control) return;
  control.addEventListener(control === personGalleryQuery ? 'input' : 'change', () => {
    clearTimeout(personGalleryFilterTimer);
    personGalleryFilterTimer = setTimeout(() => void loadPersonGallery(), control === personGalleryQuery ? 250 : 0);
  });
});

function createSearchAbortError() {
  return new DOMException('Recherche annulée', 'AbortError');
}

function isSearchAbort(error, signal) {
  return signal?.aborted === true || error?.name === 'AbortError';
}

function isActiveSearch(token, signal) {
  return token === activeSearchToken && signal?.aborted !== true;
}

function assertActiveSearch(token, signal) {
  if (!isActiveSearch(token, signal)) throw createSearchAbortError();
}

function setSearchRunningState(running) {
  searchForm?.setAttribute('aria-busy', running ? 'true' : 'false');
  btnCancelSearch?.classList.toggle('hidden', !running);
  if (btnSearchSubmit) btnSearchSubmit.title = running ? 'Annuler la recherche active ou lancer une nouvelle recherche' : 'Lancer la recherche';
}

function beginSearchSession() {
  activeSearchController?.abort();
  refreshSearchController?.abort();
  refreshSearchController = null;
  const controller = new AbortController();
  const token = activeSearchToken + 1;
  activeSearchToken = token;
  activeSearchController = controller;
  setSearchRunningState(true);
  return { controller, token };
}

function cancelActiveSearch() {
  const hadActiveSearch = Boolean(activeSearchController && !activeSearchController.signal.aborted);
  activeSearchToken += 1;
  activeSearchController?.abort();
  refreshSearchController?.abort();
  activeSearchController = null;
  refreshSearchController = null;
  setSearchRunningState(false);
  document.querySelectorAll('.source-status-dot.loading').forEach(dot => {
    dot.className = 'source-status-dot idle';
    dot.title = 'Recherche annulée';
  });
  if (hadActiveSearch) {
    addConsoleLog('Recherche annulée. Les résultats déjà reçus sont conservés.', 'warning');
    applyFilters();
  }
}

function abortableDelay(delay, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(createSearchAbortError());
    const handleAbort = () => {
      clearTimeout(timeoutId);
      reject(createSearchAbortError());
    };
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, delay);
    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

if (btnCancelSearch) btnCancelSearch.addEventListener('click', cancelActiveSearch);

function getCurrentSearchConfig() {
  const checkedSources = [];
  document.querySelectorAll('.sources-list input[type="checkbox"]').forEach(cb => {
    if (cb.checked) checkedSources.push(cb.value);
  });

  return {
    query: searchInput.value.trim(),
    checkedSources,
    safeSearch: safeSearchToggle ? safeSearchToggle.checked : true,
    adultConfirmed: adultConfirmedToggle ? adultConfirmedToggle.checked : false,
    riskMode: safetyRiskMode ? safetyRiskMode.value : 'cautious',
    matchMode: searchMatchMode ? searchMatchMode.value : 'smart',
    exactMode: searchMatchMode ? searchMatchMode.value === 'strict' : false,
    accountMode: accountScrapeMode ? accountScrapeMode.value : 'complete',
    mediaKind: mediaKindMode ? mediaKindMode.value : 'both',
    sizeVal: document.getElementById('filter-size').value,
    typeVal: document.getElementById('filter-type').value,
    colorVal: ''
  };
}

function buildSearchUrl(config, sources) {
  const freshParams = config.fresh ? `&fresh=true&since=${encodeURIComponent(config.since || '')}` : '';
  return `${API_BASE}/api/search?q=${encodeURIComponent(config.query)}&sources=${encodeURIComponent(sources)}&safe=${config.safeSearch}&adultConfirmed=${config.adultConfirmed === true}&risk=${encodeURIComponent(config.riskMode)}&exact=${config.exactMode ? 'true' : 'false'}&mode=${encodeURIComponent(config.matchMode || (config.exactMode ? 'strict' : 'smart'))}&accountMode=${encodeURIComponent(config.accountMode || 'complete')}&media=${encodeURIComponent(config.mediaKind || 'both')}&record=false${freshParams}&size=${config.sizeVal}&type=${config.typeVal}&color=${config.colorVal}`;
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
  if (!lastSearchConfig || refreshInProgress || activeSearchController) return;
  refreshInProgress = true;
  const refreshController = new AbortController();
  refreshSearchController = refreshController;
  const refreshToken = activeSearchToken;
  const { signal } = refreshController;
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
        assertActiveSearch(refreshToken, signal);
        const response = await fetch(buildSearchUrl(config, source), { signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        assertActiveSearch(refreshToken, signal);
        mergeSearchData(data);
        if (data.status?.[source]) logSourceStatus(source, data.status[source]);
      } catch (error) {
        if (isSearchAbort(error, signal)) throw error;
        addConsoleLog(`[REFRESH:${source.toUpperCase()}] ${error.message}`, 'warning');
      }
    }

    if (queryWayback && refreshCycleCount % 3 === 0) {
      addConsoleLog('[REFRESH:WAYBACK] Scan Wayback espacé pour limiter les appels.', 'info');
      const hostResponse = await fetch(`${API_BASE}/api/wayback/hosts?q=${encodeURIComponent(config.query)}&risk=${encodeURIComponent(config.riskMode)}&safe=${config.safeSearch}&adultConfirmed=${config.adultConfirmed === true}`, { signal });
      const hostData = hostResponse.ok ? await hostResponse.json() : { domains: [] };
      const extractedDomains = extractTargetDomains((hostData.domains || []).map(domain => ({ url: `https://${domain}/` })), config.query);
      const waybackData = await fetchWaybackMachineCDX(config.query, extractedDomains, (partialData) => {
        if (isActiveSearch(refreshToken, signal)) mergeSearchData(partialData);
      }, signal);
      assertActiveSearch(refreshToken, signal);
      mergeSearchData(waybackData);
    }

    const addedImages = allImages.length - beforeImages;
    const addedVideos = allVideos.length - beforeVideos;
    addConsoleLog(`[REFRESH] Fin du cycle : +${Math.max(addedImages, 0)} photos, +${Math.max(addedVideos, 0)} vidéos.`, addedImages || addedVideos ? 'success' : 'info');
  } catch (error) {
    if (!isSearchAbort(error, signal)) addConsoleLog(`[REFRESH] Erreur : ${error.message}`, 'error');
  } finally {
    if (isActiveSearch(refreshToken, signal) && lastSearchConfig?.query === config.query) {
      lastSearchConfig.lastRefreshAt = refreshStartedAt;
      await persistCurrentSearchSnapshot();
    }
    if (refreshSearchController === refreshController) refreshSearchController = null;
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
  const exact = (items || []).filter(item => {
    const key = item && (item.visualSignature || item.url || item.thumbnail || item.link);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const kept = [];
  exact.forEach(item => {
    const duplicateIndex = item.perceptualHash
      ? kept.findIndex(candidate => candidate.perceptualHash && perceptualHammingDistance(item.perceptualHash, candidate.perceptualHash) <= 6)
      : -1;
    if (duplicateIndex === -1) {
      kept.push(item);
      return;
    }
    const current = kept[duplicateIndex];
    const pixels = media => (Number(media.width) || 0) * (Number(media.height) || 0);
    if (pixels(item) > pixels(current)) kept[duplicateIndex] = item;
  });
  return kept;
}

function perceptualHammingDistance(left, right) {
  if (!/^[a-f0-9]{16}$/i.test(left || '') || !/^[a-f0-9]{16}$/i.test(right || '')) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < 16; index += 1) {
    let value = parseInt(left[index], 16) ^ parseInt(right[index], 16);
    while (value) {
      distance += value & 1;
      value >>= 1;
    }
  }
  return distance;
}

async function computeImageDHash(url) {
  if (perceptualHashCache.has(url)) return perceptualHashCache.get(url);
  try {
    const response = await fetch(`${API_BASE}/api/proxy?url=${encodeURIComponent(url)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement('canvas');
    canvas.width = 9;
    canvas.height = 8;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, 9, 8);
    bitmap.close();
    const pixels = context.getImageData(0, 0, 9, 8).data;
    let hash = 0n;
    for (let row = 0; row < 8; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        const offset = (row * 9 + column) * 4;
        const nextOffset = offset + 4;
        const luminance = pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114;
        const nextLuminance = pixels[nextOffset] * 0.299 + pixels[nextOffset + 1] * 0.587 + pixels[nextOffset + 2] * 0.114;
        hash = (hash << 1n) | (luminance > nextLuminance ? 1n : 0n);
      }
    }
    const value = hash.toString(16).padStart(16, '0');
    perceptualHashCache.set(url, value);
    return value;
  } catch {
    perceptualHashCache.set(url, '');
    return '';
  }
}

async function enrichPerceptualHashes() {
  if (perceptualPassRunning) return;
  const candidates = allImages.filter(item => !item.perceptualHash && safeHttpUrl(item.url || item.thumbnail)).slice(0, 60);
  if (!candidates.length) return;
  perceptualPassRunning = true;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(3, candidates.length) }, async () => {
    while (cursor < candidates.length) {
      const item = candidates[cursor];
      cursor += 1;
      item.perceptualHash = await computeImageDHash(item.url || item.thumbnail);
    }
  });
  await Promise.allSettled(workers);
  perceptualPassRunning = false;
  allImages = dedupeMedia(allImages);
  applyFilters();
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
  if (score >= 80) return 'high';
  if (score >= 55) return 'medium';
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
      skipped: Boolean(status.skipped),
      adapter: status.adapter || '',
      note: status.note || status.error || '',
      zeroReason: status.zeroReason || '',
      imagesCount: status.imagesCount || 0,
      videosCount: status.videosCount || 0,
      pagesDiscovered: status.pagesDiscovered || 0,
      pagesCrawled: status.pagesCrawled || 0,
      directReachable: status.directReachable !== false,
      fallbackUsed: Boolean(status.fallbackUsed),
      available: status.available !== false,
      updatedAt: new Date().toISOString()
    };
  });
}

function recordSourceFetchError(source, error) {
  sourceDiagnostics[source] = {
    success: false,
    skipped: false,
    adapter: '',
    note: error?.message || String(error || 'Erreur réseau'),
    zeroReason: 'fetch-error',
    imagesCount: 0,
    videosCount: 0,
    pagesDiscovered: 0,
    pagesCrawled: 0,
    directReachable: false,
    fallbackUsed: false,
    available: false,
    fetchError: true,
    updatedAt: new Date().toISOString()
  };
  renderInsights();
}

function normalizeAliasKey(value) {
  return normalizeSearchTerm(String(value || '').replace(/^@/, '')).replace(/[^a-z0-9]+/g, '');
}

function aliasCandidateLocalKey(candidate = {}, query = '') {
  candidate = candidate || {};
  const scope = normalizeAliasKey(candidate.query || query || currentSearchQuery || searchInput?.value || 'global');
  const kind = candidate.kind === 'username' ? 'username' : 'display_name';
  return `${scope}:${kind}:${normalizeAliasKey(candidate.value)}`;
}

function aliasStatusLabel(status) {
  return {
    to_review: 'A verifier',
    probable: 'Probable',
    confirmed: 'Confirme',
    rejected: 'Rejete',
    merged: 'Fusionne'
  }[status] || 'A verifier';
}

function aliasEvidenceHtml(candidate) {
  const evidence = [...new Set(candidate?.evidence || [])].slice(0, 8);
  if (!evidence.length) return '<span>Aucune preuve detaillee disponible.</span>';
  return evidence.map(item => {
    const url = safeHttpUrl(item);
    return url
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`
      : `<span>${escapeHtml(item)}</span>`;
  }).join('');
}

function mergePersistedAliasCandidates(candidates = []) {
  const persisted = new Map(candidates.map(candidate => [aliasCandidateLocalKey(candidate, candidate.query), candidate]));
  candidates.filter(candidate => candidate.status === 'rejected').forEach(candidate => {
    rejectedAliasKeys.add(aliasCandidateLocalKey(candidate, candidate.query));
  });
  localStorage.setItem('mediagatherer_alias_rejections', JSON.stringify([...rejectedAliasKeys]));
  currentAliases = currentAliases.map(alias => {
    const candidate = persisted.get(aliasCandidateLocalKey(alias, alias.query));
    return candidate ? { ...alias, ...candidate } : alias;
  }).filter(alias => alias.status !== 'rejected' && !rejectedAliasKeys.has(aliasCandidateLocalKey(alias, alias.query)));
  if (selectedAliasCandidate) {
    selectedAliasCandidate = currentAliases.find(alias => aliasCandidateLocalKey(alias, alias.query) === aliasCandidateLocalKey(selectedAliasCandidate, selectedAliasCandidate.query)) || null;
  }
}

function scheduleAliasCandidatePersistence(candidates = [], query = '') {
  candidates.forEach(candidate => {
    const row = { ...candidate, query: candidate.query || query || currentSearchQuery };
    if (!row.value || row.status === 'rejected') return;
    pendingAliasCandidates.set(aliasCandidateLocalKey(row, row.query), row);
  });
  clearTimeout(aliasCandidatePersistTimer);
  aliasCandidatePersistTimer = setTimeout(async () => {
    const rows = [...pendingAliasCandidates.values()];
    pendingAliasCandidates.clear();
    aliasCandidatePersistTimer = null;
    if (!rows.length) return;
    try {
      const response = await fetch(`${API_BASE}/api/aliases/candidates/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query || currentSearchQuery, candidates: rows })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      mergePersistedAliasCandidates(data.candidates || []);
      renderInsights();
    } catch (error) {
      addConsoleLog(`[ALIAS] Sauvegarde differee impossible : ${error.message}`, 'warning');
    }
  }, 450);
}

function setAliasActionStatus(message, type = 'info') {
  aliasActionFeedback = message ? { message, type } : null;
  const status = aliasActionPanel?.querySelector('[data-alias-action-status]');
  if (!status) return;
  status.textContent = message;
  status.className = `alias-action-status ${type}`;
}

function selectAliasCandidate(candidate) {
  const changed = aliasCandidateLocalKey(candidate, candidate?.query) !== aliasCandidateLocalKey(selectedAliasCandidate, selectedAliasCandidate?.query);
  if (changed) aliasActionFeedback = null;
  selectedAliasCandidate = candidate || null;
  renderInsights();
  if (selectedAliasCandidate) {
    aliasActionPanel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    addConsoleLog(`[ALIAS] ${selectedAliasCandidate.value} selectionne.`, 'info');
  }
}

async function persistAliasCandidateStatus(candidate, status, extra = {}) {
  const request = candidate.id
    ? fetch(`${API_BASE}/api/aliases/candidates/${encodeURIComponent(candidate.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ...extra })
      })
    : fetch(`${API_BASE}/api/aliases/candidates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...candidate, query: candidate.query || currentSearchQuery, status, ...extra })
      });
  const response = await request;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  mergePersistedAliasCandidates([data]);
  return data;
}

async function launchAliasSearch(candidate, append = false) {
  if (!candidate?.value) return;
  const parentQuery = currentSearchQuery || searchInput.value.trim();
  setActiveTab('search');
  searchInput.value = candidate.value;
  if (!append) {
    addConsoleLog(`[ALIAS] Nouvelle recherche : ${candidate.value}`, 'info');
    searchForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    searchForm.requestSubmit();
    return;
  }
  setAliasActionStatus(`Recherche de ${candidate.value} en cours...`);
  aliasActionPanel?.querySelectorAll('button, select').forEach(control => { control.disabled = true; });
  try {
    await runSearchWithCurrentControls({ append: true, aliasOf: parentQuery });
    try {
      const persisted = await persistAliasCandidateStatus(candidate, 'merged');
      selectedAliasCandidate = persisted;
      renderInsights();
    } catch (error) {
      addConsoleLog(`[ALIAS] Fusion effectuee, statut non sauvegarde : ${error.message}`, 'warning');
    }
    setAliasActionStatus(`Resultats de ${candidate.value} ajoutes a ${parentQuery}.`, 'success');
    addConsoleLog(`[ALIAS] Resultats de ${candidate.value} fusionnes.`, 'success');
  } finally {
    aliasActionPanel?.querySelectorAll('button, select').forEach(control => { control.disabled = false; });
  }
}

function prefillPersonFromAlias(candidate) {
  setActiveTab('persons');
  if (personName && !personName.value) personName.value = currentSearchQuery || candidate.value;
  const target = candidate.kind === 'username' ? personUsernames : personAliases;
  if (target) {
    const values = splitPersonLines(target.value);
    const cleanValue = candidate.kind === 'username' ? candidate.value.replace(/^@/, '') : candidate.value;
    target.value = [...new Set([...values, cleanValue])].join('\n');
  }
  personForm?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  target?.focus();
  addConsoleLog(`[ALIAS] ${candidate.value} prepare dans une nouvelle fiche Person Finder.`, 'success');
}

async function addAliasCandidateToPerson(candidate) {
  if (!candidate?.value) return;
  const select = aliasActionPanel?.querySelector('[data-alias-person-select]');
  const personId = select?.value || selectedPersonId || '';
  if (!personId) {
    prefillPersonFromAlias(candidate);
    return;
  }
  setAliasActionStatus('Ajout a Person Finder...');
  try {
    const response = await fetch(`${API_BASE}/api/persons/${encodeURIComponent(personId)}/aliases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alias: candidate.value,
        kind: candidate.kind,
        status: 'to_review',
        confidence: candidate.confidence,
        sources: candidate.sources,
        evidence: candidate.evidence,
        query: candidate.query || currentSearchQuery
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (data.person) {
      personProfiles = personProfiles.map(person => person.id === data.person.id ? data.person : person);
      localStorage.setItem('mediagatherer_persons', JSON.stringify(personProfiles));
    }
    setAliasActionStatus(`${candidate.value} ajoute comme candidat a verifier.`, 'success');
    addConsoleLog(`[ALIAS] ${candidate.value} envoye vers Person Finder.`, 'success');
  } catch (error) {
    setAliasActionStatus(`Ajout impossible : ${error.message}`, 'error');
  }
}

async function rejectAliasCandidate(candidate) {
  if (!candidate?.value) return;
  try {
    await persistAliasCandidateStatus(candidate, 'rejected');
  } catch (error) {
    addConsoleLog(`[ALIAS] Rejet conserve localement : ${error.message}`, 'warning');
  }
  const key = aliasCandidateLocalKey(candidate, candidate.query);
  rejectedAliasKeys.add(key);
  localStorage.setItem('mediagatherer_alias_rejections', JSON.stringify([...rejectedAliasKeys]));
  currentAliases = currentAliases.filter(alias => aliasCandidateLocalKey(alias, alias.query) !== key);
  selectedAliasCandidate = null;
  renderInsights();
  addConsoleLog(`[ALIAS] ${candidate.value} rejete pour cette recherche.`, 'success');
}

function renderAliasActionPanel() {
  if (!aliasActionPanel) return;
  const candidate = selectedAliasCandidate;
  if (!candidate) {
    aliasActionPanel.classList.add('hidden');
    aliasActionPanel.innerHTML = '';
    return;
  }
  const personOptions = personProfiles.map(person => `<option value="${escapeHtml(person.id)}" ${person.id === selectedPersonId ? 'selected' : ''}>${escapeHtml(person.displayName || person.name)}</option>`).join('');
  aliasActionPanel.innerHTML = `
    <div class="alias-action-head">
      <div>
        <strong>${escapeHtml(candidate.value)}</strong>
        <div class="alias-action-meta">${escapeHtml(candidate.kind === 'username' ? 'Username public' : 'Nom public')} · confiance ${Number(candidate.confidence || 0)}% · ${escapeHtml(aliasStatusLabel(candidate.status))}</div>
      </div>
      <button type="button" class="icon-btn" data-alias-close aria-label="Fermer les actions alias" title="Fermer"><i data-lucide="x"></i></button>
    </div>
    <div class="alias-action-buttons">
      <button type="button" class="btn btn-primary btn-small" data-alias-search><i data-lucide="search"></i><span>Rechercher</span></button>
      <button type="button" class="btn btn-secondary btn-small" data-alias-append><i data-lucide="list-plus"></i><span>Ajouter aux resultats</span></button>
      <button type="button" class="btn btn-secondary btn-small" data-alias-reject><i data-lucide="ban"></i><span>Rejeter</span></button>
    </div>
    <div class="alias-person-action">
      ${personOptions ? `<select data-alias-person-select aria-label="Fiche Person Finder cible">${personOptions}</select>` : '<span class="alias-action-meta">Aucune fiche Person Finder.</span>'}
      <button type="button" class="btn btn-secondary btn-small" data-alias-person><i data-lucide="user-plus"></i><span>${personOptions ? 'Ajouter a Person Finder' : 'Preparer une fiche'}</span></button>
    </div>
    <details class="alias-evidence">
      <summary><i data-lucide="file-search"></i><span>Preuves et sources (${(candidate.evidence || []).length})</span></summary>
      <div class="alias-evidence-list">${aliasEvidenceHtml(candidate)}</div>
    </details>
    <div class="alias-action-status ${escapeHtml(aliasActionFeedback?.type || 'info')}" data-alias-action-status>${escapeHtml(aliasActionFeedback?.message || '')}</div>
  `;
  aliasActionPanel.classList.remove('hidden');
  aliasActionPanel.querySelector('[data-alias-close]')?.addEventListener('click', () => selectAliasCandidate(null));
  aliasActionPanel.querySelector('[data-alias-search]')?.addEventListener('click', () => launchAliasSearch(candidate, false));
  aliasActionPanel.querySelector('[data-alias-append]')?.addEventListener('click', () => launchAliasSearch(candidate, true));
  aliasActionPanel.querySelector('[data-alias-person]')?.addEventListener('click', () => addAliasCandidateToPerson(candidate));
  aliasActionPanel.querySelector('[data-alias-reject]')?.addEventListener('click', () => rejectAliasCandidate(candidate));
  lucide.createIcons();
}

function updateAliases(data, options = {}) {
  const map = new Map(currentAliases.map(alias => [`${alias.kind === 'username' ? 'username' : 'display_name'}:${normalizeAliasKey(alias.value)}`, alias]));
  (data.aliases || []).forEach(alias => {
    const normalizedValue = normalizeAliasKey(alias.value);
    if (!normalizedValue) return;
    const key = `${alias.kind === 'username' ? 'username' : 'display_name'}:${normalizedValue}`;
    const query = alias.query || data.query || currentSearchQuery || searchInput?.value || '';
    if (rejectedAliasKeys.has(aliasCandidateLocalKey(alias, query))) return;
    const existing = map.get(key) || { value: alias.value, kind: alias.kind || 'display_name', count: 0, sources: [], evidence: [], confidence: 0, query };
    existing.sources = [...new Set([...(existing.sources || []), ...(alias.sources || [])])].slice(0, 6);
    existing.evidence = [...new Set([...(existing.evidence || []), ...(alias.evidence || [])])].slice(0, 4);
    existing.confidence = Math.max(existing.confidence || 0, alias.confidence || 0);
    existing.count = Math.max(existing.count || 0, alias.count || 1, existing.sources.length, existing.evidence.length);
    existing.id = alias.id || existing.id;
    existing.status = alias.status || existing.status || 'to_review';
    existing.personId = alias.personId || existing.personId || null;
    existing.query = query;
    existing.kind = alias.kind === 'username' ? 'username' : 'display_name';
    map.set(key, existing);
  });
  currentAliases = [...map.values()].sort((a, b) => (b.confidence || 0) - (a.confidence || 0) || b.count - a.count).slice(0, 24);
  if (!options.skipPersist && data.aliases?.length) scheduleAliasCandidatePersistence(data.aliases, data.query || currentSearchQuery);
}

function diagnosticState(item) {
  const total = Number(item.imagesCount || 0) + Number(item.videosCount || 0);
  if (total > 0) return 'results';
  if (!item.success && !item.skipped) return 'errors';
  return 'attention';
}

function sourceDisplayName(source) {
  const chip = document.getElementById(`src-${source}`)?.closest('.source-chip');
  return chip ? chip.textContent.replace('(18+)', '').replace(/\s+/g, ' ').trim() : source;
}

function renderSourceDiagnostics() {
  if (!sourceDiagnosticList) return;
  const allEntries = Object.entries(sourceDiagnostics);
  const selectedFilter = sourceDiagnosticFilter?.value || 'all';
  const entries = allEntries
    .filter(([, item]) => selectedFilter === 'all' || diagnosticState(item) === selectedFilter)
    .sort(([, a], [, b]) => {
      const order = { errors: 0, attention: 1, results: 2 };
      return order[diagnosticState(a)] - order[diagnosticState(b)];
    });
  const resultCount = allEntries.filter(([, item]) => diagnosticState(item) === 'results').length;
  const issueCount = allEntries.length - resultCount;
  if (sourceDiagnosticSummary) {
    sourceDiagnosticSummary.textContent = `${allEntries.length} testées · ${resultCount} avec médias · ${issueCount} à vérifier`;
  }
  sourceDiagnosticList.innerHTML = entries.length
    ? entries.map(([source, item]) => {
      const state = diagnosticState(item);
      const stateClass = state === 'results' ? (item.fallbackUsed ? 'warning' : 'ok') : (state === 'errors' ? 'fail' : 'warning');
      const statusText = item.skipped ? 'Configuration ou SafeSearch requis' : (item.note || item.zeroReason || (state === 'results' ? 'Médias publics extraits' : 'Aucun média public correspondant'));
      return `
        <div class="diagnostic-row ${stateClass} ${getSourceGroup(source) === 'nsfw' ? 'source-group-nsfw' : ''}" data-diagnostic-state="${state}">
          <div class="diagnostic-row-main">
            <strong>${escapeHtml(sourceDisplayName(source))}</strong>
            <span>${item.imagesCount || 0} photos · ${item.videosCount || 0} vidéos</span>
          </div>
          ${item.adapter ? `<small>${escapeHtml(item.adapter)} · ${item.pagesCrawled}/${item.pagesDiscovered} pages ouvertes${item.fallbackUsed ? ' · repli actif' : ''}</small>` : ''}
          <small>${escapeHtml(statusText)}</small>
        </div>`;
    }).join('')
    : `<div class="muted-line">${allEntries.length ? 'Aucune source dans ce filtre.' : 'Aucun diagnostic encore disponible.'}</div>`;
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
      ? currentAliases.map((alias, index) => `
        <button type="button" class="alias-chip ${alias === selectedAliasCandidate || aliasCandidateLocalKey(alias, alias.query) === aliasCandidateLocalKey(selectedAliasCandidate, selectedAliasCandidate?.query) ? 'active' : ''}" data-alias-index="${index}" aria-pressed="${alias === selectedAliasCandidate ? 'true' : 'false'}">
          ${escapeHtml(alias.value)}
          <span>${Number(alias.confidence || 0)}% · ${(alias.sources || []).length || alias.count} src</span>
        </button>
      `).join('')
      : '<div class="muted-line">Aucun alias inféré pour le moment.</div>';
    aliasList.querySelectorAll('[data-alias-index]').forEach(btn => {
      btn.addEventListener('click', () => selectAliasCandidate(currentAliases[Number(btn.dataset.aliasIndex)]));
    });
  }

  renderAliasActionPanel();

  renderSourceDiagnostics();

  insightsDashboard.classList.remove('hidden');
  lucide.createIcons();
}

if (sourceDiagnosticFilter) sourceDiagnosticFilter.addEventListener('change', renderSourceDiagnostics);

function mergeHistoryEntries(...lists) {
  const merged = lists.flat().filter(item => item?.query).sort((a, b) => new Date(b.createdAt || b.at || 0) - new Date(a.createdAt || a.at || 0));
  const rows = [];
  for (const item of merged) {
    const itemTime = new Date(item.createdAt || item.at || 0).getTime();
    const duplicateIndex = rows.findIndex(existing => existing.id === item.id || (
      normalizeSearchTerm(existing.query) === normalizeSearchTerm(item.query) &&
      Math.abs(new Date(existing.createdAt || existing.at || 0).getTime() - itemTime) < 30000
    ));
    if (duplicateIndex === -1) {
      rows.push(item);
      continue;
    }
    const currentTotal = Number(rows[duplicateIndex].imagesCount || rows[duplicateIndex].images || 0) + Number(rows[duplicateIndex].videosCount || rows[duplicateIndex].videos || 0);
    const candidateTotal = Number(item.imagesCount || item.images || 0) + Number(item.videosCount || item.videos || 0);
    if (candidateTotal > currentTotal) rows[duplicateIndex] = item;
  }
  return rows.slice(0, 200);
}

async function recordCompletedSearch(config = lastSearchConfig, counts = {}, signal = null) {
  const fallback = {
    id: `local-${Date.now()}`,
    query: config?.query || currentSearchQuery,
    sources: config?.checkedSources || [],
    imagesCount: Number(counts.imagesCount ?? allImages.length),
    videosCount: Number(counts.videosCount ?? allVideos.length),
    options: config,
    createdAt: new Date().toISOString(),
    localOnly: true
  };
  let item = fallback;
  try {
    const response = await fetch(`${API_BASE}/api/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fallback, id: undefined, localOnly: undefined }),
      signal
    });
    if (response.ok) item = await response.json();
  } catch (error) {
    if (signal?.aborted) throw createSearchAbortError();
    // The browser copy remains durable for this device.
  }
  searchHistory = mergeHistoryEntries([item], searchHistory);
  localStorage.setItem('mediagatherer_history', JSON.stringify(searchHistory));
}

async function refreshSearchHistory() {
  try {
    const response = await fetch(`${API_BASE}/api/history`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    searchHistory = mergeHistoryEntries(data.items || [], searchHistory);
    localStorage.setItem('mediagatherer_history', JSON.stringify(searchHistory));
  } catch {
    // The local copy remains an offline fallback.
  }
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
          <span>${new Date(item.createdAt || item.at).toLocaleString()} · ${item.imagesCount ?? item.images ?? 0} photos · ${item.videosCount ?? item.videos ?? 0} vidéos</span>
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
      restoreSearchConfig(entry.config || {
        query: entry.query,
        checkedSources: entry.sources || [],
        safeSearch: entry.options?.safe !== false,
        riskMode: entry.options?.riskMode,
        matchMode: entry.options?.matchMode,
        mediaKind: entry.options?.mediaKind
      });
      searchForm.requestSubmit();
    });
  });
  lucide.createIcons();
}

function restoreSearchConfig(config = {}) {
  if (config.query) searchInput.value = config.query;
  if (safeSearchToggle && typeof config.safeSearch === 'boolean') safeSearchToggle.checked = config.safeSearch;
  if (adultConfirmedToggle && typeof config.adultConfirmed === 'boolean') adultConfirmedToggle.checked = config.adultConfirmed;
  if (safetyRiskMode && config.riskMode) safetyRiskMode.value = config.riskMode;
  if (searchMatchMode) searchMatchMode.value = config.matchMode || (config.exactMode === true ? 'strict' : 'smart');
  if (accountScrapeMode && config.accountMode) accountScrapeMode.value = config.accountMode;
  if (mediaKindMode && config.mediaKind) mediaKindMode.value = config.mediaKind;
  document.querySelectorAll('.sources-list input[type="checkbox"]').forEach(cb => {
    cb.checked = (config.checkedSources || []).includes(cb.value);
  });
  setNsfwVisibility();
  updateSourceDrawerCounts();
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

function updateBatchControls() {
  const active = Boolean(activeBatchJobId) && !['done', 'cancelled'].includes(activeBatchJob?.status);
  btnBatchRun?.classList.toggle('hidden', active);
  btnBatchPause?.classList.toggle('hidden', !active || batchPaused);
  btnBatchResume?.classList.toggle('hidden', !active || !batchPaused);
  btnBatchCancel?.classList.toggle('hidden', !active);
  if (btnBatchClear) btnBatchClear.disabled = active;
}

function syncBatchQueueFromJob(job) {
  activeBatchJob = job;
  const results = job?.results || [];
  const errors = job?.errors || [];
  batchQueue.forEach((item, index) => {
    const result = [...results].reverse().find(entry => entry.query === item.query);
    const error = [...errors].reverse().find(entry => entry.query === item.query);
    if (result) item.status = `${result.imagesCount} photos · ${result.videosCount} vidéos`;
    else if (error) item.status = `erreur: ${error.error}`;
    else if (index < Number(job?.completed || 0)) item.status = 'terminé';
    else if (job?.status === 'paused') item.status = 'en pause';
    else if (job?.status === 'cancelled') item.status = 'annulé';
    else item.status = `en attente · ${Number(job?.completed || 0)}/${Number(job?.total || batchQueue.length)}`;
  });
  renderBatchQueue();
  updateBatchControls();
}

async function continueBatchJob(initialAction = 'resume') {
  if (!activeBatchJobId || batchLoopActive || batchPaused || batchCancelled) return;
  batchLoopActive = true;
  let action = initialAction;
  try {
    while (activeBatchJobId && !batchPaused && !batchCancelled) {
      const response = await fetch(`${API_BASE}/api/queue/jobs/${encodeURIComponent(activeBatchJobId)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxItems: 1 })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      syncBatchQueueFromJob(data.job);
      if (['done', 'cancelled', 'paused'].includes(data.job?.status)) break;
      action = 'resume';
      await new Promise(resolve => setTimeout(resolve, 120));
    }
  } catch (error) {
    batchQueue.forEach(item => {
      if (/en attente|en cours/.test(item.status || '')) item.status = `erreur: ${error.message}`;
    });
    addConsoleLog(`[BATCH] Traitement interrompu : ${error.message}`, 'error');
    renderBatchQueue();
  } finally {
    batchLoopActive = false;
    if (['done', 'cancelled'].includes(activeBatchJob?.status) || batchCancelled) {
      activeBatchJobId = null;
      batchPaused = false;
      batchCancelled = false;
    }
    updateBatchControls();
  }
}

async function runBatchQueue() {
  if (batchQueue.length === 0) return;
  const config = getCurrentSearchConfig();
  batchQueue.forEach(item => { item.status = 'en attente serveur'; });
  renderBatchQueue();
  try {
    const createResponse = await fetch(`${API_BASE}/api/queue/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: batchQueue.map(item => item.query), sources: config.checkedSources.filter(source => source !== 'wayback').join(','), safe: config.safeSearch, adultConfirmed: config.adultConfirmed === true, media: config.mediaKind, mode: config.matchMode })
    });
    const job = await createResponse.json();
    if (!createResponse.ok) throw new Error(job.error || `HTTP ${createResponse.status}`);
    activeBatchJobId = job.id;
    activeBatchJob = job;
    batchPaused = false;
    batchCancelled = false;
    syncBatchQueueFromJob(job);
    await continueBatchJob('start');
  } catch (error) {
    batchQueue.forEach(item => { if (item.status === 'en cours' || item.status === 'en attente serveur') item.status = `erreur: ${error.message}`; });
  }
  renderBatchQueue();
}

async function setBatchJobAction(action) {
  if (!activeBatchJobId) return;
  if (action === 'resume') {
    batchPaused = false;
    updateBatchControls();
    await continueBatchJob('resume');
    return;
  }
  if (action === 'pause') batchPaused = true;
  if (action === 'cancel') batchCancelled = true;
  try {
    const response = await fetch(`${API_BASE}/api/queue/jobs/${encodeURIComponent(activeBatchJobId)}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    syncBatchQueueFromJob(data.job);
    if (action === 'cancel') activeBatchJobId = null;
  } catch (error) {
    addConsoleLog(`[BATCH] Action ${action} impossible : ${error.message}`, 'error');
    if (action === 'pause') batchPaused = false;
    if (action === 'cancel') batchCancelled = false;
  } finally {
    updateBatchControls();
  }
}

async function saveMonitor() {
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
  try {
    const response = await fetch(`${API_BASE}/api/monitors`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(monitor) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const saved = await response.json();
    savedMonitors = [saved, ...savedMonitors.filter(item => item.id !== saved.id)].slice(0, 50);
    localStorage.setItem('mediagatherer_monitors', JSON.stringify(savedMonitors));
    renderMonitors();
  } catch (error) {
    addConsoleLog(`[VEILLE] Sauvegarde impossible : ${error.message}`, 'error');
  }
}

async function loadMonitors() {
  try {
    const response = await fetch(`${API_BASE}/api/monitors`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const serverItems = (await response.json()).items || [];
    savedMonitors = [...serverItems, ...savedMonitors].filter((item, index, rows) => index === rows.findIndex(candidate => candidate.id === item.id || candidate.query === item.query)).slice(0, 50);
    localStorage.setItem('mediagatherer_monitors', JSON.stringify(savedMonitors));
  } catch {
    // Keep offline fallback.
  }
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
          <span>${item.lastImages || 0} photos · ${item.lastVideos || 0} vidéos · ${item.lastRunAt ? new Date(item.lastRunAt).toLocaleString() : 'jamais'}</span>
        </div>
        <button type="button" class="btn btn-secondary btn-small" data-monitor-run="${escapeHtml(item.id)}">
          <i data-lucide="refresh-cw"></i><span>Vérifier</span>
        </button>
      </div>
    `).join('')
    : '<div class="muted-line">Aucune veille sauvegardée.</div>';
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

function mergeSearchData(data, options = {}) {
  updateSourceDiagnostics(data);
  updateAliases(data);
  allImages = dedupeMedia([...allImages, ...prepareMediaItems(data.images || [])]).sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  allVideos = dedupeMedia([...allVideos, ...prepareMediaItems(data.videos || [])]).sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  statsBar.classList.remove('hidden');
  registerDetectedAccounts(data);
  renderInsights();
  applyFilters();
  logFilterDiagnostics(data);
  void enrichPerceptualHashes();
  if (!options.skipSnapshot) scheduleSearchSnapshotSave();
}

function logFilterDiagnostics(data) {
  const diagnostics = data?.filterDiagnostics;
  if (!diagnostics) return;
  const rejected = Number(diagnostics.rejectedByRelevance || 0);
  const mediaFiltered = Number(diagnostics.rejectedByMediaFilters || 0);
  if (!rejected && !mediaFiltered) return;
  addConsoleLog(
    `[FILTRE] ${diagnostics.mode} (${diagnostics.threshold}%): ${diagnostics.retainedImages || 0} photos et ${diagnostics.retainedVideos || 0} vidéos retenues; ${rejected} hors pertinence${mediaFiltered ? `; ${mediaFiltered} hors filtres média` : ''}.`,
    'info'
  );
}

function logSourceStatus(source, status) {
  const sourceName = source.toUpperCase();
  const isZero = (Number(status.imagesCount || 0) + Number(status.videosCount || 0)) === 0;
  const accountsCount = Array.isArray(status.accounts) ? status.accounts.length : 0;
  const accountsSuffix = accountsCount ? ` ${accountsCount} page${accountsCount > 1 ? 's' : ''} ou compte${accountsCount > 1 ? 's' : ''} public${accountsCount > 1 ? 's' : ''} détecté${accountsCount > 1 ? 's' : ''}.` : '';
  if (status.success) {
    updateSourceStatusDot(source, isZero ? 'warning' : 'success');
    const noteSuffix = status.note ? ` - ${status.note}` : '';
    const logType = isZero ? 'warning' : 'success';
    addConsoleLog(`[${sourceName}] ${isZero ? 'Aucun média direct' : 'Succès'} : ${status.imagesCount || 0} photos, ${status.videosCount || 0} vidéos trouvées.${accountsSuffix}${noteSuffix}`, logType);
  } else {
    updateSourceStatusDot(source, 'error');
    addConsoleLog(`[${sourceName}] ${status.skipped ? 'Ignoré' : 'Échec'} : ${status.error || 'source indisponible'}`, status.skipped ? 'warning' : 'error');
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
    const accountHosts = ['t.me', 'telegram.me', 'x.com', 'twitter.com', 'tumblr.com', 'erome.com', 'redgifs.com', 'flickr.com', 'reddit.com', 'instagram.com', 'tiktok.com', 'onlyfans.com', 'fansly.com', 'mym.fans', 'github.com', 'lemmy.world', 'pixelfed.social', 'odysee.com', 'fanvue.com', 'chaturbate.com', 'stripchat.com', 'camsoda.com', 'livejasmin.com', 'indexxx.com', 'boobpedia.com'];
    const normalizedHost = host.replace(/^www\./, '');
    if (!accountHosts.some(accountHost => normalizedHost === accountHost || normalizedHost.endsWith(`.${accountHost}`))) return '';
    const firstSegment = parsed.pathname.split('/').filter(Boolean)[0];
    if (!firstSegment || ['search', 'results', 'watch', 'video', 'videos', 'embed'].includes(firstSegment.toLowerCase()) || /^(?:video|watch|embed|hdporn)(?:[-_]|$)/i.test(firstSegment)) return '';
    return `${parsed.protocol}//${parsed.hostname}/${firstSegment}`;
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

  const accountHosts = ['t.me', 'telegram.me', 'x.com', 'twitter.com', 'tumblr.com', 'erome.com', 'redgifs.com', 'flickr.com', 'reddit.com', 'babepedia.com', 'camwhores.tv', 'pornzog.com', 'onlyfans.com', 'fansly.com', 'mym.fans', 'pornhub.com', 'youporn.com', 'tube8.com', 'tnaflix.com', 'motherless.com', 'eporner.com', 'xnxx.com', 'hqporner.com', 'nuvid.com', 'drtuber.com', 'pornone.com', 'youjizz.com', 'github.com', 'lemmy.world', 'pixelfed.social', 'odysee.com', 'fanvue.com', 'chaturbate.com', 'stripchat.com', 'camsoda.com', 'livejasmin.com', 'indexxx.com', 'boobpedia.com'];
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
      existing.count = Math.max(existing.count || 0, count);
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
        <span class="account-count">${account.type || 'domain'} · ${account.count || 0} médias liés</span>
      </div>
      <div class="account-actions">
        <a href="${escapeHtml(safeHttpUrl(account.url))}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-small" title="Ouvrir" aria-label="Ouvrir le compte public">
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
    addConsoleLog(`[COMPTE] Aspiration ciblée : ${accountUrl}`, 'info');
    const safeSearch = safeSearchToggle ? safeSearchToggle.checked : true;
    const riskMode = safetyRiskMode ? safetyRiskMode.value : 'cautious';
    const accountMode = accountScrapeMode ? accountScrapeMode.value : 'complete';
    const mediaKind = mediaKindMode ? mediaKindMode.value : 'both';
    const response = await fetch(`${API_BASE}/api/account/scrape?url=${encodeURIComponent(accountUrl)}&q=${encodeURIComponent(currentSearchQuery)}&safe=${safeSearch}&adultConfirmed=${adultConfirmedToggle?.checked === true}&risk=${encodeURIComponent(riskMode)}&accountMode=${encodeURIComponent(accountMode)}&media=${encodeURIComponent(mediaKind)}`);
    if (!response.ok) throw new Error(`Erreur serveur (${response.status})`);
    const data = await response.json();
    mergeSearchData(data);
    addConsoleLog(`[COMPTE] ${accountUrl} : ${(data.images || []).length} photos, ${(data.videos || []).length} vidéos ajoutées.`, 'success');
  } catch (error) {
    addConsoleLog(`[COMPTE] Échec sur ${accountUrl} : ${error.message}`, 'error');
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
    'bing.com',
    'mm.bing.net',
    'google.com',
    'gstatic.com',
    'googleusercontent.com',
    'search.brave.com',
    'web.archive.org',
    'archive.org',
    'upload.wikimedia.org',
    'wikimedia.org',
    'mediawiki.org',
    'staticflickr.com',
    'flickr.com',
    'redditmedia.com',
    'redd.it',
    'ytimg.com',
    'youtube.com',
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
async function fetchWaybackMachineCDX(query, extractedDomains = [], onPartial = null, signal = null) {
  const domainsToQuery = [...new Set(extractedDomains)].slice(0, 12);

  if (domainsToQuery.length > 0) {
    addConsoleLog(`[WAYBACK] Domaines ciblés : ${domainsToQuery.join(', ')}`, 'info');
  } else {
    addConsoleLog('[WAYBACK] Aucun domaine fiable détecté : recherche dans les collections Archive.org uniquement.', 'info');
  }
  const domainResults = [];
  for (let i = 0; i < domainsToQuery.length; i += 2) {
    if (signal?.aborted) throw createSearchAbortError();
    const batch = domainsToQuery.slice(i, i + 2);
    const batchResults = await Promise.all(batch.map(domain => fetchWaybackDomainCDX(domain, query, signal)));
    domainResults.push(...batchResults);
    if (onPartial) {
      const partialImages = dedupeMedia(batchResults.flatMap(result => result.images));
      const partialVideos = dedupeMedia(batchResults.flatMap(result => result.videos));
      if (partialImages.length || partialVideos.length) {
        onPartial({ images: partialImages, videos: partialVideos });
      }
    }
  }
  const archiveResults = await fetchWaybackArchiveSearch(query, signal);
  const images = dedupeMedia([...domainResults.flatMap(result => result.images), ...archiveResults.images]);
  const videos = dedupeMedia([...domainResults.flatMap(result => result.videos), ...archiveResults.videos]);
  const scannedDomains = domainResults.filter(result => result.scanned).length;

  return { images, videos, success: scannedDomains > 0 || images.length > 0 || videos.length > 0, scannedDomains, domains: domainsToQuery };
}

async function fetchWaybackJson(url, timeoutMs = 8000, parentSignal = null) {
  if (parentSignal?.aborted) throw createSearchAbortError();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const relayAbort = () => controller.abort();
  parentSignal?.addEventListener('abort', relayAbort, { once: true });
  try {
    const targetUrl = url.startsWith('/api/') ? `${API_BASE}${url}` : url;
    const response = await fetch(targetUrl, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    if (parentSignal?.aborted) throw createSearchAbortError();
    return null;
  } finally {
    clearTimeout(timeoutId);
    parentSignal?.removeEventListener('abort', relayAbort);
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
        thumbnail: '',
        duration: mimetype || 'Archive',
        source: 'Wayback',
        trustedContext: true,
        confidenceScore: 68,
        confidenceLabel: 'moyenne',
        confidenceReason: 'Média extrait d’un snapshot du domaine validé'
      };
    }

    return {
      url: archiveUrl,
      thumbnail: archiveUrl,
      title,
      source: 'Wayback',
      width: null,
      height: null,
      link: `https://web.archive.org/web/${timestamp}/${original}`,
      trustedContext: true,
      confidenceScore: 68,
      confidenceLabel: 'moyenne',
      confidenceReason: 'Média extrait d’un snapshot du domaine validé'
    };
  }).filter(Boolean);
}

async function discoverWaybackHostsFrontend(query, riskMode, parentSignal = null) {
  const safeSearch = safeSearchToggle ? safeSearchToggle.checked : true;
  const adultConfirmed = adultConfirmedToggle?.checked === true;
  if (parentSignal?.aborted) throw createSearchAbortError();
  try {
    // Try browser-direct first
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const relayAbort = () => controller.abort();
    parentSignal?.addEventListener('abort', relayAbort, { once: true });
    addConsoleLog(`[WAYBACK] Recherche directe d'archives pour "${query}"...`, 'info');
    try {
      const res = await fetch(`https://web.archive.org/__wb/search/host?q=${encodeURIComponent(query)}`, { signal: controller.signal });
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
    } finally {
      clearTimeout(timeoutId);
      parentSignal?.removeEventListener('abort', relayAbort);
    }
  } catch (err) {
    if (parentSignal?.aborted) throw createSearchAbortError();
    console.log("Direct browser host search failed/CORS restricted, falling back to server...", err.message);
  }
  
  // Fallback to server endpoint
  try {
    addConsoleLog(`[WAYBACK] Recherche d'archives via le serveur...`, 'info');
    const res = await fetch(`${API_BASE}/api/wayback/hosts?q=${encodeURIComponent(query)}&risk=${encodeURIComponent(riskMode)}&safe=${safeSearch}&adultConfirmed=${adultConfirmed}`, { signal: parentSignal });
    if (res.ok) {
      const data = await res.json();
      return data.domains || [];
    }
  } catch (err) {
    if (parentSignal?.aborted) throw createSearchAbortError();
    console.warn("Server host search failed:", err.message);
  }
  return [];
}

async function fetchWaybackDomainCDX(domain, query, signal = null) {
  const result = { domain, images: [], videos: [], scanned: false };
  const riskMode = safetyRiskMode ? safetyRiskMode.value : 'cautious';
  
  // 1. Try browser-direct first (bypasses sandbox firewall)
  try {
    addConsoleLog(`[WAYBACK] Scan direct de *.${domain}...`, 'info');
    const makeUrl = (target, mediaType, limit) => {
      const params = new URLSearchParams({
        url: target,
        matchType: 'domain',
        output: 'json',
        fl: 'original,timestamp,mimetype',
        collapse: 'urlkey',
        limit: String(limit)
      });
      params.append('filter', 'statuscode:200');
      params.append('filter', `mimetype:${mediaType}/.*`);
      return `https://web.archive.org/cdx/search/cdx?${params.toString()}`;
    };
    const baseDomain = domain.replace(/^www\./, '');
    const target = baseDomain;
    const imgUrl = makeUrl(target, 'image', 1000);
    const vidUrl = makeUrl(target, 'video', 250);
    
    const [imgData, vidData] = await Promise.all([
      fetchWaybackJson(imgUrl, 15000, signal),
      fetchWaybackJson(vidUrl, 15000, signal)
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
    if (signal?.aborted) throw createSearchAbortError();
    console.log(`Direct browser CDX fetch failed for ${domain}, trying server fallback...`, err.message);
  }
  
  // 2. Fallback to server endpoint
  try {
    addConsoleLog(`[WAYBACK] Scan via serveur pour ${domain}...`, 'info');
    const data = await fetchWaybackJson(`/api/wayback/cdx?domain=${encodeURIComponent(domain)}&q=${encodeURIComponent(query)}&risk=${encodeURIComponent(riskMode)}`, 35000, signal);
    if (data) {
      result.images.push(...(data.images || []));
      result.videos.push(...(data.videos || []));
      result.scanned = true;
      addConsoleLog(`[WAYBACK] Scan serveur réussi pour ${domain} : ${result.images.length} images, ${result.videos.length} vidéos.`, 'success');
    }
  } catch (error) {
    if (signal?.aborted) throw createSearchAbortError();
    console.error(`Wayback CDX failed for ${domain} via both browser and server:`, error.message);
  }
  
  return result;
}

async function fetchWaybackArchiveSearch(query, signal = null) {
  const result = { images: [], videos: [] };
  const riskMode = safetyRiskMode ? safetyRiskMode.value : 'cautious';
  addConsoleLog(`[WAYBACK] Recherche collections Archive.org pour "${query}"...`, 'info');
  
  // 1. Try browser-direct first
  try {
    const searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}+AND+(mediatype:image+OR+mediatype:movies)&fl[]=identifier,title,mediatype,mimetype&rows=50&output=json`;
    const data = await fetchWaybackJson(searchUrl, 10000, signal);
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
    if (signal?.aborted) throw createSearchAbortError();
    console.log("Direct archive.org collection search failed, trying server fallback...", err.message);
  }
  
  // 2. Fallback to server endpoint
  try {
    const data = await fetchWaybackJson(`/api/archive/search?q=${encodeURIComponent(query)}&risk=${encodeURIComponent(riskMode)}`, 12000, signal);
    if (data) {
      result.images.push(...(data.images || []));
      result.videos.push(...(data.videos || []));
    }
  } catch (err) {
    if (signal?.aborted) throw createSearchAbortError();
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
  const appendResults = options.append === true;
  const parentQuery = String(options.aliasOf || currentSearchQuery || query).trim();
  const parentSearchConfig = appendResults && lastSearchConfig
    ? { ...lastSearchConfig, query: parentQuery }
    : null;
  
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
  const adultConfirmed = adultConfirmedToggle ? adultConfirmedToggle.checked : false;
  const requestsAdultSources = !safeSearch || checkedSources.some(source => getSourceGroup(source) === 'nsfw');
  if (requestsAdultSources && !adultConfirmed) {
    alert('Confirmez que vous avez 18 ans avant d utiliser les sources NSFW publiques.');
    adultConfirmedToggle?.focus();
    return;
  }
  const riskMode = safetyRiskMode ? safetyRiskMode.value : 'cautious';
  const matchMode = searchMatchMode ? searchMatchMode.value : 'smart';
  const exactMode = matchMode === 'strict';
  const accountMode = accountScrapeMode ? accountScrapeMode.value : 'complete';
  const mediaKind = mediaKindMode ? mediaKindMode.value : 'both';
  const sizeVal = document.getElementById('filter-size').value;
  const typeVal = document.getElementById('filter-type').value;
  const colorVal = '';
  stopAutoRefresh();
  const { controller, token } = beginSearchSession();
  const { signal } = controller;
  currentSearchQuery = query;
  const searchConfig = {
    query,
    checkedSources,
    safeSearch,
    adultConfirmed,
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
  if (appendResults) {
    searchConfig.append = true;
    searchConfig.parentQuery = parentQuery;
  }
  searchConfigGuards.set(searchConfig, () => isActiveSearch(token, signal));
  lastSearchConfig = searchConfig;
  
  statusConsoleWrapper.classList.remove('hidden');
  addConsoleLog(`Initialisation de la recherche pour : "${query}"`, 'info');
  addConsoleLog(`Sources sélectionnées : ${checkedSources.join(', ')}`, 'info');
  addConsoleLog(`Filtre adulte (SafeSearch) : ${safeSearch ? 'ACTIVÉ' : 'DÉSACTIVÉ'}`, 'info');
  if (!safeSearch) addConsoleLog('Confirmation 18+ : validée pour cette installation.', 'warning');
  addConsoleLog(`Mode anti-ban : ${riskMode === 'balanced' ? 'Equilibre' : 'Prudent'}`, 'info');
  addConsoleLog(`Pertinence : ${matchMode} ; comptes : ${accountMode === 'strict' ? 'strict terme' : 'compte complet'}`, 'info');
  addConsoleLog(`Médias : ${mediaKind === 'photos' ? 'photos seulement' : (mediaKind === 'videos' ? 'vidéos seulement' : 'photos + vidéos')}`, 'info');
  if (sizeVal || typeVal) {
    addConsoleLog(`Filtres média actifs : taille="${sizeVal || 'toutes'}", type="${typeVal || 'tous'}"`, 'info');
  }
  if (appendResults) addConsoleLog(`[ALIAS] Fusion des resultats de "${query}" avec "${parentQuery}".`, 'info');
  else renderLoading();
  
  // Reset and set status dots to loading
  resetAllStatusDots();
  checkedSources.forEach(src => {
    updateSourceStatusDot(src, 'loading');
  });
  
  // Reset counts only for a replacement search. Alias merge keeps the current workspace.
  if (!appendResults) {
    setShowingFavorites(false, { log: false, render: false });
    allImages = [];
    allVideos = [];
    filteredImages = [];
    filteredVideos = [];
    detectedAccounts = [];
    currentAliases = [];
    selectedAliasCandidate = null;
    sourceDiagnostics = {};
    if (accountsDashboard) accountsDashboard.classList.add('hidden');
    if (insightsDashboard) insightsDashboard.classList.add('hidden');
    if (aliasActionPanel) aliasActionPanel.classList.add('hidden');
    if (accountsList) accountsList.innerHTML = '';
    badgeImagesCount.textContent = '0';
    badgeVideosCount.textContent = '0';
    statsBar.classList.add('hidden');
    filterInput.value = '';
    document.getElementById('source-filter').value = 'all';
  }

  let serverData = { images: [], videos: [], status: {} };
  let waybackData = { images: [], videos: [], success: false };
  let domainSeedData = { images: [], videos: [] };
  
  try {
    const restoredSnapshot = await restoreSearchSnapshot(lastSearchConfig);
    assertActiveSearch(token, signal);
    if (restoredSnapshot.images || restoredSnapshot.videos) {
      addConsoleLog(`[CACHE LOCAL] ${restoredSnapshot.images} photos et ${restoredSnapshot.videos} vidéos restaurées pendant la recherche des nouveautés.`, 'success');
    }

    const sourceQueue = [...serverSources];
    const runServerSource = async (source) => {
      try {
        assertActiveSearch(token, signal);
        const response = await fetch(buildSearchUrl(searchConfig, source), { signal });
        if (!response.ok) {
          throw new Error(`Erreur serveur (${response.status})`);
        }
        const data = await response.json();
        assertActiveSearch(token, signal);
        serverData.images.push(...(data.images || []));
        serverData.videos.push(...(data.videos || []));
        Object.assign(serverData.status, data.status || {});
        domainSeedData = serverData;
        mergeSearchData(data);

        if (data.status?.[source]) {
          logSourceStatus(source, data.status[source]);
        } else {
          const missingStatusError = new Error('Aucun statut retourné');
          recordSourceFetchError(source, missingStatusError);
          logSourceStatus(source, { success: false, error: missingStatusError.message });
        }
      } catch (sourceError) {
        if (isSearchAbort(sourceError, signal)) throw sourceError;
        recordSourceFetchError(source, sourceError);
        logSourceStatus(source, { success: false, error: sourceError.message });
      }
    };
    const workerCount = Math.min(sourceQueue.length, riskMode === 'balanced' ? 3 : 1);
    const serverTasks = Array.from({ length: workerCount }, async () => {
      while (sourceQueue.length > 0) {
        assertActiveSearch(token, signal);
        const source = sourceQueue.shift();
        await runServerSource(source);
        if (riskMode !== 'balanced' && sourceQueue.length > 0) {
          await abortableDelay(500, signal);
        }
      }
    });

    let waybackHostDomains = [];
    if (queryWayback) {
      waybackHostDomains = await discoverWaybackHostsFrontend(query, riskMode, signal);
      assertActiveSearch(token, signal);
    }

    if (queryWayback && serverTasks.length > 0) {
      await Promise.race([
        Promise.allSettled(serverTasks),
        abortableDelay(2500, signal)
      ]);
      assertActiveSearch(token, signal);
    }

    if (queryWayback && (domainSeedData.images.length + domainSeedData.videos.length === 0)) {
      addConsoleLog('[WAYBACK] Découverte de domaines complémentaires...', 'info');
      const seedResponse = await fetch(buildSearchUrl(searchConfig, 'duckduckgo,wikimedia'), { signal });
      if (seedResponse.ok) {
        domainSeedData = await seedResponse.json();
      }
      assertActiveSearch(token, signal);
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
        if (isActiveSearch(token, signal)) mergeSearchData(partialData);
      }, signal);
      assertActiveSearch(token, signal);
      mergeSearchData(waybackData);
    }

    await Promise.allSettled(serverTasks);
    assertActiveSearch(token, signal);
    addConsoleLog('=== BILAN DE L\'ASPIRATION ===', 'info');
    
    if (queryWayback) {
      if (waybackData.success) {
        updateSourceStatusDot('wayback', 'success');
        updateSourceDiagnostics({ status: { wayback: {
          success: true,
          adapter: 'wayback-cdx',
          imagesCount: waybackData.images.length,
          videosCount: waybackData.videos.length,
          pagesDiscovered: waybackData.domains?.length || 0,
          pagesCrawled: waybackData.scannedDomains || 0
        } } });
        addConsoleLog(`[WAYBACK] Succès : ${waybackData.images.length} photos, ${waybackData.videos.length} vidéos trouvées.`, 'success');
      } else {
        updateSourceStatusDot('wayback', 'error');
        recordSourceFetchError('wayback', new Error('Échec de la récupération CDX'));
        addConsoleLog(`[WAYBACK] Échec de la récupération CDX.`, 'error');
      }
    }

    if (allImages.length === 0 && allVideos.length === 0) {
      statsBar.classList.remove('hidden');
      renderMedia();
    }

    assertActiveSearch(token, signal);
    addConsoleLog(`Aspiration terminée. Total: ${allImages.length} photos, ${allVideos.length} vidéos.`, 'success');
    await persistCurrentSearchSnapshot(searchConfig);
    assertActiveSearch(token, signal);
    await recordCompletedSearch(searchConfig, {
      imagesCount: allImages.length,
      videosCount: allVideos.length
    }, signal);
    assertActiveSearch(token, signal);
    await refreshSearchHistory();
    assertActiveSearch(token, signal);
    if (options.monitorId) {
      const monitor = savedMonitors.find(item => item.id === options.monitorId);
      if (monitor) {
        monitor.lastRunAt = new Date().toISOString();
        monitor.lastImages = allImages.length;
        monitor.lastVideos = allVideos.length;
        monitor.config = searchConfig;
        await fetch(`${API_BASE}/api/monitors/${encodeURIComponent(monitor.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(monitor), signal });
        localStorage.setItem('mediagatherer_monitors', JSON.stringify(savedMonitors));
        renderMonitors();
      }
    }
    
  } catch (error) {
    if (isSearchAbort(error, signal)) return;
    const networkHint = error instanceof TypeError || /NetworkError|Failed to fetch|fetch resource/i.test(error.message || '')
      ? ' Impossible de joindre le serveur local. Lancez "npm start" puis ouvrez http://localhost:3000.'
      : '';
    addConsoleLog(`Erreur lors de la recherche : ${error.message}.${networkHint}`, 'error');
    checkedSources.forEach(src => {
      if (!sourceDiagnostics[src]) {
        recordSourceFetchError(src, error);
        updateSourceStatusDot(src, 'error');
      }
    });
    if (!appendResults && allImages.length === 0 && allVideos.length === 0) {
      imagesGrid.innerHTML = '';
      videosGrid.innerHTML = '';
      renderEmptyState(imagesGrid, 'image');
      renderEmptyState(videosGrid, 'video');
    } else {
      applyFilters();
    }
  } finally {
    const supersededByNewSearch = Boolean(activeSearchController && activeSearchController !== controller);
    if (appendResults && !supersededByNewSearch) {
      currentSearchQuery = parentQuery;
      searchInput.value = parentQuery;
      if (parentSearchConfig) lastSearchConfig = parentSearchConfig;
      scheduleSearchSnapshotSave(0);
      renderInsights();
    }
    if (activeSearchController === controller) {
      activeSearchController = null;
      setSearchRunningState(false);
    }
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
      const previewUrl = safeHttpUrl(img.thumbnail || img.url);
      const sourceText = String(img.source || 'Source');
      const previewMarkup = previewUrl
        ? `<img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(img.title)}" loading="lazy" referrerpolicy="no-referrer">`
        : '<div class="media-placeholder" aria-hidden="true"><i data-lucide="image-off"></i></div>';
      const card = document.createElement('div');
      card.className = 'media-card';
      card.innerHTML = `
        <span class="source-badge ${safeCssToken(sourceText)}">${escapeHtml(sourceText)}</span>
        <span class="confidence-badge confidence-${confidenceClass(img)}" title="${escapeHtml((img.matchReasons || []).join(' · '))}">${escapeHtml(confidenceText(img))}</span>
        <button class="card-fav-btn ${isFav ? 'active' : ''}" title="${isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}">
          <i data-lucide="heart"></i>
        </button>
        <div class="media-card-img-wrapper">
          ${previewMarkup}
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

      if (previewUrl) attachImageProxyFallback(card.querySelector('img'), previewUrl);
      
      // Click event opens Lightbox
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.addEventListener('click', () => openLightbox(img, card));
      card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openLightbox(img, card); } });
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
      const previewUrl = safeHttpUrl(vid.thumbnail || '');
      const sourceText = String(vid.source || 'Source');
      const previewMarkup = previewUrl
        ? `<img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(vid.title)}" loading="lazy" referrerpolicy="no-referrer">`
        : '<div class="media-placeholder" aria-hidden="true"><i data-lucide="video"></i></div>';
      const card = document.createElement('div');
      card.className = 'media-card';
      card.innerHTML = `
        <span class="source-badge ${safeCssToken(sourceText)}">${escapeHtml(sourceText)}</span>
        <span class="confidence-badge confidence-${confidenceClass(vid)}" title="${escapeHtml((vid.matchReasons || []).join(' · '))}">${escapeHtml(confidenceText(vid))}</span>
        <span class="duration-badge"><i data-lucide="play"></i> ${escapeHtml(vid.duration || 'Ouvrir la source')}</span>
        <button class="card-fav-btn ${isFav ? 'active' : ''}" title="${isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}">
          <i data-lucide="heart"></i>
        </button>
        <div class="media-card-img-wrapper">
          ${previewMarkup}
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

      if (previewUrl) attachImageProxyFallback(card.querySelector('img'), previewUrl);
      
      // Click event opens Video Modal
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.addEventListener('click', () => openVideoModal(vid, card));
      card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openVideoModal(vid, card); } });
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
  if (text === undefined || text === null) return '';
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeHttpUrl(value) {
  try {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function safeCssToken(value) {
  return String(value || 'source').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'source';
}

function mediaSourceId(item) {
  if (item?.sourceId) return String(item.sourceId).toLowerCase();
  const normalized = normalizeForScore(item?.source);
  return sourceCatalog.find(source => normalizeForScore(source.id) === normalized || normalizeForScore(source.label) === normalized)?.id || normalized;
}

// ----------------------------------------------------
// LIVE FILTERING LOGIC
// ----------------------------------------------------
// Combined Filter Logic (Text Search + Dedicated Source Dropdown)
function isVideoMediaItem(item = {}) {
  return String(item.type || '').toLowerCase() === 'video'
    || Boolean(item.duration || item.embedUrl || item.playback);
}

function currentFilterBase() {
  if (!showingFavorites) return { images: allImages, videos: allVideos };
  return {
    images: favorites.filter(item => !isVideoMediaItem(item)),
    videos: favorites.filter(item => isVideoMediaItem(item))
  };
}

function applyFilters() {
  const textTerm = filterInput.value.toLowerCase().trim();
  const sourceTerm = document.getElementById('source-filter').value.toLowerCase().trim();
  const base = currentFilterBase();
  const matchesActiveFilters = item => {
    const searchableText = `${item.title || ''} ${item.source || ''}`.toLowerCase();
    const matchesText = !textTerm || searchableText.includes(textTerm);
    const matchesSource = sourceTerm === 'all' || mediaSourceId(item) === sourceTerm;
    return matchesText && matchesSource;
  };

  filteredImages = base.images.filter(matchesActiveFilters);
  filteredVideos = base.videos.filter(matchesActiveFilters);

  renderMedia();
}

filterInput.addEventListener('input', applyFilters);
document.getElementById('source-filter').addEventListener('change', applyFilters);

// ----------------------------------------------------
// LIGHTBOX MODAL OPERATION
// ----------------------------------------------------
function isOpenModal(modal) {
  return Boolean(modal && !modal.classList.contains('hidden'));
}

function validModalTrigger(trigger, modal) {
  return trigger instanceof HTMLElement && trigger.isConnected && !modal?.contains(trigger);
}

function restoreModalFocus(trigger) {
  if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
}

function openLightbox(img, trigger = document.activeElement) {
  const imageUrl = safeHttpUrl(img.url);
  if (!imageUrl) return;
  if (validModalTrigger(trigger, lightbox)) lastLightboxTrigger = trigger;
  lightboxImg.src = imageUrl;
  const accessibleTitle = img.title || 'Image sans titre';
  lightboxTitle.textContent = accessibleTitle;
  lightboxImg.alt = accessibleTitle;
  lightboxSource.textContent = img.source;
  
  if (img.width && img.height) {
    lightboxResolutionWrapper.style.display = 'inline-flex';
    lightboxResolution.textContent = `${img.width} x ${img.height}`;
  } else {
    lightboxResolutionWrapper.style.display = 'none';
  }
  
  lightboxBtnDownload.href = imageUrl;
  
  // Setup copy to clipboard
  lightboxBtnCopy.onclick = (e) => {
    e.preventDefault();
    navigator.clipboard.writeText(imageUrl).then(() => {
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
  
  const sourceUrl = safeHttpUrl(img.link);
  if (sourceUrl) {
    lightboxBtnSource.style.display = 'inline-flex';
    lightboxBtnSource.href = sourceUrl;
  } else {
    lightboxBtnSource.style.display = 'none';
  }
  if (lightboxBtnReverse) {
    lightboxBtnReverse.onclick = () => prepareReverseSearch(imageUrl);
  }
  
  lightbox.classList.remove('hidden');
  lightbox.focus();
}

function closeLightbox(restoreFocus = true) {
  if (!isOpenModal(lightbox)) return false;
  lightbox.classList.add('hidden');
  lightboxImg.src = '';
  lightboxImg.alt = 'Aperçu de l\'image sélectionnée';
  const trigger = lastLightboxTrigger;
  lastLightboxTrigger = null;
  if (restoreFocus) restoreModalFocus(trigger);
  return true;
}

lightboxClose.addEventListener('click', closeLightbox);

// Close Lightbox clicking background
lightbox.addEventListener('click', (e) => {
  if (e.target === lightbox) closeLightbox();
});

// ----------------------------------------------------
// VIDEO MODAL OPERATION
// ----------------------------------------------------
function openVideoModal(vid, trigger = document.activeElement) {
  const videoUrl = safeHttpUrl(vid.url);
  const candidateEmbedUrl = safeHttpUrl(vid.embedUrl);
  const trustedEmbedDomains = ['youtube.com', 'youtube-nocookie.com', 'vimeo.com', 'dailymotion.com', 'redgifs.com', 'eporner.com'];
  let embedUrl = '';
  try {
    const hostname = new URL(candidateEmbedUrl).hostname.replace(/^www\./, '');
    if (trustedEmbedDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))) embedUrl = candidateEmbedUrl;
  } catch {}
  const sourcePageUrl = safeHttpUrl(vid.link) || videoUrl;
  const directVideo = /\.(?:mp4|webm|m3u8|mov)(?:[?#]|$)/i.test(videoUrl);
  const externalPlayback = vid.playback === 'external' || (videoUrl && !directVideo && !embedUrl);
  if (validModalTrigger(trigger, videoModal)) lastVideoModalTrigger = trigger;
  videoTitle.textContent = vid.title || 'Sans titre';
  videoSource.textContent = vid.source;
  videoDuration.textContent = vid.duration || 'Inconnue';
  videoBtnLink.href = sourcePageUrl || '#';
  
  videoPlayerContainer.innerHTML = '';
  
  if (embedUrl) {
    // Iframe embed (e.g. YouTube)
    const iframe = document.createElement('iframe');
    const separator = embedUrl.includes('?') ? '&' : '?';
    iframe.src = `${embedUrl}${separator}autoplay=1`;
    iframe.title = `Lecture vidéo : ${vid.title || 'vidéo sans titre'}`;
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    iframe.sandbox = 'allow-scripts allow-same-origin allow-presentation';
    iframe.allowFullscreen = true;
    videoPlayerContainer.appendChild(iframe);
  } else if (videoUrl && !externalPlayback) {
    // HTML5 Direct Video player (e.g. Reddit mp4 fallback)
    const video = document.createElement('video');
    video.src = videoUrl;
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    videoPlayerContainer.appendChild(video);
  } else if (sourcePageUrl) {
    videoPlayerContainer.innerHTML = `
      <div class="external-video-state">
        <i data-lucide="external-link"></i>
        <p>Lecture disponible sur la page publique de la source.</p>
      </div>
    `;
    lucide.createIcons();
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
    btnPrev.disabled = true;
  } else {
    btnPrev.classList.remove('disabled');
    btnPrev.disabled = false;
  }
  
  if (currentVideoIndex === -1 || currentVideoIndex >= filteredVideos.length - 1) {
    btnNext.classList.add('disabled');
    btnNext.disabled = true;
  } else {
    btnNext.classList.remove('disabled');
    btnNext.disabled = false;
  }
  
  btnPrev.onclick = (e) => {
    e.stopPropagation();
    if (currentVideoIndex > 0) {
      openVideoModal(filteredVideos[currentVideoIndex - 1], lastVideoModalTrigger);
    }
  };
  
  btnNext.onclick = (e) => {
    e.stopPropagation();
    if (currentVideoIndex < filteredVideos.length - 1) {
      openVideoModal(filteredVideos[currentVideoIndex + 1], lastVideoModalTrigger);
    }
  };
  
  videoModal.classList.remove('hidden');
  videoModal.focus();
}

function closeVideoModal(restoreFocus = true) {
  if (!isOpenModal(videoModal)) return false;
  videoModal.classList.add('hidden');
  videoPlayerContainer.innerHTML = ''; // Stop video and audio instantly
  const trigger = lastVideoModalTrigger;
  lastVideoModalTrigger = null;
  if (restoreFocus) restoreModalFocus(trigger);
  return true;
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
  if (e.key !== 'Escape') return;
  if (isOpenModal(videoModal)) closeVideoModal();
  else if (isOpenModal(lightbox)) closeLightbox();
});

// ----------------------------------------------------
// FAVORITES OPERATIONS
// ----------------------------------------------------
async function loadCollection() {
  try {
    const response = await fetch(`${API_BASE}/api/collection`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const serverItems = (await response.json()).items || [];
    const localItems = [...favorites];
    favorites = [...serverItems, ...localItems].filter((item, index, rows) => index === rows.findIndex(candidate => (candidate.visualSignature && candidate.visualSignature === item.visualSignature) || candidate.url === item.url));
    const serverKeys = new Set(serverItems.map(item => item.visualSignature || item.url));
    for (const item of localItems.slice(0, 100)) {
      if (serverKeys.has(item.visualSignature || item.url)) continue;
      const migrated = await fetch(`${API_BASE}/api/collection`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...item, id: undefined, status: 'favorite' }) });
      if (migrated.ok) {
        const saved = await migrated.json();
        favorites = favorites.map(candidate => candidate.url === item.url ? saved : candidate);
      }
    }
    localStorage.setItem('mediagatherer_favorites', JSON.stringify(favorites));
  } catch {
    // Keep offline favorites when the local API is unavailable.
  }
  applyFilters();
}

async function toggleFavorite(item, btnEl) {
  const index = favorites.findIndex(fav => fav.url === item.url);
  if (index === -1) {
    try {
      const response = await fetch(`${API_BASE}/api/collection`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...item, status: 'favorite' }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      favorites.push(await response.json());
    } catch (error) {
      favorites.push({ ...item, id: `local-${Date.now()}`, status: 'favorite', localOnly: true });
      addConsoleLog(`Favori conservé dans ce navigateur : ${error.message}`, 'warning');
    }
    btnEl.classList.add('active');
    btnEl.title = "Retirer des favoris";
    addConsoleLog(`Ajouté aux favoris : "${item.title}"`, 'success');
  } else {
    const favorite = favorites[index];
    if (favorite.id) {
      try {
        const response = await fetch(`${API_BASE}/api/collection/${encodeURIComponent(favorite.id)}`, { method: 'DELETE' });
        if (!response.ok && !favorite.localOnly) addConsoleLog('Copie serveur du favori non supprimée.', 'warning');
      } catch (error) {
        addConsoleLog(`Favori retiré localement; serveur indisponible : ${error.message}`, 'warning');
      }
    }
    favorites.splice(index, 1);
    btnEl.classList.remove('active');
    btnEl.title = "Ajouter aux favoris";
    addConsoleLog(`Retiré des favoris : "${item.title}"`, 'info');
    
  }
  localStorage.setItem('mediagatherer_favorites', JSON.stringify(favorites));
  if (showingFavorites) applyFilters();
  lucide.createIcons();
}

function setShowingFavorites(showFavorites, options = {}) {
  showingFavorites = Boolean(showFavorites);
  if (showingFavorites) {
    btnToggleFav.classList.add('active');
    btnToggleFav.innerHTML = '<i data-lucide="heart-off"></i> <span>Résultats</span>';
    statsBar.classList.remove('hidden');
    if (options.log !== false) addConsoleLog('Affichage de votre collection de favoris avec les filtres actifs.', 'info');
  } else {
    btnToggleFav.classList.remove('active');
    btnToggleFav.innerHTML = '<i data-lucide="heart"></i> <span>Mes Favoris</span>';
    if (options.log !== false) addConsoleLog('Retour aux résultats de recherche avec les filtres actifs.', 'info');
  }
  if (options.render !== false) applyFilters();
  lucide.createIcons();
}

btnToggleFav.addEventListener('click', () => {
  setShowingFavorites(!showingFavorites);
});

// ----------------------------------------------------
// STATISTICS DASHBOARD
// ----------------------------------------------------
function updateStatsDashboard() {
  const totalCount = filteredImages.length + filteredVideos.length;
  if (totalCount === 0) {
    statsDashboard.classList.add('hidden');
    if (sourceBreakdownSummary) sourceBreakdownSummary.textContent = '0 source active';
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
    const src = mediaSourceId(item);
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
  
  const groupedSources = Object.fromEntries(Object.keys(SOURCE_GROUPS).map(group => [group, []]));

  Object.keys(sourceCounts).forEach(source => {
    groupedSources[getSourceGroup(source)].push(source);
  });

  if (sourceBreakdownSummary) {
    sourceBreakdownSummary.textContent = `${Object.keys(sourceCounts).length} sources · ${totalCount} médias`;
  }

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
  const folder = zip.folder("mediagatherer_photos");
  
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
      saveAs(content, "mediagatherer_photos.zip");
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
  btnExportJson.addEventListener('click', async () => {
    const format = exportFormat?.value || 'json';
    const exportImages = filteredImages.map(item => ({ ...item, type: 'image', query: currentSearchQuery }));
    const exportVideos = filteredVideos.map(item => ({ ...item, type: 'video', query: currentSearchQuery }));
    const safeName = (currentSearchQuery || 'recherche').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    const extension = format === 'markdown' ? 'md' : format;
    btnExportJson.disabled = true;
    try {
      const response = await fetch(`${API_BASE}/api/exports/results?format=${encodeURIComponent(format)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: exportImages, videos: exportVideos })
      });
      if (!response.ok) throw new Error(`serveur ${response.status}`);
      saveAs(await response.blob(), `mediagatherer_${safeName}.${extension}`);
      addConsoleLog(`Export ${format.toUpperCase()} filtré : ${exportImages.length} photos et ${exportVideos.length} vidéos.`, 'success');
    } catch (error) {
      if (format !== 'json') {
        addConsoleLog(`Export ${format.toUpperCase()} indisponible sans le serveur : ${error.message}`, 'error');
        return;
      }
      const payload = { query: currentSearchQuery, generatedAt: new Date().toISOString(), images: exportImages, videos: exportVideos, accounts: detectedAccounts };
      saveAs(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `mediagatherer_${safeName}.json`);
      addConsoleLog('Export JSON local généré en mode de secours.', 'info');
    } finally {
      btnExportJson.disabled = false;
    }
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
    void runBatchQueue();
  });
}
if (btnBatchPause) btnBatchPause.addEventListener('click', () => void setBatchJobAction('pause'));
if (btnBatchResume) btnBatchResume.addEventListener('click', () => void setBatchJobAction('resume'));
if (btnBatchCancel) btnBatchCancel.addEventListener('click', () => void setBatchJobAction('cancel'));

if (btnBatchClear) {
  btnBatchClear.addEventListener('click', () => {
    batchQueue = [];
    renderBatchQueue();
  });
}
updateBatchControls();

if (btnHistoryClear) {
  btnHistoryClear.addEventListener('click', async () => {
    const response = await fetch(`${API_BASE}/api/history`, { method: 'DELETE' });
    if (!response.ok) return addConsoleLog('Impossible de vider l’historique serveur.', 'error');
    searchHistory = [];
    localStorage.removeItem('mediagatherer_history');
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
  btnMonitorClear.addEventListener('click', async () => {
    const response = await fetch(`${API_BASE}/api/monitors`, { method: 'DELETE' });
    if (!response.ok) return addConsoleLog('Impossible de vider les veilles serveur.', 'error');
    savedMonitors = [];
    localStorage.removeItem('mediagatherer_monitors');
    localStorage.removeItem('aerogatherer_monitors');
    renderMonitors();
  });
}

renderBatchQueue();
refreshSearchHistory();
loadMonitors();
loadCollection();
updatePersonActions();
async function initializeRuntimeAndPersons() {
  await ensureRuntimeStatus();
  await loadPersons();
}
void initializeRuntimeAndPersons();
lucide.createIcons();

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

function sourceIconFor(source) {
  if (source.subtype === 'forum') return 'messages-square';
  if (source.subtype === 'archive') return 'archive';
  if (source.purpose === 'identity') return 'contact';
  if (source.supports?.length === 1 && source.supports[0] === 'video') return 'video';
  if (source.category === 'social') return 'share-2';
  if (source.nsfw) return 'badge-alert';
  return 'image';
}

function createSourceChip(source) {
  const chip = document.createElement('label');
  chip.className = `source-chip${source.nsfw ? ' adult-source hidden' : ''}`;
  chip.htmlFor = `src-${source.id}`;
  chip.innerHTML = `
    <input type="checkbox" id="src-${escapeHtml(source.id)}" value="${escapeHtml(source.id)}"${source.defaultSelected ? ' checked' : ''}>
    <span class="chip-custom">
      <span class="source-status-dot idle" id="dot-${escapeHtml(source.id)}"></span>
      <i data-lucide="${sourceIconFor(source)}" class="chip-icon"></i>
      ${escapeHtml(source.label)}${source.nsfw ? ' (18+)' : ''}
    </span>
  `;
  return chip;
}

function populateSourceFilter() {
  const select = document.getElementById('source-filter');
  if (!select) return;
  const selected = select.value || 'all';
  select.innerHTML = '<option value="all">Toutes sources</option>' + sourceCatalog
    .map(source => `<option value="${escapeHtml(source.id)}">${escapeHtml(source.label)}</option>`)
    .join('');
  select.value = sourceCatalogById.has(selected) ? selected : 'all';
}

async function initializeSourceDrawers() {
  const sourcesList = document.querySelector('.sources-list');
  if (!sourcesList || sourcesList.dataset.grouped === 'true') return;

  try {
    const response = await fetch(`${API_BASE}/api/sources`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    sourceCatalog = Array.isArray(payload.sources) ? payload.sources : [];
  } catch (error) {
    const socialFallback = new Set(['reddit', 'telegram', 'instagram', 'facebook', 'tiktok', 'x', 'pinterest']);
    sourceCatalog = [...sourcesList.querySelectorAll('.source-chip input[type="checkbox"]')].map(input => ({
      id: input.value,
      label: input.closest('.source-chip')?.textContent?.replace(/\s+/g, ' ').trim() || input.value,
      category: input.closest('.source-chip')?.classList.contains('adult-source') ? 'nsfw' : (socialFallback.has(input.value) ? 'social' : 'normal'),
      nsfw: input.closest('.source-chip')?.classList.contains('adult-source'),
      supports: ['image', 'video', 'page'],
      defaultSelected: input.checked
    }));
    addConsoleLog(`[SOURCES] Catalogue serveur indisponible : ${error.message}`, 'warning');
  }

  sourceCatalogById = new Map(sourceCatalog.map(source => [source.id, source]));
  const groupedChips = Object.fromEntries(Object.keys(SOURCE_GROUPS).map(group => [group, []]));
  sourceCatalog.forEach(source => {
    const group = SOURCE_GROUPS[source.category] ? source.category : (source.nsfw ? 'nsfw' : 'normal');
    groupedChips[group].push(createSourceChip(source));
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
  populateSourceFilter();
  updateSourceDrawerCounts();
  lucide.createIcons();
}

function updateSourceStatusDot(source, state) {
  const dot = document.getElementById(`dot-${source}`);
  if (dot) {
    dot.className = `source-status-dot ${state}`;
    if (state === 'idle') dot.title = "En attente";
    else if (state === 'loading') dot.title = "Aspiration en cours...";
    else if (state === 'success') dot.title = "Aspiration réussie !";
    else if (state === 'warning') dot.title = "Source joignable, mais aucun média public extrait";
    else if (state === 'error') dot.title = "Échec ou indisponible";
  }
}

function resetAllStatusDots() {
  const checkboxes = document.querySelectorAll('.sources-list input[type="checkbox"]');
  checkboxes.forEach(cb => {
    updateSourceStatusDot(cb.value, 'idle');
  });
}

function setNsfwVisibility() {
  let safeEnabled = safeSearchToggle ? safeSearchToggle.checked : true;
  if (!safeEnabled && adultConfirmedToggle?.checked !== true) {
    safeSearchToggle.checked = true;
    safeEnabled = true;
  }
  const adultChips = document.querySelectorAll('.source-chip.adult-source');
  const nsfwDrawer = document.querySelector('.source-drawer-nsfw');
  adultChips.forEach(chip => {
    if (safeEnabled) {
      chip.classList.add('hidden');
      const cb = chip.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = false;
    } else {
      chip.classList.remove('hidden');
    }
  });
  if (nsfwDrawer) {
    nsfwDrawer.classList.toggle('hidden', safeEnabled);
    if (!safeEnabled) nsfwDrawer.open = true;
  }
  if (nsfwModeNote) {
    nsfwModeNote.textContent = safeEnabled
      ? 'SafeSearch actif : les sources NSFW sont masquées et désélectionnées.'
      : 'Mode NSFW actif : seules les sources publiques sont interrogées, sans contournement de login/paywall.';
    nsfwModeNote.classList.toggle('active', !safeEnabled);
  }
  updateSourceDrawerCounts();
}

function activateNsfwPreset() {
  if (adultConfirmedToggle?.checked !== true) {
    alert('Confirmez que vous avez 18 ans avant d activer le mode NSFW public.');
    adultConfirmedToggle?.focus();
    return;
  }
  if (safeSearchToggle) safeSearchToggle.checked = false;
  if (searchMatchMode) searchMatchMode.value = 'smart';
  if (mediaKindMode) mediaKindMode.value = 'both';
  setNsfwVisibility();
  const preferred = new Set(['erome', 'redgifs', 'imagebam', 'imagefap', 'pornpics', 'babepedia', 'camwhores', 'pornzog', 'xhamster', 'xvideos', 'spankbang', 'pornhub', 'youporn', 'tube8', 'tnaflix', 'motherless', 'eporner', 'xnxx', 'hqporner', 'nuvid', 'drtuber', 'pornone', 'youjizz', 'phunforum', 'planetsuzy', 'bellazon', 'fanvue', 'chaturbate', 'stripchat', 'camsoda', 'livejasmin', 'indexxx', 'boobpedia', 'gelbooru', 'danbooru']);
  document.querySelectorAll('.sources-list input[type="checkbox"]').forEach(input => {
    if (getSourceGroup(input.value) === 'nsfw') input.checked = preferred.has(input.value);
  });
  updateSourceDrawerCounts();
  addConsoleLog('[NSFW] Mode public activé : SafeSearch désactivé, sources adultes publiques sélectionnées.', 'warning');
}
if (adultConfirmedToggle) {
  adultConfirmedToggle.checked = localStorage.getItem('mediagatherer_adult_confirmed') === 'true';
  adultConfirmedToggle.addEventListener('change', () => {
    localStorage.setItem('mediagatherer_adult_confirmed', String(adultConfirmedToggle.checked));
    if (!adultConfirmedToggle.checked && safeSearchToggle) safeSearchToggle.checked = true;
    setNsfwVisibility();
  });
}
if (safeSearchToggle) safeSearchToggle.addEventListener('change', () => {
  if (!safeSearchToggle.checked && adultConfirmedToggle?.checked !== true) {
    safeSearchToggle.checked = true;
    alert('La confirmation 18+ est requise pour désactiver SafeSearch.');
    adultConfirmedToggle?.focus();
  }
  setNsfwVisibility();
});
if (btnNsfwPreset) btnNsfwPreset.addEventListener('click', activateNsfwPreset);
initializeSourceDrawers().then(setNsfwVisibility);

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

