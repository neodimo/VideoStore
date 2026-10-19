const path = require('node:path');
const fs = require('node:fs/promises');
const { plexPathKey, applyPlexMetadata } = require('./plex.cjs');

// New paths must belong to an already configured destination. Never register
// new roots, move files, or guess a title in order to make a Plex association.
function planPlexSync(items, metadata, destinations, platform = process.platform) {
  const paths = new Set(items.map(i => plexPathKey(i.path, platform)));
  const matches = items.flatMap(item => {
    const association = metadata.byPath.get(plexPathKey(item.path, platform));
    return association ? [{ item, association }] : [];
  });
  const p = platform === 'win32' ? path.win32 : path.posix;
  const additions = [...metadata.byPath].filter(([file, meta]) => !paths.has(file) && destinations.some(d => {
    if (d.type !== meta.type) return false;
    const relative = p.relative(plexPathKey(d.path, platform), file);
    return relative && relative !== '..' && !relative.startsWith('..' + p.sep) && !p.isAbsolute(relative);
  })).map(([file]) => file);
  return { matches, additions, changed: matches.some(({item, association}) => Object.keys(association).some(k => JSON.stringify(item[k]) !== JSON.stringify(association[k]))) };
}

function createPlexSync({ getLibrary, readMetadata, backup, addFiles, save, onSynced = () => {}, intervalMs = 60_000, now = Date.now, isFile = async file => { try { return (await fs.stat(file)).isFile(); } catch { return false; } } }) {
  let pending, lastAttempt = -Infinity;
  async function sync(force = false) {
    if (pending) return pending;
    const library = getLibrary();
    if (!force && (!library.destinations.length || now() - lastAttempt < intervalMs)) return library.plexSync;
    lastAttempt = now();
    pending = (async () => {
      try {
        const metadata = readMetadata();
        const plan = planPlexSync(library.items, metadata, library.destinations);
        const readable = [];
        for (const file of plan.additions) if (await isFile(file)) readable.push(file);
        if (plan.changed || readable.length) await backup();
        let updated = 0;
        for (const {item, association} of plan.matches) if (applyPlexMetadata(item, association)) updated++;
        const imported = readable.length ? await addFiles(readable, { inspect: false, plexMetadata: metadata.byPath }) : { added: 0, errors: [] };
        library.plexSync = { state: 'ready', matched: plan.matches.length + imported.added, updated, added: imported.added, ambiguous: metadata.ambiguous, errors: imported.errors, files: library.items.length, lastSyncedAt: new Date(now()).toISOString() };
        await save();
        onSynced(library.plexSync);
        return library.plexSync;
      } catch (error) {
        library.plexSync = { ...library.plexSync, state: 'unavailable', error: error.message };
        if (force) throw error;
        return library.plexSync;
      }
    })().finally(() => { pending = null; });
    return pending;
  }
  return { sync };
}
module.exports = { planPlexSync, createPlexSync };
