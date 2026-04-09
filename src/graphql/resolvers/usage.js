const dayjs = require('dayjs');
const { requireAuth } = require('../../middleware/requireAuth');
const { sendIncidentEmail } = require('../../utils/sendIncidentEmail');

const usageResolvers = {
  Query: {
    usageRecord: (_, args, context) => {
      requireAuth(context);
      return context.prisma.vehicleUsage.findUnique({
        where: { id: Number(args.id) },
        include: { vehicle: true },
      });
    },

    myUsageRecords: (_, __, context) => {
      requireAuth(context);
      const userId = context.user.oid || context.user.sub;
      return context.prisma.vehicleUsage.findMany({
        where: { userId },
        orderBy: { pickupDate: 'desc' },
        include: { vehicle: true },
      });
    },

    allUsageRecords: (_, __, context) => {
      requireAuth(context);
      return context.prisma.vehicleUsage.findMany({
        orderBy: { pickupDate: 'desc' },
        include: { vehicle: true },
      });
    },

    myActiveTrips: (_, __, context) => {
      requireAuth(context);
      const userId = context.user.oid || context.user.sub;
      return context.prisma.vehicleUsage.findMany({
        where: { userId, status: 'IN_USE' },
        orderBy: { pickupDate: 'desc' },
        include: { vehicle: true },
      });
    },

    activeUsageByVehicle: (_, args, context) => {
      requireAuth(context);
      return context.prisma.vehicleUsage.findFirst({
        where: {
          vehicleId: Number(args.vehicleId),
          status: 'IN_USE',
        },
        include: { vehicle: true },
      });
    },

    usageByVehicle: (_, args, context) => {
      requireAuth(context);
      return context.prisma.vehicleUsage.findMany({
        where: { vehicleId: Number(args.vehicleId) },
        orderBy: { pickupDate: 'desc' },
        include: { vehicle: true },
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
            brokenWindowsDesc: input.brokenWindowsDesc,
            lightsWorking: input.lightsWorking,
            lightsWorkingDesc: input.lightsWorkingDesc,
            mirrorsOk: input.mirrorsOk,
            mirrorsOkDesc: input.mirrorsOkDesc,
            tiresOk: input.tiresOk,
            tiresOkDesc: input.tiresOkDesc,
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

      const [usage, vehicle] = await context.prisma.$transaction([
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
            interiorConditionDesc: input.interiorConditionDesc,
            properlyParked: input.properlyParked,
            properlyParkedDesc: input.properlyParkedDesc,
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

      // Send incident notification email (fire-and-forget)
      if (input.incidentOccurred) {
        sendIncidentEmail(usage, vehicle).catch(() => {});
      }

      return usage;
    },

    updateUsageRecord: async (_, { id, input }, context) => {
      requireAuth(context);
      const usageId = Number(id);

      const existing = await context.prisma.vehicleUsage.findUnique({
        where: { id: usageId },
      });
      if (!existing) throw new Error('Usage record not found');

      const usage = await context.prisma.vehicleUsage.update({
        where: { id: usageId },
        data: {
          ...(input.pickupDate !== undefined && { pickupDate: input.pickupDate }),
          ...(input.pickupMileage !== undefined && { pickupMileage: input.pickupMileage }),
          ...(input.returnDate !== undefined && { returnDate: input.returnDate }),
          ...(input.returnMileage !== undefined && { returnMileage: input.returnMileage }),
          ...(input.incidentOccurred !== undefined && { incidentOccurred: input.incidentOccurred }),
          ...(input.incidentDescription !== undefined && { incidentDescription: input.incidentDescription }),
          ...(input.newDamage !== undefined && { newDamage: input.newDamage }),
          ...(input.newDamageDesc !== undefined && { newDamageDesc: input.newDamageDesc }),
          ...(input.interiorConditionOk !== undefined && { interiorConditionOk: input.interiorConditionOk }),
          ...(input.interiorConditionDesc !== undefined && { interiorConditionDesc: input.interiorConditionDesc }),
          ...(input.properlyParked !== undefined && { properlyParked: input.properlyParked }),
          ...(input.properlyParkedDesc !== undefined && { properlyParkedDesc: input.properlyParkedDesc }),
          ...(input.returnObservations !== undefined && { returnObservations: input.returnObservations }),
          ...(input.pickupObservations !== undefined && { pickupObservations: input.pickupObservations }),
        },
        include: { vehicle: true },
      });

      // If return mileage was updated, sync vehicle's current mileage
      if (input.returnMileage !== undefined && existing.status === 'COMPLETED') {
        await context.prisma.vehicle.update({
          where: { id: existing.vehicleId },
          data: { currentMileage: input.returnMileage },
        });
      }

      return usage;
    },

    deleteUsageRecord: async (_, { id }, context) => {
      requireAuth(context);
      const usageId = Number(id);

      const existing = await context.prisma.vehicleUsage.findUnique({
        where: { id: usageId },
        include: { vehicle: true },
      });
      if (!existing) throw new Error('Usage record not found');

      // If the trip is active, release the vehicle back to AVAILABLE
      if (existing.status === 'IN_USE') {
        await context.prisma.vehicle.update({
          where: { id: existing.vehicleId },
          data: { status: 'AVAILABLE' },
        });
      }

      await context.prisma.vehicleUsage.delete({
        where: { id: usageId },
      });

      return existing;
    },

    forceCloseUsage: async (_, { id }, context) => {
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
            returnDate: new Date(),
            status: 'COMPLETED',
          },
        }),
        context.prisma.vehicle.update({
          where: { id: existing.vehicleId },
          data: { status: 'AVAILABLE' },
        }),
      ]);

      return usage;
    },
  },
};

module.exports = usageResolvers;
