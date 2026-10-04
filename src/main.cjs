const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const crypto = require('node:crypto');
const { VIDEO_EXTENSIONS, parseName, probeQuality, score } = require('./core.cjs');
const { searchCatalog, getMeta } = require('./catalog.cjs');
const { PROVIDERS, testProvider } = require('./providers.cjs');
const { GiB, evaluateDestination, recommend } = require('./storage.cjs');
const { configureUpdater } = require('./updater.cjs');
const { scanVideos } = require('./scan.cjs');

const execFileAsync = promisify(execFile);
let libraryPath;
let secretsPath;
let connectedProviders = {};
let scanCancelled = false;
let library = { version: 1, items: [], destinations: [], preferences: { hdr: true, surround: true, highBitrate: true } };

async function save() {
  const temporary = `${libraryPath}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(library, null, 2), { mode: 0o600 });
  await fs.rename(temporary, libraryPath);
}

function canEncrypt() {
  return safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');
}

async function saveProviderToken(id, token) {
  if (!canEncrypt()) throw new Error('OS-backed secure storage is unavailable; token was not saved');
  let secrets = {};
  try { secrets = JSON.parse(await fs.readFile(secretsPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  secrets[id] = safeStorage.encryptString(token).toString('base64');
  const temporary = `${secretsPath}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(secrets), { mode: 0o600 });
  await fs.rename(temporary, secretsPath);
}

async function providerStatus() {
  let secrets = {};
  try { secrets = JSON.parse(await fs.readFile(secretsPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { secureStorage: canEncrypt(), providers: Object.keys(PROVIDERS).map(id => ({ id, label: PROVIDERS[id].label, configured: Boolean(secrets[id]), checked: Boolean(connectedProviders[id]) })) };
}

async function probe(filePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath], {
      timeout: 15000, maxBuffer: 4 * 1024 * 1024, windowsHide: true
    });
    return JSON.parse(stdout);
  } catch { return null; }
}

async function addFiles(filePaths, options = {}) {
  const added = [];
  const errors = [];
  for (const filePath of filePaths) {
    if (options.shouldCancel?.()) break;
    if (!VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) continue;
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;
      const resolved = await fs.realpath(filePath);
      if (library.items.some(item => item.path === resolved)) continue;
      const parsed = parseName(resolved);
      const quality = probeQuality(parsed, options.inspect === false ? null : await probe(resolved), stat.size);
      const item = {
        id: crypto.randomUUID(), path: resolved, ...parsed, quality, sizeBytes: stat.size,
        provider: 'Local file', sourceRoot: options.sourceRoot || null, addedAt: new Date().toISOString(), watched: false, watchlist: false
      };
      item.rank = score(quality, library.preferences);
      library.items.push(item);
      added.push(item);
    } catch (error) { errors.push(`${path.basename(filePath)}: ${error.message}`); }
  }
  if (added.length) await save();
  return { added: added.length, errors, cancelled: Boolean(options.shouldCancel?.()) };
}

function getItem(id) { return library.items.find(item => item.id === id); }

async function createWindow() {
  const win = new BrowserWindow({
    width: 1320, height: 850, minWidth: 880, minHeight: 600,
    backgroundColor: '#0b0f18',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  await win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
  configureUpdater();
  libraryPath = path.join(app.getPath('userData'), 'library.json');
  secretsPath = path.join(app.getPath('userData'), 'secrets.json');
  try {
    const saved = JSON.parse(await fs.readFile(libraryPath, 'utf8'));
    if (saved.version === 1 && Array.isArray(saved.items)) library = { ...library, ...saved, destinations: Array.isArray(saved.destinations) ? saved.destinations : [] };
  } catch (error) { if (error.code !== 'ENOENT') console.error('Library load failed:', error); }
  for (const item of library.items) item.rank = score(item.quality, library.preferences);

  ipcMain.handle('library:list', () => library);
  ipcMain.handle('catalog:search', async (_event, query) => {
    if (typeof query !== 'string' || query.length > 100) throw new Error('Search must be 100 characters or fewer');
    return searchCatalog(query);
  });
  ipcMain.handle('catalog:meta', (_event, type, id) => getMeta(type, id));
  ipcMain.handle('provider:status', providerStatus);
  ipcMain.handle('provider:configure', async (_event, id, token) => {
    if (!canEncrypt()) throw new Error('OS-backed secure storage is unavailable; token was not saved');
    const result = await testProvider(id, token);
    await saveProviderToken(id, token.trim());
    connectedProviders[id] = result.checkedAt;
    return providerStatus();
  });
  ipcMain.handle('storage:list', async () => {
    const results = [];
    for (const destination of library.destinations) {
      try {
        const stat = await fs.statfs(destination.path);
        results.push({ ...destination, totalBytes: stat.blocks * stat.bsize, freeBytes: stat.bavail * stat.bsize, available: true });
      } catch (error) { results.push({ ...destination, available: false, error: error.code || 'Unavailable' }); }
    }
    return results;
  });
  ipcMain.handle('storage:add', async (_event, type, label) => {
    if (!['movie', 'tv'].includes(type) || typeof label !== 'string' || label.length > 80) throw new Error('Invalid destination');
    const selected = await dialog.showOpenDialog({ title: `Select ${type === 'tv' ? 'TV' : 'movie'} library folder`, properties: ['openDirectory'] });
    if (selected.canceled) return null;
    const folder = await fs.realpath(selected.filePaths[0]);
    if (library.destinations.some(item => item.path === folder && item.type === type)) throw new Error('Folder already configured for this media type');
    const destination = { id: crypto.randomUUID(), path: folder, type, label: label.trim() || path.basename(folder), reservePercent: 10, reserveBytes: 500 * GiB };
    library.destinations.push(destination);
    await save();
    return destination;
  });
  ipcMain.handle('storage:remove', async (_event, id) => {
    library.destinations = library.destinations.filter(item => item.id !== id);
    await save();
    return true;
  });
  ipcMain.handle('storage:update', async (_event, id, reservePercent, reserveGiB) => {
    if (!Number.isFinite(reservePercent) || reservePercent < 0 || reservePercent > 90 || !Number.isFinite(reserveGiB) || reserveGiB < 0 || reserveGiB > 100000) throw new Error('Invalid free-space floor');
    const destination = library.destinations.find(item => item.id === id);
    if (!destination) throw new Error('Unknown destination');
    destination.reservePercent = reservePercent;
    destination.reserveBytes = Math.ceil(reserveGiB * GiB);
    await save();
    return true;
  });
  ipcMain.handle('storage:plan', async (_event, type, fileBytes) => {
    if (!['movie', 'tv'].includes(type)) throw new Error('Invalid media type');
    const results = [];
    for (const destination of library.destinations.filter(item => item.type === type)) {
      try { results.push(evaluateDestination(destination, fileBytes, await fs.statfs(destination.path))); }
      catch (error) { results.push({ id: destination.id, path: destination.path, label: destination.label, type, eligible: false, reason: error.message }); }
    }
    return { results, recommended: recommend(results, type)?.id || null };
  });
  ipcMain.handle('library:add', async () => {
    const selection = await dialog.showOpenDialog({
      title: 'Add video files', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Videos', extensions: [...VIDEO_EXTENSIONS].map(ext => ext.slice(1)) }]
    });
    return selection.canceled ? { added: 0, errors: [] } : addFiles(selection.filePaths);
  });
  ipcMain.handle('library:addFolder', async event => {
    const selected = await dialog.showOpenDialog({ title: 'Scan an existing video folder', properties: ['openDirectory'] });
    if (selected.canceled) return { added: 0, errors: [], cancelled: false };
    scanCancelled = false;
    const root = await fs.realpath(selected.filePaths[0]);
    const scan = await scanVideos(root, progress => event.sender.send('scan:progress', progress), () => scanCancelled);
    if (scan.cancelled) return { added: 0, errors: scan.errors, cancelled: true };
    const imported = await addFiles(scan.files, { inspect: false, sourceRoot: root, shouldCancel: () => scanCancelled });
    return { added: imported.added, errors: [...scan.errors, ...imported.errors], cancelled: imported.cancelled };
  });
  ipcMain.handle('library:cancelScan', () => { scanCancelled = true; return true; });
  ipcMain.handle('library:remove', async (_event, id) => {
    const before = library.items.length;
    library.items = library.items.filter(item => item.id !== id);
    if (before !== library.items.length) await save();
    return before !== library.items.length;
  });
  ipcMain.handle('library:mark', async (_event, id, field, value) => {
    if (!['watched', 'watchlist'].includes(field) || typeof value !== 'boolean') throw new Error('Invalid update');
    const item = getItem(id);
    if (!item) throw new Error('File not in library');
    item[field] = value;
    await save();
    return item;
  });
  ipcMain.handle('library:preferences', async (_event, preferences) => {
    for (const key of ['hdr', 'surround', 'highBitrate']) {
      if (typeof preferences[key] !== 'boolean') throw new Error(`Invalid preference: ${key}`);
    }
    library.preferences = { hdr: preferences.hdr, surround: preferences.surround, highBitrate: preferences.highBitrate };
    for (const item of library.items) item.rank = score(item.quality, library.preferences);
    await save();
    return library;
  });
  ipcMain.handle('library:open', async (_event, id) => {
    const item = getItem(id);
    if (!item) throw new Error('File not in library');
    await fs.access(item.path);
    const failure = await shell.openPath(item.path);
    if (failure) throw new Error(failure);
    return true;
  });
  await createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
