const path = require('node:path');
const fs = require('node:fs/promises');
const { plexDatabasePath } = require('./plex.cjs');

// Resolve only Plex-selected poster names inside its metadata bundles. Never
// accept a client path, URL, or raw GUID. Plex's cache is read-only to this app.
async function plexPoster(artwork, supportRoot = path.resolve(plexDatabasePath(), '../../..')) {
  if (!artwork || !['movie','tv'].includes(artwork.type) || !/^[a-f0-9]{40}$/.test(artwork.hash || '')) return null;
  const name = /^metadata:\/\/posters\/([A-Za-z0-9_.-]+)$/.exec(artwork.thumb || '')?.[1];
  if (!name || name === '.' || name === '..') return null;
  const file = path.join(supportRoot, 'Metadata', artwork.type === 'tv' ? 'TV Shows' : 'Movies', artwork.hash[0], artwork.hash.slice(1) + '.bundle', 'Contents', '_combined', 'posters', name);
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024 || stat.size === 0) return null;
    const bytes = await fs.readFile(file);
    const mime = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP' ? 'image/webp' : null;
    return mime ? `data:${mime};base64,${bytes.toString('base64')}` : null;
  } catch (error) { if (['ENOENT','EACCES','EPERM'].includes(error.code)) return null; throw error; }
}
module.exports = { plexPoster };
