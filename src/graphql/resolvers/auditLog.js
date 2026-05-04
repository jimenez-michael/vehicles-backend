const { requireAuth } = require('../../middleware/requireAuth');

const auditLogResolvers = {
  Query: {
    auditLogsPage: async (_, { input }, context) => {
      requireAuth(context);
      const page = Math.max(1, input?.page ?? 1);
      const pageSize = Math.min(100, Math.max(1, input?.pageSize ?? 25));
      const search = input?.search?.trim();
      const action = input?.action?.trim();
      const targetType = input?.targetType?.trim();

      const and = [];
      if (action && action !== 'all') and.push({ action });
      if (targetType && targetType !== 'all') and.push({ targetType });
      if (search) {
        and.push({
          OR: [
            { actorName: { contains: search } },
            { actorEmail: { contains: search } },
            { targetId: { contains: search } },
            { metadata: { contains: search } },
          ],
        });
      }
      const where = and.length ? { AND: and } : {};

      const [items, total] = await Promise.all([
        context.prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        context.prisma.auditLog.count({ where }),
      ]);

      return {
        items,
        total,
        page,
        pageSize,
        hasMore: page * pageSize < total,
      };
    },
  },
};

module.exports = auditLogResolvers;