const crypto = require('node:crypto');
const { isPrivateIpv4 } = require('./discovery.cjs');
const { validateConfig } = require('./ssh-tunnel.cjs');

function connectionRecord(candidate, connection) {
  if (!candidate?.id || !/^[a-f0-9-]{36}$/i.test(candidate.id)) throw new Error('Update VideoStore on the media PC to enable automatic reconnection');
  const common = { id: candidate.id, name: String(candidate.name || 'Media PC').slice(0,80) };
  if (connection.kind === 'ssh') return { ...common, kind: 'ssh', ...validateConfig(connection), keyPath: typeof connection.keyPath === 'string' ? connection.keyPath.trim() : '' };
  if (!isPrivateIpv4(candidate.host)) throw new Error('The library host must be on a private network');
  return { ...common, kind:'lan', host:candidate.host };
}
function partitionFor(id) {
  return 'persist:videostore-host-' + crypto.createHash('sha256').update(String(id)).digest('hex').slice(0,32);
}

async function locatePrimary(record, { probe, discover, ssh, credentials = async()=>({}), knownKeys = {} }) {
  if (!record?.id) throw new Error('No primary library selected');
  if (record.kind === 'ssh') {
    const config = validateConfig(record);
    const expected = knownKeys[`${config.host.toLowerCase()}:${config.port}`];
    if (!expected) throw new Error('Reconnect through SSH once to confirm this machine’s fingerprint');
    const tunnel = await ssh({ ...config, keyPath: record.keyPath, ...await credentials() }, expected);
    try {
      const candidate = await probe('127.0.0.1', { port:tunnel.port, timeoutMs:3000, allowLoopback:true });
      if (candidate?.id !== record.id) throw new Error('The connected machine is not your saved primary library');
      return { candidate, tunnel };
    } catch (error) { tunnel.close(); throw error; }
  }
  if (record.kind !== 'lan' || !isPrivateIpv4(record.host)) throw new Error('Invalid saved library address');
  let candidate = await probe(record.host, { timeoutMs:1500 });
  if (candidate?.id === record.id) return { candidate };
  // DHCP may move the host. Never substitute another machine with the same name.
  candidate = (await discover()).find(item=>item.id === record.id);
  if (!candidate) throw new Error(`${record.name || 'Your primary library'} is unavailable. Check that VideoStore is open on that PC, then retry.`);
  return { candidate };
}
module.exports = { connectionRecord, partitionFor, locatePrimary };
