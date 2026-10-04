const { VIDEO_EXTENSIONS, parseName, probeQuality, score } = require('./core.cjs');
const path = require('node:path');

const API = 'https://api.real-debrid.com/rest/1.0';

async function listDownloads(token, fetchImpl = fetch) {
  if (typeof token !== 'string' || !token.trim()) throw new Error('Real-Debrid account is not configured on this host');
  let response;
  try {
    response = await fetchImpl(`${API}/downloads?limit=100`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000)
    });
  } catch { throw new Error('Real-Debrid downloads could not be reached'); }
  if (!response.ok) throw new Error(`Real-Debrid downloads returned HTTP ${response.status}`);
  let rows;
  try { rows = await response.json(); } catch { throw new Error('Real-Debrid downloads returned invalid JSON'); }
  if (!Array.isArray(rows)) throw new Error('Real-Debrid downloads returned an unexpected shape');
  return rows.filter(row => typeof row.filename === 'string' && VIDEO_EXTENSIONS.has(path.extname(row.filename).toLowerCase())).map(row => {
    const parsed = parseName(row.filename);
    const sizeBytes = Number.isSafeInteger(row.filesize) && row.filesize > 0 ? row.filesize : null;
    const quality = probeQuality(parsed, null, sizeBytes || 0);
    return {
      id: String(row.id), provider: 'real-debrid', filename: parsed.filename, sizeBytes,
      type: parsed.type, title: parsed.title, year: parsed.year, season: parsed.season, episode: parsed.episode,
      quality, rank: score(quality, { hdr: true, surround: true, highBitrate: true }),
      sourceUrl: typeof row.download === 'string' ? row.download : null,
      availability: row.download ? 'Link listed by account; not probed' : 'No link'
    };
  });
}

function publicCandidate(candidate) {
  const { sourceUrl, sourceRef, ...safe } = candidate;
  return safe;
}

module.exports = { listDownloads, publicCandidate };
