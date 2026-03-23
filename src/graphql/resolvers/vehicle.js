const { requireAuth } = require('../../middleware/requireAuth');

const vehicleResolvers = {
  Query: {
    vehicle: (_, args, context) => {
      requireAuth(context);
      return context.prisma.vehicle.findUnique({
        where: { id: Number(args.id) },
      });
    },
    vehicles: (_, __, context) => {
      requireAuth(context);
      return context.prisma.vehicle.findMany({
        orderBy: { vehicleNumber: 'asc' },
      });
    },
  },
  Mutation: {
    createVehicle: (_, { input }, context) => {
      requireAuth(context);
      return context.prisma.vehicle.create({ data: input });
    },
    updateVehicle: (_, { id, input }, context) => {
      requireAuth(context);
      return context.prisma.vehicle.update({
        where: { id: Number(id) },
        data: input,
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
