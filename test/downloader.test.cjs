const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { safeDownloadUrl, downloadToLibrary } = require('../src/downloader.cjs');

test('download uses the host-side link and atomically places a complete file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'videostore-download-'));
  const folder = path.join(root, 'Movies');
  await fs.mkdir(folder);
  try {
    const candidate = { filename: 'Example.2020.mkv', sizeBytes: 4, sourceUrl: 'https://cdn.example.com/file' };
    const placement = { destinationId: 'drive', filename: candidate.filename, sizeBytes: 4, relativePath: path.join('Example (2020)', candidate.filename) };
    const destination = { id: 'drive', path: folder, reservePercent: 0, reserveBytes: 0 };
    let imported;
    const result = await downloadToLibrary({ id: 'job-1', candidate, placement, destination, fetchImpl: async () => ({ ok: true, status: 200, body: new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.from([1, 2, 3, 4])); controller.close(); } }) }), onImported: async file => { imported = file; } });
    assert.equal(result.indexed, true);
    assert.equal(result.path, imported);
    assert.deepEqual(await fs.readFile(imported), Buffer.from([1, 2, 3, 4]));
    assert.deepEqual(await fs.readdir(path.join(root, '.videostore-staging')), []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('incomplete transfers leave no Plex file or staged partial', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'videostore-download-'));
  const folder = path.join(root, 'Movies');
  await fs.mkdir(folder);
  try {
    const candidate = { filename: 'Example.2020.mkv', sizeBytes: 4, sourceUrl: 'https://cdn.example.com/file' };
    const placement = { destinationId: 'drive', filename: candidate.filename, sizeBytes: 4, relativePath: candidate.filename };
    const destination = { id: 'drive', path: folder, reservePercent: 0, reserveBytes: 0 };
    await assert.rejects(downloadToLibrary({ id: 'job-2', candidate, placement, destination, fetchImpl: async () => ({ ok: true, status: 200, body: new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.from([1, 2])); controller.close(); } }) }) }), /Incomplete download/);
    assert.deepEqual(await fs.readdir(folder), []);
    assert.deepEqual(await fs.readdir(path.join(root, '.videostore-staging')), []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('download URL validation rejects direct local network access', () => {
  assert.throws(() => safeDownloadUrl('http://example.com/file'), /public HTTPS/);
  assert.throws(() => safeDownloadUrl('https://127.0.0.1/file'), /public HTTPS/);
  assert.throws(() => safeDownloadUrl('https://server.local/file'), /public HTTPS/);
});
