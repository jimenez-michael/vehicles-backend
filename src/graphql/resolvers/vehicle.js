const { GraphQLError } = require('graphql');
const { requireAuth } = require('../../middleware/requireAuth');
const {
  generateAttachmentUploadSas,
  generateAttachmentReadSas,
} = require('../../services/azure-blob');

let extractVehicleLicense;
try {
  // Loaded by a separate agent; resolver tolerates absence so the server
  // still boots if the OCR service is not yet on disk.
  ({ extractVehicleLicense } = require('../../services/license-ocr'));
} catch (_err) {
  extractVehicleLicense = null;
}

function ensureAdmin(context) {
  requireAuth(context);
  const roles = context.user.roles || [];
  if (!roles.includes('Admin')) {
    throw new GraphQLError('Admin role required', {
      extensions: { code: 'FORBIDDEN', http: { status: 403 } },
    });
  }
}

// Eager-load reference counts so `Vehicle.hasHistory` resolves without an
// extra round-trip. Prisma batches `_count` into the same SELECT as findMany,
// so this stays O(1) queries per page (no N+1).
const HAS_HISTORY_INCLUDE = {
  _count: { select: { usages: true, reservations: true } },
};

const vehicleResolvers = {
  Vehicle: {
    hasHistory: async (parent, _args, context) => {
      // Fast path: page resolver eager-loaded _count.
      if (parent && parent._count) {
        return (
          (parent._count.usages ?? 0) > 0 ||
          (parent._count.reservations ?? 0) > 0
        );
      }
      // Fallback (single-vehicle queries that didn't request _count):
      // run the two cheap counts in parallel.
      const [u, r] = await Promise.all([
        context.prisma.vehicleUsage.count({ where: { vehicleId: parent.id } }),
        context.prisma.reservation.count({ where: { vehicleId: parent.id } }),
      ]);
      return u > 0 || r > 0;
    },
    licenses: (parent, _args, context) =>
      context.prisma.vehicleLicense.findMany({
        where: { vehicleId: parent.id },
        orderBy: [{ effectiveTo: 'desc' }, { year: 'desc' }],
      }),
    latestLicense: async (parent, _args, context) => {
      const rows = await context.prisma.vehicleLicense.findMany({
        where: { vehicleId: parent.id },
        orderBy: [{ effectiveTo: 'desc' }, { year: 'desc' }],
        take: 1,
      });
      return rows[0] || null;
    },
  },
  VehicleLicense: {
    downloadUrl: (parent) =>
      generateAttachmentReadSas({
        blobName: parent.blobName,
        containerName: parent.containerName,
      }),
  },
  Query: {
    vehicle: (_, args, context) => {
      requireAuth(context);
      return context.prisma.vehicle.findUnique({
        where: { id: Number(args.id) },
        include: HAS_HISTORY_INCLUDE,
      });
    },
    vehicleByPlate: (_, args, context) => {
      requireAuth(context);
      return context.prisma.vehicle.findUnique({
        where: { licensePlate: args.licensePlate },
        include: HAS_HISTORY_INCLUDE,
      });
    },
    vehicles: (_, __, context) => {
      requireAuth(context);
      return context.prisma.vehicle.findMany({
        orderBy: { vehicleNumber: 'asc' },
        include: HAS_HISTORY_INCLUDE,
      });
    },

    vehiclesPage: async (_, { input }, context) => {
      requireAuth(context);
      const page = Math.max(1, input?.page ?? 1);
      const pageSize = Math.min(100, Math.max(1, input?.pageSize ?? 25));
      const search = input?.search?.trim();
      const status = input?.status;
      const excludeStatus = input?.excludeStatus;
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
      if (excludeStatus) and.push({ status: { not: excludeStatus } });
      if (search) {
        and.push({
          OR: [
            { vehicleNumber: { contains: search } },
            { licensePlate: { contains: search } },
            { make: { contains: search } },
            { model: { contains: search } },
            { program: { contains: search } },
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
          include: HAS_HISTORY_INCLUDE,
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
    requestVehicleLicenseUpload: async (
      _,
      { vehicleId, originalFileName, contentType },
      context,
    ) => {
      ensureAdmin(context);
      const vid = Number(vehicleId);
      const vehicle = await context.prisma.vehicle.findUnique({
        where: { id: vid },
      });
      if (!vehicle) throw new GraphQLError('Vehicle not found');

      // Reuse the incident attachment SAS flow — same container, same
      // pathing convention (`{usageId}/{category}/{uuid}-{filename}`).
      // We slot vehicle license uploads under a synthetic `vehicle-{id}`
      // bucket and `license` category so they don't collide with usage IDs.
      const ticket = await generateAttachmentUploadSas({
        usageId: `vehicle-${vid}`,
        category: 'license',
        originalFileName,
        contentType,
      });
      return ticket;
    },

    confirmVehicleLicenseUpload: async (
      _,
      {
        vehicleId,
        blobName,
        containerName,
        originalFileName,
        contentType,
        sizeBytes,
        year,
        effectiveFrom,
        effectiveTo,
        ocrLicensePlate,
        ocrYear,
        ocrExpiresOn,
        notes,
      },
      context,
    ) => {
      ensureAdmin(context);
      const vid = Number(vehicleId);
      const vehicle = await context.prisma.vehicle.findUnique({
        where: { id: vid },
      });
      if (!vehicle) throw new GraphQLError('Vehicle not found');

      const uploaderId = context.user.oid || context.user.sub;
      const uploaderName = context.user.name || context.user.preferred_username || null;
      const uploaderEmail = context.user.preferred_username || null;

      const hasOcr = ocrLicensePlate != null || ocrYear != null || ocrExpiresOn != null;

      return context.prisma.vehicleLicense.create({
        data: {
          vehicleId: vid,
          year,
          effectiveFrom: effectiveFrom || null,
          effectiveTo: effectiveTo || null,
          blobName,
          containerName,
          originalFileName,
          contentType,
          sizeBytes,
          uploadedById: uploaderId,
          uploadedByName: uploaderName,
          uploadedByEmail: uploaderEmail,
          ocrLicensePlate: ocrLicensePlate || null,
          ocrYear: ocrYear || null,
          ocrExpiresOn: ocrExpiresOn || null,
          ocrExtractedAt: hasOcr ? new Date() : null,
          notes: notes || null,
        },
      });
    },

    runVehicleLicenseOcr: async (_, { blobName, containerName, contentType }, context) => {
      ensureAdmin(context);
      if (!extractVehicleLicense) throw new GraphQLError('OCR service not available');
      const ocr = await extractVehicleLicense({ blobName, containerName, contentType });
      return {
        ocrLicensePlate: ocr.ocrLicensePlate ?? null,
        ocrYear: ocr.ocrYear ?? null,
        ocrExpiresOn: ocr.ocrExpiresOn ?? null,
      };
    },

    updateVehicleLicense: async (_, args, context) => {
      ensureAdmin(context);
      const id = Number(args.id);
      const existing = await context.prisma.vehicleLicense.findUnique({
        where: { id },
      });
      if (!existing) throw new GraphQLError('Vehicle license not found');

      const data = {};
      if (args.year !== undefined) data.year = args.year;
      if (args.effectiveFrom !== undefined) data.effectiveFrom = args.effectiveFrom;
      if (args.effectiveTo !== undefined) data.effectiveTo = args.effectiveTo;
      if (args.ocrLicensePlate !== undefined) data.ocrLicensePlate = args.ocrLicensePlate;
      if (args.ocrYear !== undefined) data.ocrYear = args.ocrYear;
      if (args.ocrExpiresOn !== undefined) data.ocrExpiresOn = args.ocrExpiresOn;
      if (args.notes !== undefined) data.notes = args.notes;

      return context.prisma.vehicleLicense.update({
        where: { id },
        data,
      });
    },

    deleteVehicleLicense: async (_, { id }, context) => {
      ensureAdmin(context);
      const licenseId = Number(id);
      const existing = await context.prisma.vehicleLicense.findUnique({
        where: { id: licenseId },
      });
      if (!existing) throw new GraphQLError('Vehicle license not found');

      // TODO: also delete the underlying blob via deleteAttachmentBlob({
      //   blobName: existing.blobName, containerName: existing.containerName,
      // }) — left as a follow-up so we don't lose the file if the DB delete
      // succeeds but blob delete fails partway.
      await context.prisma.vehicleLicense.delete({ where: { id: licenseId } });
      return true;
    },

    deleteVehicle: async (_, { id }, context) => {
      requireAuth(context);
      const vehicleId = Number(id);

      const [usageCount, reservationCount] = await Promise.all([
        context.prisma.vehicleUsage.count({ where: { vehicleId } }),
        context.prisma.reservation.count({ where: { vehicleId } }),
      ]);

      if (usageCount > 0 || reservationCount > 0) {
        throw new GraphQLError(
          'Cannot delete vehicle: trip history exists.',
          {
            extensions: {
              code: 'VEHICLE_HAS_REFERENCES',
              http: { status: 409 },
              usageCount,
              reservationCount,
              suggestion:
                'Mark the vehicle as OUT_OF_SERVICE to retire it without losing history.',
            },
          },
        );
      }

      return context.prisma.vehicle.delete({
        where: { id: vehicleId },
      });
    },
  },
};

module.exports = vehicleResolvers;
