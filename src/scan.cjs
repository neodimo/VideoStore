const fs = require('node:fs/promises');
const path = require('node:path');
const { VIDEO_EXTENSIONS } = require('./core.cjs');

async function scanVideos(root, progress = () => {}, shouldCancel = () => false, maxFiles = 50000) {
  const directories = [root];
  const files = [];
  const errors = [];
  while (directories.length) {
    if (shouldCancel()) break;
    const directory = directories.pop();
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { errors.push(`${directory}: ${error.code || error.message}`); continue; }
    for (const entry of entries) {
      if (shouldCancel()) break;
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) directories.push(full);
      else if (entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(full);
        if (files.length % 100 === 0) progress({ found: files.length, current: directory });
        if (files.length >= maxFiles) { errors.push(`Scan stopped at ${maxFiles} video files; narrow the folder selection.`); return { files, errors, cancelled: false }; }
      }
    }
  }
  progress({ found: files.length, current: null });
  return { files, errors, cancelled: shouldCancel() };
}

module.exports = { scanVideos };
