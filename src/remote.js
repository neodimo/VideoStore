const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '"': '&quot;', '>': '&gt;', "'": '&#39;' })[character]);
const size = value => Number.isFinite(value) ? `${(value / 1_000_000_000).toFixed(1)} GB` : 'Size unknown';
let catalog = [];
let candidates = [];
let cart = [];
let plan = null;
let hostStatus = {};
let catalogTimer;
let libraryTimer;
let librarySelection = { key: null, season: null, view: "all" };
let libraryRequest = 0;
let hostLibrary = { items: [], total: 0, offset: 0 };

async function api(route, options = {}) {
  const response = await fetch(route, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...options });
  const body = await response.json();
  if (!response.ok) { if (response.status === 401 && route !== '/api/pair') showPairing(); throw new Error(body.error || `Host returned HTTP ${response.status}`); }
  return body;
}

function notice(message, error = false) { $('#notice').textContent = message; $('#notice').style.color = error ? '#ffa8a8' : '#d7ff61'; }
function showPairing() { $('#pairing').hidden = false; $('#workspace').hidden = true; }
function showWorkspace() { $('#pairing').hidden = true; $('#workspace').hidden = false; }

function setView(view) {
  document.querySelectorAll('#remote-navigation button').forEach(b => { b.classList.toggle('active', b.dataset.view === view); if(b.dataset.view === view) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); });
  const libraryView = ['all','movie','tv'].includes(view);
  $('.host-library').hidden = !libraryView;
  $('#discover-panel').hidden = view !== 'discover';
  $('#account-panel').hidden = view !== 'account';
  $('#cart-panel').hidden = view !== 'cart';
  $('#jobs-panel').hidden = view !== 'jobs';
  $('#connection-panel').hidden = view !== 'connection';
  if (libraryView) { librarySelection = {key:null,season:null,view}; loadHostLibrary(); }
  if (view === 'jobs') loadJobs();
}
function navigateLibrary(key = null, season = null) {
  librarySelection = {...librarySelection,key,season};
  loadHostLibrary();
}
function renderHostLibrary() {
  const label = {titles:'titles',seasons:'seasons',episodes:'episodes',versions:'versions'}[hostLibrary.level] || 'titles';
  $('#library-count').textContent = `· ${hostLibrary.total.toLocaleString()} ${label}`;
  const crumbs = hostLibrary.crumbs || [{label:'Library',key:null,season:null}];
  $('#library-crumbs').innerHTML = crumbs.map((c,index) => `<button class="subtle" data-crumb="${index}" ${index === crumbs.length - 1 ? 'aria-current="page"' : ''}>${escapeHtml(c.label)}</button>`).join('<span aria-hidden="true"> / </span>');
  document.querySelectorAll('[data-crumb]').forEach(b => b.addEventListener('click', () => { const c = crumbs[Number(b.dataset.crumb)]; navigateLibrary(c.key,c.season); }));
  $('#host-library').innerHTML = hostLibrary.items.length ? hostLibrary.items.map((item,index) => {
    if (hostLibrary.level === 'versions') return `<article class="version-row"><b>${escapeHtml(item.filename)}</b><small>${escapeHtml(item.resolution || 'Resolution unknown')} · ${size(item.sizeBytes)} · ${escapeHtml(item.probeStatus || 'Not inspected')}</small></article>`;
    const kind = item.kind || 'title';
    const summary = kind === 'season' ? `${item.episodeCount} episodes` : kind === 'episode' ? `Episode ${item.episode ?? '?'} · ${item.versionCount} versions` : item.type === 'tv' ? `${item.seasonCount} seasons · ${item.episodeCount} episodes` : `${item.year || 'Year unknown'} · ${item.versionCount || item.versions?.length || 1} versions`;
    const badge = kind === 'season' ? 'SEASON' : kind === 'episode' ? 'EPISODE' : item.type === 'tv' ? 'SERIES' : 'MOVIE';
    return `<article class="library-tile"><button class="library-open" data-index="${index}"><div class="library-art">${badge}</div><div class="library-info"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(summary)}</small></div></button>${kind === 'episode' ? `<div class="episode-versions" hidden>${item.versions.map(v => `<div class="version-row"><b>${escapeHtml(v.filename)}</b><small>${escapeHtml(v.resolution || 'Resolution unknown')} · ${size(v.sizeBytes)} · ${escapeHtml(v.probeStatus || 'Not inspected')}</small></div>`).join('')}</div>` : ''}</article>`;
  }).join('') : '<p class="empty">No matching titles on the media PC. Import its Plex folders in the host app if the library is empty.</p>';
  document.querySelectorAll('.library-open').forEach(button => button.addEventListener('click', () => {
    const item = hostLibrary.items[Number(button.dataset.index)];
    if (item.kind === 'episode') { const panel = button.parentElement.querySelector('.episode-versions'); panel.hidden = !panel.hidden; button.setAttribute('aria-expanded', String(!panel.hidden)); }
    else navigateLibrary(item.key, item.kind === 'season' ? item.season : null);
  }));
  $('#library-more').hidden = hostLibrary.items.length >= hostLibrary.total;
}
async function loadHostLibrary(more = false) {
  const request = ++libraryRequest;
  try {
    const offset = more ? hostLibrary.items.length : 0;
    const params = new URLSearchParams({q:$('#library-search').value.trim(),offset:String(offset),limit:'60'});
    if (librarySelection.key) params.set('key',librarySelection.key);
    if (librarySelection.season != null) params.set('season',String(librarySelection.season));
    if (librarySelection.view !== 'all') params.set('view',librarySelection.view);
    const result = await api(`/api/library?${params}`);
    if (request !== libraryRequest) return;
    hostLibrary = {...result,items:more ? [...hostLibrary.items,...result.items] : result.items};
    renderHostLibrary();
  } catch(error) { if (request === libraryRequest) $('#host-library').innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`; }
}

function renderCatalog() {
  $('#catalog').innerHTML = catalog.length ? catalog.map(item => `<article class="poster-tile" data-id="${escapeHtml(item.id)}"><div class="poster"><strong class="poster-fallback">${escapeHtml(item.name)}</strong><img alt="" loading="lazy" hidden></div><div class="info"><b>${escapeHtml(item.name)}</b><p>${escapeHtml(item.year || 'Year unknown')} · ${item.type === 'series' ? 'Series' : 'Movie'}</p><button>Find account files</button></div></article>`).join('') : '<p class="empty">No catalog titles found.</p>';
  document.querySelectorAll('.poster-tile').forEach(tile => tile.querySelector('button').addEventListener('click', () => {
    const item = catalog.find(row => row.id === tile.dataset.id);
    setView('account');
    $('#candidate-search').value = item.name;
    renderCandidates();
    $('#candidate-search').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
  document.querySelectorAll('.poster-tile').forEach(tile => {
    const item = catalog.find(row => row.id === tile.dataset.id);
    window.VideoStorePosters.load(tile.querySelector('img'), {
      primary: () => hostStatus.artworkConfigured ? `/api/poster/${item.id}` : null,
      fallback: window.VideoStorePosters.fallback(item.id, item.poster)
    });
  });
}

function renderCandidates() {
  const query = $('#candidate-search').value.trim().toLowerCase();
  const shown = candidates.filter(item => !query || `${item.title} ${item.filename}`.toLowerCase().includes(query)).slice(0, 35);
  $('#candidates').innerHTML = shown.length ? shown.map(item => `<div class="row" data-id="${escapeHtml(item.id)}"><b>${escapeHtml(item.filename)}</b><small>${size(item.sizeBytes)} · ${escapeHtml(item.quality.resolution || 'resolution unknown')} · ${escapeHtml(item.quality.hdrClaim ? `${item.quality.hdrClaim} (filename claim)` : 'HDR unknown')} · ${escapeHtml(item.provider === 'torbox' ? `TorBox ${item.sourceKind}` : 'Real-Debrid')}</small><button ${!item.sizeBytes || item.availability === 'No link' ? 'disabled' : ''}>Add to cart</button></div>`).join('') : '<p class="empty">No matching account files. Refresh or try a different title.</p>';
  document.querySelectorAll('#candidates .row button').forEach(button => button.addEventListener('click', () => { const item = candidates.find(row => row.id === button.closest('.row').dataset.id); if (!cart.some(row => row.id === item.id)) { cart.push(item); plan = null; renderCart(); } }));
}

function renderCart() {
  $('#cart-count').textContent = cart.length;
  $('#cart').innerHTML = cart.length ? cart.map(item => `<div class="row" data-id="${escapeHtml(item.id)}"><b>${escapeHtml(item.filename)}</b><small>${size(item.sizeBytes)}</small><button class="subtle">Remove</button></div>`).join('') : '<p class="empty">Choose an account file to build a host-side placement plan.</p>';
  document.querySelectorAll('#cart .row button').forEach(button => button.addEventListener('click', () => { cart = cart.filter(item => item.id !== button.closest('.row').dataset.id); plan = null; renderCart(); }));
  $('#preview').disabled = !cart.length;
  if (!plan) { $('#plan').innerHTML = ''; $('#submit').hidden = true; }
}

function renderPlan() {
  $('#plan').innerHTML = plan.items.map(item => `<div class="plan-item"><b>${escapeHtml(item.filename)}</b><div>${escapeHtml(item.destinationLabel)} / ${escapeHtml(item.relativePath)}</div><small>${size(item.freeBeforeBytes)} free → ${size(item.freeAfterBytes)} after · floor ${size(item.floorBytes)}</small></div>`).join('');
  $('#submit').hidden = false;
}

async function loadCatalog(query = '') { try { catalog = await api(`/api/catalog?q=${encodeURIComponent(query)}`); renderCatalog(); } catch (error) { notice(error.message, true); } }
async function loadCandidates(force = false) { try { const result = await api(force ? '/api/candidates?refresh=1' : '/api/candidates'); candidates = result.items; renderCandidates(); if (result.warnings?.length) notice(result.warnings.join(' · '), true); } catch (error) { $('#candidates').innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`; } }
async function loadJobs() {
  try {
    const jobs = await api('/api/jobs');
    $('#jobs').innerHTML = jobs.length ? jobs.slice(-12).reverse().map(job => `<div class="row" data-id="${escapeHtml(job.id)}"><b>${escapeHtml(job.filename)}</b><small>${escapeHtml(job.state)} · ${size(job.receivedBytes)} of ${size(job.sizeBytes)} · ${escapeHtml(job.destinationLabel)}${job.error ? ` · ${escapeHtml(job.error)}` : ''}</small>${['queued', 'downloading'].includes(job.state) ? '<button class="subtle">Cancel</button>' : ''}</div>`).join('') : '<p class="empty">No host downloads yet.</p>';
    document.querySelectorAll('#jobs button').forEach(button => button.addEventListener('click', async () => { try { await api('/api/cancel', { method: 'POST', body: JSON.stringify({ id: button.closest('.row').dataset.id }) }); await loadJobs(); } catch (error) { notice(error.message, true); } }));
  } catch (error) { notice(error.message, true); }
}

$('#pair-form').addEventListener('submit', async event => { event.preventDefault(); try { await api('/api/pair', { method: 'POST', body: JSON.stringify({ code: event.currentTarget.elements.code.value }) }); showWorkspace(); await initialize(); } catch (error) { notice(error.message, true); } });
$('#catalog-search').addEventListener('input', () => { clearTimeout(catalogTimer); catalogTimer = setTimeout(() => loadCatalog($('#catalog-search').value), 350); });
$('#library-search').addEventListener('input', () => { librarySelection.key=null; librarySelection.season=null; clearTimeout(libraryTimer); libraryTimer=setTimeout(() => loadHostLibrary(),300); });
$('#remote-navigation').addEventListener('click', e => { const b=e.target.closest('[data-view]'); if(b) setView(b.dataset.view); });
$('#library-more').addEventListener('click', () => loadHostLibrary(true));
$('#candidate-search').addEventListener('input', renderCandidates);
$('#refresh-candidates').addEventListener('click', () => loadCandidates(true));
$('#preview').addEventListener('click', async () => { try { plan = await api('/api/plan', { method: 'POST', body: JSON.stringify({ ids: cart.map(item => item.id) }) }); renderPlan(); notice('Review every folder and post-download free-space value before sending.'); } catch (error) { notice(error.message, true); } });
$('#submit').addEventListener('click', async () => { try { const result = await api('/api/submit', { method: 'POST', body: JSON.stringify({ planId: plan.planId }) }); cart = []; plan = null; renderCart(); await loadJobs(); notice(`${result.jobIds.length} download job${result.jobIds.length === 1 ? '' : 's'} sent to the host. No files came from this laptop.`); } catch (error) { notice(error.message, true); } });

async function initialize() { hostStatus = await api('/api/status'); showWorkspace(); await Promise.all([loadHostLibrary(), loadCatalog(), loadCandidates(), loadJobs()]); }
setInterval(() => { if (!$('#workspace').hidden) loadJobs(); }, 3000);
initialize().catch(() => showPairing());
