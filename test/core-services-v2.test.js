const test = require('node:test');
const assert = require('node:assert/strict');

const { SOURCE_IDS, SOURCE_META } = require('../src/sources/sourceRegistry');
const { allSourceCanaries } = require('../src/sources/sourceCanaries');
const {
  buildPersonIdentities,
  buildPersonSearchPlan
} = require('../src/services/personQueryPlanner.service');
const {
  aggregateSourceCoverage,
  executePersonSearchPlan
} = require('../src/services/personSearch.service');
const {
  classifyMediaQuality,
  applyIntrinsicImageVerification
} = require('../src/services/mediaQuality.service');
const {
  normalizeMonitor,
  applyMonitorResults,
  applyMonitorError,
  isMonitorDue
} = require('../src/services/monitor.service');
const { auditSourceContracts } = require('../scripts/audit-source-contracts');
const { compareSourceAudits } = require('../scripts/compare-source-audits');

test('planifie chaque identite equitablement et reserve Telegram au username brut', () => {
  const person = {
    id: 'person-1',
    displayName: 'Public Creator',
    aliases: ['Creator Alias'],
    usernames: ['creator_handle'],
    accounts: [{
      id: 'account-youtube',
      platform: 'youtube',
      username: 'creator_channel',
      url: 'https://youtube.com/@creator_channel',
      status: 'confirmed'
    }]
  };
  const identities = buildPersonIdentities(person);
  const plan = buildPersonSearchPlan(person, {
    depth: 'normal',
    sourceIds: ['duckduckgo', 'telegram', 'youtube', 'wikidata'],
    sourceMeta: SOURCE_META,
    maxQueries: identities.length
  });
  assert.equal(new Set(plan.tasks.map(task => task.identityId)).size, identities.length);
  const telegramTask = plan.tasks.find(task => task.sourceIds.includes('telegram'));
  assert.equal(telegramTask.query, 'creator_handle');
  assert.equal(telegramTask.strategy, 'exact_username');
  assert.ok(!plan.tasks.some(task => task.sourceIds.includes('telegram') && /"/.test(task.query)));
  assert.ok(plan.coverage.some(row => row.identityValue === 'Creator Alias' && row.state === 'planned'));
  assert.ok(plan.coverage.some(row => row.identityValue === 'Public Creator' && row.sourceId === 'telegram' && row.reason === 'telegram_requires_username'));
});

test('explique explicitement les couples non planifies par le budget', () => {
  const plan = buildPersonSearchPlan({
    id: 'person-2',
    displayName: 'Primary',
    aliases: ['Alias One'],
    usernames: ['primary_user']
  }, {
    depth: 'deep',
    sourceIds: ['duckduckgo', 'telegram', 'wikidata', 'wayback'],
    sourceMeta: SOURCE_META,
    maxQueries: 1
  });
  assert.equal(plan.tasks.length, 1);
  assert.ok(plan.coverage.some(row => row.reason === 'query_budget_exhausted'));
});

test('execute un plan et agrege les resultats et erreurs par identite et source', async () => {
  const plan = {
    tasks: [
      { id: 'task-1', identityId: 'username:test', query: 'test', sourceIds: ['telegram'] },
      { id: 'task-2', identityId: 'username:test', query: '"test"', sourceIds: ['duckduckgo'] }
    ],
    coverage: [
      { identityId: 'username:test', sourceId: 'telegram', sourceLabel: 'Telegram', state: 'planned', plannedQueries: ['test'], interrogatedQueries: 0, results: 0, errors: [] },
      { identityId: 'username:test', sourceId: 'duckduckgo', sourceLabel: 'DuckDuckGo', state: 'planned', plannedQueries: ['"test"'], interrogatedQueries: 0, results: 0, errors: [] }
    ]
  };
  const execution = await executePersonSearchPlan({
    plan,
    runTask: async task => {
      if (task.id === 'task-2') throw new Error('temporary failure');
      return { images: [{ sourceId: 'telegram', url: 'https://example.com/a.jpg' }], videos: [], status: { telegram: { success: true } } };
    },
    mapItems: items => items.map(item => ({ media: item }))
  });
  assert.equal(execution.completedTasks, 1);
  assert.equal(execution.failedTasks, 1);
  assert.equal(execution.coverage.find(row => row.sourceId === 'telegram').results, 1);
  assert.equal(execution.coverage.find(row => row.sourceId === 'duckduckgo').state, 'error');
  assert.equal(aggregateSourceCoverage(execution.coverage).find(row => row.sourceId === 'telegram').results, 1);
});

test('distingue original confirme meilleure variante et miniature', () => {
  assert.equal(classifyMediaQuality({ url: 'https://cdn.example/full.jpg', originalConfirmed: true }).qualityState, 'original_confirmed');
  assert.equal(classifyMediaQuality({ url: 'https://cdn.example/full.jpg', thumbnail: 'https://cdn.example/thumb.jpg' }).qualityState, 'best_declared');
  assert.equal(classifyMediaQuality({ url: 'https://cdn.example/preview-thumb.jpg' }).qualityState, 'thumbnail_only');
  const verified = applyIntrinsicImageVerification({ url: 'https://cdn.example/full.jpg' }, 2048, 1365, 'https://cdn.example/full.jpg');
  assert.equal(verified.qualityState, 'best_declared');
  assert.equal(verified.width, 2048);
  assert.equal(verified.qualityVerified, true);
});

test('borne la veille automatique et calcule seulement les nouveaux medias apres baseline', () => {
  const baseline = normalizeMonitor({
    query: 'creator',
    enabled: true,
    intervalMinutes: 1,
    lastMediaKeys: ['https://cdn.example/old.jpg'],
    config: { checkedSources: ['duckduckgo'], mediaKind: 'both' }
  }, {}, { id: 'monitor-1', acceptBaseline: true, now: 1000 });
  assert.equal(baseline.intervalMinutes, 15);
  assert.equal(isMonitorDue(baseline, Date.parse(baseline.nextRunAt) - 1), false);
  assert.equal(isMonitorDue(baseline, Date.parse(baseline.nextRunAt)), true);
  const result = applyMonitorResults(baseline, [
    { type: 'image', url: 'https://cdn.example/old.jpg' },
    { type: 'image', url: 'https://cdn.example/new.jpg' }
  ], [{ type: 'video', url: 'https://cdn.example/new.mp4' }], { now: 2000 });
  assert.equal(result.monitor.newImages, 1);
  assert.equal(result.monitor.newVideos, 1);
  assert.equal(result.newItems.length, 2);
  assert.match(applyMonitorError(result.monitor, new Error('offline'), { now: 3000 }).lastError, /offline/);
});

test('chaque source possede un canari public et un contrat hors ligne valide', () => {
  const canaries = allSourceCanaries();
  assert.equal(canaries.length, SOURCE_IDS.length);
  assert.equal(new Set(canaries.map(row => row.sourceId)).size, SOURCE_IDS.length);
  assert.ok(canaries.every(row => row.query && row.inputType && row.expected && row.publicOnly));
  const report = auditSourceContracts();
  assert.equal(report.ok, true, report.errors.join(', '));
  assert.equal(report.totals.canaries, 112);
});

test('compare deux audits et signale une regression sans confondre une recuperation', () => {
  const report = compareSourceAudits({
    generatedAt: 'before',
    results: [{ id: 'bing', state: 'operational', status: { imagesCount: 5 } }, { id: 'telegram', state: 'error', status: {} }]
  }, {
    generatedAt: 'after',
    results: [{ id: 'bing', state: 'error', status: {} }, { id: 'telegram', state: 'operational', status: { imagesCount: 2 } }]
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.regressions.map(row => row.id), ['bing']);
  assert.deepEqual(report.recoveries.map(row => row.id), ['telegram']);
});
