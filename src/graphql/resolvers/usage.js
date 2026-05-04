const dayjs = require('dayjs');
const { GraphQLError } = require('graphql');
const { requireAuth } = require('../../middleware/requireAuth');
const { sendIncidentEmail } = require('../../utils/sendIncidentEmail');
const { sendForceCloseEmail } = require('../../utils/sendForceCloseEmail');
const {
  generateAttachmentUploadSas,
  generateAttachmentReadSas,
} = require('../../services/azure-blob');

function ensureOwnerOrAdmin(context, ownerUserId) {
  const userId = context.user.oid || context.user.sub;
  const roles = context.user.roles || [];
  if (ownerUserId !== userId && !roles.includes('Admin')) {
    throw new GraphQLError('You do not have access to this record', {
      extensions: { code: 'FORBIDDEN', http: { status: 403 } },
    });
  }
}

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

    usageRecordsPage: async (_, { input }, context) => {
      requireAuth(context);
      const page = Math.max(1, input?.page ?? 1);
      const pageSize = Math.min(100, Math.max(1, input?.pageSize ?? 25));
      const search = input?.search?.trim();
      const status = input?.status;
      const scope = input?.scope === 'mine' ? 'mine' : 'all';
      const incidentsOnly = input?.incidentsOnly === true;
      const vehicleId = input?.vehicleId != null ? Number(input.vehicleId) : null;
      const sortBy = input?.sortBy ?? 'pickupDate';
      const sortDir = input?.sortDir === 'asc' ? 'asc' : 'desc';

      const allowedSort = new Set(['pickupDate', 'returnDate', 'userName', 'status']);
      const orderByField = allowedSort.has(sortBy) ? sortBy : 'pickupDate';

      const and = [];
      if (scope === 'mine') {
        const userId = context.user.oid || context.user.sub;
        and.push({ userId });
      }
      if (status && status !== 'all') and.push({ status });
      if (incidentsOnly) and.push({ incidentOccurred: true });
      if (vehicleId && Number.isFinite(vehicleId)) and.push({ vehicleId });
      if (search) {
        and.push({
          OR: [
            { userName: { contains: search } },
            { userEmail: { contains: search } },
            { vehicle: { vehicleNumber: { contains: search } } },
            { vehicle: { licensePlate: { contains: search } } },
          ],
        });
      }
      const where = and.length ? { AND: and } : {};

      const [items, total] = await Promise.all([
        context.prisma.vehicleUsage.findMany({
          where,
          orderBy: { [orderByField]: sortDir },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { vehicle: true },
        }),
        context.prisma.vehicleUsage.count({ where }),
      ]);

      return {
        items,
        total,
        page,
        pageSize,
        hasMore: page * pageSize < total,
      };
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
      const where = { userId, status: 'COMPLETED' };

      const [totalTrips, aggregates, lastIncident, oldestTrip] = await Promise.all([
        context.prisma.vehicleUsage.count({ where }),
        context.prisma.vehicleUsage.aggregate({
          where,
          _sum: { returnMileage: true, pickupMileage: true },
        }),
        context.prisma.vehicleUsage.findFirst({
          where: { ...where, incidentOccurred: true },
          orderBy: { returnDate: 'desc' },
          select: { returnDate: true },
        }),
        context.prisma.vehicleUsage.findFirst({
          where,
          orderBy: { pickupDate: 'asc' },
          select: { pickupDate: true },
        }),
      ]);

      const totalMileage = (aggregates._sum.returnMileage || 0) - (aggregates._sum.pickupMileage || 0);
      const lastIncidentDate = lastIncident?.returnDate || null;
      const daysWithoutIncident = lastIncidentDate
        ? dayjs().diff(dayjs(lastIncidentDate), 'day')
        : totalTrips > 0
          ? dayjs().diff(dayjs(oldestTrip.pickupDate), 'day')
          : 0;

      return { totalTrips, totalMileage, daysWithoutIncident, lastIncidentDate };
    },

    incidentReport: async (_, args, context) => {
      requireAuth(context);
      const usage = await context.prisma.vehicleUsage.findUnique({
        where: { id: Number(args.usageId) },
        include: { vehicle: true, attachments: true },
      });
      if (!usage) return null;
      ensureOwnerOrAdmin(context, usage.userId);
      return usage;
    },

    fleetStats: async (_, __, context) => {
      requireAuth(context);
      const completedWhere = { status: 'COMPLETED' };
      const now = dayjs();
      const thisMonthStart = now.startOf('month').toDate();
      const lastMonthStart = now.subtract(1, 'month').startOf('month').toDate();

      // Run scalar aggregations in parallel
      const [
        totalVehicles,
        activeVehicles,
        totalTrips,
        mileageAgg,
        totalIncidents,
        lastIncident,
        oldestTrip,
        chartRecords,
        recentRecords,
        tripsThisMonth,
        tripsLastMonth,
        incidentsThisMonth,
        incidentsLastMonth,
      ] = await Promise.all([
        context.prisma.vehicle.count(),
        context.prisma.vehicle.count({ where: { status: 'IN_USE' } }),
        context.prisma.vehicleUsage.count({ where: completedWhere }),
        context.prisma.vehicleUsage.aggregate({
          where: completedWhere,
          _sum: { returnMileage: true, pickupMileage: true },
        }),
        context.prisma.vehicleUsage.count({ where: { ...completedWhere, incidentOccurred: true } }),
        context.prisma.vehicleUsage.findFirst({
          where: { ...completedWhere, incidentOccurred: true },
          orderBy: { returnDate: 'desc' },
          select: { returnDate: true },
        }),
        context.prisma.vehicleUsage.findFirst({
          where: completedWhere,
          orderBy: { pickupDate: 'asc' },
          select: { pickupDate: true },
        }),
        // Only fetch fields needed for chart aggregations
        context.prisma.vehicleUsage.findMany({
          where: completedWhere,
          orderBy: { pickupDate: 'asc' },
          select: {
            pickupDate: true,
            pickupMileage: true,
            returnMileage: true,
            returnDate: true,
            incidentOccurred: true,
            vehicle: { select: { vehicleNumber: true } },
          },
        }),
        context.prisma.vehicleUsage.findMany({
          orderBy: { pickupDate: 'desc' },
          take: 10,
          include: { vehicle: true },
        }),
        context.prisma.vehicleUsage.count({
          where: { pickupDate: { gte: thisMonthStart } },
        }),
        context.prisma.vehicleUsage.count({
          where: { pickupDate: { gte: lastMonthStart, lt: thisMonthStart } },
        }),
        context.prisma.vehicleUsage.count({
          where: { pickupDate: { gte: thisMonthStart }, incidentOccurred: true },
        }),
        context.prisma.vehicleUsage.count({
          where: {
            pickupDate: { gte: lastMonthStart, lt: thisMonthStart },
            incidentOccurred: true,
          },
        }),
      ]);

      const totalMileage = (mileageAgg._sum.returnMileage || 0) - (mileageAgg._sum.pickupMileage || 0);

      const daysWithoutIncident = lastIncident?.returnDate
        ? dayjs().diff(dayjs(lastIncident.returnDate), 'day')
        : totalTrips > 0
          ? dayjs().diff(dayjs(oldestTrip.pickupDate), 'day')
          : 0;

      // Mileage by month
      const mileageMap = {};
      chartRecords.forEach((r) => {
        const month = dayjs(r.pickupDate).format('MMM YYYY');
        mileageMap[month] = (mileageMap[month] || 0) + ((r.returnMileage || 0) - r.pickupMileage);
      });
      const mileageByMonth = Object.entries(mileageMap).map(([month, mileage]) => ({
        month,
        mileage,
      }));

      // Trips by vehicle
      const tripsMap = {};
      chartRecords.forEach((r) => {
        const num = r.vehicle?.vehicleNumber || 'Unknown';
        tripsMap[num] = (tripsMap[num] || 0) + 1;
      });
      const tripsByVehicle = Object.entries(tripsMap).map(([vehicleNumber, trips]) => ({
        vehicleNumber,
        trips,
      }));

      // Incidents by month
      const incidentsMap = {};
      chartRecords
        .filter((r) => r.incidentOccurred)
        .forEach((r) => {
          const month = dayjs(r.returnDate || r.pickupDate).format('MMM YYYY');
          incidentsMap[month] = (incidentsMap[month] || 0) + 1;
        });
      const incidentsByMonth = Object.entries(incidentsMap).map(([month, incidents]) => ({
        month,
        incidents,
      }));

      // Daily activity (trips + incidents per day) — drives the dashboard chart
      const dailyMap = {};
      chartRecords.forEach((r) => {
        const date = dayjs(r.pickupDate).format('YYYY-MM-DD');
        if (!dailyMap[date]) dailyMap[date] = { date, trips: 0, incidents: 0 };
        dailyMap[date].trips += 1;
        if (r.incidentOccurred) dailyMap[date].incidents += 1;
      });
      const dailyActivity = Object.values(dailyMap).sort((a, b) =>
        a.date.localeCompare(b.date),
      );

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
        dailyActivity,
        recentRecords,
        tripsThisMonth,
        tripsLastMonth,
        incidentsThisMonth,
        incidentsLastMonth,
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
            gasLevel: input.gasLevel,
            interiorCleanliness: input.interiorCleanliness,
            exteriorCleanliness: input.exteriorCleanliness,
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
            gasFilledUp: input.gasFilledUp,
            returnInteriorCleanliness: input.returnInteriorCleanliness,
            returnExteriorCleanliness: input.returnExteriorCleanliness,
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
          ...(input.gasLevel !== undefined && { gasLevel: input.gasLevel }),
          ...(input.interiorCleanliness !== undefined && { interiorCleanliness: input.interiorCleanliness }),
          ...(input.exteriorCleanliness !== undefined && { exteriorCleanliness: input.exteriorCleanliness }),
          ...(input.returnDate !== undefined && { returnDate: input.returnDate }),
          ...(input.returnMileage !== undefined && { returnMileage: input.returnMileage }),
          ...(input.gasFilledUp !== undefined && { gasFilledUp: input.gasFilledUp }),
          ...(input.returnInteriorCleanliness !== undefined && { returnInteriorCleanliness: input.returnInteriorCleanliness }),
          ...(input.returnExteriorCleanliness !== undefined && { returnExteriorCleanliness: input.returnExteriorCleanliness }),
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
        include: { vehicle: true },
      });
      if (!existing) throw new Error('Usage record not found');
      if (existing.status !== 'IN_USE') {
        throw new Error('This usage record is already completed');
      }

      const actor = {
        id: context.user.oid || context.user.sub || null,
        name: context.user.name || context.user.preferred_username || null,
        email: context.user.preferred_username || null,
      };

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
        context.prisma.auditLog.create({
          data: {
            action: 'FORCE_CLOSE_USAGE',
            actorId: actor.id,
            actorName: actor.name,
            actorEmail: actor.email,
            targetType: 'VehicleUsage',
            targetId: String(usageId),
            metadata: JSON.stringify({
              vehicleId: existing.vehicleId,
              vehicleNumber: existing.vehicle?.vehicleNumber,
              licensePlate: existing.vehicle?.licensePlate,
              originalUserId: existing.userId,
              originalUserName: existing.userName,
              originalUserEmail: existing.userEmail,
              pickupDate: existing.pickupDate,
              pickupMileage: existing.pickupMileage,
            }),
          },
        }),
      ]);

      // Fire-and-forget — email failure must not block the force-close.
      sendForceCloseEmail({
        abandonedUsage: existing,
        vehicle: existing.vehicle,
        actor,
      }).catch((err) =>
        console.error('[forceCloseUsage] email error:', err.message || err),
      );

      return usage;
    },

    updateIncidentReport: async (_, { usageId, input }, context) => {
      requireAuth(context);
      const id = Number(usageId);

      const existing = await context.prisma.vehicleUsage.findUnique({
        where: { id },
      });
      if (!existing) throw new GraphQLError('Usage record not found');
      ensureOwnerOrAdmin(context, existing.userId);

      const updated = await context.prisma.vehicleUsage.update({
        where: { id },
        data: {
          ...(input.incidentOccurred !== undefined && { incidentOccurred: input.incidentOccurred }),
          ...(input.incidentDescription !== undefined && { incidentDescription: input.incidentDescription }),
          ...(input.policeReportNumber !== undefined && { policeReportNumber: input.policeReportNumber }),
          ...(input.trustDriverName !== undefined && { trustDriverName: input.trustDriverName }),
          ...(input.thirdPartyName !== undefined && { thirdPartyName: input.thirdPartyName }),
          ...(input.thirdPartyAddress !== undefined && { thirdPartyAddress: input.thirdPartyAddress }),
          ...(input.thirdPartyPhone !== undefined && { thirdPartyPhone: input.thirdPartyPhone }),
          ...(input.thirdPartyVehicleModel !== undefined && { thirdPartyVehicleModel: input.thirdPartyVehicleModel }),
          ...(input.thirdPartyVehicleYear !== undefined && { thirdPartyVehicleYear: input.thirdPartyVehicleYear }),
          ...(input.newDamage !== undefined && { newDamage: input.newDamage }),
          ...(input.newDamageDesc !== undefined && { newDamageDesc: input.newDamageDesc }),
        },
        include: { vehicle: true, attachments: true },
      });

      return updated;
    },

    requestIncidentAttachmentUpload: async (
      _,
      { usageId, category, originalFileName, contentType, sizeBytes },
      context,
    ) => {
      requireAuth(context);
      const id = Number(usageId);

      const existing = await context.prisma.vehicleUsage.findUnique({
        where: { id },
      });
      if (!existing) throw new GraphQLError('Usage record not found');
      ensureOwnerOrAdmin(context, existing.userId);

      const ticket = await generateAttachmentUploadSas({
        usageId: id,
        category,
        originalFileName,
        contentType,
        sizeBytes,
      });

      return {
        uploadUrl: ticket.uploadUrl,
        blobName: ticket.blobName,
        containerName: ticket.containerName,
        attachmentId: null, // DB row is created in the confirm step
        expiresAt: ticket.expiresAt,
      };
    },

    confirmIncidentAttachmentUpload: async (
      _,
      { usageId, blobName, containerName, category, originalFileName, contentType, sizeBytes },
      context,
    ) => {
      requireAuth(context);
      const id = Number(usageId);

      const existing = await context.prisma.vehicleUsage.findUnique({
        where: { id },
      });
      if (!existing) throw new GraphQLError('Usage record not found');
      ensureOwnerOrAdmin(context, existing.userId);

      const uploaderId = context.user.oid || context.user.sub;
      const uploaderName = context.user.name || context.user.preferred_username || null;
      const uploaderEmail = context.user.preferred_username || null;

      const attachment = await context.prisma.incidentAttachment.create({
        data: {
          usageId: id,
          category,
          blobName,
          containerName,
          originalFileName,
          contentType,
          sizeBytes,
          uploadedById: uploaderId,
          uploadedByName: uploaderName,
          uploadedByEmail: uploaderEmail,
        },
      });

      return attachment;
    },

    deleteIncidentAttachment: async (_, { id }, context) => {
      requireAuth(context);
      const attachmentId = Number(id);

      const existing = await context.prisma.incidentAttachment.findUnique({
        where: { id: attachmentId },
      });
      if (!existing) throw new GraphQLError('Attachment not found');

      const userId = context.user.oid || context.user.sub;
      const roles = context.user.roles || [];
      if (existing.uploadedById !== userId && !roles.includes('Admin')) {
        throw new GraphQLError('You can only delete attachments you uploaded', {
          extensions: { code: 'FORBIDDEN', http: { status: 403 } },
        });
      }

      // TODO: also delete the underlying blob from Azure storage.
      await context.prisma.incidentAttachment.delete({
        where: { id: attachmentId },
      });

      return true;
    },
  },

  VehicleUsage: {
    attachments: (parent, _, context) => {
      // If already included by a parent resolver, reuse it.
      if (Array.isArray(parent.attachments)) return parent.attachments;
      return context.prisma.incidentAttachment.findMany({
        where: { usageId: parent.id },
        orderBy: { uploadedAt: 'asc' },
      });
    },
    driverLicense: (parent, _, context) => {
      if (!parent.userId) return null;
      return context.prisma.userDriverLicense.findUnique({
        where: { principalId: parent.userId },
      });
    },
  },

  IncidentAttachment: {
    downloadUrl: (parent) =>
      generateAttachmentReadSas({
        blobName: parent.blobName,
        containerName: parent.containerName,
      }),
  },
};

module.exports = usageResolvers;
