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

module.exports = { plexDatabasePath, readPlexLibraries, discoverPlexLibraries };
