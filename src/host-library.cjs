function listHostLibrary(items, query = '', offset = 0, limit = 60) {
  const term = String(query || '').trim().toLowerCase().slice(0, 120);
  const start = Math.max(0, Math.min(100000, Number.parseInt(offset, 10) || 0));
  const size = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 60));
  const groups = new Map();
  for (const item of items) {
    if (term && !`${item.title || ''} ${item.episodeTitle || ''} ${item.filename || ''} ${item.edition || ''}`.toLowerCase().includes(term)) continue;
    const identity = item.plex?.titleKey ? `plex:${item.plex.titleKey}` : `${String(item.title || '').toLowerCase()}:${item.year || ''}`;
    const key = `${item.type}:${identity}:${item.season ?? ''}:${item.episode ?? ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const sorted = [...groups].sort((a, b) => a[1][0].title.localeCompare(b[1][0].title, undefined, { numeric: true }));
  return {
    total: sorted.length,
    offset: start,
    items: sorted.slice(start, start + size).map(([key, versions]) => {
      versions.sort((a, b) => (b.rank?.points || 0) - (a.rank?.points || 0));
      const first = versions[0];
      return {
        key, title: first.title, year: first.year || null, type: first.type,
        season: first.season ?? null, episode: first.episode ?? null,
        episodeTitle: first.episodeTitle || null,
        versions: versions.map(item => ({
          id: item.id, filename: item.filename, sizeBytes: item.sizeBytes,
          resolution: item.quality?.resolution || null, hdr: item.quality?.hdr || null,
          hdrClaim: item.quality?.hdrClaim || null, probeStatus: item.quality?.probeStatus || null,
          watched: Boolean(item.watched), rank: item.rank?.points || 0
        }))
      };
    })
  };
}

module.exports = { listHostLibrary };
