const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { GiB } = require('../src/storage.cjs');
const { validateCartFile, relativeMediaPath, planCart } = require('../src/placement.cjs');

test('cart paths respect movie and TV folder patterns and reject traversal', () => {
  const movie = validateCartFile({ name: 'Arrival.2016.2160p.mkv', sizeBytes: 15 * GiB });
  const show = validateCartFile({ name: 'Example.Show.S02E03.1080p.mkv', sizeBytes: 3 * GiB });
  assert.equal(relativeMediaPath(movie, 'movie-folder'), path.join('Arrival (2016)', movie.filename));
  assert.equal(relativeMediaPath(show, 'tv-season'), path.join('Example Show', 'Season 02', show.filename));
  assert.throws(() => validateCartFile({ name: '../bad.mkv', sizeBytes: 1 }), /File paths/);
  assert.throws(() => validateCartFile({ name: 'C:\\bad.mkv', sizeBytes: 1 }), /File paths/);
});

test('cart placement accounts for earlier items and refuses to cross drive floors', async () => {
  const destinations = [
    { id: 'A', label: 'A', path: '/a', type: 'movie', layout: 'movie-folder', reservePercent: 10, reserveBytes: 500 * GiB },
    { id: 'B', label: 'B', path: '/b', type: 'movie', layout: 'movie-folder', reservePercent: 10, reserveBytes: 500 * GiB }
  ];
  const statfs = async root => ({ blocks: 1500, bsize: GiB, bavail: root === '/a' ? 560 : 1200 });
  const files = [{ name: 'One.2020.mkv', sizeBytes: 300 * GiB }, { name: 'Two.2021.mkv', sizeBytes: 300 * GiB }];
  const plan = await planCart(files, destinations, statfs, async () => false);
  assert.deepEqual(plan.map(item => item.destinationId), ['B', 'B']);
  await assert.rejects(planCart([...files, { name: 'Three.2022.mkv', sizeBytes: 300 * GiB }], destinations, statfs, async () => false), /No safe movie destination/);
  await assert.rejects(planCart(files, destinations.map(item => ({ ...item, layout: 'unknown' })), statfs, async () => false), /No safe movie destination/);
});
