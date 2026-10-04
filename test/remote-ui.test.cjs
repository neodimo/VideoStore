const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

test('laptop client pairs, shows host candidates, and falls back from a missing poster override', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/remote.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../src/remote.js'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://192.168.1.2:43879/', runScripts: 'outside-only' });
  const { window } = dom;
  const calls = [];
  window.fetch = async (route, options) => {
    calls.push({ route, options });
    const responses = {
      '/api/status': { artworkConfigured: true },
      '/api/catalog?q=': [{ id: 'tt1234567', name: 'Example Film', year: 2024, type: 'movie', poster: 'https://images.metahub.space/poster.jpg' }],
      '/api/candidates': [{ id: 'rd-1', filename: 'Example.Film.2024.2160p.mkv', title: 'Example Film', sizeBytes: 1000, availability: 'Ready', quality: { resolution: '2160p' } }],
      '/api/jobs': [],
      '/api/plan': { planId: 'plan-1', items: [{ filename: 'Example.Film.2024.2160p.mkv', destinationLabel: 'Movies', relativePath: 'Example Film (2024)/Example.Film.2024.2160p.mkv', freeBeforeBytes: 3000, freeAfterBytes: 2000, floorBytes: 1000 }] },
      '/api/submit': { jobIds: ['job-1'] }
    };
    const body = route === '/api/pair' ? { paired: true } : responses[route];
    return { ok: Boolean(body), status: body ? 200 : 404, json: async () => body || { error: 'Missing' } };
  };
  window.eval(script);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(window.document.querySelector('#catalog .poster-tile')?.dataset.id, 'tt1234567');
  const img = window.document.querySelector('.poster-tile img');
  assert.match(img.src, /\/api\/poster\/tt1234567$/);
  img.dispatchEvent(new window.Event('error'));
  assert.equal(img.src, 'https://images.metahub.space/poster.jpg');
  window.document.querySelector('#candidates button').click();
  assert.equal(window.document.querySelector('#cart-count').textContent, '1');
  window.document.querySelector('#preview').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(window.document.querySelector('#plan').textContent, /Movies/);
  window.document.querySelector('#submit').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(window.document.querySelector('#cart-count').textContent, '0');
  assert.deepEqual(JSON.parse(calls.find(call => call.route === '/api/submit').options.body), { planId: 'plan-1' });
  window.close();
});
