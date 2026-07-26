const VALIDATION_STATUSES = new Set([
  'to_review',
  'probable',
  'confirmed',
  'false_positive',
  'excluded',
  'saved'
]);
const PUBLIC_PROOF_STATUSES = new Set(['probable', 'confirmed', 'saved']);
const SENSITIVE_QUERY_KEYS = /^(?:api[_-]?key|access[_-]?token|auth|authorization|bearer|cookie|key|password|secret|session|sig|signature|token)$/i;
const SENSITIVE_TEXT = /(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:api[_ -]?key|access[_ -]?token|authorization|bearer|cookie|password|secret|session[_ -]?id)\b|(?:\+?\d[\s().-]*){8,})/i;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, maxLength = 240) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function publicText(value, maxLength = 240) {
  const text = cleanText(value, maxLength);
  return text && !SENSITIVE_TEXT.test(text) ? text : '';
}

function normalizedIdentity(value) {
  return cleanText(value, 240)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function isPrivateHostname(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;
  if (/^(?:127|10|0)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  const match = host.match(/^172\.(\d{1,3})\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function publicUrl(value) {
  const raw = cleanText(value, 2000);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol) || isPrivateHostname(parsed.hostname)) return null;
    parsed.username = '';
    parsed.password = '';
    parsed.hash = '';
    [...parsed.searchParams.keys()].forEach(key => {
      if (SENSITIVE_QUERY_KEYS.test(key)) parsed.searchParams.delete(key);
    });
    return parsed.toString();
  } catch {
    return null;
  }
}

function hashText(value) {
  let hash = 2166136261;
  const input = String(value || '');
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableId(type, value) {
  return `${type}:${hashText(`${type}:${cleanText(value, 4000).toLowerCase()}`)}`;
}

function statusOf(value, fallback = 'to_review') {
  const status = cleanText(value, 40).toLowerCase();
  return VALIDATION_STATUSES.has(status) ? status : fallback;
}

function mediaTypeOf(link, media) {
  const raw = cleanText(link.mediaType || media.type || media.mediaType, 40).toLowerCase();
  if (['image', 'photo', 'picture'].includes(raw)) return 'image';
  if (['video', 'clip'].includes(raw)) return 'video';
  if (['article', 'page', 'profile', 'archive', 'document'].includes(raw)) return raw;
  return 'page';
}

function scopedRows(rows, personId) {
  return asArray(rows).filter(row => {
    if (!row || typeof row !== 'object') return false;
    return !row.personId || !personId || String(row.personId) === String(personId);
  });
}

function sanitizeEvidence(rows) {
  return asArray(rows).flatMap(item => {
    if (typeof item === 'string' || typeof item === 'number') {
      const url = publicUrl(item);
      if (url) return [{ kind: 'url', url }];
      const reason = publicText(item, 320);
      return reason ? [{ kind: 'reason', reason }] : [];
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const proof = {};
    const kind = publicText(item.kind || item.type, 40);
    const reason = publicText(item.reason || item.label || item.description, 320);
    const source = publicText(item.source || item.sourceId, 100);
    const query = publicText(item.query, 320);
    const url = publicUrl(item.url || item.link);
    const observedAt = publicText(item.observedAt || item.date || item.createdAt, 60);
    const score = Number(item.score == null ? item.confidence : item.score);
    if (kind) proof.kind = kind;
    if (reason) proof.reason = reason;
    if (source) proof.source = source;
    if (query) proof.query = query;
    if (url) proof.url = url;
    if (observedAt) proof.observedAt = observedAt;
    if (Number.isFinite(score)) proof.score = Math.max(0, Math.min(100, score));
    return Object.keys(proof).length ? [proof] : [];
  }).slice(0, 30);
}

function graphInput(input = {}) {
  const person = input.person && typeof input.person === 'object' ? input.person : {};
  const personId = cleanText(person.id, 160);
  return {
    person,
    personId,
    aliasCandidates: scopedRows([
      ...asArray(person.aliasEvidence),
      ...asArray(input.aliasCandidates)
    ], personId),
    mediaLinks: scopedRows(input.mediaLinks, personId),
    validationRules: scopedRows(input.validationRules || input.rules, personId)
  };
}

function collectAliases(person, aliasCandidates) {
  const aliases = new Map();
  const add = (value, kind, state, details = {}) => {
    const label = publicText(value, 160);
    const normalized = normalizedIdentity(label);
    if (!label || normalized.length < 2) return;
    const key = `${kind}:${normalized}`;
    const current = aliases.get(key);
    const confirmed = state === 'confirmed' || current?.state === 'confirmed';
    aliases.set(key, {
      key,
      value: kind === 'username' ? `@${label.replace(/^@+/, '')}` : label,
      kind,
      state: confirmed ? 'confirmed' : 'candidate',
      status: confirmed ? 'confirmed' : cleanText(details.status || current?.status || 'to_review', 40),
      confidence: Math.max(Number(current?.confidence || 0), Number(details.confidence || 0)),
      sources: [...new Set([
        ...asArray(current?.sources),
        ...asArray(details.sources).map(source => publicText(source, 100)).filter(Boolean)
      ])].slice(0, 12),
      proofCount: Math.max(Number(current?.proofCount || 0), sanitizeEvidence(details.evidence).length)
    });
  };

  asArray(person.aliases).forEach(value => add(value, 'display_name', 'confirmed'));
  asArray(person.usernames).forEach(value => add(value, 'username', 'confirmed'));
  aliasCandidates.forEach(candidate => {
    const status = cleanText(candidate.status || 'to_review', 40).toLowerCase();
    if (['rejected', 'false_positive', 'excluded'].includes(status)) return;
    const kind = candidate.kind === 'username' ? 'username' : 'display_name';
    const state = ['confirmed', 'merged'].includes(status) ? 'confirmed' : 'candidate';
    add(candidate.value || candidate.alias, kind, state, candidate);
  });
  return [...aliases.values()];
}

function collectAccounts(person) {
  const accounts = new Map();
  const add = (account, state) => {
    if (!account || typeof account !== 'object') return;
    const status = cleanText(account.status || (state === 'confirmed' ? 'confirmed' : 'to_review'), 40).toLowerCase();
    if (['rejected', 'false_positive', 'excluded'].includes(status)) return;
    const username = publicText(String(account.username || '').replace(/^@+/, ''), 120);
    const url = publicUrl(account.url);
    const platform = publicText(account.platform || account.source, 80).toLowerCase();
    if (!username && !url) return;
    const key = url || `${platform}:${normalizedIdentity(username)}`;
    const current = accounts.get(key);
    const confirmed = state === 'confirmed' || status === 'confirmed' || current?.state === 'confirmed';
    accounts.set(key, {
      key,
      entityId: publicText(account.id, 160),
      platform,
      username,
      url,
      state: confirmed ? 'confirmed' : 'discovered',
      status: confirmed ? 'confirmed' : 'to_review'
    });
  };
  asArray(person.accounts).forEach(account => add(account, 'confirmed'));
  asArray(person.discoveredAccounts).forEach(account => add(account, 'discovered'));
  return [...accounts.values()];
}

function sourceOf(link, media) {
  const id = publicText(media.sourceId || link.sourceId || media.source || link.source, 100).toLowerCase();
  const label = publicText(media.sourceLabel || link.sourceLabel || media.source || link.source, 120);
  if (!id && !label) return null;
  return { id: id || normalizedIdentity(label), label: label || id };
}

function queryOf(link, media) {
  const raw = cleanText(link.query || media.query, 500);
  if (!raw) return null;
  const label = publicText(raw, 320);
  return {
    key: raw,
    label: label || 'Requete publique redactee',
    redacted: !label
  };
}

function publicMedia(link) {
  const media = link?.media && typeof link.media === 'object' ? link.media : (link || {});
  const entityId = publicText(link.id || media.id || media.stableId, 180);
  const mediaType = mediaTypeOf(link || {}, media);
  const title = publicText(media.title || media.name, 220) || `Media ${mediaType}`;
  const url = publicUrl(media.url || media.mediaUrl);
  const pageUrl = publicUrl(media.link || media.pageUrl || media.sourceUrl || link.link);
  const thumbnail = publicUrl(media.thumbnail || media.poster || media.image);
  const score = Number(link.personScore == null ? media.confidenceScore : link.personScore);
  return {
    key: entityId || media.visualSignature || url || pageUrl || `${title}:${link.createdAt || ''}`,
    entityId,
    title,
    mediaType,
    status: statusOf(link.status),
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null,
    url,
    pageUrl,
    thumbnail,
    source: sourceOf(link, media),
    query: queryOf(link, media),
    evidence: sanitizeEvidence(link.evidence || media.evidence),
    matchedRules: asArray(link.matchedRules).map(value => cleanText(value, 160)).filter(Boolean),
    accountId: cleanText(link.accountId || media.accountId, 160),
    accountUrl: publicUrl(link.accountUrl || media.accountUrl),
    accountUsername: normalizedIdentity(link.accountUsername || media.accountUsername || media.username)
  };
}

function accountMatchesMedia(account, media) {
  if (media.accountId && account.entityId && media.accountId === account.entityId) return true;
  if (media.accountUrl && account.url && media.accountUrl === account.url) return true;
  if (media.accountUsername && account.username && media.accountUsername === normalizedIdentity(account.username)) return true;
  return Boolean(media.source?.id && account.platform && media.source.id === account.platform);
}

function buildPersonGraph(input = {}) {
  const { person, personId, aliasCandidates, mediaLinks, validationRules } = graphInput(input);
  const nodes = new Map();
  const edges = new Map();
  const addNode = node => {
    if (!node?.id) return null;
    const current = nodes.get(node.id) || {};
    nodes.set(node.id, { ...current, ...node });
    return node.id;
  };
  const addEdge = (from, to, type) => {
    if (!from || !to || !type) return;
    const id = stableId('edge', `${from}|${type}|${to}`);
    edges.set(id, { id, from, to, type });
  };

  const displayName = publicText(person.displayName || person.name, 160) || 'Personne publique';
  const personNodeId = stableId('person', personId || displayName);
  addNode({
    id: personNodeId,
    type: 'person',
    label: displayName,
    entityId: publicText(personId, 160) || null,
    personType: publicText(person.type, 80) || 'unknown_public'
  });

  const aliases = collectAliases(person, aliasCandidates);
  const aliasNodes = aliases.map(alias => {
    const id = stableId('alias', alias.key);
    addNode({
      id,
      type: 'alias',
      label: alias.value,
      aliasKind: alias.kind,
      state: alias.state,
      status: alias.status,
      confidence: Math.max(0, Math.min(100, alias.confidence || 0)),
      sources: alias.sources,
      proofCount: alias.proofCount
    });
    addEdge(personNodeId, id, 'has_alias');
    return { ...alias, id };
  });

  const accounts = collectAccounts(person);
  const accountNodes = accounts.map(account => {
    let hostname = '';
    try {
      hostname = account.url ? new URL(account.url).hostname : '';
    } catch {}
    const label = [
      account.username ? `@${account.username}` : '',
      account.platform || hostname
    ].filter(Boolean).join(' - ') || 'Compte public';
    const id = stableId('account', account.key);
    addNode({
      id,
      type: 'account',
      label,
      entityId: account.entityId || null,
      platform: account.platform || null,
      username: account.username || null,
      url: account.url,
      state: account.state,
      status: account.status
    });
    addEdge(personNodeId, id, 'has_account');
    aliasNodes
      .filter(alias => alias.kind === 'username' && normalizedIdentity(alias.value) === normalizedIdentity(account.username))
      .forEach(alias => addEdge(alias.id, id, 'identifies_account'));
    return { ...account, id };
  });

  const ruleNodes = new Map();
  validationRules.forEach(rule => {
    const entityId = cleanText(rule.id, 160);
    const ruleType = publicText(rule.type, 60) || 'custom';
    const action = publicText(rule.action, 60) || 'review';
    const id = stableId('rule', entityId || `${ruleType}:${action}:${rule.createdAt || ''}:${rule.value || ''}`);
    addNode({
      id,
      type: 'rule',
      label: `${ruleType}: ${action}`,
      entityId: publicText(entityId, 160) || null,
      ruleType,
      action
    });
    addEdge(personNodeId, id, 'uses_rule');
    if (entityId) ruleNodes.set(entityId, id);
  });

  mediaLinks.map(publicMedia).forEach(media => {
    const mediaNodeId = stableId('media', media.key);
    addNode({
      id: mediaNodeId,
      type: 'media',
      label: media.title,
      entityId: media.entityId || null,
      mediaType: media.mediaType,
      status: media.status,
      score: media.score,
      url: media.url,
      pageUrl: media.pageUrl,
      thumbnail: media.thumbnail,
      evidenceCount: media.evidence.length
    });
    addEdge(personNodeId, mediaNodeId, 'has_media');
    accountNodes
      .filter(account => accountMatchesMedia(account, media))
      .forEach(account => addEdge(account.id, mediaNodeId, 'published_media'));

    let sourceNodeId = null;
    if (media.source) {
      sourceNodeId = stableId('source', media.source.id || media.source.label);
      addNode({
        id: sourceNodeId,
        type: 'source',
        label: media.source.label,
        sourceId: media.source.id || null
      });
      addEdge(mediaNodeId, sourceNodeId, 'from_source');
    }

    let queryNodeId = null;
    if (media.query) {
      queryNodeId = stableId('query', media.query.key);
      addNode({
        id: queryNodeId,
        type: 'query',
        label: media.query.label,
        redacted: media.query.redacted
      });
      addEdge(mediaNodeId, queryNodeId, 'found_by_query');
      addEdge(sourceNodeId, queryNodeId, 'searched_with');
    }

    media.matchedRules.forEach(ruleId => {
      const ruleNodeId = ruleNodes.get(ruleId);
      if (!ruleNodeId) return;
      addEdge(mediaNodeId, ruleNodeId, 'matched_rule');
      addEdge(queryNodeId, ruleNodeId, 'evaluated_by_rule');
    });
  });

  const typeOrder = ['person', 'alias', 'account', 'media', 'source', 'query', 'rule'];
  return {
    schemaVersion: 1,
    subjectId: personNodeId,
    nodes: [...nodes.values()].sort((a, b) => {
      const typeDifference = typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type);
      return typeDifference || a.id.localeCompare(b.id);
    }),
    edges: [...edges.values()].sort((a, b) => (
      a.from.localeCompare(b.from)
      || a.to.localeCompare(b.to)
      || a.type.localeCompare(b.type)
    ))
  };
}

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function sortedCounts(counts) {
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function buildPersonPublicReport(input = {}) {
  const context = graphInput(input);
  const graph = buildPersonGraph(input);
  const publicMediaRows = context.mediaLinks.map(publicMedia);
  const validation = {};
  const types = {};
  const sources = new Map();

  publicMediaRows.forEach(media => {
    increment(validation, media.status);
    increment(types, media.mediaType);
    if (!media.source) return;
    const key = media.source.id || normalizedIdentity(media.source.label);
    const current = sources.get(key) || {
      id: media.source.id || null,
      label: media.source.label,
      total: 0,
      validated: 0
    };
    current.total += 1;
    if (PUBLIC_PROOF_STATUSES.has(media.status)) current.validated += 1;
    sources.set(key, current);
  });

  const aliasNodes = graph.nodes.filter(node => node.type === 'alias');
  const accountNodes = graph.nodes.filter(node => node.type === 'account');
  const queryNodes = graph.nodes.filter(node => node.type === 'query');
  const ruleNodes = graph.nodes.filter(node => node.type === 'rule');
  const confirmedAliases = aliasNodes
    .filter(node => node.state === 'confirmed')
    .map(node => ({ value: node.label, kind: node.aliasKind }));
  const confirmedAccounts = accountNodes
    .filter(node => node.state === 'confirmed')
    .map(node => ({
      platform: node.platform,
      username: node.username,
      url: node.url
    }));

  const proofs = publicMediaRows
    .filter(media => PUBLIC_PROOF_STATUSES.has(media.status))
    .map(media => ({
      mediaId: media.entityId || stableId('media', media.key),
      title: media.title,
      type: media.mediaType,
      validationStatus: media.status,
      personScore: media.score,
      source: media.source,
      query: media.query?.redacted ? null : media.query?.label || null,
      urls: {
        media: media.url,
        page: media.pageUrl,
        thumbnail: media.thumbnail
      },
      evidence: media.evidence
    }));

  return {
    schemaVersion: 1,
    scope: {
      publicOnly: true,
      privateDataIncluded: false,
      proofStatuses: [...PUBLIC_PROOF_STATUSES]
    },
    subject: {
      id: publicText(context.personId, 160) || null,
      displayName: publicText(context.person.displayName || context.person.name, 160) || 'Personne publique',
      type: publicText(context.person.type, 80) || 'unknown_public',
      aliases: confirmedAliases,
      accounts: confirmedAccounts
    },
    stats: {
      aliases: {
        confirmed: aliasNodes.filter(node => node.state === 'confirmed').length,
        candidates: aliasNodes.filter(node => node.state === 'candidate').length
      },
      accounts: {
        confirmed: accountNodes.filter(node => node.state === 'confirmed').length,
        discovered: accountNodes.filter(node => node.state === 'discovered').length
      },
      media: {
        total: publicMediaRows.length,
        validated: publicMediaRows.filter(media => PUBLIC_PROOF_STATUSES.has(media.status)).length,
        needsReview: publicMediaRows.filter(media => media.status === 'to_review').length,
        rejected: publicMediaRows.filter(media => ['false_positive', 'excluded'].includes(media.status)).length
      },
      validation: sortedCounts(validation),
      types: sortedCounts(types),
      sources: [...sources.values()].sort((left, right) => (
        right.validated - left.validated
        || right.total - left.total
        || left.label.localeCompare(right.label)
      )),
      queries: queryNodes.length,
      rules: ruleNodes.length
    },
    proofs
  };
}

module.exports = {
  buildPersonGraph,
  buildPersonPublicReport
};
