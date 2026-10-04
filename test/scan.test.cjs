const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { scanVideos } = require('../src/scan.cjs');

test('folder scan indexes nested videos without following symlinks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'videostore-scan-'));
  try {
    await fs.mkdir(path.join(root, 'Season 1'));
    await fs.writeFile(path.join(root, 'Season 1', 'Pilot.mkv'), 'sample');
    await fs.writeFile(path.join(root, 'notes.txt'), 'ignore');
    try { await fs.symlink(root, path.join(root, 'loop'), process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) { if (error.code !== 'EPERM') throw error; }
    const result = await scanVideos(root);
    assert.deepEqual(result.files.map(file => path.basename(file)), ['Pilot.mkv']);
    assert.equal(result.cancelled, false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
