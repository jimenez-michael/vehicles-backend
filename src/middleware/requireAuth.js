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

module.exports = { requireAuth };
