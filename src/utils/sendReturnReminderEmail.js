const dayjs = require('dayjs');
const { createAppGraphClient } = require('./graphAppClient');

/**
 * Send an overdue return reminder to the driver and all eligible admin recipients.
 * Sent from the first configured admin recipient (system-originated, no actor).
 */
async function sendReturnReminderEmail(usage, vehicle) {
  const prisma = require('../config/prisma');

  if (!usage?.userEmail) {
    console.log('[sendReturnReminderEmail] No user email — skipping');
    return;
  }

  const allRecipients = await prisma.incidentNotificationRecipient.findMany();
  if (allRecipients.length === 0) {
    console.log('[sendReturnReminderEmail] No recipients configured — skipping');
    return;
  }

  // Domain gating: non-vector-control users must not notify @prvectorcontrol.org admins.
  const userIsVectorControl = (usage.userEmail || '')
    .toLowerCase()
    .endsWith('@prvectorcontrol.org');
  const adminRecipients = userIsVectorControl
    ? allRecipients
    : allRecipients.filter(
        (r) => !(r.userEmail || '').toLowerCase().endsWith('@prvectorcontrol.org'),
      );

  if (adminRecipients.length === 0) {
    console.log('[sendReturnReminderEmail] No eligible admin recipients — skipping');
    return;
  }

  // Send from the first admin recipient (system-originated email).
  const senderEmail = adminRecipients[0].userEmail;

  const vehicleLabel = vehicle
    ? `${vehicle.vehicleNumber} (${vehicle.licensePlate})`
    : 'Unknown Vehicle';
  const pickupDate = dayjs(usage.pickupDate).format('MMM D, YYYY — h:mm A');
  const hoursOut = Math.round(dayjs().diff(dayjs(usage.pickupDate), 'hour', true));

  const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  const returnUrl = vehicle
    ? `${frontendUrl}/vehicles/${vehicle.licensePlate}/return/${usage.id}`
    : null;

  // Driver gets the primary reminder; admins are CC'd (dedup by email).
  const driverEmailLower = usage.userEmail.toLowerCase();
  const toRecipients = [
    { emailAddress: { address: usage.userEmail, name: usage.userName || usage.userEmail } },
    ...adminRecipients
      .filter((r) => (r.userEmail || '').toLowerCase() !== driverEmailLower)
      .map((r) => ({ emailAddress: { address: r.userEmail, name: r.userName } })),
  ];

  const message = {
    subject: `⏰ Return Reminder — ${vehicleLabel}`,
    body: {
      contentType: 'HTML',
      content: `
        <h2>Vehicle Return Reminder</h2>
        <p>This vehicle has been checked out for <strong>${hoursOut} hours</strong> and has not been marked as returned. Please complete the return as soon as the vehicle is back.</p>
        <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Vehicle</td><td style="padding:4px 0;font-weight:600;">${vehicleLabel}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Driver</td><td style="padding:4px 0;">${usage.userName} (${usage.userEmail})</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Picked Up</td><td style="padding:4px 0;">${pickupDate}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Hours Out</td><td style="padding:4px 0;">${hoursOut}h</td></tr>
        </table>
        ${returnUrl ? `
        <p style="margin-top:16px;">
          <a href="${returnUrl}" style="display:inline-block;padding:8px 16px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:6px;font-family:sans-serif;font-size:14px;font-weight:600;">Complete Return</a>
        </p>` : ''}
      `,
    },
    toRecipients,
  };

  try {
    const client = createAppGraphClient();
    await client
      .api(`/users/${senderEmail}/sendMail`)
      .post({ message, saveToSentItems: false });
    console.log(
      `[sendReturnReminderEmail] Sent for usage ${usage.id} to ${toRecipients.length} recipient(s)`,
    );
  } catch (err) {
    console.error('[sendReturnReminderEmail] Failed to send:', err.message || err);
  }
}

module.exports = { sendReturnReminderEmail };
