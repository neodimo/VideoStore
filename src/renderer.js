let library = { items: [], preferences: {} };
let view = 'all';
let selectedKey = null;
let catalogItems = [];
let catalogQueryTimer;
let catalogPosterObserver;
let providers = { secureStorage: false, artwork: { configured: false }, providers: [] };
let destinations = [];
let updateStatus = { state: 'idle' };
let scanActive = false;
let mediaCandidates = [];
let mediaWarnings = [];
let mediaCart = [];
let mediaPlan = null;
let mediaJobs = [];
let lanState = { running: false, addresses: [], port: 43879 };
const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const bytes = value => value ? `${(value / 1_073_741_824).toFixed(2)} GB` : 'Unknown';
const bitrate = value => value ? `${(value / 1_000_000).toFixed(1)} Mb/s` : 'Unknown';
const duration = value => value ? `${Math.round(value / 60)} min` : 'Unknown';
const titleKey = item => `${item.type}:${item.title.toLowerCase()}:${item.year || ''}:${item.season ?? ''}:${item.episode ?? ''}`;

function groups() {
  const grouped = new Map();
  for (const item of library.items) {
    const key = titleKey(item);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  return [...grouped].map(([key, items]) => ({ key, items: items.sort((a, b) => b.rank.points - a.rank.points), best: items[0] }));
}

function filteredGroups() {
  const query = $('#search').value.trim().toLowerCase();
  const result = groups().filter(group => {
    const item = group.best;
    if (view === 'movie' && item.type !== 'movie') return false;
    if (view === 'tv' && item.type !== 'tv') return false;
    if (view === 'watchlist' && !group.items.some(i => i.watchlist)) return false;
    if (view === 'unwatched' && group.items.every(i => i.watched)) return false;
    return !query || group.items.some(i => `${i.title} ${i.filename} ${i.edition || ''}`.toLowerCase().includes(query));
  });
  const sort = $('#sort').value;
  result.sort((a, b) => sort === 'title' ? a.best.title.localeCompare(b.best.title) : sort === 'recent' ? b.best.addedAt.localeCompare(a.best.addedAt) : b.best.rank.points - a.best.rank.points);
  return result;
}

function render() {
  const names = { all: 'Your library', discover: 'Discover', providers: 'Providers', storage: 'Storage', account: 'Account files', network: 'Network host', movie: 'Movies', tv: 'TV shows', watchlist: 'Watchlist', unwatched: 'Unwatched' };
  $('#view-heading').textContent = names[view];
  $('#crumb').textContent = names[view];
  $('.hero').hidden = view !== 'all';
  for (const button of document.querySelectorAll('.nav')) button.classList.toggle('active', button.dataset.view === view);
  $('#sort').hidden = ['discover', 'providers', 'storage', 'account', 'network'].includes(view);
  $('#search').hidden = ['providers', 'storage', 'account', 'network'].includes(view);
  if (view === 'providers') { renderProviders(); return; }
  if (view === 'storage') { renderStorage(); return; }
  if (view === 'account') { renderMedia(); return; }
  if (view === 'network') { renderNetwork(); return; }
  $('#search').placeholder = view === 'discover' ? 'Search movies and TV shows…' : 'Search titles, files, editions…';
  if (view === 'discover') { renderCatalog(); return; }
  const found = filteredGroups();
  $('#count').textContent = `${found.length} title${found.length === 1 ? '' : 's'} · ${library.items.length} file${library.items.length === 1 ? '' : 's'}`;
  $('#grid').innerHTML = found.length ? found.map(group => {
    const item = group.best;
    const episode = item.type === 'tv' ? ` · S${String(item.season).padStart(2, '0')}E${String(item.episode).padStart(2, '0')}` : '';
    const q = item.quality;
    return `<button class="tile" data-key="${escapeHtml(group.key)}"><div class="poster"><small>${escapeHtml(item.type === 'tv' ? 'SERIES' : 'MOVIE')}</small><span>${escapeHtml(item.title)}</span></div><div class="tile-info"><strong>${escapeHtml(item.title)}${episode}</strong><p>${escapeHtml(item.year || 'Year unknown')} · ${group.items.length} version${group.items.length === 1 ? '' : 's'} · Local file</p><div class="tags"><span>${escapeHtml(q.resolution || 'Resolution unknown')}</span>${q.hdr ? `<span>${escapeHtml(q.hdr)}</span>` : ''}<span class="${q.probeStatus === 'media probed' ? 'verified' : ''}">${escapeHtml(q.probeStatus)}</span></div></div></button>`;
  }).join('') : `<div class="empty"><b>${library.items.length ? 'Nothing matches this view' : 'Your collection starts here'}</b><div>${library.items.length ? 'Try a different search or filter.' : 'Add local video files to inspect their real media tracks and compare editions.'}</div>${library.items.length ? '' : '<button class="primary" id="empty-add">＋ Add videos</button>'}</div>`;
  document.querySelectorAll('.tile').forEach(tile => tile.addEventListener('click', () => showDetails(tile.dataset.key)));
  $('#empty-add')?.addEventListener('click', add);
  if (selectedKey) showDetails(selectedKey);
}

function formatSpace(value) { return Number.isFinite(value) ? `${(value / 1_000_000_000).toFixed(1)} GB` : 'Unavailable'; }

function renderStorage() {
  $('#count').textContent = `${destinations.length} managed folder${destinations.length === 1 ? '' : 's'} · capacity checked on the host OS`;
  $('#grid').innerHTML = `<div class="provider-panel storage-panel"><h3>Plex library destinations</h3><p>Add existing movie and TV folders. VideoStore does not move or write files during setup. The default free-space floor is the greater of 10% of a drive or 500 GiB; adjust it per folder. Placement previews need an exact file size.</p><div class="detail-actions"><button class="primary" id="add-movie-folder">＋ Movie folder</button><button class="secondary" id="add-tv-folder">＋ TV folder</button></div><div id="destination-list">${destinations.map(item => `<section class="destination"><div><strong>${escapeHtml(item.label)} · ${item.type === 'movie' ? 'Movies' : 'TV'}</strong><small>${escapeHtml(item.path)}</small><small>${item.available ? `${formatSpace(item.freeBytes)} free of ${formatSpace(item.totalBytes)}` : `Unavailable: ${escapeHtml(item.error || 'unknown')}`}</small></div><form class="floor-form" data-id="${escapeHtml(item.id)}"><label>Floor % <input name="percent" type="number" min="0" max="90" step="1" value="${item.reservePercent}"></label><label>Floor GiB <input name="gib" type="number" min="0" max="100000" step="1" value="${Math.round(item.reserveBytes / 1073741824)}"></label><button class="secondary">Save floor</button><button type="button" class="secondary danger remove-folder">Remove</button></form></section>`).join('')}</div><form id="plan-form" class="plan-form"><h3>Preview a placement</h3><select name="type" aria-label="Media type"><option value="movie">Movie</option><option value="tv">TV episode/show</option></select><input name="gigabytes" type="number" min="0.001" step="0.001" placeholder="Exact size in GB" aria-label="File size in decimal GB" required><button class="primary">Preview space</button></form><div id="plan-results"></div></div>`;
  $('#add-movie-folder').addEventListener('click', () => addDestination('movie'));
  $('#add-tv-folder').addEventListener('click', () => addDestination('tv'));
  document.querySelectorAll('.floor-form').forEach(form => {
    const destination = destinations.find(item => item.id === form.dataset.id);
    const layoutLabel = document.createElement('label');
    layoutLabel.textContent = ' Folder pattern ';
    const layoutSelect = document.createElement('select');
    const patterns = destination.type === 'movie' ? [['unknown', 'Review pattern'], ['movie-folder', 'Title (Year)/File'], ['movie-flat', 'File in root']] : [['unknown', 'Review pattern'], ['tv-season', 'Show/Season XX/File'], ['tv-flat', 'File in root']];
    for (const [value, text] of patterns) layoutSelect.add(new Option(text, value));
    layoutSelect.value = destination.layout || 'unknown';
    layoutLabel.append(layoutSelect);
    form.prepend(layoutLabel);
    layoutSelect.addEventListener('change', () => run(async () => { await window.videostore.storageLayout(form.dataset.id, layoutSelect.value); await loadStorage(); }, 'Folder pattern confirmed. Existing files were not changed.'));
    form.addEventListener('submit', event => { event.preventDefault(); run(async () => { await window.videostore.storageUpdate(form.dataset.id, Number(form.elements.percent.value), Number(form.elements.gib.value)); await loadStorage(); }, 'Free-space floor saved.'); });
    form.querySelector('.remove-folder').addEventListener('click', () => run(async () => { await window.videostore.storageRemove(form.dataset.id); await loadStorage(); }, 'Destination removed from VideoStore; files untouched.'));
  });
  $('#plan-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const fileBytes = Math.round(Number(form.elements.gigabytes.value) * 1_000_000_000);
    try {
      const plan = await window.videostore.storagePlan(form.elements.type.value, fileBytes);
      $('#plan-results').innerHTML = plan.results.length ? plan.results.map(item => `<div class="plan-result ${item.eligible ? 'eligible' : 'blocked'}"><strong>${escapeHtml(item.label)}${plan.recommended === item.id ? ' · RECOMMENDED' : ''}</strong><div>${escapeHtml(item.reason)}</div><small>${item.freeBytes != null ? `${formatSpace(item.freeBytes)} now → ${formatSpace(item.afterBytes)} after · floor ${formatSpace(item.floorBytes)}` : 'Capacity unavailable'}</small></div>`).join('') : '<div class="notice">No folders configured for this media type.</div>';
    } catch (error) { status(error.message, true); }
  });
}

async function addDestination(type) {
  await run(async () => { const item = await window.videostore.storageAdd(type, ''); if (item) { await loadStorage(); status('Folder configured. No media was moved.'); } }, '');
}

async function loadStorage() {
  try { destinations = await window.videostore.storageList(); renderStorage(); }
  catch (error) { status(`Storage status unavailable: ${error.message}`, true); }
}

function renderMedia() {
  $('#count').textContent = `${mediaCandidates.length} account file${mediaCandidates.length === 1 ? '' : 's'} · downloads run on this host`;
  $('#grid').innerHTML = `<div class="provider-panel media-panel"><h3>Account files → host downloads</h3><p>Select files already listed in your Real-Debrid or TorBox account. The filename hints are not verified media facts. The cart requires a drive/folder and exact-size preview before any write.</p><button class="secondary" id="media-refresh">Refresh account files</button>${mediaWarnings.length ? `<div class="notice">${mediaWarnings.map(escapeHtml).join(' · ')}</div>` : ''}<div class="media-columns"><div><h3>AVAILABLE</h3><input id="media-filter" type="search" placeholder="Filter account filenames…"><div id="media-list"></div></div><div><h3>CART · ${mediaCart.length}</h3><div id="media-cart">${mediaCart.length ? mediaCart.map(item => `<div class="media-row" data-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.filename)}</strong><small>${bytes(item.sizeBytes)}</small><button class="secondary remove-cart">Remove</button></div>`).join('') : '<p>No files selected.</p>'}</div><button class="primary" id="media-preview" ${mediaCart.length ? '' : 'disabled'}>Preview folders & free space</button><div id="media-plan">${mediaPlan ? mediaPlan.items.map(item => `<div class="plan-result eligible"><strong>${escapeHtml(item.filename)}</strong><div>${escapeHtml(item.destinationLabel)} / ${escapeHtml(item.relativePath)}</div><small>${formatSpace(item.freeBeforeBytes)} free → ${formatSpace(item.freeAfterBytes)} after · floor ${formatSpace(item.floorBytes)}</small></div>`).join('') : ''}</div>${mediaPlan ? '<button class="primary" id="media-submit">Download on this host</button>' : ''}</div></div><h3>DOWNLOAD ACTIVITY</h3><div id="media-jobs">${mediaJobs.length ? mediaJobs.slice(-15).reverse().map(job => `<div class="media-row" data-id="${escapeHtml(job.id)}"><strong>${escapeHtml(job.filename)}</strong><small>${escapeHtml(job.state)} · ${bytes(job.receivedBytes)} of ${bytes(job.sizeBytes)} · ${escapeHtml(job.destinationLabel)}${job.error ? ` · ${escapeHtml(job.error)}` : ''}</small>${['queued', 'downloading'].includes(job.state) ? '<button class="secondary cancel-job">Cancel</button>' : ''}</div>`).join('') : '<p>No downloads yet.</p>'}</div></div>`;
  const renderList = () => {
    const query = $('#media-filter').value.toLowerCase();
    $('#media-list').innerHTML = mediaCandidates.filter(item => !query || item.filename.toLowerCase().includes(query)).slice(0, 100).map(item => `<div class="media-row" data-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.filename)}</strong><small>${bytes(item.sizeBytes)} · ${escapeHtml(item.quality.resolution || 'Resolution unknown')} · ${escapeHtml(item.quality.hdrClaim ? `${item.quality.hdrClaim} (filename claim)` : 'HDR unknown')} · ${escapeHtml(item.provider === 'torbox' ? `TorBox ${item.sourceKind}` : 'Real-Debrid')}</small><button class="secondary add-cart" ${!item.sizeBytes || item.availability === 'No link' ? 'disabled' : ''}>Add to cart</button></div>`).join('') || '<p>No matching account files.</p>';
    document.querySelectorAll('.add-cart').forEach(button => button.addEventListener('click', () => { const item = mediaCandidates.find(entry => entry.id === button.closest('.media-row').dataset.id); if (!mediaCart.some(entry => entry.id === item.id)) { mediaCart.push(item); mediaPlan = null; renderMedia(); } }));
  };
  $('#media-filter').addEventListener('input', renderList);
  renderList();
  $('#media-refresh').addEventListener('click', () => loadMedia(true));
  document.querySelectorAll('.remove-cart').forEach(button => button.addEventListener('click', () => { mediaCart = mediaCart.filter(item => item.id !== button.closest('.media-row').dataset.id); mediaPlan = null; renderMedia(); }));
  $('#media-preview').addEventListener('click', () => run(async () => { mediaPlan = await window.videostore.mediaPlan(mediaCart.map(item => item.id)); renderMedia(); status('Review each planned folder and free-space floor before downloading.'); }, ''));
  $('#media-submit')?.addEventListener('click', () => run(async () => { const ids = await window.videostore.mediaSubmit(mediaPlan.planId); mediaCart = []; mediaPlan = null; mediaJobs = await window.videostore.mediaJobs(); renderMedia(); status(`${ids.length} host download job${ids.length === 1 ? '' : 's'} queued.`); }, ''));
  document.querySelectorAll('.cancel-job').forEach(button => button.addEventListener('click', () => run(async () => { await window.videostore.mediaCancel(button.closest('.media-row').dataset.id); mediaJobs = await window.videostore.mediaJobs(); renderMedia(); }, 'Cancellation requested.')));
}

async function loadMedia(force = false) {
  try { const result = await window.videostore.mediaCandidates(force); mediaCandidates = result.items; mediaWarnings = result.warnings || []; mediaJobs = await window.videostore.mediaJobs(); renderMedia(); }
  catch (error) { status(`Account files unavailable: ${error.message}`, true); }
}

function renderNetwork() {
  $('#count').textContent = lanState.running ? 'This machine is accepting paired laptop clients on your private network.' : 'Network host is off; local VideoStore still works.';
  const links = (lanState.addresses || []).map(address => `http://${address}:${lanState.port || 43879}`);
  $('#grid').innerHTML = `<div class="provider-panel"><h3>Use VideoStore from your laptop</h3><p>Start the host here, then open one of these addresses in your laptop browser on the same private network. Pair with a short-lived code shown only on this machine. The laptop sends selections; provider links, credentials, downloads, and media files stay on this machine.</p><div class="notice">LAN mode uses HTTP on a trusted private network. Do not port-forward it to the Internet. Keep this app running while you use the laptop client.</div><div class="detail-actions"><button class="primary" id="lan-toggle">${lanState.running ? 'Stop network host' : 'Start network host'}</button>${lanState.running ? '<button class="secondary" id="lan-code">Show pairing code</button>' : ''}</div>${lanState.running ? `<div class="detail-section"><h3>LAPTOP ADDRESS</h3>${links.length ? links.map(link => `<div class="fact"><span>Open in laptop browser</span><span>${escapeHtml(link)}</span></div>`).join('') : '<div class="notice">No private-network IPv4 address detected. Check this machine’s network connection.</div>'}${lanState.pairing ? `<div class="notice">Pairing code: <strong>${escapeHtml(lanState.pairing.code)}</strong> · expires ${escapeHtml(new Date(lanState.pairing.expiresAt).toLocaleTimeString())}</div>` : ''}</div>` : ''}</div>`;
  $('#lan-toggle').addEventListener('click', () => run(async () => { lanState = lanState.running ? await window.videostore.lanStop() : await window.videostore.lanStart(); renderNetwork(); }, lanState.running ? 'Network host stopped.' : 'Network host started.'));
  $('#lan-code')?.addEventListener('click', () => run(async () => { lanState.pairing = await window.videostore.lanPairCode(); renderNetwork(); }, 'Pairing code refreshed.'));
}

async function loadNetwork() { try { lanState = await window.videostore.lanStatus(); renderNetwork(); } catch (error) { status(error.message, true); } }

function renderProviders() {
  $('#count').textContent = 'Connect your own accounts; credentials never enter the library file.';
  $('#grid').innerHTML = `<div class="provider-panel"><h3>Account connections</h3><p>Enter a provider API token to test the official account endpoint. A successful token is saved only if OS-backed encryption is available. Tokens are never shown again.</p>${providers.secureStorage ? '' : '<div class="notice">Secure OS storage is unavailable on this desktop. Provider tokens cannot be saved here.</div>'}${providers.providers.map(provider => `<form class="provider-form" data-provider="${escapeHtml(provider.id)}"><div><strong>${escapeHtml(provider.label)}</strong><small>${provider.configured ? 'Encrypted token saved locally' : 'Not connected'}</small></div><input type="password" name="token" autocomplete="off" placeholder="API token" aria-label="${escapeHtml(provider.label)} API token" ${providers.secureStorage ? '' : 'disabled'}><button class="primary" ${providers.secureStorage ? '' : 'disabled'}>Test & save</button></form>`).join('')}<h3>Poster artwork</h3><p>Optional RatingPosterDB override for IMDb-identified titles. The API key stays encrypted on this host; browsers on the network receive only the finished poster image. A missing poster falls back to Cinemeta.</p><form id="artwork-form" class="provider-form"><div><strong>RatingPosterDB</strong><small>${providers.artwork?.configured ? 'Encrypted key saved locally' : 'Cinemeta posters in use'}</small></div><input type="password" name="key" autocomplete="off" placeholder="API key" aria-label="RatingPosterDB API key" ${providers.secureStorage ? '' : 'disabled'}><button class="primary" ${providers.secureStorage ? '' : 'disabled'}>Save key</button></form><div class="notice">Real-Debrid and TorBox account files can be queued for host-side download from Library → Account files. New-source discovery is not connected yet.</div></div>`;
  document.querySelectorAll('.provider-form').forEach(form => form.addEventListener('submit', async event => {
    if (form.id === 'artwork-form') return;
    event.preventDefault();
    const input = form.elements.token;
    const token = input.value;
    input.value = '';
    form.querySelector('button').disabled = true;
    try { providers = await window.videostore.configureProvider(form.dataset.provider, token); renderProviders(); status(`${form.dataset.provider} account verified; token stored with OS encryption.`); }
    catch (error) { status(error.message, true); form.querySelector('button').disabled = false; }
  }));
  $('#artwork-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = event.currentTarget.elements.key;
    const key = input.value;
    input.value = '';
    try { providers = await window.videostore.configureArtwork(key); renderProviders(); status('RatingPosterDB key saved. Posters will load on demand.'); }
    catch (error) { status(error.message, true); }
  });
}

async function loadProviders() {
  try { providers = await window.videostore.providerStatus(); renderProviders(); }
  catch (error) { status(`Provider status unavailable: ${error.message}`, true); }
}

function renderCatalog() {
  catalogPosterObserver?.disconnect();
  $('#count').textContent = `${catalogItems.length} catalog titles · metadata by Cinemeta`;
  $('#grid').innerHTML = catalogItems.length ? catalogItems.map(meta => `<button class="tile catalog-tile" data-id="${escapeHtml(meta.id)}" data-type="${escapeHtml(meta.type)}"><div class="poster"><span class="poster-fallback">${escapeHtml(meta.name)}</span>${meta.poster ? `<img src="${escapeHtml(meta.poster)}" alt="" loading="lazy">` : ''}<small>${meta.type === 'series' ? 'SERIES' : 'MOVIE'}</small></div><div class="tile-info"><strong>${escapeHtml(meta.name)}</strong><p>${escapeHtml(meta.year || 'Year unknown')} · ${escapeHtml(meta.genres.slice(0, 2).join(' / ') || 'Genre unknown')}</p><div class="tags"><span>Cinemeta</span><span>IMDb ${escapeHtml(meta.id)}</span></div></div></button>`).join('') : '<div class="empty"><b>No catalog titles loaded</b><div>Search by title, or check the metadata connection.</div></div>';
  document.querySelectorAll('.catalog-tile').forEach(tile => tile.addEventListener('click', () => showCatalogDetails(tile.dataset.type, tile.dataset.id)));
  document.querySelectorAll('.catalog-tile .poster img').forEach(img => {
    const fallback = img.src;
    img.addEventListener('error', () => {
      if (img.dataset.override === 'true') { img.dataset.override = 'false'; img.src = fallback; }
      else img.remove();
    });
  });
  if (window.videostore.posterFor && typeof IntersectionObserver !== 'undefined') {
    catalogPosterObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      catalogPosterObserver.unobserve(entry.target);
      const tile = entry.target;
      const img = tile.querySelector('.poster img');
      if (img) window.videostore.posterFor(tile.dataset.id).then(art => { if (art && img.isConnected) { img.dataset.override = 'true'; img.src = art; img.title = 'RatingPosterDB poster'; } }).catch(() => {});
    }), { rootMargin: '300px' });
    document.querySelectorAll('.catalog-tile').forEach(tile => catalogPosterObserver.observe(tile));
  }
}

async function loadCatalog(query = '') {
  status('Loading Cinemeta catalog…');
  try { catalogItems = await window.videostore.searchCatalog(query); status(''); renderCatalog(); }
  catch (error) { catalogItems = []; renderCatalog(); status(`Catalog unavailable: ${error.message}`, true); }
}

async function showCatalogDetails(type, id) {
  $('#details').hidden = false;
  $('#details').innerHTML = '<button class="close" id="close" aria-label="Close details">×</button><p>Loading title details…</p>';
  $('#close').addEventListener('click', closeDetails);
  try {
    const meta = await window.videostore.getMeta(type, id);
    const episodes = meta.videos.slice().sort((a, b) => a.season - b.season || a.episode - b.episode);
    $('#details').innerHTML = `<button class="close" id="close" aria-label="Close details">×</button><div class="eyebrow">${escapeHtml(meta.provenance)} · IMDb ${escapeHtml(meta.id)}</div><h2>${escapeHtml(meta.name)}</h2><div class="subheading">${escapeHtml(meta.year || 'Year unknown')} · ${escapeHtml(meta.genres.join(' / ') || 'Genre unknown')} · ${escapeHtml(meta.runtime || 'Runtime unknown')}</div>${meta.poster ? `<img class="detail-poster" src="${escapeHtml(meta.poster)}" alt="Poster for ${escapeHtml(meta.name)}">` : ''}<p class="synopsis">${escapeHtml(meta.description || 'No synopsis supplied by Cinemeta.')}</p>${fact('Cast', meta.cast.slice(0, 6).join(', ') || null)}${fact('Type', meta.type === 'series' ? 'TV series' : 'Movie')}${meta.trailerId ? '<div class="notice">A trailer is listed in Cinemeta metadata; trailer playback is not wired yet.</div>' : ''}${meta.type === 'series' ? `<div class="detail-section"><h3>SEASONS & EPISODES</h3><div class="subheading">${episodes.length} episodes listed by Cinemeta; specials retain season 0.</div><div class="episode-list">${episodes.map(ep => `<div class="episode"><b>S${String(ep.season).padStart(2, '0')}E${String(ep.episode).padStart(2, '0')} · ${escapeHtml(ep.name || 'Untitled episode')}</b><span>${escapeHtml(ep.description || 'No episode synopsis.')}</span></div>`).join('')}</div></div>` : ''}<div class="notice">Metadata browsing does not imply a playable source. Add your own local file or connect an authorized provider when available.</div>`;
    $('#close').addEventListener('click', closeDetails);
    const detailPoster = $('#details .detail-poster');
    if (detailPoster) {
      const fallback = detailPoster.src;
      detailPoster.addEventListener('error', () => {
        if (detailPoster.dataset.override === 'true') { detailPoster.dataset.override = 'false'; detailPoster.src = fallback; }
        else detailPoster.remove();
      });
    }
    if (meta.poster && window.videostore.posterFor) window.videostore.posterFor(meta.id).then(art => { const img = $('#details .detail-poster'); if (art && img) { img.dataset.override = 'true'; img.src = art; img.title = 'RatingPosterDB poster'; } }).catch(() => {});
  } catch (error) { $('#details').innerHTML = `<button class="close" id="close" aria-label="Close details">×</button><p>Metadata failed: ${escapeHtml(error.message)}</p>`; $('#close').addEventListener('click', closeDetails); }
}

function fact(label, value) { return `<div class="fact"><span>${escapeHtml(label)}</span><span>${escapeHtml(value || 'Unknown')}</span></div>`; }

function showDetails(key) {
  const group = groups().find(entry => entry.key === key);
  if (!group) { closeDetails(); return; }
  selectedKey = key;
  const item = group.best;
  const episode = item.type === 'tv' ? ` · Season ${item.season}, episode ${item.episode}` : '';
  $('#details').hidden = false;
  $('#details').innerHTML = `<button class="close" id="close" aria-label="Close details">×</button><div class="eyebrow">QUALITY PICKER</div><h2>${escapeHtml(item.title)}</h2><div class="subheading">${escapeHtml(item.year || 'Year unknown')}${escapeHtml(episode)} · ${group.items.length} version${group.items.length === 1 ? '' : 's'}</div><div class="notice">The highest score is a suggestion, not a playback guarantee. Your display, audio device, OS, and player have not been measured. Pick any version manually.</div><div class="detail-section"><h3>AVAILABLE VERSIONS</h3><div id="versions"></div></div>`;
  $('#close').addEventListener('click', closeDetails);
  const versions = $('#versions');
  for (const candidate of group.items) {
    const q = candidate.quality;
    const card = document.createElement('section');
    card.className = 'detail-section';
    card.innerHTML = `<div class="eyebrow">${escapeHtml(candidate.provider)} · ${escapeHtml(q.probeStatus)} · SCORE ${candidate.rank.points}</div><h3 style="color:#f2f6ed;font-size:14px;letter-spacing:0;overflow-wrap:anywhere">${escapeHtml(candidate.edition || 'Standard edition')}</h3><div class="subheading" style="overflow-wrap:anywhere">${escapeHtml(candidate.filename)}</div>${fact('Size', bytes(candidate.sizeBytes))}${fact('Resolution', q.resolution)}${fact('Video codec', q.videoCodec)}${fact('HDR format', q.hdr || (q.hdrClaim ? `${q.hdrClaim} (filename claim)` : null))}${fact('Container', q.container)}${fact('Bitrate', q.bitrate ? `${bitrate(q.bitrate)} · ${q.bitrateBasis}` : null)}${fact('Runtime', duration(q.duration))}${fact('Audio tracks', q.audio.length ? q.audio.map(a => `${a.codec}${a.channels ? ` ${a.channels}ch` : ''}${a.language ? ` (${a.language})` : ''}`).join(', ') : candidate.audio ? `${candidate.audio} (filename claim)` : null)}${fact('Atmos', candidate.atmos ? 'Filename claim, not verified' : null)}${fact('Subtitles', q.subtitles.length ? q.subtitles.join(', ') : null)}<div class="detail-actions"><button class="primary open">Open in default player ↗</button><button class="secondary watched">${candidate.watched ? '✓ Watched' : 'Mark watched'}</button><button class="secondary watchlist">${candidate.watchlist ? '★ Watchlisted' : '☆ Watchlist'}</button><button class="secondary danger remove">Remove entry</button></div>`;
    card.querySelector('.detail-actions').insertAdjacentHTML('beforebegin', fact('Why ranked', candidate.rank.reasons?.join(' · ') || 'Insufficient quality data'));
    card.querySelector('.open').addEventListener('click', () => run(async () => window.videostore.open(candidate.id), 'Opened in default player. HDR/audio output depends on that player and your hardware.'));
    card.querySelector('.watched').addEventListener('click', () => run(async () => { await window.videostore.mark(candidate.id, 'watched', !candidate.watched); await refresh(); }, 'Watch state updated.'));
    card.querySelector('.watchlist').addEventListener('click', () => run(async () => { await window.videostore.mark(candidate.id, 'watchlist', !candidate.watchlist); await refresh(); }, 'Watchlist updated.'));
    card.querySelector('.remove').addEventListener('click', () => run(async () => { await window.videostore.remove(candidate.id); await refresh(); }, 'Entry removed; video file was not deleted.'));
    versions.append(card);
  }
}

function closeDetails() { selectedKey = null; $('#details').hidden = true; }
async function refresh() { library = await window.videostore.list(); render(); }
async function run(action, success) { try { await action(); if (success) status(success); } catch (error) { status(error.message || String(error), true); } }
function status(message, error = false) { $('#status').textContent = message; $('#status').style.color = error ? '#ffa7a7' : '#d7ff61'; }
function renderUpdate() {
  const button = $('#update');
  const labels = { idle: 'Check for updates', checking: 'Checking…', available: `Download v${updateStatus.version || '?'}`, downloading: `Downloading ${updateStatus.percent ?? 0}%`, ready: 'Restart to update', current: 'Up to date', unsupported: 'Updates unavailable', error: 'Update failed · retry' };
  button.textContent = labels[updateStatus.state] || 'Check for updates';
  button.disabled = ['checking', 'downloading'].includes(updateStatus.state);
  button.title = updateStatus.message || '';
}
async function add() { await run(async () => { const result = await window.videostore.add(); await refresh(); status(result.errors.length ? `${result.added} added. ${result.errors.join('; ')}` : `${result.added} file${result.added === 1 ? '' : 's'} added.`); }, ''); }
async function scanFolder() {
  if (scanActive) { await window.videostore.cancelScan(); status('Cancelling folder scan…'); return; }
  scanActive = true;
  $('#scan-folder').textContent = 'Cancel scan';
  try {
    const result = await window.videostore.addFolder();
    await refresh();
    status(`${result.added} files indexed${result.cancelled ? ' before cancellation' : ''}.${result.errors.length ? ` ${result.errors.slice(0, 3).join('; ')}` : ''}`);
  } catch (error) { status(`Folder scan failed: ${error.message}`, true); }
  finally { scanActive = false; $('#scan-folder').textContent = 'Scan folder'; }
}

$('#navigation').addEventListener('click', event => { const button = event.target.closest('[data-view]'); if (button) { view = button.dataset.view; closeDetails(); $('#search').value = ''; render(); if (view === 'discover') loadCatalog(); if (view === 'providers') loadProviders(); if (view === 'storage') loadStorage(); if (view === 'account') loadMedia(); if (view === 'network') loadNetwork(); } });
$('#search').addEventListener('input', () => { if (view === 'discover') { clearTimeout(catalogQueryTimer); catalogQueryTimer = setTimeout(() => loadCatalog($('#search').value), 350); } else render(); });
$('#sort').addEventListener('change', render);
$('#add').addEventListener('click', add);
$('#hero-add').addEventListener('click', add);
$('#scan-folder').addEventListener('click', scanFolder);
window.videostore.onScanProgress?.(progress => { if (scanActive) status(`${progress.found} video files found…`); });
window.videostore.onMediaJobs?.(jobs => { mediaJobs = jobs; if (view === 'account') renderMedia(); });
$('#update').addEventListener('click', () => run(async () => {
  if (updateStatus.state === 'available') await window.videostore.downloadUpdate();
  else if (updateStatus.state === 'ready') await window.videostore.restartToUpdate();
  else await window.videostore.checkForUpdates();
}, ''));
window.videostore.getUpdateStatus?.().then(value => { updateStatus = value; renderUpdate(); });
window.videostore.onUpdateStatus?.(value => { updateStatus = value; renderUpdate(); });
refresh().catch(error => status(error.message, true));
