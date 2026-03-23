const { Client } = require('@microsoft/microsoft-graph-client');

function createGraphClient(token) {
  return Client.init({
    authProvider: (done) => {
      done(null, token);
    },
  });
}

module.exports = { createGraphClient };