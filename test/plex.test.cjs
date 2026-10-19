const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { readPlexLibraries, discoverPlexLibraries, readPlexMetadata, applyPlexMetadata } = require('../src/plex.cjs');

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

test('reuses exact Plex file associations, TV hierarchy and manual titles without modifying the database', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'videostore-plex-metadata-'));
  const databasePath = path.join(root, 'plex.db');
  try {
    const database = new DatabaseSync(databasePath);
    database.exec(String.raw`
      CREATE TABLE library_sections (id INTEGER PRIMARY KEY, section_type INTEGER);
      CREATE TABLE metadata_items (id INTEGER PRIMARY KEY, library_section_id INTEGER, metadata_type INTEGER,
        parent_id INTEGER, title TEXT, year INTEGER, "index" INTEGER, guid TEXT, summary TEXT, deleted_at INTEGER);
      CREATE TABLE media_items (id INTEGER PRIMARY KEY, metadata_item_id INTEGER, deleted_at INTEGER);
      CREATE TABLE media_parts (id INTEGER PRIMARY KEY, media_item_id INTEGER, file TEXT, deleted_at INTEGER);
      INSERT INTO library_sections VALUES (1,1),(2,2),(3,8);
      INSERT INTO metadata_items VALUES
        (10,1,1,NULL,'Manually Corrected Movie',1999,NULL,'plex://movie/abc','Movie summary',NULL),
        (20,2,2,NULL,'Correct Show',2005,NULL,'plex://show/def','Show summary',NULL),
        (21,2,3,20,'Specials',NULL,0,NULL,NULL,NULL),
        (22,2,4,21,'A Special Episode',2007,3,'plex://episode/aaa','Episode summary',NULL),
        (23,2,4,21,'Other Episode',2007,4,NULL,NULL,NULL),
        (30,1,1,NULL,'Deleted Movie',2000,NULL,NULL,NULL,123),
        (40,3,1,NULL,'Not a movie library',2001,NULL,NULL,NULL,NULL);
      INSERT INTO media_items VALUES (1,10,NULL),(2,22,NULL),(3,23,NULL),(4,30,NULL),(5,40,NULL),(6,10,NULL);
      INSERT INTO media_parts VALUES
        (1,1,'C:\Movies\meaningless.mkv',NULL),
        (2,1,'C:\Movies\second-version.mkv',NULL),
        (3,2,'C:\TV\meaningless.mp4',NULL),
        (4,2,'C:\TV\multi.mkv',NULL),(5,3,'C:\TV\multi.mkv',NULL),
        (6,4,'C:\Movies\deleted.mkv',NULL),
        (7,5,'C:\Music\other.mp4',NULL),(8,6,'C:\Movies\deleted-part.mkv',123);
    `);
    database.exec(`CREATE TABLE tags (id INTEGER, tag_type INTEGER, tag TEXT);
      CREATE TABLE taggings (metadata_item_id INTEGER, tag_id INTEGER);
      INSERT INTO tags VALUES (1,314,'imdb://tt0103639'),(2,314,'imdb://tt12345');
      INSERT INTO taggings VALUES (10,1),(20,2);
      ALTER TABLE metadata_items ADD COLUMN hash TEXT;
      ALTER TABLE metadata_items ADD COLUMN user_thumb_url TEXT;
      UPDATE metadata_items SET hash='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', user_thumb_url='metadata://posters/selected' WHERE id IN (10,20);`);
    database.close();
    const before = await fs.readFile(databasePath);
    const result = readPlexMetadata(databasePath, 'win32');
    assert.equal(result.byPath.size, 3);
    assert.equal(result.ambiguous, 1);
    const movie = result.byPath.get('c:\\movies\\meaningless.mkv');
    assert.equal(movie.title, 'Manually Corrected Movie');
    assert.equal(movie.year, 1999);
    assert.equal(movie.plex.imdbId, 'tt0103639');
    assert.equal(movie.plex.artwork.thumb, 'metadata://posters/selected');
    assert.equal(movie.plex.titleKey, result.byPath.get('c:\\movies\\second-version.mkv').plex.titleKey);
    const episode = result.byPath.get('c:\\tv\\meaningless.mp4');
    assert.equal(episode.title, 'Correct Show');
    assert.equal(episode.plex.imdbId, 'tt12345');
    assert.equal(episode.plex.artwork.type, 'tv');
    assert.equal(episode.year, 2005);
    assert.equal(episode.season, 0);
    assert.equal(episode.episode, 3);
    assert.equal(episode.episodeTitle, 'A Special Episode');
    const quality = { probeStatus: 'filename only', hdr: 'HDR10' };
    const item = { title: 'Wrong filename guess', quality, watched: true, edition: 'Extended', id: 'keep' };
    assert.equal(applyPlexMetadata(item, movie), true);
    assert.equal(applyPlexMetadata(item, movie), false);
    assert.equal(applyPlexMetadata(item, undefined), false);
    assert.equal(item.quality, quality);
    assert.equal(item.watched, true);
    assert.equal(item.edition, 'Extended');
    assert.equal(item.id, 'keep');
    assert.deepEqual(await fs.readFile(databasePath), before);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('unsupported Plex metadata schema fails explicitly rather than inventing matches', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'videostore-plex-schema-'));
  const file = path.join(root, 'plex.db');
  try {
    new DatabaseSync(file).close();
    assert.throws(() => readPlexMetadata(file), /Plex metadata unavailable/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
