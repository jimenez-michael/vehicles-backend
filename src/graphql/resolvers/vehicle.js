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
