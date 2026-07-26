const fs = require('node:fs');
const path = require('node:path');

const STATE_RANK = Object.freeze({
  operational: 8,
  degraded: 7,
  empty: 6,
  skipped: 5,
  configuration_required: 4,
  access_blocked: 3,
  rate_limited: 2,
  false_positive: 1,
  error: 0
});

function readArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : '';
}

function compareSourceAudits(baseline = {}, current = {}) {
  const baselineById = new Map((baseline.results || []).map(row => [row.id, row]));
  const currentById = new Map((current.results || []).map(row => [row.id, row]));
  const regressions = [];
  const recoveries = [];
  const missing = [];
  const added = [];

  baselineById.forEach((before, id) => {
    const after = currentById.get(id);
    if (!after) {
      missing.push(id);
      return;
    }
    const beforeRank = STATE_RANK[before.state] ?? -1;
    const afterRank = STATE_RANK[after.state] ?? -1;
    const change = {
      id,
      before: before.state,
      after: after.state,
      beforeMedia: Number(before.status?.imagesCount || 0) + Number(before.status?.videosCount || 0),
      afterMedia: Number(after.status?.imagesCount || 0) + Number(after.status?.videosCount || 0)
    };
    if (afterRank < beforeRank) regressions.push(change);
    if (afterRank > beforeRank) recoveries.push(change);
  });
  currentById.forEach((row, id) => {
    if (!baselineById.has(id)) added.push(id);
  });
  return {
    ok: regressions.length === 0 && missing.length === 0,
    generatedAt: new Date().toISOString(),
    baselineGeneratedAt: baseline.generatedAt || null,
    currentGeneratedAt: current.generatedAt || null,
    regressions,
    recoveries,
    missing,
    added
  };
}

function markdownReport(report) {
  const lines = [
    '# Comparaison des audits de sources',
    '',
    `Etat: ${report.ok ? 'aucune regression' : 'regressions detectees'}.`,
    '',
    '| Source | Avant | Apres | Medias avant | Medias apres |',
    '| --- | --- | --- | ---: | ---: |',
    ...report.regressions.map(row => `| ${row.id} | ${row.before} | ${row.after} | ${row.beforeMedia} | ${row.afterMedia} |`)
  ];
  if (!report.regressions.length) lines.push('| - | - | - | 0 | 0 |');
  if (report.missing.length) lines.push('', `Sources absentes: ${report.missing.join(', ')}.`);
  return `${lines.join('\n')}\n`;
}

if (require.main === module) {
  const baselinePath = readArg('baseline');
  const currentPath = readArg('current');
  const outputPath = readArg('output');
  if (!baselinePath || !currentPath) {
    console.error('Usage: node scripts/compare-source-audits.js --baseline ancien.json --current nouveau.json [--output rapport.json]');
    process.exitCode = 1;
  } else {
    const report = compareSourceAudits(
      JSON.parse(fs.readFileSync(baselinePath, 'utf8')),
      JSON.parse(fs.readFileSync(currentPath, 'utf8'))
    );
    if (outputPath) {
      const absolute = path.resolve(outputPath);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, JSON.stringify(report, null, 2), 'utf8');
      fs.writeFileSync(absolute.replace(/\.json$/i, '.md'), markdownReport(report), 'utf8');
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 2;
  }
}

module.exports = { STATE_RANK, compareSourceAudits, markdownReport };
