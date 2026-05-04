/**
 * License OCR service — Claude Vision-backed extraction of structured fields
 * from driver license / vehicle registration images uploaded to Blob Storage.
 *
 * Callers pass a blob reference (already uploaded via the existing SAS-upload
 * flow) plus its content type. We pull the bytes from Blob Storage, hand them
 * to Claude as a vision input, and parse the model's JSON response.
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY                       (warned at load, thrown at call)
 *   ANTHROPIC_LICENSE_OCR_MODEL             (optional; default below)
 */

const Anthropic = require('@anthropic-ai/sdk');
const { getBlobBytes } = require('./azure-blob');

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MODEL = process.env.ANTHROPIC_LICENSE_OCR_MODEL || DEFAULT_MODEL;
const API_KEY = process.env.ANTHROPIC_API_KEY;

if (!API_KEY) {
  // Don't crash at boot — backend should still come up without this key set.
  // We throw at call time instead.
  // eslint-disable-next-line no-console
  console.warn(
    '[license-ocr] ANTHROPIC_API_KEY is not set. License OCR endpoints will fail until configured.',
  );
}

let _client = null;
function getClient() {
  if (!API_KEY) {
    throw new Error(
      '[license-ocr] ANTHROPIC_API_KEY is not set; cannot call Claude.',
    );
  }
  if (!_client) {
    _client = new Anthropic({ apiKey: API_KEY });
  }
  return _client;
}

// ---------- helpers ----------

/**
 * Map a blob's content-type to one of the media types Claude vision accepts.
 * Returns null if unsupported.
 */
function normalizeMediaType(contentType) {
  if (!contentType || typeof contentType !== 'string') return null;
  const ct = contentType.toLowerCase().split(';')[0].trim();
  switch (ct) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'image/jpeg';
    case 'image/png':
      return 'image/png';
    case 'image/gif':
      return 'image/gif';
    case 'image/webp':
      return 'image/webp';
    case 'application/pdf':
      return 'application/pdf';
    default:
      return null;
  }
}

/**
 * Pull Claude's response text out of a Messages API result. Concatenates all
 * text blocks; ignores tool_use / other non-text blocks.
 */
function extractText(message) {
  if (!message || !Array.isArray(message.content)) return '';
  return message.content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/**
 * Best-effort JSON parse — strip ```json fences, find the first {...} block.
 * Returns {} if nothing parseable is found (so callers can simply spread it).
 */
function parseJsonLoose(text) {
  if (!text) return {};
  let body = text.trim();

  // Strip ``` or ```json fences.
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) body = fence[1].trim();

  // If the response has prose around the JSON, grab the first balanced object.
  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    body = body.slice(first, last + 1);
  }

  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Parse YYYY-MM-DD (or other Date-acceptable strings) into a Date. Returns
 * null on bad input. We anchor the date at UTC midnight to avoid TZ drift.
 */
function parseDateOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return null;

  // Prefer the strict YYYY-MM-DD form the prompt asks for.
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [_, y, mo, d] = m;
    const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function trimOrUndefined(v) {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

function intOrUndefined(v) {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : undefined;
}

// ---------- Claude call ----------

async function callClaudeVision({ buffer, mediaType, systemPrompt, userText }) {
  const base64 = buffer.toString('base64');

  // PDFs use the 'document' content block; images use the 'image' block.
  const fileBlock =
    mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };

  let resp;
  try {
    resp = await getClient().messages.create({
      model: MODEL,
      max_tokens: 1024,
      temperature: 0,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [fileBlock, { type: 'text', text: userText }],
        },
      ],
    });
  } catch (err) {
    const detail = err && err.message ? err.message : String(err);
    throw new Error(`[license-ocr] Claude API call failed: ${detail}`);
  }

  return parseJsonLoose(extractText(resp));
}

// ---------- public API ----------

/**
 * Extract driver license fields from an uploaded image/PDF. All return fields
 * are optional — undefined when Claude can't read them confidently. Date
 * fields are Date | null (null = present but unparseable).
 *
 * @param {object} args
 * @param {string} args.blobName
 * @param {string} [args.containerName]
 * @param {string} args.contentType   MIME type of the uploaded file
 * @returns {Promise<{
 *   licenseNumber?: string,
 *   fullNameOnLicense?: string,
 *   dateOfBirth?: Date | null,
 *   expiresOn?: Date | null,
 *   licenseClass?: string,
 *   address?: string,
 * }>}
 */
async function extractDriverLicense({ blobName, containerName, contentType }) {
  if (!blobName) throw new Error('[license-ocr] blobName is required');
  if (!contentType) throw new Error('[license-ocr] contentType is required');

  const mediaType = normalizeMediaType(contentType);
  if (!mediaType) {
    throw new Error(
      `[license-ocr] Unsupported content type: ${contentType}. Expected image/jpeg, image/png, image/gif, image/webp, or application/pdf.`,
    );
  }

  const buffer = await getBlobBytes({ blobName, containerName });

  const systemPrompt = [
    'You are an OCR assistant processing a Puerto Rico driver license.',
    'Extract the following fields from the image, exactly as printed on the license:',
    '  - licenseNumber: the license/ID number',
    '  - fullNameOnLicense: the holder\'s full name as printed (one line)',
    '  - dateOfBirth: format YYYY-MM-DD',
    '  - expiresOn: expiration date, format YYYY-MM-DD',
    '  - licenseClass: e.g. "3", "Class B", "REAL ID"',
    '  - address: a single-line postal address as printed',
    '',
    'Respond with ONLY a JSON object inside a ```json code fence.',
    'Omit any field you cannot read confidently — DO NOT guess or hallucinate.',
    'If the image is not a driver license, respond with `{}`.',
  ].join('\n');

  const userText =
    'Extract the driver license fields from this image and return JSON.';

  const data = await callClaudeVision({
    buffer,
    mediaType,
    systemPrompt,
    userText,
  });

  const out = {};
  const licenseNumber = trimOrUndefined(data.licenseNumber);
  if (licenseNumber !== undefined) out.licenseNumber = licenseNumber;

  const fullNameOnLicense = trimOrUndefined(data.fullNameOnLicense);
  if (fullNameOnLicense !== undefined) out.fullNameOnLicense = fullNameOnLicense;

  if ('dateOfBirth' in data) {
    out.dateOfBirth = parseDateOrNull(data.dateOfBirth);
  }
  if ('expiresOn' in data) {
    out.expiresOn = parseDateOrNull(data.expiresOn);
  }

  const licenseClass = trimOrUndefined(data.licenseClass);
  if (licenseClass !== undefined) out.licenseClass = licenseClass;

  const address = trimOrUndefined(data.address);
  if (address !== undefined) out.address = address;

  return out;
}

/**
 * Extract vehicle license / registration fields from an uploaded image/PDF.
 *
 * @param {object} args
 * @param {string} args.blobName
 * @param {string} [args.containerName]
 * @param {string} args.contentType
 * @returns {Promise<{
 *   ocrLicensePlate?: string,
 *   ocrYear?: number,
 *   ocrExpiresOn?: Date | null,
 * }>}
 */
async function extractVehicleLicense({ blobName, containerName, contentType }) {
  if (!blobName) throw new Error('[license-ocr] blobName is required');
  if (!contentType) throw new Error('[license-ocr] contentType is required');

  const mediaType = normalizeMediaType(contentType);
  if (!mediaType) {
    throw new Error(
      `[license-ocr] Unsupported content type: ${contentType}. Expected image/jpeg, image/png, image/gif, image/webp, or application/pdf.`,
    );
  }

  const buffer = await getBlobBytes({ blobName, containerName });

  const systemPrompt = [
    'You are an OCR assistant processing a Puerto Rico vehicle license / registration ("marbete" / vehicle registration card).',
    'Extract the following fields exactly as printed:',
    '  - ocrLicensePlate: the vehicle plate/tag number (uppercase, no spaces)',
    '  - ocrYear: model year of the vehicle, as an integer (e.g. 2019)',
    '  - ocrExpiresOn: registration expiration date, format YYYY-MM-DD',
    '',
    'Respond with ONLY a JSON object inside a ```json code fence.',
    'Omit any field you cannot read confidently — DO NOT guess or hallucinate.',
    'If the image is not a vehicle registration, respond with `{}`.',
  ].join('\n');

  const userText =
    'Extract the vehicle registration fields from this image and return JSON.';

  const data = await callClaudeVision({
    buffer,
    mediaType,
    systemPrompt,
    userText,
  });

  const out = {};
  const plate = trimOrUndefined(data.ocrLicensePlate);
  if (plate !== undefined) out.ocrLicensePlate = plate.toUpperCase();

  const year = intOrUndefined(data.ocrYear);
  if (year !== undefined) out.ocrYear = year;

  if ('ocrExpiresOn' in data) {
    out.ocrExpiresOn = parseDateOrNull(data.ocrExpiresOn);
  }

  return out;
}

module.exports = { extractDriverLicense, extractVehicleLicense };
