const { GraphQLError } = require('graphql');

function requireAuth(context) {
  if (!context.user) {
    throw new GraphQLError('You must be logged in to perform this action.', {
      extensions: {
        code: 'UNAUTHENTICATED',
        http: { status: 401 },
      },
    });
  }
}

// Training resolvers accept tokens from either the vehicles app or the
// training app. Returns the token claims.
function requireTrainingAuth(context) {
  if (!context.trainingUser) {
    throw new GraphQLError('You must be logged in to perform this action.', {
      extensions: {
        code: 'UNAUTHENTICATED',
        http: { status: 401 },
      },
    });
  }
  return context.trainingUser;
}

module.exports = { requireAuth, requireTrainingAuth };
