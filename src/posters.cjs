const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs/promises');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function posterCacheName(key, id) {
  if (!/^tt\d+$/.test(id)) throw new Error('Invalid IMDb ID');
  return crypto.createHash('sha256').update(`${key}:${id}:poster-default`).digest('hex');
}

async function ratingPoster(key, id, cacheRoot, fetchImpl = fetch) {
  if (typeof key !== 'string' || !key.trim() || key.length > 4096) return null;
  const name = posterCacheName(key.trim(), id);
  const cachePath = path.join(cacheRoot, `${name}.json`);
  try {
    const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    if (MIME[cached.mimeType] && typeof cached.data === 'string') return `data:${cached.mimeType};base64,${cached.data}`;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const url = `https://api.ratingposterdb.com/${encodeURIComponent(key.trim())}/imdb/poster-default/${id}.jpg`;
  let response;
  try { response = await fetchImpl(url, { signal: AbortSignal.timeout(12000) }); }
  catch { return null; }
  if (!response.ok) return null;
  const mimeType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!MIME[mimeType]) return null;
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_IMAGE_BYTES) return null;
  const data = Buffer.from(await response.arrayBuffer());
  if (!data.length || data.length > MAX_IMAGE_BYTES) return null;
  await fs.mkdir(cacheRoot, { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify({ mimeType, data: data.toString('base64') }), { mode: 0o600 });
  return `data:${mimeType};base64,${data.toString('base64')}`;
}

module.exports = { ratingPoster, posterCacheName };
