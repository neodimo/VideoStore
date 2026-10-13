const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');
const { Server } = require('ssh2');
const { openSshTunnel } = require('../src/ssh-tunnel.cjs');

test('SSH tunnel requires explicit first-use host-key trust and forwards host API bytes', async () => {
  const hostKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  const api = http.createServer((_request, response) => response.end('host-library'));
  const ssh = new Server({ hostKeys: [hostKey] });
  const connections = new Set();
  ssh.on('connection', connection => {
    connections.add(connection);
    connection.on('error', () => {});
    connection.once('close', () => connections.delete(connection));
    connection.on('authentication', context => context.method === 'password' && context.password === 'test-password' ? context.accept() : context.reject());
    connection.on('ready', () => connection.on('tcpip', (accept, _reject, info) => {
      const stream = accept();
      const socket = net.connect(info.destPort, info.destIP);
      socket.pipe(stream).pipe(socket);
    }));
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => ssh.listen(0, '127.0.0.1', resolve));
  const input = { host: '127.0.0.1', port: ssh.address().port, username: 'tester', password: 'test-password' };
  let tunnel;
  try {
    let fingerprint;
    await assert.rejects(() => openSshTunnel(input, undefined, { servicePort: api.address().port }), error => { assert.equal(error.code, 'SSH_TRUST_REQUIRED'); fingerprint = error.fingerprint; return /^SHA256:/.test(fingerprint); });
    await assert.rejects(() => openSshTunnel(input, 'SHA256:incorrect', { servicePort: api.address().port }), /host key changed/);
    tunnel = await openSshTunnel(input, fingerprint, { servicePort: api.address().port });
    assert.equal(await (await fetch(`http://127.0.0.1:${tunnel.port}/api/library`)).text(), 'host-library');
  } finally {
    tunnel?.close();
    for (const connection of connections) connection.end();
    await new Promise(resolve => ssh.close(resolve));
    await new Promise(resolve => api.close(resolve));
  }
});
