const test = require('node:test');
const assert = require('node:assert/strict');
const { GiB, evaluateDestination, recommend } = require('../src/storage.cjs');

test('space floor blocks a nearly full Plex drive and prefers headroom', () => {
  const movieF = { id: 'F', label: 'Movies', path: 'F:/Movies', type: 'movie', reservePercent: 10, reserveBytes: 500 * GiB };
  const movieG = { id: 'G', label: 'Media', path: 'G:/Movies', type: 'movie', reservePercent: 10, reserveBytes: 500 * GiB };
  const f = evaluateDestination(movieF, 50 * GiB, { blocks: 2441600511, bavail: 37467535, bsize: 4096 });
  const g = evaluateDestination(movieG, 50 * GiB, { blocks: 2441473791, bavail: 1983980222, bsize: 8192 });
  assert.equal(f.eligible, false);
  assert.equal(g.eligible, true);
  assert.equal(recommend([f, g], 'movie').id, 'G');
});

test('unknown file size cannot produce an unsafe placement', () => {
  assert.throws(() => evaluateDestination({ id: 'x' }, 0, { blocks: 10, bavail: 10, bsize: 4096 }), /exact positive file size/);
});
