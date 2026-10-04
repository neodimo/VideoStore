const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

const SESSION_MS = 12 * 60 * 60_000;
const PAIR_MS = 10 * 60_000;
const root = __dirname;

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter(address => address?.family === 'IPv4' && !address.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(address.address)).map(address => address.address);
}

function trustedHost(header) {
  const host = String(header || '').split(':')[0];
  if (host === 'localhost') return true;
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const [a, b] = octets;
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
}

async function jsonBody(request, limit = 16_384) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw new Error('Request body is too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Invalid JSON request'); }
}

function createLanServer(handlers, options = {}) {
  const sessions = new Map();
  const failures = new Map();
  let code = null;
  let codeExpires = 0;
  let server;

  function pairCode() {
    if (!code || Date.now() >= codeExpires) { code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'); codeExpires = Date.now() + PAIR_MS; }
    return { code, expiresAt: new Date(codeExpires).toISOString() };
  }

  const send = (response, status, data, headers = {}) => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
    response.end(JSON.stringify(data));
  };

  async function handle(request, response) {
    if (!trustedHost(request.headers.host)) return send(response, 403, { error: 'Host address is not a trusted private-network address' });
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === 'GET' && ['/', '/remote.js', '/remote.css'].includes(url.pathname)) {
      const filename = url.pathname === '/' ? 'remote.html' : url.pathname.slice(1);
      const mime = filename.endsWith('.html') ? 'text/html' : filename.endsWith('.js') ? 'text/javascript' : 'text/css';
      const content = await fs.readFile(path.join(root, filename));
      response.writeHead(200, { 'content-type': `${mime}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; img-src 'self' data: https://images.metahub.space; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'" });
      response.end(content);
      return;
    }
    if (request.method === 'POST' && request.headers.origin !== `http://${request.headers.host}`) return send(response, 403, { error: 'Request origin rejected' });
    if (request.method === 'POST' && url.pathname === '/api/pair') {
      const address = request.socket.remoteAddress || 'unknown';
      const attempt = failures.get(address) || { count: 0, until: Date.now() + PAIR_MS };
      if (Date.now() > attempt.until) { attempt.count = 0; attempt.until = Date.now() + PAIR_MS; }
      if (attempt.count >= 5) return send(response, 429, { error: 'Too many pairing attempts; wait ten minutes' });
      let body;
      try { body = await jsonBody(request, 1000); }
      catch (error) { return send(response, 400, { error: error.message }); }
      if (body.code !== pairCode().code) { attempt.count++; failures.set(address, attempt); return send(response, 401, { error: 'Pairing code did not match' }); }
      failures.delete(address);
      code = null;
      const token = crypto.randomBytes(32).toString('base64url');
      sessions.set(token, Date.now() + SESSION_MS);
      return send(response, 200, { paired: true }, { 'set-cookie': `vs_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` });
    }
    const cookie = request.headers.cookie?.match(/(?:^|;\s*)vs_session=([A-Za-z0-9_-]+)/)?.[1];
    if (!cookie || !sessions.has(cookie) || sessions.get(cookie) < Date.now()) return send(response, 401, { error: 'Pair with the host app first' });
    try {
      if (request.method === 'GET' && url.pathname === '/api/status') return send(response, 200, await handlers.status());
      if (request.method === 'GET' && url.pathname === '/api/catalog') return send(response, 200, await handlers.catalog(url.searchParams.get('q') || ''));
      if (request.method === 'GET' && url.pathname === '/api/candidates') return send(response, 200, await handlers.candidates(url.searchParams.get('refresh') === '1'));
      if (request.method === 'GET' && url.pathname === '/api/jobs') return send(response, 200, handlers.jobs());
      if (request.method === 'GET' && /^\/api\/poster\/tt\d+$/.test(url.pathname)) {
        const art = await handlers.poster(url.pathname.split('/').at(-1));
        if (!art) return send(response, 404, { error: 'No RatingPosterDB override' });
        const match = art.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
        if (!match) return send(response, 502, { error: 'Invalid artwork response' });
        response.writeHead(200, { 'content-type': match[1], 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' });
        return response.end(Buffer.from(match[2], 'base64'));
      }
      if (request.method === 'POST' && url.pathname === '/api/plan') return send(response, 200, await handlers.plan((await jsonBody(request)).ids));
      if (request.method === 'POST' && url.pathname === '/api/submit') return send(response, 200, { jobIds: await handlers.submit((await jsonBody(request)).planId) });
      if (request.method === 'POST' && url.pathname === '/api/cancel') return send(response, 200, { cancelled: handlers.cancel((await jsonBody(request)).id) });
      return send(response, 404, { error: 'Unknown route' });
    } catch (error) { return send(response, 400, { error: error.message || 'Request failed' }); }
  }

  async function start(port = 43879) {
    if (server) return { port: server.address().port, addresses: lanAddresses() };
    server = http.createServer((request, response) => { handle(request, response).catch(() => send(response, 500, { error: 'Host request failed' })); });
    try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, options.host || '0.0.0.0', resolve); }); }
    catch (error) { server = null; throw error; }
    return { port: server.address().port, addresses: lanAddresses() };
  }

  async function stop() {
    if (!server) return;
    const old = server;
    server = null;
    old.closeAllConnections?.();
    await new Promise(resolve => old.close(resolve));
    sessions.clear();
    code = null;
  }

  return { start, stop, pairCode, running: () => Boolean(server), addresses: lanAddresses };
}

module.exports = { createLanServer, trustedHost, lanAddresses };
