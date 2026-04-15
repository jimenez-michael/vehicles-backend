const { Client } = require('@microsoft/microsoft-graph-client');

let cachedToken = null;
let tokenExpiry = 0;

function clearTokenCache() {
  cachedToken = null;
  tokenExpiry = 0;
}

async function getAppToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(tokenUrl, { method: 'POST', body: params });
  if (!res.ok) {
    const errBody = await res.text();
    console.error('[getAppToken] Token request failed:', res.status, errBody);
    throw new Error('Failed to acquire app token');
  }
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

function createAppGraphClient() {
  return Client.init({
    authProvider: async (done) => {
      try {
        done(null, await getAppToken());
      } catch (err) {
        done(err, null);
      }
    },
  });
}

module.exports = { createAppGraphClient, clearTokenCache };
