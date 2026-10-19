const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(count = 1) {
  const dom = new JSDOM('<body>' + '<div class="poster"><span>Title fallback</span><img hidden></div>'.repeat(count), { runScripts: 'outside-only', url: 'http://localhost/' });
  dom.window.eval(fs.readFileSync(path.join(__dirname, '../src/poster-loader.js'), 'utf8'));
  return dom;
}

test('a failed first image cannot discard a late successful poster response', async () => {
  const dom = fixture();
  try {
    const img = dom.window.document.querySelector('img');
    let deliver;
    const result = dom.window.VideoStorePosters.load(img, { primary: () => new Promise(resolve => { deliver = resolve; }), fallback: 'https://images.metahub.space/fallback.jpg' });
    await tick();
    img.dispatchEvent(new dom.window.Event('error'));
    assert.equal(img.isConnected, true);
    deliver('data:image/jpeg;base64,/9j/');
    await tick();
    assert.match(img.src, /^data:image\/jpeg/);
    img.dispatchEvent(new dom.window.Event('load'));
    assert.equal(await result, true);
    assert.equal(img.hidden, false);
    assert.equal(img.dataset.posterSource, 'primary');
  } finally { dom.window.close(); }
});

test('poster decode failures fall back, keep the image node, and finish with an honest unavailable state', async () => {
  const dom = fixture();
  try {
    const img = dom.window.document.querySelector('img');
    const result = dom.window.VideoStorePosters.load(img, { primary: async () => '/api/poster/tt12345', fallback: 'https://images.metahub.space/fallback.jpg' });
    await tick();
    img.dispatchEvent(new dom.window.Event('error'));
    await tick();
    assert.equal(img.src, 'https://images.metahub.space/fallback.jpg');
    img.dispatchEvent(new dom.window.Event('error'));
    assert.equal(await result, false);
    assert.equal(img.isConnected, true);
    assert.equal(img.hidden, true);
    assert.equal(img.parentElement.dataset.posterState, 'unavailable');
    assert.equal(img.hasAttribute('src'), false);
    assert.equal(dom.window.VideoStorePosters.fallback('tt12345', null), 'https://images.metahub.space/poster/medium/tt12345/img');
  } finally { dom.window.close(); }
});

test('poster work is limited to four cards at once', async () => {
  const dom = fixture(7);
  try {
    const images = [...dom.window.document.querySelectorAll('img')];
    let requests = 0;
    const results = images.map((img, index) => dom.window.VideoStorePosters.load(img, { primary: async () => { requests++; return `/api/poster/tt${index + 10000}`; } }));
    await tick();
    assert.equal(requests, 4);
    images.slice(0, 4).forEach(img => img.dispatchEvent(new dom.window.Event('load')));
    await tick();
    assert.equal(requests, 7);
    images.slice(4).forEach(img => img.dispatchEvent(new dom.window.Event('load')));
    assert.ok((await Promise.all(results)).every(Boolean));
  } finally { dom.window.close(); }
});

test('a delayed poster cannot update a card removed by a later search', async () => {
  const dom = fixture();
  try {
    const img = dom.window.document.querySelector('img');
    let deliver;
    const result = dom.window.VideoStorePosters.load(img, { primary: () => new Promise(resolve => { deliver = resolve; }) });
    await tick();
    img.parentElement.remove();
    deliver('/api/poster/tt12345');
    assert.equal(await result, false);
    assert.equal(img.hasAttribute('src'), false);
  } finally { dom.window.close(); }
});
