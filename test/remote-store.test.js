const test = require('node:test');
const assert = require('node:assert/strict');
const { createRemoteStore } = require('../src/storage/remoteStore');

test('isole les cles et files d ecriture du store distant par session', async () => {
  const values = new Map();
  const calls = [];
  const remote = createRemoteStore({
    url: 'https://redis.example.test',
    token: 'secret',
    key: 'mediagatherer:store',
    ttlSeconds: 3600,
    fetch: async (_url, options) => {
      const command = JSON.parse(options.body);
      calls.push(command);
      if (command[0] === 'SET') values.set(command[1], command[2]);
      return {
        ok: true,
        json: async () => ({
          result: command[0] === 'GET' ? values.get(command[1]) || null : 'OK'
        })
      };
    }
  });

  assert.equal(remote.scopedKey('global'), 'mediagatherer:store:global');
  assert.equal(remote.scopedKey('session_a'), 'mediagatherer:store:session:session_a');
  assert.equal(remote.scopedKey('../unsafe'), 'mediagatherer:store:global');

  await Promise.all([
    remote.persist({ history: [{ id: 'a' }] }, 'session_a'),
    remote.persist({ history: [{ id: 'b' }] }, 'session_b')
  ]);
  assert.deepEqual(await remote.load('session_a'), { history: [{ id: 'a' }] });
  assert.deepEqual(await remote.load('session_b'), { history: [{ id: 'b' }] });
  assert.ok(calls.some(command => (
    command[1] === 'mediagatherer:store:session:session_a' &&
    command.slice(-2).join(':') === 'EX:3600'
  )));
  assert.ok(calls.some(command => command[1] === 'mediagatherer:store:session:session_b'));
  assert.equal(remote.status('session_a').scope, 'session_a');
});
