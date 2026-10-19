const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validateCartFile, relativeMediaPath, planCart } = require('../src/placement.cjs');
const { resolveTvPath } = require('../src/tv-placement.cjs');
const { GiB } = require('../src/storage.cjs');

const file = name => validateCartFile({ name, sizeBytes: GiB });
const episode = (location, options = {}) => ({ type: 'tv', title: 'Example Show', year: 2020, season: 1, path: location, plex: { titleKey: 'show-1' }, ...options });
function resolve(name, root, items) {
  const selected = file(name);
  return resolveTvPath(selected, { path: root }, items, relativeMediaPath(selected, 'tv-season'));
}

test('TV placement reuses nested Plex show and Sxx season folders, not release folders', () => {
  const result = resolve('Example.Show.S01E02.mkv', 'G:\\TV', [episode('G:\\TV\\Drama\\Example Show (2020)\\S01\\Release.Pack\\S01E01.mkv')]);
  assert.equal(result.relativePath, 'Drama\\Example Show (2020)\\S01\\Example.Show.S01E02.mkv');
  assert.equal(result.reuse, 2);
  const specials = resolve('Example.Show.S00E01.mkv', '/tv', [episode('/tv/Example Show/Specials/old.mkv', { season: 0 })]);
  assert.equal(specials.relativePath, path.join('Example Show', 'Specials', 'Example.Show.S00E01.mkv'));
});

test('flat legacy episodes stay untouched while new episodes get a season under the existing show', () => {
  const items = [episode('/tv/Example.Show.(2020)/old.mkv')];
  const snapshot = JSON.stringify(items);
  const result = resolve('Example.Show.S02E03.mkv', '/tv', items);
  assert.equal(result.relativePath, path.join('Example.Show.(2020)', 'Season 02', 'Example.Show.S02E03.mkv'));
  assert.equal(JSON.stringify(items), snapshot);
  assert.equal(result.reuse, 1);
});

test('new TV folders retain a remake year but ignore years in episode titles', () => {
  assert.equal(resolve('New.Show.2025.S01E01.mkv', '/tv', []).relativePath, path.join('New Show (2025)', 'Season 01', 'New.Show.2025.S01E01.mkv'));
  assert.equal(resolve('New.Show.S01E01.The.Year.2025.mkv', '/tv', []).relativePath, path.join('New Show', 'Season 01', 'New.Show.S01E01.The.Year.2025.mkv'));
});

test('ambiguous remakes and duplicate season folders are withheld instead of guessed', () => {
  const originals = [episode('/tv/Example Show (2020)/Season 01/old.mkv'), episode('/tv/Example Show (2024)/Season 01/old.mkv', { year: 2024, plex: { titleKey: 'show-2' } })];
  assert.throws(() => resolve('Example.Show.S01E02.mkv', '/tv', originals), /Multiple TV shows/);
  assert.equal(resolve('Example.Show.2024.S01E02.mkv', '/tv', originals).relativePath, path.join('Example Show (2024)', 'Season 01', 'Example.Show.2024.S01E02.mkv'));
  assert.throws(() => resolve('Example.Show.S01E02.mkv', '/tv', [episode('/tv/Example Show/Season 01/old.mkv'), episode('/tv/Example Show/S01/other.mkv')]), /Multiple existing TV folders/);
  assert.equal(resolve('Example.Show.S01E02.mkv', '/tv', [episode('/other/Example Show/S01/old.mkv')]).reuse, 0);
});

test('TV placement keeps an existing season together when safe, but never crosses drive floors or overwrites', async () => {
  const destinations = ['a', 'b'].map(id => ({ id, path: `/${id}`, label: id, type: 'tv', layout: 'tv-season', reservePercent: 10, reserveBytes: 500 * GiB }));
  const items = [episode('/a/Example Show (2020)/S01/old.mkv')];
  let aFree = 600;
  const statfs = async root => ({ blocks: 2000, bavail: root === '/a' ? aFree : 1800, bsize: GiB });
  const files = [{ name: 'Example.Show.S01E02.mkv', sizeBytes: 10 * GiB }];
  const preview = () => planCart(files, destinations, statfs, async () => false, new Map(), items);
  assert.equal((await preview())[0].destinationId, 'a');
  aFree = 505;
  assert.equal((await preview())[0].destinationId, 'b');
  aFree = 600;
  const existing = await planCart(files, destinations, statfs, async target => target.startsWith('/a/'), new Map(), items);
  assert.equal(existing[0].destinationId, 'b');
});
