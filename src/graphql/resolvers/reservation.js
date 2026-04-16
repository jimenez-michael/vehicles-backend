const { GraphQLError } = require('graphql');
const { requireAuth } = require('../../middleware/requireAuth');
const { sendReservationCancelledEmail } = require('../../utils/sendReservationCancelledEmail');

const reservationResolvers = {
  Query: {
    myReservations: (_, __, context) => {
      requireAuth(context);
      const userId = context.user.oid || context.user.sub;
      return context.prisma.reservation.findMany({
        where: { userId },
        orderBy: { startDate: 'desc' },
        include: { vehicle: true },
      });
    },

    allReservations: (_, __, context) => {
      requireAuth(context);
      return context.prisma.reservation.findMany({
        orderBy: { startDate: 'desc' },
        include: { vehicle: true },
      });
    },

    reservation: (_, args, context) => {
      requireAuth(context);
      return context.prisma.reservation.findUnique({
        where: { id: Number(args.id) },
        include: { vehicle: true },
      });
    },

    reservationsPage: async (_, { input }, context) => {
      requireAuth(context);
      const page = Math.max(1, input?.page ?? 1);
      const pageSize = Math.min(100, Math.max(1, input?.pageSize ?? 25));
      const search = input?.search?.trim();
      const status = input?.status;
      const scope = input?.scope === 'mine' ? 'mine' : 'all';
      const sortBy = input?.sortBy ?? 'startDate';
      const sortDir = input?.sortDir === 'asc' ? 'asc' : 'desc';

      const allowedSort = new Set(['startDate', 'endDate', 'status', 'createdAt']);
      const orderByField = allowedSort.has(sortBy) ? sortBy : 'startDate';

      const and = [];
      if (scope === 'mine') {
        const userId = context.user.oid || context.user.sub;
        and.push({ userId });
      }
      if (status && status !== 'all') and.push({ status });
      if (search) {
        and.push({
          OR: [
            { userName: { contains: search, mode: 'insensitive' } },
            { userEmail: { contains: search, mode: 'insensitive' } },
            { vehicle: { vehicleNumber: { contains: search, mode: 'insensitive' } } },
            { vehicle: { licensePlate: { contains: search, mode: 'insensitive' } } },
            { vehicle: { make: { contains: search, mode: 'insensitive' } } },
            { vehicle: { model: { contains: search, mode: 'insensitive' } } },
          ],
        });
      }
      const where = and.length ? { AND: and } : {};

      const [items, total] = await Promise.all([
        context.prisma.reservation.findMany({
          where,
          orderBy: { [orderByField]: sortDir },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { vehicle: true },
        }),
        context.prisma.reservation.count({ where }),
      ]);

      return {
        items,
        total,
        page,
        pageSize,
        hasMore: page * pageSize < total,
      };
    },

    reservationsByVehicle: (_, args, context) => {
      requireAuth(context);
      const where = {
        vehicleId: Number(args.vehicleId),
        status: 'CONFIRMED',
      };

      if (args.startDate && args.endDate) {
        where.startDate = { lt: new Date(args.endDate) };
        where.endDate = { gt: new Date(args.startDate) };
      }

      return context.prisma.reservation.findMany({
        where,
        orderBy: { startDate: 'asc' },
        include: { vehicle: true },
      });
    },
  },

  Mutation: {
    createReservation: async (_, { input }, context) => {
      requireAuth(context);
      const userId = context.user.oid || context.user.sub;
      const userName = context.user.name || context.user.preferred_username;
      const userEmail = context.user.preferred_username;
      const vehicleId = Number(input.vehicleId);

      const vehicle = await context.prisma.vehicle.findUnique({
        where: { id: vehicleId },
      });
      if (!vehicle) throw new GraphQLError('Vehicle not found');

      // Check for overlapping confirmed reservations
      const overlapping = await context.prisma.reservation.findFirst({
        where: {
          vehicleId,
          status: 'CONFIRMED',
          startDate: { lt: new Date(input.endDate) },
          endDate: { gt: new Date(input.startDate) },
        },
      });

      if (overlapping) {
        throw new GraphQLError(
          'This vehicle already has a reservation during the selected time',
          { extensions: { code: 'RESERVATION_OVERLAP' } }
        );
      }

      return context.prisma.reservation.create({
        data: {
          vehicleId,
          userId,
          userName,
          userEmail,
          startDate: new Date(input.startDate),
          endDate: new Date(input.endDate),
          purpose: input.purpose,
          notes: input.notes,
          status: 'CONFIRMED',
          createdBy: userEmail,
        },
        include: { vehicle: true },
      });
    },

    updateReservation: async (_, { id, input }, context) => {
      requireAuth(context);
      const reservationId = Number(id);
      const userId = context.user.oid || context.user.sub;
      const roles = context.user.roles || [];

      const existing = await context.prisma.reservation.findUnique({
        where: { id: reservationId },
      });
      if (!existing) throw new GraphQLError('Reservation not found');

      if (existing.userId !== userId && !roles.includes('Admin')) {
        throw new GraphQLError('You can only edit your own reservations');
      }

      // If dates changed, re-check overlap
      const newStartDate = input.startDate ? new Date(input.startDate) : existing.startDate;
      const newEndDate = input.endDate ? new Date(input.endDate) : existing.endDate;

      if (input.startDate || input.endDate) {
        const overlapping = await context.prisma.reservation.findFirst({
          where: {
            vehicleId: existing.vehicleId,
            status: 'CONFIRMED',
            id: { not: reservationId },
            startDate: { lt: newEndDate },
            endDate: { gt: newStartDate },
          },
        });

        if (overlapping) {
          throw new GraphQLError(
            'This vehicle already has a reservation during the selected time',
            { extensions: { code: 'RESERVATION_OVERLAP' } }
          );
        }
      }

      const userEmail = context.user.preferred_username;

      return context.prisma.reservation.update({
        where: { id: reservationId },
        data: {
          ...(input.startDate !== undefined && { startDate: newStartDate }),
          ...(input.endDate !== undefined && { endDate: newEndDate }),
          ...(input.purpose !== undefined && { purpose: input.purpose }),
          ...(input.notes !== undefined && { notes: input.notes }),
          updatedBy: userEmail,
        },
        include: { vehicle: true },
      });
    },

    cancelReservation: async (_, { id }, context) => {
      requireAuth(context);
      const reservationId = Number(id);
      const userId = context.user.oid || context.user.sub;
      const roles = context.user.roles || [];

      const existing = await context.prisma.reservation.findUnique({
        where: { id: reservationId },
        include: { vehicle: true },
      });
      if (!existing) throw new GraphQLError('Reservation not found');

      if (existing.userId !== userId && !roles.includes('Admin')) {
        throw new GraphQLError('You can only cancel your own reservations');
      }

      if (existing.status === 'CANCELLED') {
        throw new GraphQLError('This reservation is already cancelled');
      }

      const userEmail = context.user.preferred_username;

      const cancelled = await context.prisma.reservation.update({
        where: { id: reservationId },
        data: {
          status: 'CANCELLED',
          updatedBy: userEmail,
        },
        include: { vehicle: true },
      });

      // Notify reservation owner if cancelled by someone else (admin)
      if (existing.userId !== userId) {
        sendReservationCancelledEmail(existing, userEmail).catch(() => {});
      }

      return cancelled;
    },

    deleteReservation: async (_, { id }, context) => {
      requireAuth(context);
      const reservationId = Number(id);
      const userId = context.user.oid || context.user.sub;
      const roles = context.user.roles || [];

      const existing = await context.prisma.reservation.findUnique({
        where: { id: reservationId },
        include: { vehicle: true },
      });
      if (!existing) throw new GraphQLError('Reservation not found');

      if (existing.userId !== userId && !roles.includes('Admin')) {
        throw new GraphQLError('You can only delete your own reservations');
      }

      await context.prisma.reservation.delete({
        where: { id: reservationId },
      });

      return existing;
    },
  },
};

module.exports = reservationResolvers;
