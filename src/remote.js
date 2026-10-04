const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '"': '&quot;', '>': '&gt;', "'": '&#39;' })[character]);
const size = value => Number.isFinite(value) ? `${(value / 1_000_000_000).toFixed(1)} GB` : 'Size unknown';
let catalog = [];
let candidates = [];
let cart = [];
let plan = null;
let hostStatus = {};
let catalogTimer;

async function api(route, options = {}) {
  const response = await fetch(route, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...options });
  const body = await response.json();
  if (!response.ok) { if (response.status === 401 && route !== '/api/pair') showPairing(); throw new Error(body.error || `Host returned HTTP ${response.status}`); }
  return body;
}

function notice(message, error = false) { $('#notice').textContent = message; $('#notice').style.color = error ? '#ffa8a8' : '#d7ff61'; }
function showPairing() { $('#pairing').hidden = false; $('#workspace').hidden = true; }
function showWorkspace() { $('#pairing').hidden = true; $('#workspace').hidden = false; }

function renderCatalog() {
  $('#catalog').innerHTML = catalog.length ? catalog.map(item => `<article class="poster-tile" data-id="${escapeHtml(item.id)}"><div class="poster"><strong>${escapeHtml(item.name)}</strong>${item.poster ? `<img alt="" loading="lazy" src="${escapeHtml(item.poster)}">` : ''}</div><div class="info"><b>${escapeHtml(item.name)}</b><p>${escapeHtml(item.year || 'Year unknown')} · ${item.type === 'series' ? 'Series' : 'Movie'}</p><button>Find account files</button></div></article>`).join('') : '<p class="empty">No catalog titles found.</p>';
  document.querySelectorAll('.poster-tile').forEach(tile => tile.querySelector('button').addEventListener('click', () => {
    const item = catalog.find(row => row.id === tile.dataset.id);
    $('#candidate-search').value = item.name;
    renderCandidates();
    $('#candidate-search').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
  document.querySelectorAll('.poster-tile').forEach(tile => {
    const img = tile.querySelector('img');
    if (!img) return;
    const fallback = img.src;
    let usingOverride = Boolean(hostStatus.artworkConfigured);
    img.addEventListener('error', () => {
      if (usingOverride) { usingOverride = false; img.src = fallback; }
      else img.remove();
    });
    if (usingOverride) img.src = `/api/poster/${tile.dataset.id}`;
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
$('#candidate-search').addEventListener('input', renderCandidates);
$('#refresh-candidates').addEventListener('click', () => loadCandidates(true));
$('#preview').addEventListener('click', async () => { try { plan = await api('/api/plan', { method: 'POST', body: JSON.stringify({ ids: cart.map(item => item.id) }) }); renderPlan(); notice('Review every folder and post-download free-space value before sending.'); } catch (error) { notice(error.message, true); } });
$('#submit').addEventListener('click', async () => { try { const result = await api('/api/submit', { method: 'POST', body: JSON.stringify({ planId: plan.planId }) }); cart = []; plan = null; renderCart(); await loadJobs(); notice(`${result.jobIds.length} download job${result.jobIds.length === 1 ? '' : 's'} sent to the host. No files came from this laptop.`); } catch (error) { notice(error.message, true); } });

async function initialize() { hostStatus = await api('/api/status'); showWorkspace(); await Promise.all([loadCatalog(), loadCandidates(), loadJobs()]); }
setInterval(() => { if (!$('#workspace').hidden) loadJobs(); }, 3000);
initialize().catch(() => showPairing());
