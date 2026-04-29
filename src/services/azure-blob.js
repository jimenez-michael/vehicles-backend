/**
 * Azure Blob Storage service — SAS URL issuance for incident attachments.
 *
 * Issues short-lived SAS URLs so the browser can PUT files directly to Blob
 * Storage and later GET them back for preview/download, without proxying
 * binary data through the API.
 *
 * ---------------------------------------------------------------------------
 * One-time CORS setup (required, otherwise browser PUT will be blocked):
 *
 *   az storage cors add \
 *     --services b \
 *     --methods GET PUT \
 *     --origins "<frontend origin>" \
 *     --allowed-headers "*" \
 *     --exposed-headers "*" \
 *     --max-age 3600 \
 *     --account-name <account>
 *
 * Run once per storage account. Repeat with each frontend origin you need to
 * support (e.g. http://localhost:5173, https://vehicles.prsciencetrust.org).
 * ---------------------------------------------------------------------------
 *
 * Required env vars (validated at module load):
 *   AZURE_STORAGE_ACCOUNT_NAME
 *   AZURE_STORAGE_ACCOUNT_KEY
 *   AZURE_STORAGE_INCIDENT_CONTAINER         (default: incident-attachments)
 *   AZURE_STORAGE_SAS_UPLOAD_TTL_MINUTES     (default: 15)
 *   AZURE_STORAGE_SAS_READ_TTL_MINUTES       (default: 60)
 */

const { randomUUID } = require('crypto');
const {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol,
} = require('@azure/storage-blob');

// ---------- env validation ----------
const ACCOUNT_NAME = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const ACCOUNT_KEY = process.env.AZURE_STORAGE_ACCOUNT_KEY;
const DEFAULT_CONTAINER =
  process.env.AZURE_STORAGE_INCIDENT_CONTAINER || 'incident-attachments';
const UPLOAD_TTL_MINUTES = Number(
  process.env.AZURE_STORAGE_SAS_UPLOAD_TTL_MINUTES || 15,
);
const READ_TTL_MINUTES = Number(
  process.env.AZURE_STORAGE_SAS_READ_TTL_MINUTES || 60,
);

if (!ACCOUNT_NAME || !ACCOUNT_KEY) {
  throw new Error(
    '[azure-blob] Missing required env vars: AZURE_STORAGE_ACCOUNT_NAME and/or AZURE_STORAGE_ACCOUNT_KEY are not set.',
  );
}
if (!Number.isFinite(UPLOAD_TTL_MINUTES) || UPLOAD_TTL_MINUTES <= 0) {
  throw new Error(
    '[azure-blob] AZURE_STORAGE_SAS_UPLOAD_TTL_MINUTES must be a positive number.',
  );
}
if (!Number.isFinite(READ_TTL_MINUTES) || READ_TTL_MINUTES <= 0) {
  throw new Error(
    '[azure-blob] AZURE_STORAGE_SAS_READ_TTL_MINUTES must be a positive number.',
  );
}

// ---------- shared client ----------
const sharedKeyCredential = new StorageSharedKeyCredential(
  ACCOUNT_NAME,
  ACCOUNT_KEY,
);
const blobServiceClient = new BlobServiceClient(
  `https://${ACCOUNT_NAME}.blob.core.windows.net`,
  sharedKeyCredential,
);

// ---------- helpers ----------
/**
 * Sanitize a user-provided filename so it is safe to use as part of a blob
 * name. Strips any path separators, control chars, and trims whitespace,
 * while preserving the file extension.
 */
function sanitizeFileName(originalFileName) {
  if (!originalFileName || typeof originalFileName !== 'string') {
    return 'file';
  }
  // Take just the basename — strip any directory components.
  const base = originalFileName.replace(/^.*[\\/]/, '');
  // Replace anything that's not alphanumeric, dot, dash, underscore.
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim();
  return cleaned || 'file';
}

function sanitizeSegment(segment, fallback) {
  const s = String(segment ?? '').replace(/[^A-Za-z0-9._-]+/g, '-');
  return s || fallback;
}

function minutesFromNow(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

// ---------- public API ----------

/**
 * Generate a short-lived SAS URL the browser PUTs the file to directly.
 *
 * Blob name pattern: `${usageId}/${category}/${uuid}-${sanitizedFilename}`
 *
 * @param {object} args
 * @param {string|number} args.usageId         VehicleUsage record id
 * @param {string} args.category               e.g. 'photo', 'document', 'damage'
 * @param {string} args.originalFileName       Original filename from the user
 * @param {string} [args.contentType]          MIME type (informational; client
 *                                             must set Content-Type header on PUT)
 * @returns {Promise<{ uploadUrl: string, blobName: string, containerName: string, expiresAt: Date }>}
 */
async function generateAttachmentUploadSas({
  usageId,
  category,
  originalFileName,
  contentType,
}) {
  if (usageId === undefined || usageId === null || usageId === '') {
    throw new Error('[azure-blob] usageId is required');
  }
  if (!category) {
    throw new Error('[azure-blob] category is required');
  }

  const containerName = DEFAULT_CONTAINER;
  const safeUsage = sanitizeSegment(usageId, 'usage');
  const safeCategory = sanitizeSegment(category, 'misc');
  const safeFile = sanitizeFileName(originalFileName);
  const blobName = `${safeUsage}/${safeCategory}/${randomUUID()}-${safeFile}`;

  const expiresAt = minutesFromNow(UPLOAD_TTL_MINUTES);
  // Allow ~5 min of clock skew on the start time.
  const startsOn = new Date(Date.now() - 5 * 60 * 1000);

  const sas = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse('cw'),
      startsOn,
      expiresOn: expiresAt,
      protocol: SASProtocol.Https,
      contentType: contentType || undefined,
    },
    sharedKeyCredential,
  ).toString();

  const uploadUrl = `${blobServiceClient.url}${containerName}/${encodeURI(blobName)}?${sas}`;

  return { uploadUrl, blobName, containerName, expiresAt };
}

/**
 * Generate a short-lived read SAS URL for downloading/previewing an attachment.
 *
 * @param {object} args
 * @param {string} args.blobName
 * @param {string} [args.containerName]   defaults to AZURE_STORAGE_INCIDENT_CONTAINER
 * @returns {Promise<string>} full URL with read SAS token
 */
async function generateAttachmentReadSas({ blobName, containerName }) {
  if (!blobName) {
    throw new Error('[azure-blob] blobName is required');
  }
  const container = containerName || DEFAULT_CONTAINER;
  const expiresOn = minutesFromNow(READ_TTL_MINUTES);
  const startsOn = new Date(Date.now() - 5 * 60 * 1000);

  const sas = generateBlobSASQueryParameters(
    {
      containerName: container,
      blobName,
      permissions: BlobSASPermissions.parse('r'),
      startsOn,
      expiresOn,
      protocol: SASProtocol.Https,
    },
    sharedKeyCredential,
  ).toString();

  return `${blobServiceClient.url}${container}/${encodeURI(blobName)}?${sas}`;
}

/**
 * Delete an attachment blob. Used by deleteIncidentAttachment.
 * Resolves true if the blob was deleted, false if it did not exist.
 *
 * @param {object} args
 * @param {string} args.blobName
 * @param {string} [args.containerName]
 * @returns {Promise<boolean>}
 */
async function deleteAttachmentBlob({ blobName, containerName }) {
  if (!blobName) {
    throw new Error('[azure-blob] blobName is required');
  }
  const container = containerName || DEFAULT_CONTAINER;
  const containerClient = blobServiceClient.getContainerClient(container);
  const blockBlob = containerClient.getBlockBlobClient(blobName);
  const result = await blockBlob.deleteIfExists();
  return Boolean(result.succeeded);
}

module.exports = {
  generateAttachmentUploadSas,
  generateAttachmentReadSas,
  deleteAttachmentBlob,
};
