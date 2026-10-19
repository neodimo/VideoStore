(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VideoStoreLibrary = api;
})(globalThis, function () {
  const identity = i => i.plex?.titleKey ? `plex:${i.plex.titleKey}` : `${String(i.title || '').toLowerCase()}:${i.year || ''}`;
  const titleKey = i => `${i.type}:${identity(i)}`;
  const episodeKey = i => `${titleKey(i)}:${i.season ?? ''}:${i.episode ?? ''}`;
  const numeric = (a,b) => (a == null ? Infinity : a)-(b == null ? Infinity : b);
  const seasonName = n => n === 0 ? 'Specials' : n == null ? 'Unsorted episodes' : `Season ${n}`;
  const artwork = items => { const item = items.find(i => i.plex?.artwork?.thumb) || items.find(i => i.plex?.imdbId) || items[0]; return { artworkId: item?.id || null, imdbId: item?.plex?.imdbId || null }; };
  function groups(items) {
    const rows = new Map();
    for (const i of items) {
      const key = titleKey(i);
      if (!rows.has(key)) rows.set(key,{key,type:i.type,title:i.title || 'Untitled',year:i.year || null,items:[]});
      rows.get(key).items.push(i);
    }
    return [...rows.values()].sort((a,b)=>a.title.localeCompare(b.title,undefined,{numeric:true}) || String(a.year).localeCompare(String(b.year)));
  }
  function versions(items) {
    return [...items].sort((a,b)=>(b.rank?.points||0)-(a.rank?.points||0)).map(i=>({id:i.id,filename:i.filename,sizeBytes:i.sizeBytes,
      resolution:i.quality?.resolution||null,hdr:i.quality?.hdr||null,hdrClaim:i.quality?.hdrClaim||null,
      probeStatus:i.quality?.probeStatus||null,watched:Boolean(i.watched),rank:i.rank?.points||0}));
  }
  function seasons(group) {
    const rows=new Map();
    for(const i of group.items){const n=Number.isInteger(i.season)?i.season:null;if(!rows.has(n))rows.set(n,[]);rows.get(n).push(i);}
    return [...rows].sort((a,b)=>numeric(a[0],b[0]));
  }
  function episodes(items) {
    const rows=new Map();
    for(const i of items){const k=i.episode==null?`${episodeKey(i)}:${i.id}`:episodeKey(i);if(!rows.has(k))rows.set(k,[]);rows.get(k).push(i);}
    return [...rows].sort((a,b)=>numeric(a[1][0].episode,b[1][0].episode));
  }
  function browse(items, query='', offset=0, limit=60, selection={}) {
    const term=String(query||'').trim().toLowerCase().slice(0,120), view=selection.view||'all';
    const filtered=items.filter(i=>(!['movie','tv'].includes(view)||i.type===view)&&(view!=='watchlist'||i.watchlist)&&(view!=='unwatched'||!i.watched));
    let titles=groups(filtered), level='titles', rows;
    const crumbs=[{label:'Library',key:null,season:null}];
    if(selection.key){
      const g=titles.find(g=>g.key===selection.key);
      if(!g)return{total:0,offset:0,items:[],level:'titles',crumbs};
      crumbs.push({label:g.title,key:g.key,season:null});
      if(g.type==='movie'){level='versions';rows=versions(g.items);}
      else if(selection.season!=null&&selection.season!==''){
        const n=selection.season==='unknown'?null:Number(selection.season);
        const entries=seasons(g).find(([s])=>s===n)?.[1]||[];
        crumbs.push({label:seasonName(n),key:g.key,season:n==null?'unknown':n});level='episodes';
        rows=episodes(entries).map(([key,files])=>({...artwork(files),kind:'episode',key,detailKey:key,
          title:files[0].episodeTitle||(files[0].episode==null?'Unsorted episode':`Episode ${files[0].episode}`),
          type:'tv',season:n,episode:files[0].episode??null,versionCount:files.length,versions:versions(files)}));
      }else{level='seasons';rows=seasons(g).map(([n,files])=>({...artwork(files),kind:'season',key:g.key,season:n==null?'unknown':n,title:seasonName(n),episodeCount:episodes(files).length}));}
    }else{
      if(term)titles=titles.filter(g=>g.items.some(i=>`${i.title||''} ${i.episodeTitle||''} ${i.filename||''} ${i.edition||''}`.toLowerCase().includes(term)));
      if (selection.sort === 'quality') titles.sort((a,b)=>Math.max(...b.items.map(i=>i.rank?.points||0))-Math.max(...a.items.map(i=>i.rank?.points||0)));
      if (selection.sort === 'recent') titles.sort((a,b)=>b.items.reduce((n,i)=>i.addedAt>n?i.addedAt:n,'').localeCompare(a.items.reduce((n,i)=>i.addedAt>n?i.addedAt:n,'')));
      rows=titles.map(g=>({...artwork(g.items),kind:'title',key:g.key,detailKey:episodeKey(g.items[0]),title:g.title,year:g.year,type:g.type,
        seasonCount:g.type==='tv'?seasons(g).length:0,episodeCount:g.type==='tv'?episodes(g.items).length:0,
        versionCount:g.type==='movie'?g.items.length:undefined,versions:g.type==='movie'?versions(g.items):undefined}));
    }
    const start=Math.max(0,Math.min(100000,parseInt(offset,10)||0)), size=Math.max(1,Math.min(100,parseInt(limit,10)||60));
    return{total:rows.length,offset:start,level,crumbs,items:rows.slice(start,start+size)};
  }
  return{browse,groups,titleKey,episodeKey};
});
