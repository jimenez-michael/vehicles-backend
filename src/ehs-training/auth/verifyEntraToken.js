const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { config } = require('../config');

// Valida el ID token que Microsoft Entra ID (Azure AD) emite tras el login M365 de
// ehs-training. Usa su propio app registration (EHS_AZURE_*), distinto al de vehicles.
// Solo se usa cuando EHS_MOCK_AUTH=false.

let client;
function getClient() {
  if (!client) {
    client = jwksClient({
      jwksUri: `https://login.microsoftonline.com/${config.azure.tenantId}/discovery/v2.0/keys`,
      cache: true,
      rateLimit: true,
    });
  }
  return client;
}

function getSigningKey(header, callback) {
  getClient().getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

function verifyEntraIdToken(idToken) {
  return new Promise((resolve, reject) => {
    jwt.verify(
      idToken,
      getSigningKey,
      {
        audience: config.azure.clientId,
        issuer: [
          `https://login.microsoftonline.com/${config.azure.tenantId}/v2.0`,
          `https://sts.windows.net/${config.azure.tenantId}/`,
        ],
      },
      (err, decoded) => {
        if (err) return reject(err);
        resolve(decoded);
      }
    );
  });
}

module.exports = { verifyEntraIdToken };
