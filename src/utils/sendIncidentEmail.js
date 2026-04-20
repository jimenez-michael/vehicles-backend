const dayjs = require('dayjs');
const { createAppGraphClient } = require('./graphAppClient');

/**
 * Send incident notification email to all configured recipients via MS Graph.
 * Uses the application (client credentials) flow with Mail.Send permission.
 * The email is sent from the user who reported the incident.
 */
async function sendIncidentEmail(usage, vehicle) {
  // Lazy-import prisma to avoid circular deps
  const prisma = require('../config/prisma');

  const allRecipients = await prisma.incidentNotificationRecipient.findMany();
  if (allRecipients.length === 0) {
    console.log('[sendIncidentEmail] No recipients configured — skipping email');
    return;
  }

  // Domain gating: PR Vector Control reporters notify everyone;
  // all other reporters (e.g. prsciencetrust.org) must NOT notify prvectorcontrol.org recipients.
  const reporterIsVectorControl = (usage.userEmail || '')
    .toLowerCase()
    .endsWith('@prvectorcontrol.org');
  const recipients = reporterIsVectorControl
    ? allRecipients
    : allRecipients.filter(
        (r) => !(r.userEmail || '').toLowerCase().endsWith('@prvectorcontrol.org'),
      );

  if (recipients.length === 0) {
    console.log(
      `[sendIncidentEmail] No eligible recipients for reporter ${usage.userEmail} — skipping email`,
    );
    return;
  }

  const vehicleLabel = vehicle
    ? `${vehicle.vehicleNumber} (${vehicle.licensePlate})`
    : 'Unknown Vehicle';

  const date = dayjs(usage.returnDate).format('MMM D, YYYY — h:mm A');

  const message = {
    subject: `⚠️ Vehicle Incident Report — ${vehicleLabel}`,
    body: {
      contentType: 'HTML',
      content: `
        <h2>Vehicle Incident Report</h2>
        <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Vehicle</td><td style="padding:4px 0;font-weight:600;">${vehicleLabel}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Reported By</td><td style="padding:4px 0;">${usage.userName} (${usage.userEmail})</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Date</td><td style="padding:4px 0;">${date}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Description</td><td style="padding:4px 0;">${usage.incidentDescription || 'No description provided'}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">New Damage</td><td style="padding:4px 0;">${usage.newDamage ? 'Yes' : 'No'}${usage.newDamageDesc ? ' — ' + usage.newDamageDesc : ''}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Interior OK</td><td style="padding:4px 0;">${usage.interiorConditionOk ? 'Yes' : 'No'}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Properly Parked</td><td style="padding:4px 0;">${usage.properlyParked ? 'Yes' : 'No'}</td></tr>
        </table>
        ${usage.returnObservations ? `<p style="margin-top:12px;color:#666;"><strong>Observations:</strong> ${usage.returnObservations}</p>` : ''}
      `,
    },
    toRecipients: recipients.map((r) => ({
      emailAddress: { address: r.userEmail, name: r.userName },
    })),
  };

  try {
    const client = createAppGraphClient();
    await client
      .api(`/users/${usage.userEmail}/sendMail`)
      .post({ message, saveToSentItems: false });
    console.log(
      `[sendIncidentEmail] Sent from ${usage.userEmail} to ${recipients.length} recipient(s)`,
    );
  } catch (err) {
    // Log but don't throw — email failure shouldn't block the return mutation
    console.error('[sendIncidentEmail] Failed to send:', err.message || err);
  }
}

module.exports = { sendIncidentEmail };
