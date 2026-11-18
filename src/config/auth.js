const { expressjwt: jwt } = require('express-jwt');
const jwks = require('jwks-rsa');

// Accepted audiences: the vehicles app itself, plus (optionally) the fleet
// training app. Training tokens are split off by `scopeTrainingTokens` so they
// can only reach the training resolvers — see index.js.
function getAudiences() {
  return [process.env.AZURE_CLIENT_ID, process.env.TRAINING_CLIENT_ID].filter(Boolean);
}

function createAuthMiddleware() {
  return jwt({
    secret: jwks.expressJwtSecret({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksUri: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/discovery/v2.0/keys`,
    }),
    audience: getAudiences(),
    issuer: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/v2.0`,
    algorithms: ['RS256'],
    credentialsRequired: false,
  });
}

// Moves tokens issued for the training app from `req.auth` to
// `req.trainingAuth`. Everything else in the API (GraphQL context.user, REST
// routes) only ever sees vehicles-app tokens, so a user who has not passed the
// training cannot call vehicles operations with a training-app token.
// `req.trainingAuth` holds any valid token (vehicles or training).
function scopeTrainingTokens(req, res, next) {
  req.trainingAuth = req.auth || null;
  if (req.auth && req.auth.aud !== process.env.AZURE_CLIENT_ID) {
    req.auth = undefined;
  }
  next();
}

module.exports = { createAuthMiddleware, scopeTrainingTokens };
