const test = require('node:test');
const assert = require('node:assert/strict');
const { listHostLibrary } = require('../src/host-library.cjs');
const { validateConfig } = require('../src/ssh-tunnel.cjs');

test('paired host library groups versions and never exposes Plex paths', () => {
  const file = (id, rank) => ({ id, type: 'movie', title: 'Example Film', year: 2024, filename: `${id}.mkv`, path: `C:\\Plex\\private\\${id}.mkv`, sizeBytes: 1000, quality: { resolution: '2160p', hdr: 'HDR10', probeStatus: 'media probed' }, rank: { points: rank } });
  const result = listHostLibrary([file('old', 10), file('best', 90), { ...file('other', 20), title: 'Another' }], 'example', 0, 60);
  assert.equal(result.total, 1);
  assert.deepEqual(result.items[0].versions.map(version => version.id), ['best', 'old']);
  assert.doesNotMatch(JSON.stringify(result), /Plex|private|path/);
  assert.equal(listHostLibrary([file('one', 1)], '', 0, 1000).items.length, 1);
});

test('SSH tunnel accepts only a private VideoStore destination', () => {
  assert.equal(validateConfig({ host: 'media.example', username: 'omid', serviceHost: '127.0.0.1' }).port, 22);
  assert.throws(() => validateConfig({ host: 'media.example', username: 'omid', serviceHost: '8.8.8.8' }), /private/);
  assert.throws(() => validateConfig({ host: 'media.example', username: 'omid', port: 70000 }), /port/);
});
