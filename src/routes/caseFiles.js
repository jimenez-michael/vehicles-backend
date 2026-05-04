/**
 * REST endpoint that streams a zip of every file related to one incident
 * (VehicleUsage record): the accident form, the trust vehicle's most recent
 * license, the driver's license, third-party licenses, photos, etc.
 *
 * Auth: JWT (already enforced globally by checkJwt). The user must own the
 * record OR have the `Admin` role.
 *
 * Mounted from `index.js`:
 *   registerCaseFilesRoute(app, { prisma })
 *
 * Uses `archiver` (added in package.json) — run `npm install` once after
 * pulling these changes.
 */

const archiver = require('archiver');
const dayjs = require('dayjs');
const path = require('path');
const { getBlobBytes } = require('../services/azure-blob');

function getExtension(originalFileName, contentType) {
  const ext = path.extname(originalFileName || '');
  if (ext) return ext;
  if (!contentType) return '';
  if (contentType === 'application/pdf') return '.pdf';
  if (contentType === 'image/jpeg') return '.jpg';
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/heic') return '.heic';
  if (contentType === 'image/webp') return '.webp';
  return '';
}

function safeFileSegment(s, fallback = 'file') {
  return String(s ?? '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

function formatSummary(record, vehicle, latestLicense, driverLicense) {
  const lines = [];
  lines.push('Incident Case File Summary');
  lines.push('==========================');
  lines.push('');
  lines.push(`Usage ID:        ${record.id}`);
  lines.push(`Status:          ${record.status}`);
  lines.push('');
  lines.push('-- Vehicle --');
  lines.push(`Vehicle Number:  ${vehicle?.vehicleNumber || ''}`);
  lines.push(`License Plate:   ${vehicle?.licensePlate || ''}`);
  lines.push(`Make/Model/Year: ${[vehicle?.make, vehicle?.model, vehicle?.year].filter(Boolean).join(' ')}`);
  lines.push('');
  lines.push('-- Driver --');
  lines.push(`Name:            ${record.userName || ''}`);
  lines.push(`Email:           ${record.userEmail || ''}`);
  if (driverLicense) {
    lines.push(`License Number:  ${driverLicense.licenseNumber || ''}`);
    lines.push(`License Class:   ${driverLicense.licenseClass || ''}`);
    lines.push(`Expires On:      ${driverLicense.expiresOn ? dayjs(driverLicense.expiresOn).format('YYYY-MM-DD') : ''}`);
  }
  lines.push('');
  lines.push('-- Trip --');
  lines.push(`Pickup Date:     ${record.pickupDate ? dayjs(record.pickupDate).format('YYYY-MM-DD HH:mm') : ''}`);
  lines.push(`Pickup Mileage:  ${record.pickupMileage ?? ''}`);
  lines.push(`Return Date:     ${record.returnDate ? dayjs(record.returnDate).format('YYYY-MM-DD HH:mm') : ''}`);
  lines.push(`Return Mileage:  ${record.returnMileage ?? ''}`);
  lines.push('');
  lines.push('-- Incident --');
  lines.push(`Occurred:        ${record.incidentOccurred ? 'Yes' : 'No'}`);
  lines.push(`Description:     ${record.incidentDescription || ''}`);
  lines.push(`Police Report #: ${record.policeReportNumber || ''}`);
  lines.push(`Trust Driver:    ${record.trustDriverName || ''}`);
  lines.push('');
  lines.push('-- Third Party --');
  lines.push(`Name:            ${record.thirdPartyName || ''}`);
  lines.push(`Address:         ${record.thirdPartyAddress || ''}`);
  lines.push(`Phone:           ${record.thirdPartyPhone || ''}`);
  lines.push(`Vehicle:         ${[record.thirdPartyVehicleYear, record.thirdPartyVehicleModel].filter(Boolean).join(' ')}`);
  lines.push('');
  lines.push('-- Damage / Condition --');
  lines.push(`New Damage:      ${record.newDamage ? 'Yes' : 'No'}`);
  lines.push(`Description:     ${record.newDamageDesc || ''}`);
  lines.push('');
  if (latestLicense) {
    lines.push('-- Trust Vehicle License On File --');
    lines.push(`Year:            ${latestLicense.year}`);
    lines.push(`Plate (OCR):     ${latestLicense.ocrLicensePlate || ''}`);
    lines.push(`Expires (OCR):   ${latestLicense.ocrExpiresOn ? dayjs(latestLicense.ocrExpiresOn).format('YYYY-MM-DD') : ''}`);
  }
  return lines.join('\n');
}

const CATEGORY_FOLDER = {
  TRUST_VEHICLE_PHOTO: '05-Trust-Vehicle-Photos',
  IMPACT_AREA_PHOTO: '06-Impact-Area-Photos',
  OTHER: '07-Other',
};

function registerCaseFilesRoute(app, { prisma }) {
  app.get('/incidents/:usageId/case-files.zip', async (req, res) => {
    try {
      if (!req.auth) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const usageId = Number(req.params.usageId);
      if (!Number.isFinite(usageId)) {
        return res.status(400).json({ error: 'Invalid usage id' });
      }

      const record = await prisma.vehicleUsage.findUnique({
        where: { id: usageId },
        include: { vehicle: true, attachments: true },
      });
      if (!record) {
        return res.status(404).json({ error: 'Usage record not found' });
      }

      // Auth: same pattern as ensureOwnerOrAdmin.
      const userId = req.auth.oid || req.auth.sub;
      const roles = req.auth.roles || [];
      const isAdmin = roles.includes('Admin');
      if (record.userId !== userId && !isAdmin) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      // Pull supporting docs in parallel.
      const [latestLicense, driverLicense] = await Promise.all([
        prisma.vehicleLicense.findFirst({
          where: { vehicleId: record.vehicleId },
          orderBy: [{ effectiveTo: 'desc' }, { year: 'desc' }],
        }),
        prisma.userDriverLicense.findUnique({
          where: { principalId: record.userId },
        }),
      ]);

      const plate = safeFileSegment(record.vehicle?.licensePlate || 'vehicle');
      const dateStr = dayjs(record.pickupDate || record.createdAt || new Date()).format('YYYY-MM-DD');
      const caseFolder = `Case-${plate}-${record.id}-${dateStr}`;
      const zipFilename = `Case-${plate}-${record.id}.zip`;

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

      const archive = archiver('zip', { zlib: { level: 9 } });
      let errored = false;
      archive.on('warning', (err) => {
        if (err.code !== 'ENOENT') {
          console.error('[case-files.zip] archiver warning:', err);
        }
      });
      archive.on('error', (err) => {
        console.error('[case-files.zip] archiver error:', err);
        errored = true;
        if (!res.headersSent) {
          res.status(500).end();
        } else {
          res.end();
        }
      });
      archive.pipe(res);

      // 00 — Summary
      archive.append(
        formatSummary(record, record.vehicle, latestLicense, driverLicense),
        { name: `${caseFolder}/00-Summary.txt` },
      );

      // Helper: fetch a blob and append it; logs and skips on failure.
      const appendBlob = async ({ blobName, containerName, name, originalFileName, contentType }) => {
        try {
          const buf = await getBlobBytes({ blobName, containerName });
          const ext = name.includes('.') ? '' : getExtension(originalFileName, contentType);
          archive.append(buf, { name: `${caseFolder}/${name}${ext}` });
        } catch (err) {
          console.error(`[case-files.zip] failed to fetch blob ${blobName}:`, err.message || err);
          archive.append(
            `Failed to load attachment: ${originalFileName || blobName}\n${err.message || err}`,
            { name: `${caseFolder}/_errors/${safeFileSegment(originalFileName || blobName)}.txt` },
          );
        }
      };

      // 01 — Accident form (first ACCIDENT_FORM attachment, if any)
      const accidentForm = record.attachments.find((a) => a.category === 'ACCIDENT_FORM');
      if (accidentForm) {
        await appendBlob({
          blobName: accidentForm.blobName,
          containerName: accidentForm.containerName,
          originalFileName: accidentForm.originalFileName,
          contentType: accidentForm.contentType,
          name: '01-Accident-Form',
        });
      }

      // 02 — Trust vehicle license (most recent)
      if (latestLicense) {
        await appendBlob({
          blobName: latestLicense.blobName,
          containerName: latestLicense.containerName,
          originalFileName: latestLicense.originalFileName,
          contentType: latestLicense.contentType,
          name: `02-Trust-Vehicle-License-${latestLicense.year}`,
        });
      }

      // 03 — Driver's license on file
      if (driverLicense) {
        await appendBlob({
          blobName: driverLicense.blobName,
          containerName: driverLicense.containerName,
          originalFileName: driverLicense.originalFileName,
          contentType: driverLicense.contentType,
          name: '03-Driver-License',
        });
      }

      // 04 — Third-party licenses (numbered)
      const thirdPartyLicenses = record.attachments.filter((a) => a.category === 'THIRD_PARTY_LICENSE');
      for (let i = 0; i < thirdPartyLicenses.length; i += 1) {
        const a = thirdPartyLicenses[i];
        // eslint-disable-next-line no-await-in-loop
        await appendBlob({
          blobName: a.blobName,
          containerName: a.containerName,
          originalFileName: a.originalFileName,
          contentType: a.contentType,
          name: `04-Third-Party-License-${i + 1}`,
        });
      }

      // 05/06/07 — photos and other
      const photoBuckets = ['TRUST_VEHICLE_PHOTO', 'IMPACT_AREA_PHOTO', 'OTHER'];
      for (const cat of photoBuckets) {
        const bucket = record.attachments.filter((a) => a.category === cat);
        for (let i = 0; i < bucket.length; i += 1) {
          const a = bucket[i];
          const folder = CATEGORY_FOLDER[cat];
          const baseName = safeFileSegment(
            path.basename(a.originalFileName, path.extname(a.originalFileName || '')),
            `file-${i + 1}`,
          );
          const ext = getExtension(a.originalFileName, a.contentType);
          // eslint-disable-next-line no-await-in-loop
          await appendBlob({
            blobName: a.blobName,
            containerName: a.containerName,
            originalFileName: a.originalFileName,
            contentType: a.contentType,
            // include extension explicitly so appendBlob doesn't double-append
            name: `${folder}/${String(i + 1).padStart(2, '0')}-${baseName}${ext}`,
          });
        }
      }

      if (!errored) {
        await archive.finalize();
      }
    } catch (err) {
      console.error('[case-files.zip] fatal error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to build case files zip' });
      } else {
        res.end();
      }
    }
  });
}

module.exports = { registerCaseFilesRoute };
