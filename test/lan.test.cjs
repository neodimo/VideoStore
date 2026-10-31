const test = require('node:test');
const assert = require('node:assert/strict');
const { createLanServer, trustedHost } = require('../src/lan.cjs');

test('LAN browser requires local host, same-origin pairing, and session before cart operations', async () => {
  const server = createLanServer({ status: async () => ({ provider: 'real-debrid' }), library: async () => ({ total: 1, items: [{ title: 'Host Film' }] }), catalog: async () => [], candidates: async () => [], jobs: () => [], plan: async ids => ({ items: ids }), submit: async () => ['job-1'], cancel: () => true, poster: async () => null, libraryPoster: async id => id === 'opaque-id' ? 'data:image/jpeg;base64,/9j/2Q==' : null }, { host: '127.0.0.1' });
  const { port } = await server.start(0);
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.equal(trustedHost(`192.168.1.25:${port}`), true);
    assert.equal(trustedHost('evil.example:43879'), false);
    assert.deepEqual(await (await fetch(`${base}/api/identity`)).json(), { app: 'videostore', protocol: 1, name: require('node:os').hostname() });
    assert.equal((await fetch(`${base}/api/status`)).status, 401);
    assert.equal((await fetch(`${base}/api/library-poster/opaque-id`)).status, 401);
    assert.equal((await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: '{invalid' })).status, 400);
    assert.equal((await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, body: JSON.stringify({ code: server.pairCode().code }) })).status, 403);
    const pair = await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ code: server.pairCode().code }) });
    assert.equal(pair.status, 200);
    const cookie = pair.headers.get('set-cookie').split(';')[0];
    const art = await fetch(`${base}/api/library-poster/opaque-id`, { headers: { cookie } });
    assert.equal(art.status, 200); assert.equal(art.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await art.arrayBuffer()), Buffer.from('/9j/2Q==','base64'));
    assert.equal((await fetch(`${base}/api/library-poster/unknown`, { headers: { cookie } })).status, 404);
    assert.deepEqual(await (await fetch(`${base}/api/status`, { headers: { cookie } })).json(), { provider: 'real-debrid' });
    assert.deepEqual(await (await fetch(`${base}/api/library`, { headers: { cookie } })).json(), { total: 1, items: [{ title: 'Host Film' }] });
    assert.equal((await fetch(`${base}/api/submit`, { method: 'POST', headers: { cookie, origin: 'http://evil.example', 'content-type': 'application/json' }, body: JSON.stringify({ planId: 'x' }) })).status, 403);
    assert.deepEqual(await (await fetch(`${base}/api/plan`, { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ ids: ['rd-1'] }) })).json(), { items: ['rd-1'] });
    const page = await (await fetch(base)).text();
    assert.match(page, /Choose here\. Download there\./);
  } finally { await server.stop(); }
});

test('remembered pairing survives host restart using only token hashes; disable revokes it',async()=>{
 let stored=[];
 const identity='d7b1f040-8938-4840-9606-f1d35aba1cb8';
 const handlers={status:async()=>({libraryFiles:123})};
 const make=()=>createLanServer(handlers,{host:'127.0.0.1',identity,pairedClients:stored,savePairings:async values=>{stored=JSON.parse(JSON.stringify(values))}});
 let server=make();let address;
 try {
  let {port}=await server.start(0);address=`http://127.0.0.1:${port}`;
  assert.equal((await (await fetch(address+'/api/identity')).json()).id,identity);
  const response=await fetch(address+'/api/pair',{method:'POST',headers:{origin:address,'content-type':'application/json'},body:JSON.stringify({code:server.pairCode().code,remember:true})});
  assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];
  assert.match(response.headers.get('set-cookie'),/Max-Age=2592000/);
  assert.equal(stored.length,1);assert.match(stored[0].hash,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(stored).includes(cookie.split('=')[1]));
  await server.stop();server=make();({port}=await server.start(0));address=`http://127.0.0.1:${port}`;
  assert.equal((await fetch(address+'/api/status',{headers:{cookie}})).status,200);
  assert.equal((await fetch(address+'/api/status',{headers:{cookie:cookie+'wrong'}})).status,401);
  await server.stop({revoke:true});assert.equal(stored.length,0);
  server=make();({port}=await server.start(0));address=`http://127.0.0.1:${port}`;
  assert.equal((await fetch(address+'/api/status',{headers:{cookie}})).status,401);
 }finally{await server.stop()}
});
