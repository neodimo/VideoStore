const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { readPlexLibraries, discoverPlexLibraries } = require('../src/plex.cjs');

test('reads Plex movie/TV roots without editing its database or including other sections', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'videostore-plex-'));
  const movies = path.join(root, 'Movies');
  const tv = path.join(root, 'TV');
  const missing = path.join(root, 'Missing');
  const databasePath = path.join(root, 'plex.db');
  await fs.mkdir(movies);
  await fs.mkdir(tv);
  const database = new DatabaseSync(databasePath);
  try {
    database.exec('CREATE TABLE library_sections (id INTEGER PRIMARY KEY, name TEXT, section_type INTEGER); CREATE TABLE section_locations (library_section_id INTEGER, root_path TEXT)');
    const section = database.prepare('INSERT INTO library_sections VALUES (?, ?, ?)');
    section.run(1, 'Movies', 1); section.run(2, 'Shows', 2); section.run(3, 'Music', 8);
    const location = database.prepare('INSERT INTO section_locations VALUES (?, ?)');
    location.run(1, movies); location.run(1, movies); location.run(2, tv); location.run(2, missing); location.run(3, root);
    database.close();
    const roots = readPlexLibraries(databasePath);
    assert.equal(roots.length, 3);
    assert.deepEqual(roots.map(item => item.type).sort(), ['movie', 'tv', 'tv']);
    const detected = await discoverPlexLibraries(databasePath);
    assert.equal(detected.filter(item => item.available).length, 2);
    assert.equal(detected.find(item => item.path === missing).available, false);
    const verify = new DatabaseSync(databasePath, { readOnly: true });
    assert.equal(verify.prepare('SELECT count(*) AS count FROM section_locations').get().count, 5);
    verify.close();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
