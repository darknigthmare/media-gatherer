const { SOURCE_IDS, SOURCE_META, SOURCE_CRAWL_ADAPTERS } = require('../src/sources/sourceRegistry');
const { sourceCanary } = require('../src/sources/sourceCanaries');

function auditSourceContracts() {
  const errors = [];
  const warnings = [];
  const duplicateIds = SOURCE_IDS.filter((id, index, ids) => ids.indexOf(id) !== index);
  duplicateIds.forEach(id => errors.push(`duplicate_source_id:${id}`));

  SOURCE_IDS.forEach(id => {
    const source = SOURCE_META[id];
    if (!source) {
      errors.push(`missing_source_meta:${id}`);
      return;
    }
    if (!source.adapter) errors.push(`missing_adapter:${id}`);
    if (!Array.isArray(source.supports) || !source.supports.length) errors.push(`missing_supports:${id}`);
    if (!['normal', 'social', 'identity', 'nsfw'].includes(source.category)) errors.push(`invalid_category:${id}`);
    if (source.publicOnly !== true) errors.push(`not_public_only:${id}`);
    const canary = sourceCanary(source);
    if (!canary?.query) errors.push(`missing_canary_query:${id}`);
    if (!canary?.inputType) errors.push(`missing_canary_input_type:${id}`);
    if (!canary?.expected) errors.push(`missing_canary_expectation:${id}`);
    if (source.nsfw && canary?.adultConfirmed !== true) errors.push(`unsafe_nsfw_canary:${id}`);
    if (SOURCE_CRAWL_ADAPTERS[id] && !SOURCE_CRAWL_ADAPTERS[id].domains?.length) {
      errors.push(`crawl_adapter_without_domain:${id}`);
    }
    if (!SOURCE_CRAWL_ADAPTERS[id] && source.adapter === 'generic-public') {
      warnings.push(`generic_adapter_without_explicit_crawl_contract:${id}`);
    }
  });

  return {
    ok: errors.length === 0,
    generatedAt: new Date().toISOString(),
    totals: {
      sources: SOURCE_IDS.length,
      uniqueSources: new Set(SOURCE_IDS).size,
      nsfw: Object.values(SOURCE_META).filter(source => source.nsfw).length,
      canaries: SOURCE_IDS.filter(id => sourceCanary(id)?.query).length,
      crawlAdapters: Object.keys(SOURCE_CRAWL_ADAPTERS).length
    },
    errors,
    warnings
  };
}

if (require.main === module) {
  const report = auditSourceContracts();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

module.exports = { auditSourceContracts };
