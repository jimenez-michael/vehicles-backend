const { GraphQLError } = require('graphql');
const { requireAuth } = require('../../middleware/requireAuth');
const {
  generateAttachmentUploadSas,
  generateAttachmentReadSas,
} = require('../../services/azure-blob');

let extractDriverLicense;
try {
  ({ extractDriverLicense } = require('../../services/license-ocr'));
} catch (_err) {
  extractDriverLicense = null;
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

async function runOcrAndPersist(context, principalId, blobName, containerName) {
  if (!extractDriverLicense) return null;
  try {
    const ocr = await extractDriverLicense({ blobName, containerName });
    if (!ocr) return null;
    return context.prisma.userDriverLicense.update({
      where: { principalId },
      data: {
        licenseNumber: ocr.licenseNumber ?? null,
        fullNameOnLicense: ocr.fullNameOnLicense ?? null,
        dateOfBirth: ocr.dateOfBirth ?? null,
        expiresOn: ocr.expiresOn ?? null,
        licenseClass: ocr.licenseClass ?? null,
        address: ocr.address ?? null,
        ocrExtractedAt: new Date(),
      },
    });
  } catch (err) {
    console.error('[userDriverLicense] OCR failed:', err.message || err);
    return null;
  }
}

const userDriverLicenseResolvers = {
  Query: {
    userDriverLicense: async (_, { principalId }, context) => {
      ensureAdmin(context);
      return context.prisma.userDriverLicense.findUnique({
        where: { principalId },
      });
    },
  },

  Mutation: {
    requestDriverLicenseUpload: async (
      _,
      { principalId, originalFileName, contentType },
      context,
    ) => {
      ensureAdmin(context);
      // Slot driver license uploads under `user-{principalId}` / `license`
      // so they share the same blob naming convention as other attachments.
      const ticket = await generateAttachmentUploadSas({
        usageId: `user-${principalId}`,
        category: 'license',
        originalFileName,
        contentType,
      });
      return ticket;
    },

    confirmDriverLicenseUpload: async (
      _,
      {
        principalId,
        email,
        displayName,
        blobName,
        containerName,
        originalFileName,
        contentType,
        sizeBytes,
      },
      context,
    ) => {
      ensureAdmin(context);
      const uploaderId = context.user.oid || context.user.sub;
      const uploaderName = context.user.name || context.user.preferred_username || null;
      const uploaderEmail = context.user.preferred_username || null;

      const baseData = {
        email,
        displayName: displayName || null,
        blobName,
        containerName,
        originalFileName,
        contentType,
        sizeBytes,
        uploadedById: uploaderId,
        uploadedByName: uploaderName,
        uploadedByEmail: uploaderEmail,
        uploadedAt: new Date(),
      };

      await context.prisma.userDriverLicense.upsert({
        where: { principalId },
        create: { principalId, ...baseData },
        update: baseData,
      });

      const ocrUpdated = await runOcrAndPersist(
        context,
        principalId,
        blobName,
        containerName,
      );
      return (
        ocrUpdated ||
        (await context.prisma.userDriverLicense.findUnique({
          where: { principalId },
        }))
      );
    },

    updateUserDriverLicense: async (_, args, context) => {
      ensureAdmin(context);
      const existing = await context.prisma.userDriverLicense.findUnique({
        where: { principalId: args.principalId },
      });
      if (!existing) throw new GraphQLError('Driver license not found');

      const data = {};
      if (args.licenseNumber !== undefined) data.licenseNumber = args.licenseNumber;
      if (args.fullNameOnLicense !== undefined) data.fullNameOnLicense = args.fullNameOnLicense;
      if (args.dateOfBirth !== undefined) data.dateOfBirth = args.dateOfBirth;
      if (args.expiresOn !== undefined) data.expiresOn = args.expiresOn;
      if (args.licenseClass !== undefined) data.licenseClass = args.licenseClass;
      if (args.address !== undefined) data.address = args.address;

      return context.prisma.userDriverLicense.update({
        where: { principalId: args.principalId },
        data,
      });
    },

    deleteUserDriverLicense: async (_, { principalId }, context) => {
      ensureAdmin(context);
      const existing = await context.prisma.userDriverLicense.findUnique({
        where: { principalId },
      });
      if (!existing) throw new GraphQLError('Driver license not found');

      // TODO: also delete the underlying blob via deleteAttachmentBlob.
      await context.prisma.userDriverLicense.delete({
        where: { principalId },
      });
      return true;
    },

    extractDriverLicenseFields: async (_, { principalId }, context) => {
      ensureAdmin(context);
      const existing = await context.prisma.userDriverLicense.findUnique({
        where: { principalId },
      });
      if (!existing) throw new GraphQLError('Driver license not found');

      const updated = await runOcrAndPersist(
        context,
        principalId,
        existing.blobName,
        existing.containerName,
      );
      return updated || existing;
    },
  },

  UserDriverLicense: {
    downloadUrl: (parent) =>
      generateAttachmentReadSas({
        blobName: parent.blobName,
        containerName: parent.containerName,
      }),
  },
};

module.exports = userDriverLicenseResolvers;
