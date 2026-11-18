// Grants vehicles-app access to a user who passed the fleet safety training by
// creating an Entra ID app role assignment on the vehicles enterprise app.
//
// Requires the backend app registration to hold the Microsoft Graph
// application permission AppRoleAssignment.ReadWrite.All (admin consented).
// Which role gets assigned is configured by TRAINING_GRANT_ROLE_VALUE (the
// role's `value`, e.g. "Driver"); defaults to "Driver".

const { createAppGraphClient } = require('../utils/graphAppClient');
const { getServicePrincipalId } = require('../utils/servicePrincipal');

async function grantVehiclesAccess({ prisma, principalId, displayName, email }) {
  const client = createAppGraphClient();
  const resourceId = await getServicePrincipalId(client);

  // Already assigned (any role) → nothing to do. Idempotent on retries.
  const existing = await client
    .api(`/users/${principalId}/appRoleAssignments`)
    .filter(`resourceId eq ${resourceId}`)
    .get();
  if (existing.value?.length) {
    return { alreadyAssigned: true, assignment: existing.value[0] };
  }

  const roleValue = process.env.TRAINING_GRANT_ROLE_VALUE || 'Driver';
  const sp = await client.api(`/servicePrincipals/${resourceId}`).select('appRoles').get();
  const role = (sp.appRoles || []).find((r) => r.isEnabled && r.value === roleValue);
  if (!role) {
    throw new Error(
      `App role with value "${roleValue}" not found on the vehicles enterprise app (set TRAINING_GRANT_ROLE_VALUE)`,
    );
  }

  const assignment = await client
    .api(`/servicePrincipals/${resourceId}/appRoleAssignments`)
    .post({ principalId, resourceId, appRoleId: role.id });

  // Mirror into the local table the admin Users screen reads from.
  await prisma.appUserRole.upsert({
    where: { assignmentId: assignment.id },
    update: {},
    create: {
      assignmentId: assignment.id,
      principalId,
      displayName: displayName || email || principalId,
      email: email || null,
      appRoleId: role.id,
      roleName: role.displayName,
    },
  });

  return { alreadyAssigned: false, assignment, roleName: role.displayName };
}

// Entra is the source of truth for access. The local appUserRole table is only
// a mirror and drifts when roles are removed by hand in the Entra portal.
async function hasVehiclesAccess(principalId) {
  const client = createAppGraphClient();
  const resourceId = await getServicePrincipalId(client);
  const res = await client
    .api(`/users/${principalId}/appRoleAssignments`)
    .filter(`resourceId eq ${resourceId}`)
    .get();
  return (res.value?.length ?? 0) > 0;
}

module.exports = { grantVehiclesAccess, hasVehiclesAccess };
