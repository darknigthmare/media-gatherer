const COOMER_ORIGIN = 'https://site1.coomer.com.co';
const COOMER_SERVICES = ['onlyfans', 'fansly', 'candfans'];

function compactIdentity(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9]+/g, '');
}

function parsePayload(payload) {
  if (typeof payload !== 'string') return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function coomerProfileMatches(profile, query) {
  const needle = compactIdentity(query);
  if (!needle || !profile || Array.isArray(profile)) return false;
  return [profile.id, profile.public_id, profile.name]
    .map(compactIdentity)
    .some(value => value === needle);
}

async function resolveCoomerPublicProfile(query, options = {}, deps = {}) {
  const fetchText = deps.fetchText;
  if (typeof fetchText !== 'function') throw new Error('fetchText requis pour Coomer');
  const username = /^@?[a-z0-9._-]+$/i.test(String(query || '').trim())
    ? String(query).trim().replace(/^@/, '')
    : '';
  if (!username) {
    return {
      profile: null,
      notes: ['un username exact est requis; index global volontairement non aspire'],
      successfulRequests: 0,
      blockedResponses: 0,
      rateLimitedResponses: 0,
      attemptedRequests: 0,
      identity: { aliases: [], accounts: [] }
    };
  }

  const timeout = options.timeout || 12000;
  const notes = [];
  let successfulRequests = 0;
  let blockedResponses = 0;
  let rateLimitedResponses = 0;
  let attemptedRequests = 0;

  for (const service of COOMER_SERVICES) {
    const profileUrl = `${COOMER_ORIGIN}/api/v1/${service}/user/${encodeURIComponent(username)}/profile`;
    attemptedRequests += 1;
    try {
      const profile = parsePayload(await fetchText(profileUrl, {
        timeout,
        headers: { accept: 'application/json' }
      }));
      successfulRequests += 1;
      if (!coomerProfileMatches(profile, username)) {
        notes.push(`${service}: profil public non correspondant`);
        continue;
      }
      const id = String(profile.id || username);
      const accountUrl = `${COOMER_ORIGIN}/${encodeURIComponent(service)}/user/${encodeURIComponent(id)}`;
      return {
        profile,
        notes: [...notes, `${service}: profil exact; metadonnees uniquement`],
        successfulRequests,
        blockedResponses,
        rateLimitedResponses,
        attemptedRequests,
        identity: {
          aliases: [
            { value: profile.name || id, kind: 'display_name', confidence: 92, evidence: [accountUrl] },
            { value: `@${id}`, kind: 'username', confidence: 96, evidence: [accountUrl] }
          ],
          accounts: [accountUrl]
        }
      };
    } catch (error) {
      if (error.status === 429) rateLimitedResponses += 1;
      if ([401, 403, 451].includes(error.status)) blockedResponses += 1;
      notes.push(`${service}: ${error.status ? `HTTP ${error.status}` : error.message}`);
    }
  }

  return {
    profile: null,
    notes,
    successfulRequests,
    blockedResponses,
    rateLimitedResponses,
    attemptedRequests,
    identity: { aliases: [], accounts: [] }
  };
}

module.exports = {
  COOMER_ORIGIN,
  COOMER_SERVICES,
  coomerProfileMatches,
  resolveCoomerPublicProfile
};
