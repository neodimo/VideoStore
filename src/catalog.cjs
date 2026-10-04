const ORIGIN = 'https://v3-cinemeta.strem.io';

async function json(path, fetchImpl = fetch) {
  const response = await fetchImpl(`${ORIGIN}${path}`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Cinemeta returned HTTP ${response.status}`);
  return response.json();
}

function normalize(meta) {
  if (!meta || !/^tt\d+$/.test(meta.id || meta.imdb_id || '')) throw new Error('Cinemeta returned invalid title ID');
  const id = meta.id || meta.imdb_id;
  const videos = Array.isArray(meta.videos) ? meta.videos.filter(video => Number.isInteger(video.season) && Number.isInteger(video.episode ?? video.number)).map(video => ({
    id: video.id || `${id}:${video.season}:${video.episode ?? video.number}`,
    season: video.season, episode: video.episode ?? video.number,
    name: video.name || null, description: video.overview || video.description || null,
    released: video.released || video.firstAired || null,
    thumbnail: /^https:\/\/episodes\.metahub\.space\//.test(video.thumbnail || '') ? video.thumbnail : null
  })) : [];
  return {
    id, provenance: 'Cinemeta / Stremio', type: meta.type === 'series' ? 'series' : 'movie',
    name: meta.name || 'Untitled', year: meta.year || null, description: meta.description || null,
    poster: /^https:\/\/images\.metahub\.space\//.test(meta.poster || '') ? meta.poster : null,
    background: /^https:\/\/images\.metahub\.space\//.test(meta.background || '') ? meta.background : null,
    genres: meta.genres || meta.genre || [], cast: meta.cast || [], runtime: meta.runtime || null,
    trailerId: /^[\w-]{11}$/.test(meta.trailers?.[0]?.source || '') ? meta.trailers[0].source : null,
    videos
  };
}

async function searchCatalog(query = '', fetchImpl = fetch) {
  const tail = query.trim() ? `/search=${encodeURIComponent(query.trim())}` : '';
  const responses = await Promise.all(['movie', 'series'].map(type => json(`/catalog/${type}/top${tail}.json`, fetchImpl)));
  return responses.flatMap(response => (response.metas || []).slice(0, 15).map(meta => {
    try { return normalize(meta); } catch { return null; }
  }).filter(Boolean));
}

async function getMeta(type, id, fetchImpl = fetch) {
  if (!['movie', 'series'].includes(type) || !/^tt\d+$/.test(id)) throw new Error('Invalid catalog selection');
  const response = await json(`/meta/${type}/${id}.json`, fetchImpl);
  return normalize(response.meta);
}

module.exports = { normalize, searchCatalog, getMeta };
