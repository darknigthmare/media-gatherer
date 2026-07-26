const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPersonGraph,
  buildPersonPublicReport
} = require('../src/services/personGraph.service');

function fixture() {
  return {
    person: {
      id: 'person_public_1',
      displayName: 'Creator Example',
      name: 'Creator Legal Name',
      type: 'creator',
      aliases: ['Stage Name'],
      usernames: ['creatorx'],
      aliasEvidence: [
        {
          id: 'alias_candidate_1',
          value: 'Former Stage Name',
          kind: 'display_name',
          status: 'probable',
          confidence: 82,
          sources: ['wikidata'],
          evidence: ['https://www.wikidata.org/wiki/Q1']
        },
        {
          id: 'alias_rejected_1',
          value: 'Wrong Person',
          kind: 'display_name',
          status: 'rejected'
        },
        {
          id: 'alias_private_1',
          value: 'private@example.test',
          kind: 'display_name',
          status: 'probable'
        }
      ],
      accounts: [
        {
          id: 'account_confirmed_1',
          platform: 'youtube',
          username: 'creatorx',
          url: 'https://youtube.com/@creatorx?token=must-not-leak&view=public',
          status: 'confirmed'
        }
      ],
      discoveredAccounts: [
        {
          id: 'account_discovered_1',
          platform: 'bluesky',
          username: 'creator.example',
          url: 'https://bsky.app/profile/creator.example',
          status: 'to_review'
        }
      ],
      notes: 'Private editorial notes must not be exported',
      birthYear: 1990,
      adultConfirmed: true,
      privatePhone: '+33 6 12 34 56 78'
    },
    aliasCandidates: [
      {
        id: 'alias_candidate_2',
        personId: 'person_public_1',
        value: '@creator-alt',
        kind: 'username',
        status: 'to_review',
        confidence: 71,
        sources: ['bluesky']
      },
      {
        id: 'other_person_alias',
        personId: 'another_person',
        value: 'Must Not Appear',
        status: 'confirmed'
      }
    ],
    mediaLinks: [
      {
        id: 'media_confirmed_1',
        personId: 'person_public_1',
        status: 'confirmed',
        mediaType: 'video',
        personScore: 94,
        query: '"Creator Example" interview',
        accountId: 'account_confirmed_1',
        matchedRules: ['rule_confirm_1'],
        evidence: [
          'Nom exact dans le titre',
          'private@example.test',
          {
            kind: 'source_match',
            reason: 'Compte public confirme',
            url: 'https://example.com/proof?access_token=must-not-leak&item=1',
            password: 'must-not-leak'
          }
        ],
        media: {
          title: 'Creator Example interview',
          type: 'video',
          url: 'https://cdn.example.com/interview.mp4?sig=must-not-leak&quality=hd',
          link: 'https://youtube.com/watch?v=public',
          thumbnail: 'https://img.example.com/interview.jpg',
          sourceId: 'youtube',
          sourceLabel: 'YouTube'
        }
      },
      {
        id: 'media_review_1',
        personId: 'person_public_1',
        status: 'to_review',
        mediaType: 'image',
        query: 'private@example.test',
        media: {
          title: 'Possible portrait',
          url: 'https://images.example.com/possible.jpg',
          sourceId: 'bing',
          sourceLabel: 'Bing'
        }
      },
      {
        id: 'media_rejected_1',
        personId: 'person_public_1',
        status: 'false_positive',
        mediaType: 'image',
        media: {
          title: 'Another person',
          url: 'https://images.example.com/wrong.jpg',
          sourceId: 'bing',
          sourceLabel: 'Bing'
        }
      },
      {
        id: 'other_person_media',
        personId: 'another_person',
        status: 'confirmed',
        media: { title: 'Must Not Appear', sourceId: 'reddit' }
      }
    ],
    validationRules: [
      {
        id: 'rule_confirm_1',
        personId: 'person_public_1',
        type: 'source',
        action: 'confirm',
        value: 'youtube'
      },
      {
        id: 'rule_private_1',
        personId: 'person_public_1',
        type: 'custom',
        action: 'review',
        value: 'private@example.test'
      }
    ]
  };
}

test('produit un graphe relationnel public, deduplique et deterministe', () => {
  const input = fixture();
  const untouched = JSON.parse(JSON.stringify(input));
  const graph = buildPersonGraph(input);

  assert.deepEqual(input, untouched);
  assert.deepEqual(buildPersonGraph(input), graph);
  assert.equal(graph.nodes.filter(node => node.type === 'person').length, 1);
  assert.equal(graph.nodes.filter(node => node.type === 'alias' && node.state === 'confirmed').length, 2);
  assert.equal(graph.nodes.filter(node => node.type === 'alias' && node.state === 'candidate').length, 2);
  assert.equal(graph.nodes.filter(node => node.type === 'account' && node.state === 'confirmed').length, 1);
  assert.equal(graph.nodes.filter(node => node.type === 'account' && node.state === 'discovered').length, 1);
  assert.equal(graph.nodes.filter(node => node.type === 'media').length, 3);
  assert.deepEqual(
    [...new Set(graph.nodes.filter(node => node.type === 'source').map(node => node.sourceId))].sort(),
    ['bing', 'youtube']
  );
  assert.equal(graph.nodes.filter(node => node.type === 'query').length, 2);
  assert.equal(graph.nodes.filter(node => node.type === 'rule').length, 2);

  const relationTypes = new Set(graph.edges.map(edge => edge.type));
  assert.ok(relationTypes.has('has_alias'));
  assert.ok(relationTypes.has('identifies_account'));
  assert.ok(relationTypes.has('published_media'));
  assert.ok(relationTypes.has('from_source'));
  assert.ok(relationTypes.has('found_by_query'));
  assert.ok(relationTypes.has('searched_with'));
  assert.ok(relationTypes.has('evaluated_by_rule'));

  const serialized = JSON.stringify(graph);
  assert.doesNotMatch(serialized, /must-not-leak/);
  assert.doesNotMatch(serialized, /private@example\.test/);
  assert.doesNotMatch(serialized, /Private editorial notes/);
  assert.doesNotMatch(serialized, /\+33 6 12 34 56 78/);
  assert.doesNotMatch(serialized, /Must Not Appear/);
  assert.match(serialized, /quality=hd/);
  assert.match(serialized, /view=public/);
});

test('genere un rapport synthetique avec statistiques et preuves publiques', () => {
  const report = buildPersonPublicReport(fixture());

  assert.equal(report.scope.publicOnly, true);
  assert.equal(report.scope.privateDataIncluded, false);
  assert.equal(report.subject.displayName, 'Creator Example');
  assert.deepEqual(report.subject.aliases.map(alias => alias.value).sort(), ['@creatorx', 'Stage Name']);
  assert.equal(report.subject.accounts.length, 1);
  assert.equal(report.stats.aliases.confirmed, 2);
  assert.equal(report.stats.aliases.candidates, 2);
  assert.equal(report.stats.accounts.confirmed, 1);
  assert.equal(report.stats.accounts.discovered, 1);
  assert.deepEqual(report.stats.media, {
    total: 3,
    validated: 1,
    needsReview: 1,
    rejected: 1
  });
  assert.deepEqual(report.stats.validation, {
    confirmed: 1,
    false_positive: 1,
    to_review: 1
  });
  assert.deepEqual(report.stats.types, { image: 2, video: 1 });
  assert.deepEqual(report.stats.sources, [
    { id: 'youtube', label: 'YouTube', total: 1, validated: 1 },
    { id: 'bing', label: 'Bing', total: 2, validated: 0 }
  ]);
  assert.equal(report.stats.queries, 2);
  assert.equal(report.stats.rules, 2);
  assert.equal(report.proofs.length, 1);
  assert.equal(report.proofs[0].mediaId, 'media_confirmed_1');
  assert.equal(report.proofs[0].validationStatus, 'confirmed');
  assert.equal(report.proofs[0].evidence.length, 2);
  assert.match(report.proofs[0].urls.media, /quality=hd/);

  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /must-not-leak/);
  assert.doesNotMatch(serialized, /private@example\.test/);
  assert.doesNotMatch(serialized, /Private editorial notes/);
  assert.doesNotMatch(serialized, /birthYear|adultConfirmed|privatePhone|validationNote/);
  assert.doesNotMatch(serialized, /rule_private_1.*private@example\.test/);
});
