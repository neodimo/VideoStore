const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { parseName, probeQuality, score } = require('../src/core.cjs');

test('library renders grouped versions and opens the quality picker without injecting filenames', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const paths = ['/library/Example.2025.1080p.mkv', '/library/Example.2025.2160p.HDR10.mkv'];
  const items = paths.map((file, index) => {
    const parsed = parseName(file);
    const quality = probeQuality(parsed, null, 1_000_000_000);
    return { id: String(index), path: file, ...parsed, quality, sizeBytes: 1_000_000_000,
      provider: 'Local file', addedAt: '2026-10-04T00:00:00Z', watched: false, watchlist: false,
      rank: score(quality) };
  });
  items[0].filename = '<img src=x onerror=alert(1)> Series.mkv';
  dom.window.videostore = { list: async () => ({ items, preferences: {} }) };
  dom.window.eval(script);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dom.window.document.querySelectorAll('.tile').length, 1);
  dom.window.document.querySelector('.tile').click();
  assert.equal(dom.window.document.querySelectorAll('#versions section').length, 2);
  assert.equal(dom.window.document.querySelector('#details img'), null);
  assert.match(dom.window.document.querySelector('#details').textContent, /2 versions/);
  dom.window.close();
});

test('discover opens real-ID series metadata with numbered episodes', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const meta = { id: 'tt12345', type: 'series', name: 'A Show', provenance: 'Cinemeta / Stremio', year: '2020', genres: ['Drama'], cast: ['Actor'], videos: [
    { id: 'tt12345:1:1', season: 1, episode: 1, name: 'Pilot' },
    { id: 'tt12345:1:2', season: 1, episode: 2, name: 'Second' }
  ] };
  dom.window.videostore = { list: async () => ({ items: [], preferences: {} }), searchCatalog: async () => [meta], getMeta: async () => meta };
  dom.window.eval(script);
  await new Promise(resolve => setImmediate(resolve));
  dom.window.document.querySelector('[data-view="discover"]').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dom.window.document.querySelectorAll('.catalog-tile').length, 1);
  dom.window.document.querySelector('.catalog-tile').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(dom.window.document.querySelector('#details').textContent, /S01E02 · Second/);
  dom.window.close();
});
