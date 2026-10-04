const path = require('node:path');
const { VIDEO_EXTENSIONS, parseName, probeQuality, score } = require('./core.cjs');
const { safeDownloadUrl } = require('./downloader.cjs');

const API = 'https://api.torbox.app/v1/api';
const KINDS = Object.freeze({ torrents: 'torrent_id', usenet: 'usenet_id', webdl: 'web_id' });

function basename(value) {
  return path.posix.basename(path.win32.basename(String(value || '')));
}

function normalizeFile(kind, row, file) {
  if (!Number.isSafeInteger(row.id) || row.id < 0 || !Number.isSafeInteger(file.id) || file.id < 0) return null;
  const filename = basename(file.short_name || file.name);
  if (!VIDEO_EXTENSIONS.has(path.extname(filename).toLowerCase()) || !Number.isSafeInteger(file.size) || file.size <= 0 || file.infected === true) return null;
  const parsed = parseName(filename);
  const quality = probeQuality(parsed, null, file.size);
  return {
    id: `tb:${kind}:${row.id}:${file.id}`, provider: 'torbox', sourceKind: kind,
    filename: parsed.filename, sizeBytes: file.size, type: parsed.type,
    title: parsed.title, year: parsed.year, season: parsed.season, episode: parsed.episode,
    quality, rank: score(quality, { hdr: true, surround: true, highBitrate: true }),
    sourceRef: { kind, parentId: row.id, fileId: file.id },
    availability: 'TorBox file ready; host requests link when downloading'
  };
}

async function listKind(kind, token, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${API}/${kind}/mylist?limit=100`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000)
    });
  } catch { throw new Error(`TorBox ${kind} list could not be reached`); }
  if (!response.ok) throw new Error(`TorBox ${kind} list returned HTTP ${response.status}`);
  let body;
  try { body = await response.json(); } catch { throw new Error(`TorBox ${kind} list returned invalid JSON`); }
  if (body?.success !== true || !Array.isArray(body.data)) throw new Error(`TorBox ${kind} list returned an unsuccessful or unexpected response`);
  return body.data.filter(row => row?.download_finished === true && row.download_present === true && Array.isArray(row.files))
    .flatMap(row => row.files.map(file => normalizeFile(kind, row, file)).filter(Boolean));
}

async function listDownloads(token, fetchImpl = fetch) {
  if (typeof token !== 'string' || !token.trim()) throw new Error('TorBox account is not configured on this host');
  const kinds = Object.keys(KINDS);
  const results = await Promise.allSettled(kinds.map(kind => listKind(kind, token, fetchImpl)));
  const items = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const warnings = results.flatMap((result, index) => result.status === 'rejected' ? [result.reason.message || `TorBox ${kinds[index]} list failed`] : []);
  if (warnings.length === kinds.length) throw new Error('TorBox account files could not be listed; check the token or try again');
  return { items, warnings };
}

async function requestDownloadLink(token, sourceRef, fetchImpl = fetch) {
  const { kind, parentId, fileId } = sourceRef || {};
  if (typeof token !== 'string' || !token.trim()) throw new Error('TorBox account is not configured on this host');
  if (!KINDS[kind] || !Number.isSafeInteger(parentId) || parentId < 0 || !Number.isSafeInteger(fileId) || fileId < 0) throw new Error('Invalid TorBox file selection');
  const url = new URL(`${API}/${kind}/requestdl`);
  url.searchParams.set('token', token);
  url.searchParams.set(KINDS[kind], String(parentId));
  url.searchParams.set('file_id', String(fileId));
  url.searchParams.set('redirect', 'false');
  let response;
  try { response = await fetchImpl(url, { headers: { Accept: 'application/json' }, referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(20000) }); }
  catch { throw new Error('TorBox download link could not be requested'); }
  if (!response.ok) throw new Error(`TorBox download link returned HTTP ${response.status}`);
  let body;
  try { body = await response.json(); } catch { throw new Error('TorBox download link returned invalid JSON'); }
  if (body?.success !== true || typeof body.data !== 'string') throw new Error('TorBox could not provide a download link for this file');
  return safeDownloadUrl(body.data).href;
}

module.exports = { listDownloads, requestDownloadLink, basename, normalizeFile };
