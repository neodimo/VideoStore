const test = require('node:test');
const assert = require('node:assert/strict');
const { createLanServer, trustedHost } = require('../src/lan.cjs');

test('LAN browser requires local host, same-origin pairing, and session before cart operations', async () => {
  const server = createLanServer({ status: async () => ({ provider: 'real-debrid' }), catalog: async () => [], candidates: async () => [], jobs: () => [], plan: async ids => ({ items: ids }), submit: async () => ['job-1'], cancel: () => true, poster: async () => null }, { host: '127.0.0.1' });
  const { port } = await server.start(0);
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.equal(trustedHost(`192.168.1.25:${port}`), true);
    assert.equal(trustedHost('evil.example:43879'), false);
    assert.equal((await fetch(`${base}/api/status`)).status, 401);
    assert.equal((await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: '{invalid' })).status, 400);
    assert.equal((await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, body: JSON.stringify({ code: server.pairCode().code }) })).status, 403);
    const pair = await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ code: server.pairCode().code }) });
    assert.equal(pair.status, 200);
    const cookie = pair.headers.get('set-cookie').split(';')[0];
    assert.deepEqual(await (await fetch(`${base}/api/status`, { headers: { cookie } })).json(), { provider: 'real-debrid' });
    assert.equal((await fetch(`${base}/api/submit`, { method: 'POST', headers: { cookie, origin: 'http://evil.example', 'content-type': 'application/json' }, body: JSON.stringify({ planId: 'x' }) })).status, 403);
    assert.deepEqual(await (await fetch(`${base}/api/plan`, { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ ids: ['rd-1'] }) })).json(), { items: ['rd-1'] });
    const page = await (await fetch(base)).text();
    assert.match(page, /Choose here\. Download there\./);
  } finally { await server.stop(); }
});
