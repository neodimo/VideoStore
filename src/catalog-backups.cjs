const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_BACKUPS = 3;
const MIN_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 32;

async function listBackups(libraryPath) {
  const directory = path.dirname(libraryPath);
  const prefix = `${path.basename(libraryPath)}.pre-plex-`;
  const generatedId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.bak$/i;
  const backups = [];
  const names = (await fs.readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.startsWith(prefix) && generatedId.test(entry.name.slice(prefix.length)));
  for (let offset = 0; offset < names.length; offset += BATCH_SIZE) {
    const batch = await Promise.all(names.slice(offset, offset + BATCH_SIZE).map(async entry => {
      const file = path.join(directory, entry.name);
      try { return { file, modified: (await fs.stat(file)).mtimeMs }; }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    }));
    backups.push(...batch.filter(Boolean));
  }
  backups.sort((a, b) => b.modified - a.modified);
  return backups;
}

async function prune(backups, keep) {
  for (let offset = keep; offset < backups.length; offset += BATCH_SIZE) {
    await Promise.all(backups.slice(offset, offset + BATCH_SIZE).map(async entry => {
      try { await fs.unlink(entry.file); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }));
  }
}

async function pruneCatalogBackups(libraryPath, maxBackups = MAX_BACKUPS) {
  await prune(await listBackups(libraryPath), maxBackups);
}

async function backupCatalog(libraryPath, { now = Date.now, maxBackups = MAX_BACKUPS, minIntervalMs = MIN_BACKUP_INTERVAL_MS } = {}) {
  const backups = await listBackups(libraryPath);
  const directory = path.dirname(libraryPath);
  const prefix = `${path.basename(libraryPath)}.pre-plex-`;
  const create = !backups.length || now() - backups[0].modified >= minIntervalMs;
  await prune(backups, create ? maxBackups - 1 : maxBackups);
  if (create) {
    const file = path.join(directory, `${prefix}${crypto.randomUUID()}.bak`);
    const temporary = `${file}.tmp`;
    try {
      await fs.copyFile(libraryPath, temporary);
      await fs.rename(temporary, file);
    } catch (error) {
      await fs.unlink(temporary).catch(() => {});
      throw error;
    }
    return file;
  }
  return backups[0].file;
}

module.exports = { backupCatalog, pruneCatalogBackups, MAX_BACKUPS, MIN_BACKUP_INTERVAL_MS };
