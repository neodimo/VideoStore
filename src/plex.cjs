const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

function plexDatabasePath(platform = process.platform, env = process.env, home = os.homedir()) {
  const support = platform === 'win32'
    ? path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Plex Media Server')
    : path.join(env.PLEX_MEDIA_SERVER_APPLICATION_SUPPORT_DIR || path.join(home, 'Library', 'Application Support'), 'Plex Media Server');
  return path.join(support, 'Plug-in Support', 'Databases', 'com.plexapp.plugins.library.db');
}

function readPlexLibraries(databasePath = plexDatabasePath()) {
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const rows = database.prepare(`
      SELECT sections.name AS name, sections.section_type AS section_type, locations.root_path AS root_path
      FROM section_locations AS locations
      JOIN library_sections AS sections ON sections.id = locations.library_section_id
      WHERE sections.section_type IN (1, 2)
      ORDER BY sections.id, locations.root_path
    `).all();
    const seen = new Set();
    return rows.flatMap(row => {
      if (typeof row.root_path !== 'string' || !path.isAbsolute(row.root_path)) return [];
      const type = row.section_type === 1 ? 'movie' : 'tv';
      const key = `${type}:${process.platform === 'win32' ? row.root_path.toLowerCase() : row.root_path}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ type, name: String(row.name || (type === 'movie' ? 'Movies' : 'TV Shows')), path: row.root_path }];
    });
  } catch (error) {
    if (error.code === 'ERR_SQLITE_ERROR' || error.code === 'ERR_SQLITE_CANTOPEN') throw new Error('Plex library database is unavailable or has an unsupported format');
    throw error;
  } finally { database?.close(); }
}

async function discoverPlexLibraries(databasePath) {
  const roots = readPlexLibraries(databasePath);
  return Promise.all(roots.map(async root => {
    try {
      const resolved = await fs.realpath(root.path);
      if (!(await fs.stat(resolved)).isDirectory()) throw new Error('Not a directory');
      return { ...root, path: resolved, available: true };
    } catch (error) { return { ...root, available: false, reason: error.code || error.message }; }
  }));
}

function plexPathKey(filePath, platform = process.platform) {
  return platform === 'win32' ? path.win32.normalize(filePath).toLowerCase() : path.normalize(filePath);
}

// Reuse file associations, not title searches: Plex may have manually corrected matches.
function readPlexMetadata(databasePath = plexDatabasePath(), platform = process.platform) {
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const columns = table => new Set(database.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
    const metadataColumns = columns('metadata_items');
    const partColumns = columns('media_parts');
    const mediaColumns = columns('media_items');
    const optional = (alias, column) => metadataColumns.has(column) ? `${alias}.${column}` : 'NULL';
    const active = (alias, available) => available.has('deleted_at') ? ` AND ${alias}.deleted_at IS NULL` : '';
    const rows = database.prepare(`
      SELECT parts.file AS file, item.id AS rating_key, item.metadata_type AS metadata_type,
        item.title AS item_title, item.year AS item_year, ${optional('item', 'guid')} AS item_guid,
        ${optional('item', 'summary')} AS summary, item."index" AS episode,
        season."index" AS season, show.id AS show_key, show.title AS show_title,
        show.year AS show_year, ${optional('show', 'guid')} AS show_guid
      FROM media_parts AS parts
      JOIN media_items AS media ON media.id = parts.media_item_id
      JOIN metadata_items AS item ON item.id = media.metadata_item_id
      JOIN library_sections AS section ON section.id = item.library_section_id
      LEFT JOIN metadata_items AS season ON season.id = item.parent_id AND season.metadata_type = 3
      LEFT JOIN metadata_items AS show ON show.id = season.parent_id AND show.metadata_type = 2
      WHERE ((item.metadata_type = 1 AND section.section_type = 1)
        OR (item.metadata_type = 4 AND section.section_type = 2 AND show.id IS NOT NULL))
        ${active('parts', partColumns)} ${active('media', mediaColumns)} ${active('item', metadataColumns)}
        ${metadataColumns.has('deleted_at') ? 'AND (show.id IS NULL OR show.deleted_at IS NULL) AND (season.id IS NULL OR season.deleted_at IS NULL)' : ''}
      ORDER BY item.id, parts.id
    `).all();
    const result = new Map();
    const ambiguous = new Set();
    for (const row of rows) {
      if (typeof row.file !== 'string' || !path[platform === 'win32' ? 'win32' : 'posix'].isAbsolute(row.file)) continue;
      const tv = row.metadata_type === 4;
      const title = tv ? row.show_title : row.item_title;
      if (typeof title !== 'string' || !title.trim()) continue;
      if (tv && (!Number.isInteger(row.season) || !Number.isInteger(row.episode))) continue;
      const key = plexPathKey(row.file, platform);
      const metadata = {
        title, year: (tv ? row.show_year : row.item_year) || null, type: tv ? 'tv' : 'movie',
        season: tv ? row.season : null, episode: tv ? row.episode : null,
        episodeTitle: tv ? row.item_title : null, summary: row.summary || null,
        plex: { ratingKey: String(row.rating_key), titleKey: String(tv ? row.show_key : row.rating_key),
          guid: (tv ? row.show_guid : row.item_guid) || null, source: 'Plex library metadata' }
      };
      // Multiple episodes in a single file need a richer model; never silently choose one.
      if (result.has(key) && result.get(key).plex.ratingKey !== metadata.plex.ratingKey) ambiguous.add(key);
      else result.set(key, metadata);
    }
    for (const key of ambiguous) result.delete(key);
    return { byPath: result, ambiguous: ambiguous.size };
  } catch (error) {
    throw new Error(`Plex metadata unavailable: ${error.code || error.message}`);
  } finally { database?.close(); }
}

function applyPlexMetadata(item, metadata) {
  if (!metadata) return false;
  // Deliberately leave quality/probe facts, editions, and VideoStore watch state alone.
  const changed = Object.keys(metadata).some(key => JSON.stringify(item[key]) !== JSON.stringify(metadata[key]));
  if (changed) Object.assign(item, metadata);
  return changed;
}

module.exports = { plexDatabasePath, readPlexLibraries, discoverPlexLibraries, readPlexMetadata, plexPathKey, applyPlexMetadata };
