const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { planPlexSync, createPlexSync } = require('../src/plex-sync.cjs');
const { plexPathKey } = require('../src/plex.cjs');

test('Plex sync only discovers exact safe paths inside configured same-type roots', () => {
  const meta = {type:'movie', title:'Plex title', plex:{titleKey:'12'}};
  const byPath = new Map(['C:\\Movies\\one.mkv','C:\\Movies\\new.mkv','C:\\Movies2\\outside.mkv','D:\\Movies\\other.mkv','C:\\Movies\\wrong-type.mkv'].map(p=>[plexPathKey(p,'win32'),meta]));
  byPath.set('c:\\movies\\wrong-type.mkv',{...meta,type:'tv'});
  const item={path:'c:\\MOVIES\\ONE.mkv',title:'Old',watched:true};
  const plan=planPlexSync([item],{byPath},[{path:'C:\\Movies',type:'movie'}],'win32');
  assert.deepEqual(plan.additions,['c:\\movies\\new.mkv']);
  assert.equal(plan.matches.length,1);assert.equal(plan.changed,true);assert.equal(item.title,'Old');
});

test('automatic Plex refresh backs up before changes, indexes additions, is idempotent and retains an unavailable library', async () => {
  const base=path.resolve('fixture-movies'), one=path.join(base,'one.mkv'), two=path.join(base,'new.mkv');
  const item={id:'keep',path:one,title:'Filename guess',watched:true,quality:{hdr:'HDR10'}};
  const quality=item.quality;
  const library={items:[item],destinations:[{path:base,type:'movie'}]};
  const association={title:'Plex corrected title',type:'movie',plex:{titleKey:'42'}};
  let fail=false,backups=0,reads=0,timestamp=0;
  const sync=createPlexSync({getLibrary:()=>library, now:()=>timestamp,isFile:async()=>true,
    readMetadata:()=>{reads++;if(fail)throw Error('Database offline');return{byPath:new Map([[plexPathKey(one),association],[plexPathKey(two),association]]),ambiguous:2}},
    backup:async()=>{assert.equal(item.title,'Filename guess');backups++},
    addFiles:async(files,options)=>{assert.equal(backups,1);assert.equal(options.inspect,false);assert.deepEqual(files,[plexPathKey(two)]);library.items.push({id:'new',path:two,...association});return{added:1,errors:[]}},save:async()=>{}});
  const first=await sync.sync();assert.equal(first.matched,2);assert.equal(first.ambiguous,2);assert.equal(first.added,1);
  assert.equal(item.id,'keep');assert.equal(item.watched,true);assert.equal(item.quality,quality);
  await sync.sync();assert.equal(reads,1);
  timestamp=60_001;const again=await sync.sync();assert.equal(again.updated,0);assert.equal(again.added,0);assert.equal(backups,1);
  fail=true;timestamp+=60_001;assert.equal((await sync.sync()).state,'unavailable');assert.equal(library.items.length,2);assert.equal(item.title,'Plex corrected title');
  await assert.rejects(sync.sync(true),/offline/);
});
