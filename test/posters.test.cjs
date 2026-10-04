const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ratingPoster, posterCacheName } = require('../src/posters.cjs');

test('RatingPosterDB poster is fetched by IMDb ID, cached, and returned without the key', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'videostore-posters-'));
  let calls = 0;
  try {
    const fetchImpl = async (url) => {
      calls++;
      assert.equal(url, 'https://api.ratingposterdb.com/private-key/imdb/poster-default/tt1234567.jpg');
      return { ok: true, headers: new Headers({ 'content-type': 'image/jpeg', 'content-length': '3' }), arrayBuffer: async () => Uint8Array.from([255, 216, 217]).buffer };
    };
    const first = await ratingPoster('private-key', 'tt1234567', root, fetchImpl);
    const second = await ratingPoster('private-key', 'tt1234567', root, fetchImpl);
    assert.equal(first, 'data:image/jpeg;base64,/9jZ');
    assert.equal(second, first);
    assert.equal(calls, 1);
    assert.ok(!posterCacheName('private-key', 'tt1234567').includes('private-key'));
    assert.ok(!(await fs.readFile(path.join(root, `${posterCacheName('private-key', 'tt1234567')}.json`), 'utf8')).includes('private-key'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('RatingPosterDB missing or invalid art falls back without caching error bodies', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'videostore-posters-'));
  try {
    assert.equal(await ratingPoster('private-key', 'tt1234567', root, async () => ({ ok: false, status: 404 })), null);
    assert.equal(await ratingPoster('private-key', 'tt1234567', root, async () => ({ ok: true, headers: new Headers({ 'content-type': 'text/html' }) })), null);
    assert.deepEqual(await fs.readdir(root), []);
    await assert.rejects(ratingPoster('private-key', '../bad', root), /Invalid IMDb ID/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
