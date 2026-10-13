const net = require('node:net');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { Client } = require('ssh2');
const { isPrivateIpv4, PORT } = require('./discovery.cjs');

function validateConfig(input) {
  const host = String(input.host || '').trim();
  const username = String(input.username || '').trim();
  const port = Number(input.port || 22);
  const serviceHost = String(input.serviceHost || '127.0.0.1').trim();
  if (!host || host.length > 253 || /[^a-zA-Z0-9.:-]/.test(host)) throw new Error('Enter a valid SSH host');
  if (!username || username.length > 64 || /[\s\x00-\x1f]/.test(username)) throw new Error('Enter an SSH username');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Enter a valid SSH port');
  if (serviceHost !== 'localhost' && serviceHost !== '127.0.0.1' && !isPrivateIpv4(serviceHost)) throw new Error('VideoStore service must be on the SSH machine or a private address');
  return { host, username, port, serviceHost };
}

async function openSshTunnel(input, expectedKey, options = {}) {
  const { host, username, port, serviceHost } = validateConfig(input);
  const password = typeof input.password === 'string' ? input.password : '';
  const keyPath = typeof input.keyPath === 'string' ? input.keyPath.trim() : '';
  if (!password && !keyPath && !process.env.SSH_AUTH_SOCK) throw new Error('Enter an SSH password or private-key path, or enable an SSH agent');
  const privateKey = keyPath ? await fs.readFile(keyPath) : undefined;
  const client = new Client();
  let seenKey = '';
  let connected = false;
  try {
    await new Promise((resolve, reject) => {
      client.once('ready', () => { connected = true; resolve(); });
      client.once('error', reject);
      client.once('close', () => { if (!connected) reject(new Error('SSH connection closed')); });
      client.connect({
        host, port, username, password: password || undefined, privateKey,
        passphrase: input.passphrase || undefined, agent: !password && !keyPath ? process.env.SSH_AUTH_SOCK : undefined,
        readyTimeout: 12000, keepaliveInterval: 10000, keepaliveCountMax: 3,
        hostVerifier: key => {
          seenKey = `SHA256:${crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
          return Boolean(expectedKey) && seenKey === expectedKey;
        }
      });
    });
  } catch (error) {
    client.end();
    if (!expectedKey && seenKey) { const rejection = new Error('Confirm this SSH host key before connecting'); rejection.code = 'SSH_TRUST_REQUIRED'; rejection.fingerprint = seenKey; throw rejection; }
    if (expectedKey && seenKey && seenKey !== expectedKey) throw new Error('SSH host key changed; connection blocked');
    throw new Error(`SSH connection failed: ${error.message}`);
  }

  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    client.forwardOut('127.0.0.1', socket.localPort, serviceHost, options.servicePort || PORT, (error, stream) => {
      if (error) return socket.destroy(error);
      socket.pipe(stream).pipe(socket);
      socket.once('close', () => stream.end());
      stream.once('close', () => socket.destroy());
    });
  });
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); }
  catch (error) { client.end(); throw error; }
  const close = () => { for (const socket of sockets) socket.destroy(); server.close(); client.end(); };
  client.once('close', close);
  return { port: server.address().port, fingerprint: seenKey, close };
}

module.exports = { validateConfig, openSshTunnel };
