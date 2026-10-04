const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, searchCatalog, getMeta } = require('../src/catalog.cjs');
const { testProvider } = require('../src/providers.cjs');

test('catalog preserves IMDb and episode identities and rejects untrusted art origins', () => {
  const meta = normalize({ id: 'tt12345', type: 'series', name: 'A Show', poster: 'https://evil.example/poster', videos: [
    { season: 0, episode: 1, name: 'Special' }, { season: 1, number: 2, id: 'tt12345:1:2' }
  ] });
  assert.equal(meta.poster, null);
  assert.equal(meta.videos[0].id, 'tt12345:0:1');
  assert.equal(meta.videos[1].episode, 2);
});

test('catalog search uses the documented movie and series resources', async () => {
  const urls = [];
  const fetchStub = async url => { urls.push(url); return { ok: true, json: async () => ({ metas: [{ id: 'tt12345', name: 'A Title' }] }) }; };
  assert.equal((await searchCatalog('A Title', fetchStub)).length, 2);
  assert.ok(urls.some(url => url.includes('/catalog/movie/top/search=A%20Title.json')));
  assert.ok(urls.some(url => url.includes('/catalog/series/top/search=A%20Title.json')));
  const meta = await getMeta('series', 'tt12345', async url => ({ ok: true, json: async () => ({ meta: { id: 'tt12345', type: 'series', name: 'A Show' } }) }));
  assert.equal(meta.name, 'A Show');
});

test('provider tokens stay in authorization headers and errors do not echo them', async () => {
  let seen;
  const result = await testProvider('real-debrid', 'private-token', async (url, options) => {
    seen = { url, authorization: options.headers.Authorization };
    return { ok: true, json: async () => ({ username: 'test' }) };
  });
  assert.equal(result.connected, true);
  assert.equal(seen.authorization, 'Bearer private-token');
  assert.ok(!seen.url.includes('private-token'));
  await assert.rejects(testProvider('torbox', 'private-token', async () => ({ ok: false, status: 401 })), error => !error.message.includes('private-token'));
});
