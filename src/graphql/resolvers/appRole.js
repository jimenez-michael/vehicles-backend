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
      return context.prisma.appUserRole.findMany({
        orderBy: { createdAt: 'desc' },
      });
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
    assignAppRole: async (_, { principalId, appRoleId, displayName, email }, context) => {
      requireAuth(context);
      const client = createAppGraphClient();
      const id = await getServicePrincipalId(client);

      // Create in Azure AD
      const result = await client
        .api(`/servicePrincipals/${id}/appRoleAssignments`)
        .post({ principalId, resourceId: id, appRoleId });

      // Get role name
      const spRes = await client
        .api(`/servicePrincipals/${id}`)
        .select('appRoles')
        .get();
      const role = spRes.appRoles.find((r) => r.id === appRoleId);

      // Save to local DB
      return context.prisma.appUserRole.create({
        data: {
          assignmentId: result.id,
          principalId,
          displayName,
          email: email || null,
          appRoleId,
          roleName: role?.displayName || 'Unknown',
        },
      });
    },

    removeAppRoleAssignment: async (_, { id }, context) => {
      requireAuth(context);

      // Find the local record to get the Azure assignment ID
      const record = await context.prisma.appUserRole.findUnique({
        where: { id },
      });
      if (!record) throw new Error('Assignment not found');

      // Delete from Azure AD
      const client = createAppGraphClient();
      const spIdValue = await getServicePrincipalId(client);
      await client
        .api(`/servicePrincipals/${spIdValue}/appRoleAssignments/${record.assignmentId}`)
        .delete();

      // Delete from local DB
      await context.prisma.appUserRole.delete({ where: { id } });
      return true;
    },

    syncAppRoleAssignments: async (_, __, context) => {
      requireAuth(context);
      const client = createAppGraphClient();
      const id = await getServicePrincipalId(client);

      // Fetch all assignments from Azure AD
      const assignRes = await client
        .api(`/servicePrincipals/${id}/appRoleAssignedTo`)
        .top(999)
        .get();

      // Get role names
      const spRes = await client
        .api(`/servicePrincipals/${id}`)
        .select('appRoles')
        .get();
      const roleMap = Object.fromEntries(
        spRes.appRoles.map((r) => [r.id, r.displayName]),
      );

      // Get user emails
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

      // Clear local table and re-seed from Azure AD
      await context.prisma.appUserRole.deleteMany();

      const records = await Promise.all(
        assignRes.value.map((a) =>
          context.prisma.appUserRole.create({
            data: {
              assignmentId: a.id,
              principalId: a.principalId,
              displayName: a.principalDisplayName,
              email: emailMap[a.principalId] || null,
              appRoleId: a.appRoleId,
              roleName: roleMap[a.appRoleId] || 'Unknown',
            },
          }),
        ),
      );

      return records;
    },
  },
};

module.exports = appRoleResolvers;