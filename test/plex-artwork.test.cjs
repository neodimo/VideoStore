const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {plexPoster}=require('../src/plex-artwork.cjs');
test('Plex artwork reads the selected local poster, rejects traversal and tolerates absent artwork',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vs-plex-art-'));
 try {
  const art={type:'movie',hash:'a'.repeat(40),thumb:'metadata://posters/chosen'};
  const dir=path.join(root,'Metadata','Movies','a','a'.repeat(39)+'.bundle','Contents','_combined','posters');await fs.mkdir(dir,{recursive:true});
  const bytes=Buffer.from([255,216,255,217]);await fs.writeFile(path.join(dir,'chosen'),bytes);
  assert.equal(await plexPoster(art,root),'data:image/jpeg;base64,'+bytes.toString('base64'));
  assert.equal(await plexPoster({...art,thumb:'metadata://posters/../chosen'},root),null);
  assert.equal(await plexPoster({...art,hash:'../etc'},root),null);
  assert.equal(await plexPoster({...art,thumb:'metadata://posters/absent'},root),null);
  await fs.writeFile(path.join(dir,'chosen'),'not an image');assert.equal(await plexPoster(art,root),null);
 } finally {await fs.rm(root,{recursive:true,force:true})}
});
