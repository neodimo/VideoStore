const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { evaluateDestination } = require('./storage.cjs');

function safeDownloadUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Provider returned an invalid download URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || net.isIP(url.hostname) || /(^localhost$|\.local$|\.internal$|\.test$|\.invalid$)/i.test(url.hostname)) throw new Error('Provider download URL is not a public HTTPS endpoint');
  return url;
}

async function fetchDownload(url, signal, fetchImpl = fetch) {
  let current = safeDownloadUrl(url);
  for (let redirects = 0; redirects < 4; redirects++) {
    const response = await fetchImpl(current, { signal, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Provider redirect has no destination');
      current = safeDownloadUrl(new URL(location, current).href);
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`Provider download returned HTTP ${response.status}`);
    return response;
  }
  throw new Error('Provider download redirected too many times');
}

async function downloadToLibrary({ id, candidate, placement, destination, signal, onProgress = () => {}, fetchImpl = fetch, onImported = async () => {} }) {
  if (!candidate.sourceUrl || !Number.isSafeInteger(candidate.sizeBytes) || candidate.sizeBytes <= 0) throw new Error('Provider link needs a known exact size');
  if (placement.destinationId !== destination.id || placement.sizeBytes !== candidate.sizeBytes || placement.filename !== candidate.filename) throw new Error('Placement no longer matches the selected source');
  const stat = await fs.statfs(destination.path);
  const fresh = evaluateDestination(destination, candidate.sizeBytes, stat);
  if (!fresh.eligible) throw new Error('Drive no longer has enough space above its floor');
  const finalPath = path.join(destination.path, placement.relativePath);
  if (await fs.access(finalPath).then(() => true, () => false)) throw new Error('Destination file already exists; no file was replaced');
  const stagingRoot = path.join(path.dirname(destination.path), '.videostore-staging');
  const stagingPath = path.join(stagingRoot, `${id}.partial`);
  await fs.mkdir(stagingRoot, { recursive: true });
  let written = 0;
  let lastUpdate = 0;
  let nextSpaceCheck = 64 * 1024 * 1024;
  try {
    const response = await fetchDownload(candidate.sourceUrl, signal, fetchImpl);
    const declared = Number(response.headers?.get('content-length'));
    if (Number.isFinite(declared) && declared > candidate.sizeBytes) throw new Error('Provider advertised more bytes than the placement preview');
    await pipeline(Readable.fromWeb(response.body), new Transform({ async transform(chunk, _encoding, callback) {
      written += chunk.length;
      if (written > candidate.sizeBytes) return callback(new Error('Provider sent more bytes than advertised'));
      if (written >= nextSpaceCheck) {
        nextSpaceCheck = written + 64 * 1024 * 1024;
        try {
          const current = evaluateDestination(destination, candidate.sizeBytes - written, await fs.statfs(destination.path));
          if (!current.eligible) return callback(new Error('Drive space fell below its configured floor during download'));
        } catch (error) { return callback(error); }
      }
      const now = Date.now();
      if (now - lastUpdate > 500) { onProgress(written, candidate.sizeBytes); lastUpdate = now; }
      callback(null, chunk);
    } }), createWriteStream(stagingPath, { flags: 'wx', mode: 0o600 }), { signal });
    if (written !== candidate.sizeBytes) throw new Error(`Incomplete download: received ${written} of ${candidate.sizeBytes} bytes`);
    const handle = await fs.open(stagingPath, 'r+');
    try { await handle.sync(); } finally { await handle.close(); }
    if (await fs.access(finalPath).then(() => true, () => false)) throw new Error('Destination file appeared during download; no file was replaced');
    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    await fs.rename(stagingPath, finalPath);
    onProgress(written, candidate.sizeBytes);
    try { await onImported(finalPath); return { path: finalPath, indexed: true }; }
    catch { return { path: finalPath, indexed: false, warning: 'Download completed but library indexing failed; the media file was kept' }; }
  } catch (error) {
    await fs.unlink(stagingPath).catch(() => {});
    if (signal?.aborted) throw new Error('Download cancelled; partial file removed');
    throw error;
  }
}

module.exports = { safeDownloadUrl, fetchDownload, downloadToLibrary };
