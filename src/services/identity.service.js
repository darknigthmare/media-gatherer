function normalizeIdentityValue(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function mergeIdentityEvidence(query, discoveredAliases = [], sourceStatus = {}) {
  const queryKey = normalizeIdentityValue(query).replace(/[^a-z0-9]+/g, '');
  const merged = new Map();
  const add = candidate => {
    if (!candidate || !candidate.value) return;
    const kind = candidate.kind === 'username' ? 'username' : 'display_name';
    const value = kind === 'username' ? `@${String(candidate.value).replace(/^@+/, '')}` : String(candidate.value).trim();
    const normalized = normalizeIdentityValue(value.replace(/^@/, ''));
    if (!normalized || normalized.length < 2) return;
    if (kind === 'username' && normalized.replace(/[^a-z0-9]+/g, '') === queryKey) return;
    const key = `${kind}:${normalized}`;
    const current = merged.get(key) || { value, kind, confidence: 0, sources: [], evidence: [], count: 0 };
    current.confidence = Math.max(current.confidence, Number(candidate.confidence) || 0);
    current.sources = [...new Set([...current.sources, ...(candidate.sources || []), candidate.sourceId].filter(Boolean))].slice(0, 10);
    current.evidence = [...new Set([...current.evidence, ...(candidate.evidence || []), candidate.url].filter(Boolean))].slice(0, 6);
    current.count += Number(candidate.count) || 1;
    merged.set(key, current);
  };

  (discoveredAliases || []).forEach(add);
  Object.entries(sourceStatus || {}).forEach(([sourceId, status]) => {
    (status?.identityAliases || []).forEach(candidate => add({ ...candidate, sourceId }));
  });

  return [...merged.values()]
    .sort((a, b) => b.confidence - a.confidence || b.sources.length - a.sources.length || b.count - a.count)
    .slice(0, 40);
}

function applyIdentityEvidenceToPerson(person, aliases = [], accounts = []) {
  const primary = normalizeIdentityValue(person.displayName || person.name);
  const displayAliases = aliases
    .filter(alias => alias.kind !== 'username' && Number(alias.confidence || 0) >= 75)
    .map(alias => alias.value)
    .filter(value => normalizeIdentityValue(value) !== primary);
  const usernames = aliases
    .filter(alias => alias.kind === 'username' && Number(alias.confidence || 0) >= 80)
    .map(alias => alias.value.replace(/^@/, ''))
    .filter(value => normalizeIdentityValue(value) !== primary);
  const existingAccounts = Array.isArray(person.accounts) ? person.accounts : [];
  const accountRows = (accounts || []).filter(Boolean).map(url => typeof url === 'string' ? { url } : url);
  const accountMap = new Map([...existingAccounts, ...accountRows].map(account => [String(account.url || `${account.platform || ''}:${account.username || ''}`).toLowerCase(), account]));
  return {
    ...person,
    aliases: [...new Set([...(person.aliases || []), ...displayAliases])],
    usernames: [...new Set([...(person.usernames || []), ...usernames])],
    accounts: [...accountMap.values()],
    identityResolvedAt: new Date().toISOString()
  };
}

function adultSearchGuard({ safe = true, selectedSources = [], nsfwSources = new Set(), adultConfirmed = false } = {}) {
  const wantsNsfw = safe === false || selectedSources.some(source => nsfwSources.has(source));
  if (!wantsNsfw) return { allowed: true, wantsNsfw: false, adultConfirmed: false };
  if (adultConfirmed !== true) {
    return { allowed: false, wantsNsfw: true, adultConfirmed: false, reason: 'Confirmation 18+ requise pour les sources NSFW publiques' };
  }
  return { allowed: true, wantsNsfw: true, adultConfirmed: true };
}

module.exports = {
  normalizeIdentityValue,
  mergeIdentityEvidence,
  applyIdentityEvidenceToPerson,
  adultSearchGuard
};
