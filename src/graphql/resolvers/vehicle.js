const { requireAuth } = require('../../middleware/requireAuth');

const vehicleResolvers = {
  Query: {
    vehicle: (_, args, context) => {
      requireAuth(context);
      return context.prisma.vehicle.findUnique({
        where: { id: Number(args.id) },
      });
    },
    vehicleByPlate: (_, args, context) => {
      requireAuth(context);
      return context.prisma.vehicle.findUnique({
        where: { licensePlate: args.licensePlate },
      });
    },
    vehicles: (_, __, context) => {
      requireAuth(context);
      return context.prisma.vehicle.findMany({
        orderBy: { vehicleNumber: 'asc' },
      });
    },

    vehiclesPage: async (_, { input }, context) => {
      requireAuth(context);
      const page = Math.max(1, input?.page ?? 1);
      const pageSize = Math.min(100, Math.max(1, input?.pageSize ?? 25));
      const search = input?.search?.trim();
      const status = input?.status;
      const sortBy = input?.sortBy ?? 'vehicleNumber';
      const sortDir = input?.sortDir === 'desc' ? 'desc' : 'asc';

      const allowedSort = new Set([
        'vehicleNumber',
        'licensePlate',
        'make',
        'model',
        'year',
        'status',
        'currentMileage',
      ]);
      const orderByField = allowedSort.has(sortBy) ? sortBy : 'vehicleNumber';

      const and = [];
      if (status && status !== 'all') and.push({ status });
      if (search) {
        and.push({
          OR: [
            { vehicleNumber: { contains: search, mode: 'insensitive' } },
            { licensePlate: { contains: search, mode: 'insensitive' } },
            { make: { contains: search, mode: 'insensitive' } },
            { model: { contains: search, mode: 'insensitive' } },
            { program: { contains: search, mode: 'insensitive' } },
          ],
        });
      }
      const where = and.length ? { AND: and } : {};

      const [items, total] = await Promise.all([
        context.prisma.vehicle.findMany({
          where,
          orderBy: { [orderByField]: sortDir },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        context.prisma.vehicle.count({ where }),
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
  Mutation: {
    createVehicle: (_, { input }, context) => {
      requireAuth(context);
      return context.prisma.vehicle.create({
        data: {
          ...input,
          createdBy: context.user.name || context.user.preferred_username,
          updatedBy: context.user.name || context.user.preferred_username,
        },
      });
    },
    updateVehicle: (_, { id, input }, context) => {
      requireAuth(context);
      return context.prisma.vehicle.update({
        where: { id: Number(id) },
        data: {
          ...input,
          updatedBy: context.user.name || context.user.preferred_username,
        },
      });
    },
    deleteVehicle: (_, { id }, context) => {
      requireAuth(context);
      return context.prisma.vehicle.delete({
        where: { id: Number(id) },
      });
    },
  },
};

module.exports = vehicleResolvers;
