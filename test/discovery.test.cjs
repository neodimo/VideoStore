const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { isPrivateIpv4, scanAddresses, probeHost, discoverHosts } = require('../src/discovery.cjs');

test('local sweep stays on bounded private /24s and excludes this PC', () => {
  const interfaces = { wifi: [{ family: 'IPv4', internal: false, address: '192.168.7.42' }], public: [{ family: 'IPv4', internal: false, address: '8.8.8.8' }] };
  const addresses = scanAddresses(interfaces);
  assert.equal(addresses.length, 253);
  assert.ok(addresses.includes('192.168.7.1'));
  assert.ok(!addresses.includes('192.168.7.42'));
  assert.ok(!addresses.includes('8.8.8.8'));
  assert.equal(isPrivateIpv4('192.168.7.1'), true);
  assert.equal(isPrivateIpv4('example.com'), false);
  assert.equal(isPrivateIpv4('192.168.7.999'), false);
});

test('discovery accepts only the VideoStore identity and rechecks selected hosts', async () => {
  let appName = 'videostore';
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ app: appName, protocol: 1, name: 'Media PC' }));
  });
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  const port = server.address().port;
  try {
    assert.equal(await probeHost('8.8.8.8', { port }), null);
    const address = Object.values(require('node:os').networkInterfaces()).flat().find(entry => entry.family === 'IPv4' && !entry.internal && isPrivateIpv4(entry.address))?.address;
    if (address) {
      assert.deepEqual(await probeHost(address, { port }), { host: address, port, name: 'Media PC' });
      assert.deepEqual(await discoverHosts({ addresses: [address], port }), [{ host: address, port, name: 'Media PC' }]);
      appName = 'not-videostore';
      assert.equal(await probeHost(address, { port }), null);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
