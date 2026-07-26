const PERSON_DEPTHS = new Set(['quick', 'normal', 'deep', 'archive']);
const PERSON_SOURCE_PLANS = Object.freeze({
  quick: ['duckduckgo', 'bing', 'wikimedia', 'wikidata'],
  normal: ['duckduckgo', 'bing', 'wikimedia', 'wikidata', 'youtube', 'reddit', 'telegram', 'bluesky', 'mastodon'],
  deep: ['duckduckgo', 'bing', 'wikimedia', 'wikidata', 'youtube', 'reddit', 'telegram', 'bluesky', 'mastodon', 'github', 'tumblr', 'internetarchive', 'wayback'],
  archive: ['duckduckgo', 'bing', 'wikimedia', 'wikidata', 'youtube', 'reddit', 'telegram', 'internetarchive', 'wayback', 'commoncrawl', 'arquivo']
});
const DEFAULT_QUERY_LIMITS = Object.freeze({ quick: 8, normal: 20, deep: 32, archive: 40 });
const ARCHIVE_SOURCES = new Set(['wayback', 'commoncrawl', 'arquivo', 'internetarchive']);
const SEARCH_ENGINES = new Set(['duckduckgo', 'bing', 'google', 'brave', 'searxng']);
const EXACT_USERNAME_SOURCES = new Set(['telegram', 'github', 'coomer']);
const METADATA_SOURCES = new Set([
  'wikidata', 'tmdb', 'musicbrainz', 'stashdb', 'iafd', 'adultdatabase',
  'theporndb', 'indexxx', 'boobpedia', 'babepedia', 'freeones'
]);

function normalizeDepth(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return PERSON_DEPTHS.has(normalized) ? normalized : 'normal';
}

function normalizeIdentity(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '');
}

function uniq(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function stableIdentityId(kind, value, platform = '') {
  return `${kind}:${normalizeIdentity(value)}${platform ? `:${normalizeIdentity(platform)}` : ''}`;
}

function confirmedAccounts(person = {}) {
  return (Array.isArray(person.accounts) ? person.accounts : [])
    .filter(account => account && (!account.status || account.status === 'confirmed') && (account.username || account.url));
}

function buildPersonIdentities(person = {}) {
  const identities = [];
  const seenNames = new Set();
  const pushName = (value, role) => {
    const normalized = normalizeIdentity(value);
    if (!normalized || seenNames.has(normalized)) return;
    seenNames.add(normalized);
    identities.push({
      id: stableIdentityId(role, value),
      kind: role,
      value: String(value).trim(),
      normalized,
      label: role === 'primary_name' ? 'Nom principal' : 'Alias'
    });
  };
  pushName(person.displayName || person.name, 'primary_name');
  pushName(person.name, 'primary_name');
  (person.aliases || []).forEach(value => pushName(value, 'alias'));

  const seenUsernames = new Set();
  (person.usernames || []).forEach(value => {
    const normalized = normalizeIdentity(value);
    if (!normalized || seenUsernames.has(normalized)) return;
    seenUsernames.add(normalized);
    identities.push({
      id: stableIdentityId('username', normalized),
      kind: 'username',
      value: normalized,
      normalized,
      label: 'Username'
    });
  });

  confirmedAccounts(person).forEach(account => {
    const platform = normalizeIdentity(account.platform);
    const username = normalizeIdentity(account.username);
    const value = username || account.url;
    identities.push({
      id: account.id || stableIdentityId('account', value, platform),
      kind: 'account',
      value,
      normalized: normalizeIdentity(value),
      label: `Compte ${platform || 'public'}`,
      platform,
      username,
      url: String(account.url || '').trim()
    });
  });
  return identities.slice(0, 100);
}

function accountMatchesSource(identity, sourceId) {
  if (identity.kind !== 'account') return false;
  const aliases = {
    twitter: 'x',
    xcom: 'x',
    youtubechannel: 'youtube',
    onlyfan: 'onlyfans'
  };
  const platform = aliases[identity.platform] || identity.platform;
  return platform === sourceId;
}

function sourceStrategy(source, identity) {
  if (!source?.id) return { compatible: false, reason: 'source_unknown' };
  if (ARCHIVE_SOURCES.has(source.id)) {
    const query = identity.kind === 'account' && identity.url ? identity.url : identity.value;
    return query
      ? { compatible: true, query, strategy: 'archive_identity', reason: identity.url ? 'confirmed_account_url' : 'identity_archive_lookup' }
      : { compatible: false, reason: 'archive_identity_missing' };
  }
  if (source.id === 'telegram') {
    if (identity.kind === 'username') {
      return { compatible: true, query: identity.value, strategy: 'exact_username', reason: 'telegram_requires_raw_username' };
    }
    if (identity.kind === 'account' && accountMatchesSource(identity, 'telegram') && identity.username) {
      return { compatible: true, query: identity.username, strategy: 'exact_account', reason: 'confirmed_telegram_account' };
    }
    return { compatible: false, reason: 'telegram_requires_username' };
  }
  if (EXACT_USERNAME_SOURCES.has(source.id)) {
    if (identity.kind === 'username') {
      return { compatible: true, query: identity.value, strategy: 'exact_username', reason: 'raw_username_adapter' };
    }
    if (identity.kind === 'account' && accountMatchesSource(identity, source.id) && identity.username) {
      return { compatible: true, query: identity.username, strategy: 'exact_account', reason: 'matching_confirmed_account' };
    }
    return { compatible: false, reason: 'source_requires_username' };
  }
  if (METADATA_SOURCES.has(source.id)) {
    if (['primary_name', 'alias'].includes(identity.kind)) {
      return { compatible: true, query: identity.value, strategy: 'identity_metadata', reason: 'display_name_metadata_lookup' };
    }
    return { compatible: false, reason: 'metadata_source_requires_name' };
  }
  if (identity.kind === 'account') {
    if (accountMatchesSource(identity, source.id)) {
      return {
        compatible: true,
        query: identity.username || identity.url,
        strategy: 'confirmed_account',
        reason: 'matching_confirmed_account'
      };
    }
    if (SEARCH_ENGINES.has(source.id) && identity.url) {
      let host = '';
      try { host = new URL(identity.url).hostname.replace(/^www\./, ''); } catch {}
      return host
        ? { compatible: true, query: `site:${host} "${identity.username || identity.value}"`, strategy: 'account_site_search', reason: 'confirmed_account_domain' }
        : { compatible: false, reason: 'account_url_invalid' };
    }
    return { compatible: false, reason: 'account_source_mismatch' };
  }
  if (identity.kind === 'username') {
    return {
      compatible: true,
      query: source.category === 'social' || source.purpose === 'identity' ? identity.value : `"${identity.value}"`,
      strategy: source.category === 'social' || source.purpose === 'identity' ? 'profile_username' : 'quoted_username',
      reason: 'username_lookup'
    };
  }
  return {
    compatible: true,
    query: SEARCH_ENGINES.has(source.id) ? `"${identity.value}"` : identity.value,
    strategy: source.purpose === 'identity' ? 'identity_name' : 'media_name',
    reason: 'name_lookup'
  };
}

function groupCoreTasks(identities, sources) {
  const buckets = new Map(identities.map(identity => [identity.id, []]));
  const compatibility = new Map();
  identities.forEach(identity => {
    const grouped = new Map();
    sources.forEach(source => {
      const strategy = sourceStrategy(source, identity);
      compatibility.set(`${identity.id}:${source.id}`, strategy);
      if (!strategy.compatible) return;
      const key = `${strategy.query}\u0000${strategy.strategy}\u0000${strategy.reason}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          identityId: identity.id,
          identityKind: identity.kind,
          identityValue: identity.value,
          query: strategy.query,
          strategy: strategy.strategy,
          reason: strategy.reason,
          sourceIds: []
        });
      }
      grouped.get(key).sourceIds.push(source.id);
    });
    const strategyPriority = {
      exact_account: 0,
      exact_username: 0,
      confirmed_account: 0,
      profile_username: 1,
      identity_metadata: 1,
      identity_name: 1,
      archive_identity: 1,
      account_site_search: 2,
      quoted_username: 2,
      media_name: 2
    };
    buckets.set(identity.id, [...grouped.values()].sort((left, right) => (
      (strategyPriority[left.strategy] ?? 5) - (strategyPriority[right.strategy] ?? 5)
    )));
  });
  return { buckets, compatibility };
}

function addVariantTasks(buckets, identities, sources, person, depth) {
  if (depth === 'quick') return;
  const variantSources = sources
    .filter(source => SEARCH_ENGINES.has(source.id) || (source.purpose !== 'identity' && !ARCHIVE_SOURCES.has(source.id)))
    .map(source => source.id);
  if (!variantSources.length) return;
  const positives = uniq(person.positiveKeywords || []).slice(0, 3);
  identities.filter(identity => identity.kind !== 'account').forEach(identity => {
    const bucket = buckets.get(identity.id) || [];
    const variants = ['photo', 'video', 'interview', ...positives];
    if (['deep', 'archive'].includes(depth)) variants.push('profile', 'gallery', 'creator');
    if (depth === 'archive') variants.push('archive', 'old username');
    variants.forEach(variant => {
      bucket.push({
        identityId: identity.id,
        identityKind: identity.kind,
        identityValue: identity.value,
        query: `"${identity.value}" ${variant}`,
        strategy: 'context_variant',
        reason: `context_${normalizeIdentity(variant).replace(/\s+/g, '_')}`,
        sourceIds: [...variantSources]
      });
    });
    buckets.set(identity.id, bucket);
  });
}

function selectFairGroups(buckets, identities, maxQueries) {
  const selected = [];
  let round = 0;
  while (selected.length < maxQueries) {
    let added = false;
    for (const identity of identities) {
      const candidate = (buckets.get(identity.id) || [])[round];
      if (!candidate) continue;
      selected.push(candidate);
      added = true;
      if (selected.length >= maxQueries) break;
    }
    if (!added) break;
    round += 1;
  }
  return selected.map((group, index) => ({ ...group, id: `task-${index + 1}`, sourceIds: uniq(group.sourceIds) }));
}

function buildCoverage(identities, sources, selectedGroups, compatibility) {
  return identities.flatMap(identity => sources.map(source => {
    const groups = selectedGroups.filter(group => group.identityId === identity.id && group.sourceIds.includes(source.id));
    const strategy = compatibility.get(`${identity.id}:${source.id}`);
    return {
      identityId: identity.id,
      identityKind: identity.kind,
      identityValue: identity.value,
      identityLabel: identity.label,
      sourceId: source.id,
      sourceLabel: source.label || source.id,
      state: groups.length ? 'planned' : 'skipped',
      reason: groups.length
        ? groups[0].reason
        : (strategy?.compatible ? 'query_budget_exhausted' : (strategy?.reason || 'source_incompatible')),
      plannedQueries: groups.map(group => group.query),
      interrogatedQueries: 0,
      results: 0,
      errors: []
    };
  }));
}

function buildPersonSearchPlan(person, options = {}) {
  const depth = normalizeDepth(options.depth);
  const sourceMeta = options.sourceMeta || {};
  const selectedSourceIds = uniq(options.sourceIds || PERSON_SOURCE_PLANS[depth]).filter(id => sourceMeta[id]);
  const sources = selectedSourceIds.map(id => sourceMeta[id]);
  const identities = buildPersonIdentities(person);
  const requestedLimit = Number(options.maxQueries);
  const maxQueries = Math.max(1, Math.min(40, Number.isFinite(requestedLimit) ? requestedLimit : DEFAULT_QUERY_LIMITS[depth]));
  const { buckets, compatibility } = groupCoreTasks(identities, sources);
  addVariantTasks(buckets, identities, sources, person, depth);
  const tasks = selectFairGroups(buckets, identities, maxQueries);
  const coverage = buildCoverage(identities, sources, tasks, compatibility);
  return {
    personId: person.id,
    depth,
    maxQueries,
    identities,
    sources: selectedSourceIds,
    tasks,
    queries: uniq(tasks.map(task => task.query)),
    coverage,
    summary: {
      identities: identities.length,
      sources: selectedSourceIds.length,
      executionGroups: tasks.length,
      plannedPairs: coverage.filter(row => row.state === 'planned').length,
      skippedPairs: coverage.filter(row => row.state === 'skipped').length
    }
  };
}

function personSourcesForDepth(depth, requestedSources, sourceMeta) {
  const normalizedDepth = normalizeDepth(depth);
  const requested = uniq(String(requestedSources || '').split(',').map(value => value.trim())).filter(source => sourceMeta[source]);
  return requested.length ? requested : PERSON_SOURCE_PLANS[normalizedDepth].filter(source => sourceMeta[source]);
}

module.exports = {
  PERSON_SOURCE_PLANS,
  DEFAULT_QUERY_LIMITS,
  normalizeDepth,
  normalizeIdentity,
  buildPersonIdentities,
  sourceStrategy,
  buildPersonSearchPlan,
  personSourcesForDepth
};
