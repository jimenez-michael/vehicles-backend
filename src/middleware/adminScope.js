// src/middleware/adminScope.js
const { GraphQLError } = require('graphql');
const { requireAuth } = require('./requireAuth');

const VECTOR_CONTROL_EMAIL_DOMAIN = '@prvectorcontrol.org';
const VECTOR_CONTROL_PROGRAM = 'PR Vector Control Unit';

function forbidden(message) {
  return new GraphQLError(message, {
    extensions: { code: 'FORBIDDEN', http: { status: 403 } },
  });
}

// Returns 'global' | 'vectorControl' | null. null = not an admin.
function getAdminScope(user) {
  const roles = (user && user.roles) || [];
  if (!roles.includes('Admin')) return null;
  const email = ((user && user.preferred_username) || '').toLowerCase();
  return email.endsWith(VECTOR_CONTROL_EMAIL_DOMAIN) ? 'vectorControl' : 'global';
}

// Any admin (global or vectorControl). Throws otherwise.
function requireAdmin(context) {
  requireAuth(context);
  if (getAdminScope(context.user) === null) {
    throw forbidden('Admin role required');
  }
}

// Global admin only. Throws for non-admins AND for scoped (vectorControl) admins.
function requireGlobalAdmin(context) {
  requireAuth(context);
  if (getAdminScope(context.user) !== 'global') {
    throw forbidden('This action is not available for your account');
  }
}

// where-clause fragment that limits usage/reservation records to the
// vector-control user-email domain. Returns {} for global scope.
function scopedUsageWhere(scope) {
  return scope === 'vectorControl'
    ? { userEmail: { endsWith: VECTOR_CONTROL_EMAIL_DOMAIN } }
    : {};
}

module.exports = {
  VECTOR_CONTROL_EMAIL_DOMAIN,
  VECTOR_CONTROL_PROGRAM,
  getAdminScope,
  requireAdmin,
  requireGlobalAdmin,
  scopedUsageWhere,
};