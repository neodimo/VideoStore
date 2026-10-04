const path = require('node:path');

const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.m4v', '.mov', '.avi', '.webm', '.ts']);
const clean = value => value.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();

function parseName(filePath) {
  const filename = path.basename(filePath);
  const stem = filename.slice(0, -path.extname(filename).length);
  const episode = stem.match(/\bS(\d{1,2})[ ._-]*E(\d{1,3})\b/i);
  const year = stem.match(/(?:^|[ ._(])((?:19|20)\d{2})(?=[ ._)\-]|$)/);
  const technical = stem.search(/\b(?:2160p|1080p|720p|480p|BluRay|WEB[ ._-]?DL|REMUX|Director'?s[ ._-]?Cut|Extended|Theatrical|Ultimate|Unrated|IMAX)\b/i);
  const boundary = [episode?.index, year?.index, technical].filter(index => index != null && index > 0).sort((a, b) => a - b)[0];
  const title = clean(stem.slice(0, boundary)) || clean(stem);
  const edition = stem.match(/\b(Director'?s Cut|Extended(?: Edition| Cut)?|Theatrical(?: Cut)?|Ultimate(?: Edition)?|Unrated|IMAX)\b/i)?.[0] || null;
  const resolution = /\b(?:2160p|4k)\b/i.test(stem) ? '2160p' : /\b1080p\b/i.test(stem) ? '1080p' : /\b720p\b/i.test(stem) ? '720p' : null;
  const videoCodec = /\b(?:x265|h265|hevc)\b/i.test(stem) ? 'HEVC' : /\b(?:x264|h264|avc)\b/i.test(stem) ? 'H.264' : /\bAV1\b/i.test(stem) ? 'AV1' : null;
  const hdr = /\b(?:DV|DoVi|Dolby[ ._-]?Vision)\b/i.test(stem) ? 'Dolby Vision' : /\bHDR10\+(?!\w)/i.test(stem) ? 'HDR10+' : /\bHDR10\b/i.test(stem) ? 'HDR10' : /\bHDR\b/i.test(stem) ? 'HDR' : null;
  const audio = /\bTrueHD\b/i.test(stem) ? 'TrueHD' : /\b(?:DDP|EAC3|E-AC-3)\b/i.test(stem) ? 'E-AC-3' : /\bDTS[ ._-]?HD\b/i.test(stem) ? 'DTS-HD' : /\bDTS\b/i.test(stem) ? 'DTS' : /\bAC3\b/i.test(stem) ? 'AC-3' : null;
  return {
    title, year: year ? Number(year[1]) : null, type: episode ? 'tv' : 'movie',
    season: episode ? Number(episode[1]) : null, episode: episode ? Number(episode[2]) : null,
    edition, resolution, videoCodec, hdr, audio,
    atmos: /\bAtmos\b/i.test(stem) ? 'claimed' : null,
    container: path.extname(filename).slice(1).toUpperCase(), filename
  };
}

function probeQuality(parsed, probe, sizeBytes) {
  const video = probe?.streams?.find(s => s.codec_type === 'video');
  const audios = probe?.streams?.filter(s => s.codec_type === 'audio') || [];
  const subs = probe?.streams?.filter(s => s.codec_type === 'subtitle') || [];
  const height = Number(video?.height);
  const resolution = height >= 2000 ? '2160p' : height >= 1000 ? '1080p' : height >= 700 ? '720p' : height ? `${height}p` : parsed.resolution;
  const transfer = video?.color_transfer;
  const side = video?.side_data_list || [];
  const dovi = side.find(s => /DOVI/i.test(s.side_data_type || ''));
  const hdr = dovi ? `Dolby Vision${dovi.dv_profile != null ? ` P${dovi.dv_profile}` : ''}` :
    side.some(s => /HDR Dynamic Metadata SMPTE2094-40/i.test(s.side_data_type || '')) ? 'HDR10+' :
    transfer === 'smpte2084' ? 'HDR10/PQ' : transfer === 'arib-std-b67' ? 'HLG' : video ? null : parsed.hdr;
  const duration = Number(probe?.format?.duration);
  const bitrate = Number(probe?.format?.bit_rate);
  const estimatedBitrate = Number.isFinite(duration) && duration > 0 ? Math.round(sizeBytes * 8 / duration) : null;
  return {
    resolution, hdr, videoCodec: video?.codec_name?.toUpperCase() || parsed.videoCodec,
    audio: audios.map(s => ({ codec: s.codec_name?.toUpperCase() || 'Unknown', channels: s.channels || null, language: s.tags?.language || null })),
    subtitles: subs.map(s => s.tags?.language || s.codec_name || 'unknown'),
    bitrate: bitrate || estimatedBitrate, bitrateBasis: bitrate ? 'container reported' : estimatedBitrate ? 'estimated from size/duration' : null,
    duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    probeStatus: probe ? 'media probed' : 'filename only',
    hdrClaim: parsed.hdr,
    atmos: parsed.atmos,
    container: probe?.format?.format_name?.split(',')[0]?.toUpperCase() || parsed.container
  };
}

function score(quality, preferences = {}) {
  let points = 0;
  const reasons = [];
  const confidence = quality.probeStatus === 'media probed' ? 1 : 0.4;
  if (quality.resolution === '2160p') { points += 35 * confidence; reasons.push(`4K${confidence < 1 ? ' (filename claim)' : ''}`); }
  else if (quality.resolution === '1080p') { points += 20 * confidence; reasons.push(`1080p${confidence < 1 ? ' (filename claim)' : ''}`); }
  if (quality.hdr && preferences.hdr !== false) { points += 25 * confidence; reasons.push(`${quality.hdr}${confidence < 1 ? ' (filename claim)' : ''}`); }
  if (quality.audio.some(a => a.channels >= 6) && preferences.surround !== false) { points += 20; reasons.push('verified surround track'); }
  if (quality.bitrate && preferences.highBitrate !== false) { points += Math.min(15, quality.bitrate / 3_000_000); reasons.push(`bitrate (${quality.bitrateBasis})`); }
  if (quality.probeStatus === 'media probed') { points += 5; reasons.push('media probed'); }
  return { points: Math.round(points), reasons };
}

module.exports = { VIDEO_EXTENSIONS, parseName, probeQuality, score };
