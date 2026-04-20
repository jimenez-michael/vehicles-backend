const dayjs = require('dayjs');
const { createAppGraphClient } = require('./graphAppClient');

/**
 * Send a force-close notification to admins (via IncidentNotificationRecipient)
 * and always CC the abandoning user whose trip was closed.
 * Sent from the actor (the new driver who triggered the force-close).
 */
async function sendForceCloseEmail({ abandonedUsage, vehicle, actor }) {
  const prisma = require('../config/prisma');

  if (!actor?.email) {
    console.log('[sendForceCloseEmail] No actor email — skipping email');
    return;
  }

  const allRecipients = await prisma.incidentNotificationRecipient.findMany();

  // Same domain gating as incident email: PR Vector Control actors notify everyone;
  // other actors must NOT notify prvectorcontrol.org admins.
  const actorIsVectorControl = (actor.email || '')
    .toLowerCase()
    .endsWith('@prvectorcontrol.org');
  const adminRecipients = actorIsVectorControl
    ? allRecipients
    : allRecipients.filter(
        (r) => !(r.userEmail || '').toLowerCase().endsWith('@prvectorcontrol.org'),
      );

  // Always include the abandoning user (dedup against admin list by email).
  const adminEmails = new Set(
    adminRecipients.map((r) => (r.userEmail || '').toLowerCase()),
  );
  const abandonerEmail = abandonedUsage?.userEmail;
  const includeAbandoner =
    abandonerEmail && !adminEmails.has(abandonerEmail.toLowerCase());

  const toRecipients = [
    ...adminRecipients.map((r) => ({
      emailAddress: { address: r.userEmail, name: r.userName },
    })),
    ...(includeAbandoner
      ? [
          {
            emailAddress: {
              address: abandonerEmail,
              name: abandonedUsage.userName || abandonerEmail,
            },
          },
        ]
      : []),
  ];

  if (toRecipients.length === 0) {
    console.log('[sendForceCloseEmail] No eligible recipients — skipping email');
    return;
  }

  const vehicleLabel = vehicle
    ? `${vehicle.vehicleNumber} (${vehicle.licensePlate})`
    : 'Unknown Vehicle';
  const pickupDate = dayjs(abandonedUsage.pickupDate).format('MMM D, YYYY — h:mm A');
  const closedAt = dayjs().format('MMM D, YYYY — h:mm A');

  const message = {
    subject: `Vehicle Trip Force-Closed — ${vehicleLabel}`,
    body: {
      contentType: 'HTML',
      content: `
        <h2>Vehicle Trip Force-Closed</h2>
        <p>A vehicle was picked up but never returned. The next driver force-closed the open trip in order to use the vehicle.</p>
        <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Vehicle</td><td style="padding:4px 0;font-weight:600;">${vehicleLabel}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Original Driver</td><td style="padding:4px 0;">${abandonedUsage.userName} (${abandonedUsage.userEmail})</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Picked Up</td><td style="padding:4px 0;">${pickupDate}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Pickup Mileage</td><td style="padding:4px 0;">${abandonedUsage.pickupMileage ?? '—'}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Force-Closed By</td><td style="padding:4px 0;">${actor.name || actor.email} (${actor.email})</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Closed At</td><td style="padding:4px 0;">${closedAt}</td></tr>
        </table>
        <p style="margin-top:12px;color:#666;">The closed trip has no return mileage, inspection, or incident data. Please follow up with the original driver to confirm vehicle condition.</p>
      `,
    },
    toRecipients,
  };

  try {
    const client = createAppGraphClient();
    await client
      .api(`/users/${actor.email}/sendMail`)
      .post({ message, saveToSentItems: false });
    console.log(
      `[sendForceCloseEmail] Sent from ${actor.email} to ${toRecipients.length} recipient(s)`,
    );
  } catch (err) {
    console.error('[sendForceCloseEmail] Failed to send:', err.message || err);
  }
}

module.exports = { sendForceCloseEmail };