const { requireAuth } = require('../../middleware/requireAuth');

const meResolvers = {
  Query: {
    me: (_, __, context) => {
      requireAuth(context);
      const user = context.user;
      return {
        id: user.oid || user.sub,
        name: user.name,
        email: user.preferred_username || user.email,
        roles: user.roles || [],
      };
    },
  },
};

module.exports = meResolvers;
