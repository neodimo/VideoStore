import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const excluded = new Set(['.git', 'node_modules', 'dist', 'release']);
const videoExtensions = new Set(['.mkv', '.mp4', '.m4v', '.avi', '.mov', '.ts', '.webm']);
const problems = [];

async function scan(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) await scan(full);
    else if (entry.isFile()) {
      const info = await stat(full);
      if (videoExtensions.has(path.extname(entry.name).toLowerCase())) problems.push(`Bundled video: ${path.relative(root, full)}`);
      if (info.size > 2_000_000) problems.push(`Oversized source asset: ${path.relative(root, full)} (${info.size} bytes)`);
    }
  }
}

await scan(root);
if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
else console.log('Media-light source check passed.');
