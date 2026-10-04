const test = require('node:test');
const assert = require('node:assert/strict');
const { listDownloads, requestDownloadLink } = require('../src/torbox.cjs');

test('TorBox lists ready video files from torrent, Usenet, and web accounts without generating links', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    const kind = String(url).match(/\/(torrents|usenet|webdl)\/mylist/)[1];
    return { ok: true, json: async () => ({ success: true, data: [
      { id: 42, download_finished: true, download_present: true, files: [
        { id: 0, name: `Folder\\Example.${kind}.2024.2160p.mkv`, size: 1200 },
        { id: 1, name: 'ignore.txt', size: 100 },
        { id: 2, name: 'infected.mp4', size: 100, infected: true }
      ] },
      { id: 43, download_finished: false, download_present: true, files: [{ id: 0, name: 'not-ready.mkv', size: 300 }] }
    ] }) };
  };
  const result = await listDownloads('private-torbox-token', fetchImpl);
  assert.equal(result.items.length, 3);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.items.map(item => item.sourceKind), ['torrents', 'usenet', 'webdl']);
  assert.equal(result.items[0].id, 'tb:torrents:42:0');
  assert.equal(result.items[0].filename, 'Example.torrents.2024.2160p.mkv');
  assert.equal(result.items[0].sourceUrl, undefined);
  assert.equal(requests.every(request => request.options.headers.Authorization === 'Bearer private-torbox-token' && !request.url.includes('private-torbox-token')), true);
});

test('TorBox requests a selected file link on the host and keeps token out of errors', async () => {
  let requested;
  const url = await requestDownloadLink('private-torbox-token', { kind: 'usenet', parentId: 42, fileId: 0 }, async (input, options) => {
    requested = { input, options };
    return { ok: true, json: async () => ({ success: true, data: 'https://cdn.example.com/video.mkv?download=secret' }) };
  });
  assert.equal(url, 'https://cdn.example.com/video.mkv?download=secret');
  assert.equal(requested.input.searchParams.get('usenet_id'), '42');
  assert.equal(requested.input.searchParams.get('file_id'), '0');
  assert.equal(requested.input.searchParams.get('token'), 'private-torbox-token');
  assert.equal(requested.options.referrerPolicy, 'no-referrer');
  await assert.rejects(requestDownloadLink('private-torbox-token', { kind: 'torrents', parentId: 1, fileId: 1 }, async () => { throw new Error('https://api.torbox.app/?token=private-torbox-token'); }), error => !error.message.includes('private-torbox-token'));
});

test('TorBox partial list failures are labeled and do not hide available files', async () => {
  const result = await listDownloads('private-token', async url => String(url).includes('/torrents/') ? { ok: true, json: async () => ({ success: true, data: [{ id: 1, download_finished: true, download_present: true, files: [{ id: 0, name: 'Example.mkv', size: 100 }] }] }) } : { ok: false, status: 503 });
  assert.equal(result.items.length, 1);
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings.join(' '), /usenet.*503.*webdl.*503/);
});
