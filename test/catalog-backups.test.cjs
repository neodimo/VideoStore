const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { backupCatalog } = require('../src/catalog-backups.cjs');

test('Plex catalog backups retain a pre-change copy without growing on repeated refreshes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'videostore-backups-'));
  try {
    const libraryPath = path.join(directory, 'library.json');
    await fs.writeFile(libraryPath, 'original');
    const first = await backupCatalog(libraryPath, { now: () => Date.now(), minIntervalMs: 60_000, maxBackups: 2 });
    await fs.writeFile(libraryPath, 'changed');
    assert.equal(await backupCatalog(libraryPath, { now: () => Date.now(), minIntervalMs: 60_000, maxBackups: 2 }), first);
    assert.equal(await fs.readFile(first, 'utf8'), 'original');
    for (let i = 0; i < 3; i++) {
      const old = new Date(Date.now() - 120_000);
      const names = (await fs.readdir(directory)).filter(name => name.endsWith('.bak'));
      for (const name of names) await fs.utimes(path.join(directory, name), old, old);
      await backupCatalog(libraryPath, { now: () => Date.now(), minIntervalMs: 60_000, maxBackups: 2 });
    }
    assert.equal((await fs.readdir(directory)).filter(name => name.endsWith('.bak')).length, 2);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
