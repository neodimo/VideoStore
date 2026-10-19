const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { parseName, probeQuality, score } = require('../src/core.cjs');

test('discover fetches RPDB without a metadata poster and places type badges below artwork', async () => {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/' });
  try {
    let requested;
    let deliver;
    dom.window.videostore = {
      list: async () => ({ items: [], preferences: {} }),
      searchCatalog: async () => [{ id: 'tt34384900', name: 'Love of Your Life', type: 'movie', genres: [], poster: null }],
      posterFor: id => { requested = id; return new Promise(resolve => { deliver = resolve; }); }
    };
    for (const file of ['library-model.js', 'poster-loader.js', 'renderer.js']) dom.window.eval(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'));
    await new Promise(resolve => setImmediate(resolve));
    dom.window.document.querySelector('[data-view="discover"]').click();
    await new Promise(resolve => setImmediate(resolve));
    const tile = dom.window.document.querySelector('.catalog-tile');
    const img = tile.querySelector('img');
    assert.equal(requested, 'tt34384900');
    assert.ok(img);
    assert.equal(tile.querySelector('.poster small'), null);
    assert.equal(tile.querySelector('.tile-info .media-kind').textContent, 'MOVIE');
    assert.equal(tile.querySelectorAll('.tags > span').length, 1);
    assert.doesNotMatch(tile.textContent, /Cinemeta|IMDb|tt34384900/);
    assert.equal(tile.dataset.id, 'tt34384900');
    img.dispatchEvent(new dom.window.Event('error'));
    deliver('data:image/jpeg;base64,/9j/');
    await new Promise(resolve => setImmediate(resolve));
    img.dispatchEvent(new dom.window.Event('load'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(img.isConnected, true);
    assert.equal(img.hidden, false);
  } finally { dom.window.close(); }
});

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
  dom.window.eval(fs.readFileSync(path.join(__dirname, '../src/library-model.js'), 'utf8'));
  dom.window.eval(fs.readFileSync(path.join(__dirname, '../src/poster-loader.js'), 'utf8'));
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
  dom.window.eval(fs.readFileSync(path.join(__dirname, '../src/library-model.js'), 'utf8'));
  dom.window.eval(fs.readFileSync(path.join(__dirname, '../src/poster-loader.js'), 'utf8'));
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

test('network finder lists verified hosts and connects through the app', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const connected = [];
  dom.window.videostore = {
    list: async () => ({ items: [], preferences: {} }),
    lanStatus: async () => ({ running: false, addresses: [], port: 43879 }),
    lanDiscover: async () => [{ host: '192.168.1.25', name: '<Media PC>', port: 43879 }],
    lanConnect: async host => { connected.push(host); }
  };
  dom.window.eval(fs.readFileSync(path.join(__dirname, '../src/library-model.js'), 'utf8'));
  dom.window.eval(fs.readFileSync(path.join(__dirname, '../src/poster-loader.js'), 'utf8'));
  dom.window.eval(script);
  await new Promise(resolve => setImmediate(resolve));
  dom.window.document.querySelector('[data-view="network"]').click();
  await new Promise(resolve => setImmediate(resolve));
  dom.window.document.querySelector('#lan-scan').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(dom.window.document.querySelector('#lan-hosts').textContent, /Media PC/);
  assert.equal(dom.window.document.querySelector('#lan-hosts Media'), null);
  dom.window.document.querySelector('.lan-connect').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(connected, ['192.168.1.25']);
  dom.window.close();
});

test('Plex import shows source folders before indexing and updates destinations', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  let imported = false;
  dom.window.videostore = {
    list: async () => ({ items: [], preferences: {} }),
    storageList: async () => imported ? [{ id: 'plex-1', type: 'movie', label: 'Plex Movies', path: '/plex/Movies', available: true, freeBytes: 2e12, totalBytes: 4e12, reservePercent: 10, reserveBytes: 500 * 2 ** 30, layout: 'movie-folder' }] : [],
    plexPreview: async () => [{ type: 'movie', name: '<Movies>', path: '/plex/Movies', available: true }],
    plexImport: async () => { imported = true; return { roots: 1, registered: 1, added: 2, errors: [], cancelled: false }; }
  };
  dom.window.eval(fs.readFileSync(path.join(__dirname, '../src/library-model.js'), 'utf8'));
  dom.window.eval(fs.readFileSync(path.join(__dirname, '../src/poster-loader.js'), 'utf8'));
  dom.window.eval(script);
  await new Promise(resolve => setImmediate(resolve));
  dom.window.document.querySelector('#plex').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(imported, false);
  assert.match(dom.window.document.querySelector('.storage-panel').textContent, /Import folders & index videos/);
  assert.equal(dom.window.document.querySelector('.storage-panel Movies'), null);
  dom.window.document.querySelector('#plex-import').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(imported, true);
  assert.match(dom.window.document.querySelector('#status').textContent, /2 existing videos indexed/);
  assert.match(dom.window.document.querySelector('#destination-list').textContent, /Plex Movies/);
  dom.window.close();
});

test('local TV library shows a series once, then seasons and episodes with a persistent rail', async () => {
  const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8'),{runScripts:'outside-only',url:'http://localhost/'});
  const items=[1,2].map(n=>{const parsed=parseName(`/library/Show.S01E0${n}.mkv`),quality=probeQuality(parsed,null,1000);return{...parsed,id:String(n),episodeTitle:`Chapter ${n}`,quality,rank:score(quality),addedAt:'2026-01-01'};});
  dom.window.videostore={list:async()=>({items,preferences:{}})};
  dom.window.eval(fs.readFileSync(path.join(__dirname,'../src/library-model.js'),'utf8'));
  dom.window.eval(fs.readFileSync(path.join(__dirname,'../src/poster-loader.js'),'utf8'));
  dom.window.eval(fs.readFileSync(path.join(__dirname,'../src/renderer.js'),'utf8'));
  await new Promise(r=>setImmediate(r));const d=dom.window.document;
  assert.equal(d.querySelectorAll('.tile').length,1);d.querySelector('.tile').click();
  assert.match(d.querySelector('#grid').textContent,/Season 1/);d.querySelector('.tile').click();
  assert.equal(d.querySelectorAll('.tile').length,2);assert.match(d.querySelector('#grid').textContent,/Chapter 1/);
  assert.ok(d.querySelector('#navigation'));assert.equal(d.querySelector('.rail').hidden,false);
  d.querySelector('[data-crumb="0"]').click();assert.equal(d.querySelectorAll('.tile').length,1);
  dom.window.close();
});
