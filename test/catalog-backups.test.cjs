const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { backupCatalog, pruneCatalogBackups } = require('../src/catalog-backups.cjs');

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

test('startup cleanup removes excess old snapshots without touching the live catalog', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'videostore-backups-'));
  try {
    const libraryPath = path.join(directory, 'library.json');
    await fs.writeFile(libraryPath, 'live');
    const backupName = i => `library.json.pre-plex-00000000-0000-4000-8000-${String(i).padStart(12, '0')}.bak`;
    await fs.writeFile(path.join(directory, 'library.json.pre-plex-personal.bak'), 'keep');
    for (let i = 0; i < 70; i++) {
      const file = path.join(directory, backupName(i));
      await fs.writeFile(file, String(i));
      const timestamp = new Date(Date.now() - (70 - i) * 1000);
      await fs.utimes(file, timestamp, timestamp);
    }
    await pruneCatalogBackups(libraryPath);
    assert.equal(await fs.readFile(libraryPath, 'utf8'), 'live');
    assert.equal(await fs.readFile(path.join(directory, 'library.json.pre-plex-personal.bak'), 'utf8'), 'keep');
    assert.deepEqual((await fs.readdir(directory)).filter(name => name.endsWith('.bak')).sort(),
      [...[67, 68, 69].map(backupName), 'library.json.pre-plex-personal.bak']);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
