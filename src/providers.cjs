const PROVIDERS = {
  'real-debrid': { label: 'Real-Debrid', origin: 'https://api.real-debrid.com', path: '/rest/1.0/user' },
  torbox: { label: 'TorBox', origin: 'https://api.torbox.app', path: '/v1/api/user/me' }
};

async function testProvider(id, token, fetchImpl = fetch) {
  const provider = PROVIDERS[id];
  if (!provider) throw new Error('Unknown provider');
  if (typeof token !== 'string' || !token.trim() || token.length > 4096) throw new Error('Invalid token');
  let response;
  try {
    response = await fetchImpl(provider.origin + provider.path, {
      headers: { Authorization: `Bearer ${token.trim()}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
  } catch { throw new Error(`${provider.label} connection failed`); }
  if (!response.ok) throw new Error(`${provider.label} rejected the connection (HTTP ${response.status})`);
  let result;
  try { result = await response.json(); } catch { throw new Error(`${provider.label} returned invalid JSON`); }
  if (id === 'torbox' && result.success === false) throw new Error('TorBox rejected the connection');
  return { provider: id, connected: true, checkedAt: new Date().toISOString() };
}

module.exports = { PROVIDERS, testProvider };
