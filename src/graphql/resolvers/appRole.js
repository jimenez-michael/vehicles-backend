const { createAppGraphClient } = require('../../utils/graphAppClient');
const { requireAuth } = require('../../middleware/requireAuth');

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

const appRoleResolvers = {
  Query: {
    appRoles: async (_, __, context) => {
      requireAuth(context);
      const client = createAppGraphClient();
      const clientId = process.env.AZURE_CLIENT_ID;
      const res = await client
        .api('/servicePrincipals')
        .filter(`appId eq '${clientId}'`)
        .select('appRoles')
        .get();
      return (res.value[0]?.appRoles ?? []).filter((r) => r.isEnabled);
    },

    appRoleAssignments: async (_, __, context) => {
      requireAuth(context);
      try {
        const client = createAppGraphClient();
        const id = await getServicePrincipalId(client);

        const assignRes = await client
          .api(`/servicePrincipals/${id}/appRoleAssignedTo`)
          .top(999)
          .get();

        const spRes = await client
          .api(`/servicePrincipals/${id}`)
          .select('appRoles')
          .get();
        const roleMap = Object.fromEntries(
          spRes.appRoles.map((r) => [r.id, r.displayName]),
        );

        const userIds = [...new Set(assignRes.value.map((a) => a.principalId))];
        let emailMap = {};
        if (userIds.length > 0) {
          const filter = userIds.map((uid) => `'${uid}'`).join(',');
          const usersRes = await client
            .api('/users')
            .filter(`id in (${filter})`)
            .select('id,mail,userPrincipalName')
            .get();
          emailMap = Object.fromEntries(
            usersRes.value.map((u) => [u.id, u.mail || u.userPrincipalName]),
          );
        }

        return assignRes.value.map((a) => ({
          ...a,
          principalEmail: emailMap[a.principalId] || null,
          roleName: roleMap[a.appRoleId] || 'Unknown',
        }));
      } catch (err) {
        console.error('[appRoleAssignments] ERROR:', err.message ?? err);
        throw err;
      }
    },

    searchDirectoryUsers: async (_, { search }, context) => {
      requireAuth(context);
      const client = createAppGraphClient();
      const res = await client
        .api('/users')
        .header('ConsistencyLevel', 'eventual')
        .search(`"displayName:${search}" OR "mail:${search}"`)
        .select('id,displayName,mail,userPrincipalName,jobTitle')
        .top(10)
        .get();
      return res.value;
    },
  },

  Mutation: {
    assignAppRole: async (_, { principalId, appRoleId }, context) => {
      requireAuth(context);
      const client = createAppGraphClient();
      const id = await getServicePrincipalId(client);
      const result = await client
        .api(`/servicePrincipals/${id}/appRoleAssignments`)
        .post({ principalId, resourceId: id, appRoleId });

      const spRes = await client
        .api(`/servicePrincipals/${id}`)
        .select('appRoles')
        .get();
      const role = spRes.appRoles.find((r) => r.id === appRoleId);

      return {
        ...result,
        roleName: role?.displayName || 'Unknown',
        principalEmail: null,
      };
    },

    removeAppRoleAssignment: async (_, { assignmentId }, context) => {
      requireAuth(context);
      const client = createAppGraphClient();
      const id = await getServicePrincipalId(client);
      await client
        .api(`/servicePrincipals/${id}/appRoleAssignments/${assignmentId}`)
        .delete();
      return true;
    },
  },
};

module.exports = appRoleResolvers;
