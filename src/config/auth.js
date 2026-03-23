const { expressjwt: jwt } = require('express-jwt');
const jwks = require('jwks-rsa');

function createAuthMiddleware() {
  return jwt({
    secret: jwks.expressJwtSecret({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksUri: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/discovery/v2.0/keys`,
    }),
    audience: process.env.AZURE_CLIENT_ID,
    issuer: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/v2.0`,
    algorithms: ['RS256'],
    credentialsRequired: false,
  });
}

module.exports = { createAuthMiddleware };
