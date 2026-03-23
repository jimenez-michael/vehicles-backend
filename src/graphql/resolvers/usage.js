const dayjs = require('dayjs');
const { requireAuth } = require('../../middleware/requireAuth');

const usageResolvers = {
  VehicleUsage: {
    vehicle: (parent, _, context) => {
      return context.prisma.vehicle.findUnique({
        where: { id: parent.vehicleId },
      });
    },
  },

  Query: {
    usageRecord: (_, args, context) => {
      requireAuth(context);
      return context.prisma.vehicleUsage.findUnique({
        where: { id: Number(args.id) },
      });
    },

    myUsageRecords: (_, __, context) => {
      requireAuth(context);
      const userId = context.user.oid || context.user.sub;
      return context.prisma.vehicleUsage.findMany({
        where: { userId },
        orderBy: { pickupDate: 'desc' },
      });
    },

    allUsageRecords: (_, __, context) => {
      requireAuth(context);
      return context.prisma.vehicleUsage.findMany({
        orderBy: { pickupDate: 'desc' },
      });
    },

    activeUsageByVehicle: (_, args, context) => {
      requireAuth(context);
      return context.prisma.vehicleUsage.findFirst({
        where: {
          vehicleId: Number(args.vehicleId),
          status: 'IN_USE',
        },
      });
    },

    usageStats: async (_, __, context) => {
      requireAuth(context);
      const userId = context.user.oid || context.user.sub;

      const records = await context.prisma.vehicleUsage.findMany({
        where: { userId, status: 'COMPLETED' },
        orderBy: { pickupDate: 'desc' },
      });

      const totalTrips = records.length;
      const totalMileage = records.reduce(
        (sum, r) => sum + ((r.returnMileage || 0) - r.pickupMileage),
        0,
      );

      const lastIncident = records.find((r) => r.incidentOccurred);
      const lastIncidentDate = lastIncident?.returnDate || null;
      const daysWithoutIncident = lastIncidentDate
        ? dayjs().diff(dayjs(lastIncidentDate), 'day')
        : totalTrips > 0
          ? dayjs().diff(dayjs(records[records.length - 1].pickupDate), 'day')
          : 0;

      return { totalTrips, totalMileage, daysWithoutIncident, lastIncidentDate };
    },

    fleetStats: async (_, __, context) => {
      requireAuth(context);

      const vehicles = await context.prisma.vehicle.findMany();
      const records = await context.prisma.vehicleUsage.findMany({
        where: { status: 'COMPLETED' },
        orderBy: { pickupDate: 'asc' },
        include: { vehicle: true },
      });

      const totalVehicles = vehicles.length;
      const activeVehicles = vehicles.filter((v) => v.status === 'IN_USE').length;
      const totalTrips = records.length;
      const totalMileage = records.reduce(
        (sum, r) => sum + ((r.returnMileage || 0) - r.pickupMileage),
        0,
      );
      const totalIncidents = records.filter((r) => r.incidentOccurred).length;

      const lastIncident = [...records].reverse().find((r) => r.incidentOccurred);
      const daysWithoutIncident = lastIncident?.returnDate
        ? dayjs().diff(dayjs(lastIncident.returnDate), 'day')
        : totalTrips > 0
          ? dayjs().diff(dayjs(records[0].pickupDate), 'day')
          : 0;

      // Mileage by month
      const mileageMap = {};
      records.forEach((r) => {
        const month = dayjs(r.pickupDate).format('MMM YYYY');
        mileageMap[month] = (mileageMap[month] || 0) + ((r.returnMileage || 0) - r.pickupMileage);
      });
      const mileageByMonth = Object.entries(mileageMap).map(([month, mileage]) => ({
        month,
        mileage,
      }));

      // Trips by vehicle
      const tripsMap = {};
      records.forEach((r) => {
        const num = r.vehicle?.vehicleNumber || 'Unknown';
        tripsMap[num] = (tripsMap[num] || 0) + 1;
      });
      const tripsByVehicle = Object.entries(tripsMap).map(([vehicleNumber, trips]) => ({
        vehicleNumber,
        trips,
      }));

      // Incidents by month
      const incidentsMap = {};
      records
        .filter((r) => r.incidentOccurred)
        .forEach((r) => {
          const month = dayjs(r.returnDate || r.pickupDate).format('MMM YYYY');
          incidentsMap[month] = (incidentsMap[month] || 0) + 1;
        });
      const incidentsByMonth = Object.entries(incidentsMap).map(([month, incidents]) => ({
        month,
        incidents,
      }));

      return {
        totalVehicles,
        activeVehicles,
        totalTrips,
        totalMileage,
        totalIncidents,
        daysWithoutIncident,
        mileageByMonth,
        tripsByVehicle,
        incidentsByMonth,
      };
    },
  },

  Mutation: {
    createPickup: async (_, { input }, context) => {
      requireAuth(context);
      const vehicleId = Number(input.vehicleId);

      // Check vehicle is available
      const vehicle = await context.prisma.vehicle.findUnique({
        where: { id: vehicleId },
      });
      if (!vehicle) throw new Error('Vehicle not found');
      if (vehicle.status !== 'AVAILABLE') {
        throw new Error('Vehicle is not available for pickup');
      }

      // Create usage record and update vehicle status in a transaction
      const [usage] = await context.prisma.$transaction([
        context.prisma.vehicleUsage.create({
          data: {
            vehicleId,
            userId: input.userId,
            userName: input.userName,
            userEmail: input.userEmail,
            pickupDate: input.pickupDate,
            pickupMileage: input.pickupMileage,
            visibleDamage: input.visibleDamage,
            visibleDamageDesc: input.visibleDamageDesc,
            brokenWindows: input.brokenWindows,
            lightsWorking: input.lightsWorking,
            mirrorsOk: input.mirrorsOk,
            tiresOk: input.tiresOk,
            dashboardAlerts: input.dashboardAlerts,
            dashboardAlertDetails: input.dashboardAlertDetails,
            pickupObservations: input.pickupObservations,
            status: 'IN_USE',
          },
        }),
        context.prisma.vehicle.update({
          where: { id: vehicleId },
          data: {
            status: 'IN_USE',
            currentMileage: input.pickupMileage,
          },
        }),
      ]);

      return usage;
    },

    completeReturn: async (_, { id, input }, context) => {
      requireAuth(context);
      const usageId = Number(id);

      const existing = await context.prisma.vehicleUsage.findUnique({
        where: { id: usageId },
      });
      if (!existing) throw new Error('Usage record not found');
      if (existing.status !== 'IN_USE') {
        throw new Error('This usage record is already completed');
      }

      const [usage] = await context.prisma.$transaction([
        context.prisma.vehicleUsage.update({
          where: { id: usageId },
          data: {
            returnDate: input.returnDate,
            returnMileage: input.returnMileage,
            incidentOccurred: input.incidentOccurred,
            incidentDescription: input.incidentDescription,
            newDamage: input.newDamage,
            newDamageDesc: input.newDamageDesc,
            interiorConditionOk: input.interiorConditionOk,
            properlyParked: input.properlyParked,
            returnObservations: input.returnObservations,
            status: 'COMPLETED',
          },
        }),
        context.prisma.vehicle.update({
          where: { id: existing.vehicleId },
          data: {
            status: 'AVAILABLE',
            currentMileage: input.returnMileage,
          },
        }),
      ]);

      return usage;
    },
  },
};

module.exports = usageResolvers;
