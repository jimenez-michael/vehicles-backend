const { requireAuth } = require('../../middleware/requireAuth');

const notificationResolvers = {
  Query: {
    incidentNotificationRecipients: (_, __, context) => {
      requireAuth(context);
      return context.prisma.incidentNotificationRecipient.findMany({
        orderBy: { createdAt: 'asc' },
      });
    },
  },

  Mutation: {
    addIncidentNotificationRecipient: async (
      _,
      { userId, userName, userEmail },
      context,
    ) => {
      requireAuth(context);
      return context.prisma.incidentNotificationRecipient.create({
        data: { userId, userName, userEmail },
      });
    },

    removeIncidentNotificationRecipient: async (_, { id }, context) => {
      requireAuth(context);
      return context.prisma.incidentNotificationRecipient.delete({
        where: { id: Number(id) },
      });
    },
  },
};

module.exports = notificationResolvers;