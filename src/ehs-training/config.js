const parseList = (value) =>
  (value || '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

// Prefijo EHS_ para no chocar con las variables propias de vehicles (AZURE_TENANT_ID,
// AZURE_CLIENT_ID, etc. ya las usa el checkJwt de vehicles con su propio app registration).
const config = {
  mockAuth: (process.env.EHS_MOCK_AUTH || 'false').toLowerCase() === 'true',
  sessionSecret: process.env.EHS_SESSION_SECRET || 'dev-only-secret-change-me',
  adminEmails: parseList(process.env.EHS_ADMIN_EMAILS),
  azure: {
    tenantId: process.env.EHS_AZURE_TENANT_ID || '',
    clientId: process.env.EHS_AZURE_CLIENT_ID || '',
  },
};

function isAdminEmail(email) {
  if (!email) return false;
  return config.adminEmails.includes(email.toLowerCase());
}

module.exports = { config, isAdminEmail };
