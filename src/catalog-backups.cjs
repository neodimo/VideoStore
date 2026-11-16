const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_BACKUPS = 3;
const MIN_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function backupCatalog(libraryPath, { now = Date.now, maxBackups = MAX_BACKUPS, minIntervalMs = MIN_BACKUP_INTERVAL_MS } = {}) {
  const directory = path.dirname(libraryPath);
  const prefix = `${path.basename(libraryPath)}.pre-plex-`;
  const backups = [];
  for (const name of await fs.readdir(directory)) {
    if (!name.startsWith(prefix) || !name.endsWith('.bak')) continue;
    const file = path.join(directory, name);
    const stat = await fs.lstat(file);
    if (stat.isFile()) backups.push({ file, modified: stat.mtimeMs });
  }
  backups.sort((a, b) => b.modified - a.modified);
  const create = !backups.length || now() - backups[0].modified >= minIntervalMs;
  for (const old of backups.slice(create ? maxBackups - 1 : maxBackups)) await fs.unlink(old.file);
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

module.exports = { backupCatalog, MAX_BACKUPS, MIN_BACKUP_INTERVAL_MS };
