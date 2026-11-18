// Resolves the object id of the vehicles app's service principal (enterprise
// app) — the `resourceId` for app role assignments. Cached per process.
let spId = null;

async function getServicePrincipalId(client) {
  if (spId) return spId;
  const clientId = process.env.AZURE_CLIENT_ID;
  const res = await client
    .api('/servicePrincipals')
    .filter(`appId eq '${clientId}'`)
    .select('id')
    .get();
  spId = res.value[0]?.id;
  if (!spId) throw new Error('Service principal not found');
  return spId;
}

module.exports = { getServicePrincipalId };
