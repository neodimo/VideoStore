const test = require('node:test');
const assert = require('node:assert/strict');
const { createMediaController } = require('../src/media-controller.cjs');

test('cart submits only host-held Real-Debrid URL and records completion', async () => {
  let resolved;
  const completed = new Promise(resolve => { resolved = resolve; });
  const controller = createMediaController({
    getToken: async () => 'private-token',
    getDestinations: () => [{ id: 'disk', type: 'movie', path: '/media', layout: 'movie-folder' }],
    onImported: async () => {},
    onJobsChanged: jobs => { if (jobs[0]?.state === 'completed') resolved(jobs[0]); },
    listImpl: async token => { assert.equal(token, 'private-token'); return [{ id: 'rd-1', provider: 'real-debrid', filename: 'Example.2020.mkv', sizeBytes: 100, sourceUrl: 'https://cdn.example.com/private' }]; },
    planImpl: async () => [{ filename: 'Example.2020.mkv', sizeBytes: 100, destinationId: 'disk', destinationLabel: 'Media', relativePath: 'Example (2020)/Example.2020.mkv', freeBeforeBytes: 1000, freeAfterBytes: 900, floorBytes: 500 }],
    downloadImpl: async ({ candidate }) => { assert.equal(candidate.sourceUrl, 'https://cdn.example.com/private'); return { path: '/media/Example (2020)/Example.2020.mkv', indexed: true }; }
  });
  const listed = await controller.refreshCandidates();
  assert.equal(listed[0].sourceUrl, undefined);
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
