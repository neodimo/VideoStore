const test = require('node:test');
const assert = require('node:assert/strict');
const { listHostLibrary } = require('../src/host-library.cjs');
const { validateConfig } = require('../src/ssh-tunnel.cjs');

test('paired host library groups versions and never exposes Plex paths', () => {
  const file = (id, rank) => ({ id, type: 'movie', title: 'Example Film', year: 2024, filename: `${id}.mkv`, path: `C:\\Plex\\private\\${id}.mkv`, sizeBytes: 1000, quality: { resolution: '2160p', hdr: 'HDR10', probeStatus: 'media probed' }, rank: { points: rank } });
  const result = listHostLibrary([file('old', 10), file('best', 90), { ...file('other', 20), title: 'Another' }], 'example', 0, 60);
  assert.equal(result.total, 1);
  assert.deepEqual(result.items[0].versions.map(version => version.id), ['best', 'old']);
  assert.doesNotMatch(JSON.stringify(result), /Plex|private|path/);
  assert.equal(listHostLibrary([file('one', 1)], '', 0, 1000).items.length, 1);
});

test('SSH tunnel accepts only a private VideoStore destination', () => {
  assert.equal(validateConfig({ host: 'media.example', username: 'omid', serviceHost: '127.0.0.1' }).port, 22);
  assert.throws(() => validateConfig({ host: 'media.example', username: 'omid', serviceHost: '8.8.8.8' }), /private/);
  assert.throws(() => validateConfig({ host: 'media.example', username: 'omid', port: 70000 }), /port/);
});

test('Plex identities keep different matches apart and remote search uses episode titles without leaking paths or GUIDs', () => {
  const item = { title: 'Same Show', type: 'tv', year: 2005, season: 0, episode: 3,
    episodeTitle: 'A Special Episode', filename: 'opaque.mkv', path: 'C:\\private\\opaque.mkv',
    plex: { titleKey: '20', ratingKey: '22', guid: 'local://private/path' } };
  const result = listHostLibrary([{ ...item, id: 'first' }, { ...item, id: 'second' },
    { ...item, id: 'different', plex: { ...item.plex, titleKey: '99' } }], 'special');
  assert.equal(result.total, 2);
  assert.equal(result.items[0].episodeCount, 1);
  assert.equal(result.items[0].seasonCount, 1);
  const episodes = listHostLibrary([item, {...item,id:'second'}], '', 0, 60, {key:result.items[0].key,season:0});
  assert.equal(episodes.items[0].versions.length, 2);
  assert.equal(episodes.items[0].title, 'A Special Episode');
  assert.doesNotMatch(JSON.stringify(result), /private|local:\/\/|ratingKey|guid/);
});

test('series browse drills into ordered seasons and episodes, with duplicate versions kept at the leaf', () => {
  const episode=(id,season,n,title='Show')=>({id,title,type:'tv',season,episode:n,episodeTitle:`Chapter ${n}`,year:2020,
    filename:`raw-${id}.mkv`,path:`C:\\private\\${id}.mkv`,plex:{titleKey:'42',guid:'private-guid'},quality:{},rank:{points:1}});
  const files=[episode('b',2,10),episode('a',1,2),episode('a-alt',1,2),episode('pilot',1,1),episode('special',0,1)];
  const root=listHostLibrary(files);
  assert.equal(root.total,1);assert.equal(root.items[0].seasonCount,3);assert.equal(root.items[0].episodeCount,4);
  assert.doesNotMatch(JSON.stringify(root),/raw-|private|guid|filename/);
  const key=root.items[0].key;
  assert.deepEqual(listHostLibrary(files,'',0,60,{key}).items.map(i=>i.title),['Specials','Season 1','Season 2']);
  const season=listHostLibrary(files,'',0,60,{key,season:1});
  assert.deepEqual(season.items.map(i=>i.episode),[1,2]);assert.equal(season.items[1].versions.length,2);
  assert.equal(season.crumbs.length,3);assert.doesNotMatch(JSON.stringify(season),/private|guid/);
  assert.equal(listHostLibrary(files,'raw-a').items[0].title,'Show');
  assert.equal(listHostLibrary(files,'',0,60,{view:'movie'}).total,0);
  assert.equal(listHostLibrary(files,'',0,60,{key:'nonexistent'}).items.length,0);
});
