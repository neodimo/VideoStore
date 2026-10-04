const test = require('node:test');
const assert = require('node:assert/strict');
const { parseName, probeQuality, score } = require('../src/core.cjs');

test('TV episode, edition and filename claims stay distinct', () => {
  const file = parseName('/videos/Orbit.City.S02E03.Extended.2160p.DV.TrueHD.Atmos.mkv');
  assert.equal(file.title, 'Orbit City');
  assert.equal(file.season, 2);
  assert.equal(file.episode, 3);
  assert.equal(file.edition, 'Extended');
  assert.equal(file.hdr, 'Dolby Vision');
  assert.equal(file.atmos, 'claimed');
  assert.equal(probeQuality(file, null, 1000).probeStatus, 'filename only');
});

test('ffprobe track data overrides filename claims and bitrate is labeled', () => {
  const file = parseName('/videos/Test.2160p.HDR10.mkv');
  const quality = probeQuality(file, {
    format: { duration: '100' },
    streams: [
      { codec_type: 'video', codec_name: 'h264', height: 1080, color_transfer: 'bt709' },
      { codec_type: 'audio', codec_name: 'eac3', channels: 6, tags: { language: 'eng' } },
      { codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'spa' } }
    ]
  }, 100_000_000);
  assert.equal(quality.resolution, '1080p');
  assert.equal(quality.videoCodec, 'H264');
  assert.equal(quality.bitrate, 8_000_000);
  assert.equal(quality.bitrateBasis, 'estimated from size/duration');
  assert.equal(quality.hdr, null);
  assert.equal(quality.hdrClaim, 'HDR10');
  assert.equal(quality.audio[0].channels, 6);
  assert.deepEqual(quality.subtitles, ['spa']);
  assert.ok(score(quality).points > 0);
});

test('HDR10+ filename marker is parsed without treating it as verified', () => {
  const file = parseName('/videos/Film.2025.2160p.HDR10+.mkv');
  assert.equal(file.hdr, 'HDR10+');
  assert.equal(file.year, 2025);
});
