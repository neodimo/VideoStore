const http = require('node:http');
const os = require('node:os');

const PORT = 43879;
const TIMEOUT_MS = 600;

function isPrivateIpv4(host) {
  const parts = String(host || '').split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

function scanAddresses(interfaces = os.networkInterfaces()) {
  const prefixes = new Set();
  const self = new Set();
  for (const entries of Object.values(interfaces)) for (const entry of entries || []) {
    if (entry.family !== 'IPv4' || entry.internal || !isPrivateIpv4(entry.address)) continue;
    self.add(entry.address);
    prefixes.add(entry.address.split('.').slice(0, 3).join('.'));
  }
  // Match GameStore's bounded local /24 sweep; never expand a VPN /8 into a huge scan.
  return [...prefixes].slice(0, 4).flatMap(prefix => Array.from({ length: 254 }, (_, index) => `${prefix}.${index + 1}`)).filter(address => !self.has(address));
}

function probeHost(host, options = {}) {
  if (!isPrivateIpv4(host)) return Promise.resolve(null);
  const port = options.port || PORT;
  return new Promise(resolve => {
    let settled = false;
    const finish = value => { if (!settled) { settled = true; resolve(value); } };
    const request = http.get({ hostname: host, port, path: '/api/identity', timeout: options.timeoutMs || TIMEOUT_MS, agent: false }, response => {
      if (response.statusCode !== 200) { response.resume(); return finish(null); }
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { raw += chunk; if (raw.length > 1024) { request.destroy(); finish(null); } });
      response.on('end', () => {
        try {
          const identity = JSON.parse(raw);
          if (identity.app === 'videostore' && identity.protocol === 1 && typeof identity.name === 'string')
            return finish({ host, name: identity.name.slice(0, 80), port });
        } catch {}
        finish(null);
      });
    });
    request.on('timeout', () => { request.destroy(); finish(null); });
    request.on('error', () => finish(null));
  });
}

async function discoverHosts(options = {}) {
  const addresses = options.addresses || scanAddresses();
  const found = [];
  let cursor = 0;
  let done = 0;
  const worker = async () => {
    while (cursor < addresses.length) {
      const host = addresses[cursor++];
      const candidate = await probeHost(host, options);
      if (candidate) found.push(candidate);
      options.onProgress?.(++done, addresses.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(24, addresses.length) }, worker));
  return found.sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }));
}

module.exports = { PORT, isPrivateIpv4, scanAddresses, probeHost, discoverHosts };
