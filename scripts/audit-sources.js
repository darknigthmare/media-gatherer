const fs = require('node:fs');
const path = require('node:path');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const baseUrl = readArg('base', process.env.MEDIAGATHERER_AUDIT_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const outputPrefix = readArg('output', path.join('data', `source-audit-${new Date().toISOString().slice(0, 10)}`));
const forcedQuery = readArg('query');
const timeoutMs = Math.max(5000, Number(readArg('timeout', '70000')) || 70000);
const concurrency = Math.max(1, Math.min(3, Number(readArg('concurrency', '1')) || 1));
const delayMs = Math.max(0, Number(readArg('delay', '350')) || 0);
const onlySourceIds = new Set(readArg('only').split(',').map(value => value.trim()).filter(Boolean));
const unsafeMode = process.argv.includes('--unsafe');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function compact(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function hostOf(value) {
  try { return new URL(String(value || '')).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

function sampleMatchesQuery(sample, query) {
  const needle = compact(query);
  if (!needle) return true;
  const text = compact([sample.title, sample.description, sample.url, sample.link, ...(sample.matchReasons || [])].filter(Boolean).join(' '));
  return text.includes(needle);
}

function sampleMatchesDomains(sample, domains = []) {
  if (!domains.length) return true;
  const hosts = [hostOf(sample.link), hostOf(sample.url), hostOf(sample.thumbnail)].filter(Boolean);
  return hosts.some(host => domains.some(domain => host === domain || host.endsWith(`.${domain}`)));
}

function queryForSource(source) {
  if (forcedQuery) return forcedQuery;
  if (source.nsfw) return 'mia khalifa';
  if (source.category === 'identity' || source.purpose === 'identity') return 'Douglas Adams';
  return 'NASA';
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { error: text.slice(0, 500) || 'Reponse non JSON' }; }
    return { response, payload };
  } finally {
    clearTimeout(timer);
  }
}

function classify(row) {
  const status = row.status || {};
  const reason = String(status.zeroReason || row.error || '').toLowerCase();
  const total = Number(status.imagesCount || 0) + Number(status.videosCount || 0);
  if (row.httpStatus === 429 || /rate.?limit/.test(reason)) return 'rate_limited';
  if (status.skipped || /missing_credentials|configuration/.test(reason)) return 'configuration_required';
  if (total > 0 && row.quality?.queryRelevantSamples === 0) return 'false_positive';
  if (total > 0) return status.fallbackUsed || status.directReachable === false || row.quality?.missingThumbnails > 0 ? 'degraded' : 'operational';
  if (/access_blocked|http 401|http 403|http 451/.test(reason)) return 'access_blocked';
  if (/no_matching|no_public_media|without_public_media|without_matching_media|empty/.test(reason)) return 'empty';
  if (row.httpStatus >= 500 || /request_failed|source_unreachable|abort|timeout/.test(reason)) return 'error';
  return status.success ? 'empty' : 'error';
}

function markdownReport(report) {
  const lines = [
    '# Audit live des sources MediaGatherer',
    '',
    `Date: ${report.generatedAt}`,
    '',
    `Base testee: \`${report.baseUrl}\``,
    '',
    `Sources: ${report.summary.total}; operational: ${report.summary.operational}; degradees: ${report.summary.degraded}; faux positifs: ${report.summary.false_positive}; vides: ${report.summary.empty}; configuration requise: ${report.summary.configuration_required}; bloquees: ${report.summary.access_blocked}; limitees: ${report.summary.rate_limited}; erreurs: ${report.summary.error}.`,
    '',
    '| Source | Categorie | Adaptateur | Requete | Etat | HTTP | Photos | Videos | Echantillons pertinents | Miniatures absentes | Pages | Raison |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |'
  ];
  for (const row of report.results) {
    const status = row.status || {};
    const pages = `${Number(status.pagesCrawled || 0)}/${Number(status.pagesDiscovered || 0)}`;
    const reason = String(status.zeroReason || row.error || status.note || '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 180);
    lines.push(`| ${row.id} | ${row.category} | ${row.adapterMode} | ${row.query} | ${row.state} | ${row.httpStatus || 0} | ${Number(status.imagesCount || 0)} | ${Number(status.videosCount || 0)} | ${Number(row.quality?.queryRelevantSamples || 0)}/${Number(row.quality?.sampleCount || 0)} | ${Number(row.quality?.missingThumbnails || 0)} | ${pages} | ${reason} |`);
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const [sourceResponse, adapterResponse] = await Promise.all([
    fetchJson(`${baseUrl}/api/sources`),
    fetchJson(`${baseUrl}/api/sources/adapters`)
  ]);
  if (!sourceResponse.response.ok) throw new Error(`Catalogue sources HTTP ${sourceResponse.response.status}`);
  if (!adapterResponse.response.ok) throw new Error(`Catalogue adaptateurs HTTP ${adapterResponse.response.status}`);

  const catalogSources = sourceResponse.payload.sources || [];
  const sources = onlySourceIds.size ? catalogSources.filter(source => onlySourceIds.has(source.id)) : catalogSources;
  const adapters = adapterResponse.payload.adapters || [];
  const adaptersById = new Map(adapters.map(adapter => [adapter.id, adapter]));
  const results = new Array(sources.length);
  let cursor = 0;
  const absolutePrefix = path.resolve(outputPrefix);

  function writeReport(partial) {
    const completed = results.filter(Boolean);
    const summary = { total: completed.length, operational: 0, degraded: 0, false_positive: 0, empty: 0, configuration_required: 0, access_blocked: 0, rate_limited: 0, error: 0 };
    completed.forEach(row => { summary[row.state] = (summary[row.state] || 0) + 1; });
    const report = {
      generatedAt: new Date().toISOString(),
      partial,
      baseUrl,
      queryMode: `${forcedQuery ? `forced:${forcedQuery}` : 'category-smoke-queries'}; safe=${unsafeMode ? 'false' : 'per-source'}`,
      catalog: {
        sources: catalogSources.length,
        selectedSources: sources.length,
        adapters: adapters.length,
        missingAdapters: catalogSources.filter(source => !adaptersById.has(source.id)).map(source => source.id),
        duplicateSourceIds: catalogSources.map(source => source.id).filter((id, index, ids) => ids.indexOf(id) !== index)
      },
      summary,
      results: completed
    };
    fs.mkdirSync(path.dirname(absolutePrefix), { recursive: true });
    fs.writeFileSync(`${absolutePrefix}.json`, JSON.stringify(report, null, 2), 'utf8');
    fs.writeFileSync(`${absolutePrefix}.md`, markdownReport(report), 'utf8');
    return report;
  }

  async function worker() {
    while (cursor < sources.length) {
      const index = cursor++;
      const source = sources[index];
      const adapter = adaptersById.get(source.id) || {};
      const query = queryForSource(source);
      const params = new URLSearchParams({ q: query, safe: (unsafeMode || source.nsfw) ? 'false' : 'true', timeout: '9000' });
      if (source.nsfw) params.set('adultConfirmed', 'true');
      const startedAt = Date.now();
      let row;
      try {
        const { response, payload } = await fetchJson(`${baseUrl}/api/sources/${encodeURIComponent(source.id)}/test?${params}`);
        row = {
          id: source.id,
          label: source.label,
          category: source.category,
          nsfw: source.nsfw,
          auth: adapter.auth || source.auth,
          authRequired: Boolean(adapter.authRequired),
          configured: adapter.configured,
          supports: source.supports,
          adapterMode: adapter.mode || source.adapter,
          implementation: adapter.implementation || '',
          availability: adapter.availability || '',
          domains: adapter.domains || [],
          query,
          httpStatus: response.status,
          durationMs: Date.now() - startedAt,
          status: payload.status || {},
          samples: payload.samples || [],
          error: payload.error || ''
        };
        row.quality = {
          sampleCount: row.samples.length,
          queryRelevantSamples: row.samples.filter(sample => sampleMatchesQuery(sample, query)).length,
          sourceDomainSamples: row.samples.filter(sample => sampleMatchesDomains(sample, row.domains)).length,
          missingThumbnails: row.samples.filter(sample => !sample.thumbnail).length,
          missingUrls: row.samples.filter(sample => !sample.url).length
        };
      } catch (error) {
        row = {
          id: source.id,
          label: source.label,
          category: source.category,
          nsfw: source.nsfw,
          auth: adapter.auth || source.auth,
          authRequired: Boolean(adapter.authRequired),
          configured: adapter.configured,
          supports: source.supports,
          adapterMode: adapter.mode || source.adapter,
          implementation: adapter.implementation || '',
          availability: adapter.availability || '',
          domains: adapter.domains || [],
          query,
          httpStatus: 0,
          durationMs: Date.now() - startedAt,
          status: {},
          samples: [],
          quality: { sampleCount: 0, queryRelevantSamples: 0, sourceDomainSamples: 0, missingThumbnails: 0, missingUrls: 0 },
          error: error.name === 'AbortError' ? `timeout_${timeoutMs}ms` : error.message
        };
      }
      row.state = classify(row);
      results[index] = row;
      writeReport(true);
      const count = Number(row.status.imagesCount || 0) + Number(row.status.videosCount || 0);
      process.stdout.write(`[${index + 1}/${sources.length}] ${source.id}: ${row.state} (${count} medias, HTTP ${row.httpStatus || 0}, ${row.durationMs} ms)\n`);
      if (delayMs) await sleep(delayMs);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  const report = writeReport(false);
  process.stdout.write(`${JSON.stringify(report.summary)}\n`);
  process.stdout.write(`Rapports: ${absolutePrefix}.json et ${absolutePrefix}.md\n`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
