const path = require('node:path');

const titleKey = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const seasonNumber = name => /^specials$/i.test(name) ? 0 : Number(name.match(/^(?:season[ ._-]*|s)(\d{1,2})$/i)?.[1] ?? NaN);

// Only a year before the episode marker identifies a remake; an episode title may contain a year too.
function showYear(file) {
  const prefix = file.filename.split(/\b(?:s\d{1,2}[ ._-]*e\d{1,3}|\d{1,2}x\d{1,3})\b/i)[0];
  return Number(prefix.match(/(?:^|[ ._(])((?:19|20)\d{2})(?=[ ._)\-]|$)/)?.[1]) || null;
}

function resolveTvPath(file, destination, libraryItems, fallback) {
  const paths = /^[A-Za-z]:[\\/]/.test(destination.path) ? path.win32 : path;
  const year = showYear(file);
  let matches = libraryItems.filter(item => item.type === 'tv' && titleKey(item.title) === titleKey(file.parsed.title) && (!year || item.year === year));
  // Prefer Plex's exact identities to older filename guesses when both exist.
  if (matches.some(item => item.plex?.titleKey)) matches = matches.filter(item => item.plex?.titleKey);
  const identities = new Set(matches.map(item => item.plex?.titleKey || `${titleKey(item.title)}:${item.year || ''}`));
  if (identities.size > 1) throw new Error(`Multiple TV shows match ${file.parsed.title}; select a year-qualified file before placement`);

  const folders = new Map();
  for (const item of matches) {
    if (typeof item.path !== 'string') continue;
    const relative = paths.relative(destination.path, item.path);
    if (!relative || paths.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${paths.sep}`)) continue;
    const parts = relative.split(paths.sep).slice(0, -1);
    if (!parts.length) continue; // Root-level legacy episodes are not a show folder.
    const seasonIndex = parts.findIndex((part, index) => index > 0 && seasonNumber(part) === item.season);
    let showParts;
    if (seasonIndex > 0) showParts = parts.slice(0, seasonIndex);
    else {
      const indices = parts.map((part, index) => titleKey(part.replace(/\s*\((?:19|20)\d{2}\)\s*$/, '')) === titleKey(item.title) ? index : -1).filter(index => index >= 0);
      if (indices.length === 1) showParts = parts.slice(0, indices[0] + 1);
      else if (parts.length === 1) showParts = parts;
      else continue; // Do not mistake a nested release-pack directory for a show.
    }
    const show = paths.join(...showParts);
    const key = process.platform === 'win32' || paths === path.win32 ? show.toLowerCase() : show;
    if (!folders.has(key)) folders.set(key, { show, seasons: new Set() });
    if (seasonIndex > 0 && item.season === file.parsed.season) folders.get(key).seasons.add(parts[seasonIndex]);
  }

  // Reuse an existing season before a show-only match; never pick an arbitrary duplicate folder.
  const withSeason = [...folders.values()].filter(folder => folder.seasons.size);
  const candidates = withSeason.length ? withSeason : [...folders.values()];
  if (candidates.length > 1 || candidates.some(folder => folder.seasons.size > 1))
    throw new Error(`Multiple existing TV folders match ${file.parsed.title}; review the destination before placement`);
  if (!candidates.length) return { relativePath: fallback, reuse: 0 };
  const folder = candidates[0];
  const season = [...folder.seasons][0] || `Season ${String(file.parsed.season).padStart(2, '0')}`;
  // Episode files go directly in the season, even if old files lived in release subfolders.
  return { relativePath: paths.join(folder.show, season, paths.basename(fallback)), reuse: folder.seasons.size ? 2 : 1 };
}

module.exports = { resolveTvPath, showYear };
