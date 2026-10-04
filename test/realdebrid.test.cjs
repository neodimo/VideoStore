const test = require('node:test');
const assert = require('node:assert/strict');
const { listDownloads, publicCandidate } = require('../src/realdebrid.cjs');

test('Real-Debrid account downloads become filename-claim candidates without exposing links', async () => {
  let authorization;
  const rows = await listDownloads('private-token', async (url, options) => {
    assert.equal(url, 'https://api.real-debrid.com/rest/1.0/downloads?limit=100');
    authorization = options.headers.Authorization;
    return { ok: true, json: async () => [
      { id: 'rd-1', filename: 'Example.Movie.2020.2160p.HDR.mkv', filesize: 1000000000, download: 'https://example.invalid/private-link' },
      { id: 'rd-2', filename: 'readme.txt', filesize: 100, download: 'https://example.invalid/no' }
    ] };
  });
  assert.equal(authorization, 'Bearer private-token');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quality.probeStatus, 'filename only');
  assert.equal(rows[0].sizeBytes, 1000000000);
  assert.equal(publicCandidate(rows[0]).sourceUrl, undefined);
});

test('Real-Debrid errors never echo the account token', async () => {
  await assert.rejects(listDownloads('private-token', async () => ({ ok: false, status: 401 })), error => !error.message.includes('private-token'));
});
