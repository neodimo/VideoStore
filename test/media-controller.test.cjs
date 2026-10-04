const test = require('node:test');
const assert = require('node:assert/strict');
const { createMediaController } = require('../src/media-controller.cjs');

test('cart submits only host-held Real-Debrid URL and records completion', async () => {
  let resolved;
  const completed = new Promise(resolve => { resolved = resolve; });
  const controller = createMediaController({
    getToken: async id => id === 'real-debrid' ? 'private-token' : null,
    getDestinations: () => [{ id: 'disk', type: 'movie', path: '/media', layout: 'movie-folder' }],
    onImported: async () => {},
    onJobsChanged: jobs => { if (jobs[0]?.state === 'completed') resolved(jobs[0]); },
    listImpl: async token => { assert.equal(token, 'private-token'); return [{ id: 'rd-1', provider: 'real-debrid', filename: 'Example.2020.mkv', sizeBytes: 100, sourceUrl: 'https://cdn.example.com/private' }]; },
    planImpl: async () => [{ filename: 'Example.2020.mkv', sizeBytes: 100, destinationId: 'disk', destinationLabel: 'Media', relativePath: 'Example (2020)/Example.2020.mkv', freeBeforeBytes: 1000, freeAfterBytes: 900, floorBytes: 500 }],
    downloadImpl: async ({ candidate }) => { assert.equal(candidate.sourceUrl, 'https://cdn.example.com/private'); return { path: '/media/Example (2020)/Example.2020.mkv', indexed: true }; }
  });
  const listed = await controller.refreshCandidates();
  assert.equal(listed.items[0].sourceUrl, undefined);
  const plan = await controller.preview(['rd-1']);
  assert.equal(JSON.stringify(plan).includes('cdn.example.com'), false);
  const ids = await controller.submit(plan.planId);
  assert.equal(ids.length, 1);
  assert.equal((await completed).state, 'completed');
  assert.equal(controller.visibleJobs()[0].sourceUrl, undefined);
});

test('in-progress jobs restored after a host restart are marked interrupted', () => {
  const controller = createMediaController({ getToken: async () => null, getDestinations: () => [], onImported: async () => {}, savedJobs: [{ id: 'old', state: 'downloading', filename: 'Example.mkv' }] });
  assert.equal(controller.visibleJobs()[0].state, 'interrupted');
});

test('TorBox-only cart resolves its selected file link only when the host job begins', async () => {
  let completed;
  const done = new Promise(resolve => { completed = resolve; });
  let linkRequests = 0;
  const controller = createMediaController({
    getToken: async id => id === 'torbox' ? 'private-torbox-token' : null,
    getDestinations: () => [{ id: 'disk', type: 'movie', path: '/media', layout: 'movie-folder' }],
    onImported: async () => {},
    onJobsChanged: jobs => { if (jobs[0]?.state === 'completed') completed(jobs[0]); },
    torboxListImpl: async () => ({ items: [{ id: 'tb:torrents:42:0', provider: 'torbox', filename: 'Example.2024.mkv', sizeBytes: 100, sourceRef: { kind: 'torrents', parentId: 42, fileId: 0 } }], warnings: [] }),
    torboxLinkImpl: async (token, sourceRef) => { assert.equal(token, 'private-torbox-token'); assert.equal(sourceRef.fileId, 0); linkRequests++; return 'https://cdn.example.com/host-file'; },
    planImpl: async () => [{ filename: 'Example.2024.mkv', sizeBytes: 100, destinationId: 'disk', destinationLabel: 'Media', relativePath: 'Example (2024)/Example.2024.mkv', freeBeforeBytes: 1000, freeAfterBytes: 900, floorBytes: 500 }],
    downloadImpl: async ({ candidate }) => { assert.equal(candidate.sourceUrl, 'https://cdn.example.com/host-file'); return { indexed: true }; }
  });
  const listed = await controller.refreshCandidates();
  assert.equal(listed.items[0].sourceRef, undefined);
  assert.equal(linkRequests, 0);
  const plan = await controller.preview(['tb:torrents:42:0']);
  assert.equal(JSON.stringify(plan).includes('private-torbox-token'), false);
  assert.equal(linkRequests, 0);
  await controller.submit(plan.planId);
  assert.equal((await done).provider, 'torbox');
  assert.equal(linkRequests, 1);
});

test('a failing Real-Debrid account does not hide ready TorBox files', async () => {
  const controller = createMediaController({
    getToken: async () => 'configured-token', getDestinations: () => [], onImported: async () => {},
    listImpl: async () => { throw new Error('Real-Debrid returned HTTP 503'); },
    torboxListImpl: async () => ({ items: [{ id: 'tb:usenet:5:0', provider: 'torbox', filename: 'Show.S01E01.mkv', sizeBytes: 100, sourceRef: { kind: 'usenet', parentId: 5, fileId: 0 } }], warnings: ['TorBox webdl list returned HTTP 503'] })
  });
  const result = await controller.refreshCandidates();
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].provider, 'torbox');
  assert.deepEqual(result.warnings, ['Real-Debrid: Real-Debrid returned HTTP 503', 'TorBox webdl list returned HTTP 503']);
});
