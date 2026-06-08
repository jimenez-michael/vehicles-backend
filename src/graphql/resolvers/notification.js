const { requireGlobalAdmin } = require('../../middleware/adminScope');

const notificationResolvers = {
  Query: {
    incidentNotificationRecipients: (_, __, context) => {
      requireGlobalAdmin(context);
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
      requireGlobalAdmin(context);
      return context.prisma.incidentNotificationRecipient.create({
        data: { userId, userName, userEmail },
      });
    },

    removeIncidentNotificationRecipient: async (_, { id }, context) => {
      requireGlobalAdmin(context);
      return context.prisma.incidentNotificationRecipient.delete({
        where: { id: Number(id) },
      });
    },
  },
};

module.exports = notificationResolvers;