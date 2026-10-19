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
      '/api/library?q=&offset=0&limit=60': { total: 1, offset: 0, items: [{ key: 'movie:example:2024', title: 'Host Film', year: 2024, type: 'movie', versions: [{ id: 'host-1', filename: 'Host.Film.mkv', resolution: '2160p', hdr: 'HDR10' }] }] },
      '/api/catalog?q=': [{ id: 'tt1234567', name: 'Example Film', year: 2024, type: 'movie', poster: 'https://images.metahub.space/poster.jpg' }],
      '/api/candidates': { items: [{ id: 'rd-1', provider: 'real-debrid', filename: 'Example.Film.2024.2160p.mkv', title: 'Example Film', sizeBytes: 1000, availability: 'Ready', quality: { resolution: '2160p' } }, { id: 'tb:torrents:1:0', provider: 'torbox', sourceKind: 'torrents', filename: 'Other.Film.2024.mkv', title: 'Other Film', sizeBytes: 900, availability: 'Ready', quality: {} }], warnings: [] },
      '/api/jobs': [],
      '/api/plan': { planId: 'plan-1', items: [{ filename: 'Example.Film.2024.2160p.mkv', destinationLabel: 'Movies', relativePath: 'Example Film (2024)/Example.Film.2024.2160p.mkv', freeBeforeBytes: 3000, freeAfterBytes: 2000, floorBytes: 1000 }] },
      '/api/submit': { jobIds: ['job-1'] }
    };
    const body = route === '/api/pair' ? { paired: true } : responses[route];
    return { ok: Boolean(body), status: body ? 200 : 404, json: async () => body || { error: 'Missing' } };
  };
  window.eval(fs.readFileSync(path.join(__dirname, '../src/poster-loader.js'), 'utf8'));
  window.eval(script);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(window.document.querySelector('#catalog .poster-tile')?.dataset.id, 'tt1234567');
  assert.match(window.document.querySelector('#host-library').textContent, /Host Film/);
  assert.ok(calls.some(call => call.route.startsWith('/api/library?')));
  assert.match(window.document.querySelector('#candidates').textContent, /TorBox torrents/);
  const img = window.document.querySelector('.poster-tile img');
  assert.match(img.src, /\/api\/poster\/tt1234567$/);
  img.dispatchEvent(new window.Event('error'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(img.src, 'https://images.metahub.space/poster.jpg');
  img.dispatchEvent(new window.Event('load'));
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

test('paired library keeps navigation while drilling show → season → episode → versions', async () => {
  const {listHostLibrary}=require('../src/host-library.cjs');
  const files=[1,2].map(n=>({id:String(n),type:'tv',title:'A Show',year:2020,season:1,episode:n,episodeTitle:n===1?'Pilot':'Second',filename:`raw-file-${n}.mkv`,plex:{titleKey:'100'},quality:{},rank:{points:1}}));
  files.push({...files[0],id:'alternate',filename:'raw-alternate.mkv'});
  files.push({...files[0],id:'sample',type:'movie',title:'Sample clip',plex:undefined});
  const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../src/remote.html'),'utf8'),{url:'http://127.0.0.1:43879/',runScripts:'outside-only'});
  dom.window.fetch=async route=>{
    const u=new URL(route,'http://127.0.0.1:43879');
    const body=u.pathname==='/api/library'?listHostLibrary(files,u.searchParams.get('q'),u.searchParams.get('offset'),60,{key:u.searchParams.get('key'),season:u.searchParams.get('season'),view:u.searchParams.get('view')||'all'}):u.pathname==='/api/candidates'?{items:[]}:u.pathname==='/api/status'?{}:[];
    return{ok:true,json:async()=>body};
  };
  dom.window.eval(fs.readFileSync(path.join(__dirname,'../src/poster-loader.js'),'utf8'));
  dom.window.eval(fs.readFileSync(path.join(__dirname,'../src/remote.js'),'utf8'));
  const tick=()=>new Promise(r=>setImmediate(r));await tick();
  const d=dom.window.document;
  assert.equal(d.querySelectorAll('.library-tile').length,1);
  const art=d.querySelector('.library-art img');assert.match(art.src,/\/api\/library-poster\/1$/);art.dispatchEvent(new dom.window.Event('load'));
  assert.equal(d.querySelector('.library-info .media-kind').textContent,'SERIES');
  assert.doesNotMatch(d.querySelector('#host-library').textContent,/raw-file/);
  d.querySelector('.library-open').click();await tick();assert.match(d.querySelector('#host-library').textContent,/Season 1/);
  d.querySelector('.library-open').click();await tick();assert.equal(d.querySelectorAll('.library-tile').length,2);
  assert.equal(d.querySelector('.episode-versions').hidden,true);
  d.querySelector('.library-open').click();assert.equal(d.querySelector('.episode-versions').hidden,false);
  assert.match(d.querySelector('.episode-versions').textContent,/raw-alternate/);
  d.querySelector('[data-crumb="0"]').click();await tick();assert.equal(d.querySelectorAll('.library-tile').length,1);
  assert.equal(d.querySelector('[data-view="unmatched"]').hidden,false);
  d.querySelector('[data-view="unmatched"]').click();await tick();assert.match(d.querySelector('#host-library').textContent,/Sample clip/);
  for(const view of ['discover','account','cart','jobs','all']){d.querySelector(`[data-view="${view}"]`).click();await tick();assert.ok(d.querySelector('#remote-navigation'));assert.equal(d.querySelector('.rail').hidden,false);}
  dom.window.close();
});
