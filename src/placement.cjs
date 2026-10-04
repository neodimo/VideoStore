const fs = require('node:fs/promises');
const path = require('node:path');
const { VIDEO_EXTENSIONS, parseName } = require('./core.cjs');
const { evaluateDestination, recommend } = require('./storage.cjs');

const LAYOUTS = {
  movie: new Set(['movie-folder', 'movie-flat']),
  tv: new Set(['tv-season', 'tv-flat'])
};
const volumeKey = destination => /^[A-Za-z]:[\\/]/.test(destination.path) ? destination.path.slice(0, 2).toUpperCase() : destination.volumeKey || destination.id;

function safeSegment(value) {
  const cleaned = String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').trim();
  if (!cleaned || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(cleaned)) throw new Error('Invalid media path segment');
  return cleaned.slice(0, 180);
}

function validateCartFile(file) {
  if (!file || typeof file.name !== 'string' || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes <= 0) throw new Error('Each file needs a name and exact positive byte size');
  if (file.name !== path.posix.basename(file.name) || file.name !== path.win32.basename(file.name)) throw new Error('File paths are not accepted; select a file name only');
  const extension = path.extname(file.name).toLowerCase();
  if (!VIDEO_EXTENSIONS.has(extension)) throw new Error('Unsupported video file type');
  const base = safeSegment(file.name.slice(0, -extension.length));
  return { filename: `${base}${extension}`, sizeBytes: file.sizeBytes, parsed: parseName(`${base}${extension}`) };
}

function relativeMediaPath(file, layout) {
  const title = safeSegment(file.parsed.title);
  const filename = safeSegment(file.filename.slice(0, -path.extname(file.filename).length)) + path.extname(file.filename);
  if (!LAYOUTS[file.parsed.type]?.has(layout)) throw new Error('Folder layout must be confirmed before placement');
  if (layout === 'movie-flat' || layout === 'tv-flat') return filename;
  if (layout === 'movie-folder') return path.join(`${title}${file.parsed.year ? ` (${file.parsed.year})` : ''}`, filename);
  return path.join(title, `Season ${String(file.parsed.season).padStart(2, '0')}`, filename);
}

async function inferLayout(root, type) {
  let directories = 0;
  let files = 0;
  const sample = [];
  try {
    const handle = await fs.opendir(root);
    try {
      for await (const entry of handle) {
        if (entry.isDirectory()) { directories++; if (sample.length < 4) sample.push(entry.name); }
        else if (entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files++;
        if (directories + files >= 40) break;
      }
    } finally { await handle.close().catch(() => {}); }
  } catch { return 'unknown'; }
  if (directories + files < 3) return 'unknown';
  if (type === 'movie') return directories >= files * 3 ? 'movie-folder' : files >= directories * 3 ? 'movie-flat' : 'unknown';
  if (files >= directories * 3) return 'tv-flat';
  if (directories < files * 3) return 'unknown';
  for (const name of sample) {
    try {
      const show = await fs.opendir(path.join(root, name));
      try {
        for await (const entry of show) { if (entry.isDirectory() && /^Season[ ._-]*\d+$/i.test(entry.name)) return 'tv-season'; }
      } finally { await show.close().catch(() => {}); }
    } catch { /* An unreadable show is not layout evidence. */ }
  }
  return 'unknown';
}

async function planCart(files, destinations, statfs = fs.statfs, exists = async target => fs.access(target).then(() => true, () => false), activeReservations = new Map()) {
  if (!Array.isArray(files) || !files.length || files.length > 50) throw new Error('Select 1–50 video files');
  const normalized = files.map(validateCartFile);
  const stats = new Map();
  for (const destination of destinations) {
    try { stats.set(destination.id, await statfs(destination.path)); } catch { /* unavailable destinations stay ineligible */ }
  }
  const reserved = new Map(activeReservations);
  const planned = new Array(normalized.length);
  for (const index of normalized.map((_, i) => i).sort((a, b) => normalized[b].sizeBytes - normalized[a].sizeBytes)) {
    const file = normalized[index];
    const options = destinations.filter(d => d.type === file.parsed.type && LAYOUTS[file.parsed.type].has(d.layout) && stats.has(d.id)).map(d => {
      const evaluation = evaluateDestination(d, file.sizeBytes, stats.get(d.id), reserved.get(volumeKey(d)) || 0);
      return { ...evaluation, layout: d.layout, relativePath: relativeMediaPath(file, d.layout) };
    }).filter(option => option.eligible);
    const available = [];
    for (const option of options) if (!(await exists(path.join(option.path, option.relativePath))) && !planned.some(p => p && p.destinationId === option.id && p.relativePath === option.relativePath)) available.push(option);
    const best = recommend(available, file.parsed.type);
    if (!best) throw new Error(`No safe ${file.parsed.type === 'tv' ? 'TV' : 'movie'} destination for ${file.filename}; configure a folder layout or free-space floor`);
    const chosenDestination = destinations.find(d => d.id === best.id);
    const volume = volumeKey(chosenDestination);
    reserved.set(volume, (reserved.get(volume) || 0) + file.sizeBytes);
    planned[index] = { filename: file.filename, sizeBytes: file.sizeBytes, type: file.parsed.type, title: file.parsed.title, year: file.parsed.year, season: file.parsed.season, episode: file.parsed.episode, destinationId: best.id, destinationLabel: best.label, relativePath: best.relativePath, freeBeforeBytes: best.freeBytes, freeAfterBytes: best.afterBytes, floorBytes: best.floorBytes };
  }
  return planned;
}

module.exports = { safeSegment, validateCartFile, relativeMediaPath, inferLayout, planCart, LAYOUTS, volumeKey };
