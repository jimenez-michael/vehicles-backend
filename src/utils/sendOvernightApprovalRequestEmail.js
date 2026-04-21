const dayjs = require('dayjs');
const { createAppGraphClient } = require('./graphAppClient');

/**
 * Send an approval-request email to every user with the `Approver` role
 * when a driver submits an overnight reservation.
 */
async function sendOvernightApprovalRequestEmail(reservation, prisma) {
  const sender = reservation.userEmail;
  const frontendUrl = process.env.FRONTEND_URL?.replace(/\/$/, '') || '';

  if (!sender) {
    console.error(
      '[sendOvernightApprovalRequestEmail] reservation has no userEmail; skipping email',
    );
    return;
  }

  const approverRoles = await prisma.appUserRole.findMany({
    where: { roleName: 'Approver' },
  });

  const recipients = approverRoles
    .map((r) => r.email)
    .filter((email) => !!email);

  const uniqueRecipients = Array.from(new Set(recipients));

  if (uniqueRecipients.length === 0) {
    console.warn(
      '[sendOvernightApprovalRequestEmail] No users with the Approver role were found',
    );
    return;
  }

  const vehicle = reservation.vehicle;
  const vehicleLabel = vehicle
    ? `${vehicle.year} ${vehicle.make} ${vehicle.model} — ${vehicle.licensePlate}`
    : 'Unknown Vehicle';

  const startDate = dayjs(reservation.startDate).format('MMM D, YYYY — h:mm A');
  const endDate = dayjs(reservation.endDate).format('MMM D, YYYY — h:mm A');
  const approvalLink = `${frontendUrl}/approvals/${reservation.id}`;

  const detailsHtml = (reservation.overnightDetails || '')
    .split('\n')
    .map((line) => `<p style="margin:0 0 6px 0;">${escapeHtml(line)}</p>`)
    .join('');

  const message = {
    subject: `Overnight Reservation — Approval Needed (${vehicleLabel})`,
    body: {
      contentType: 'HTML',
      content: `
        <h2>Overnight Reservation Requires Your Approval</h2>
        <p><strong>${escapeHtml(reservation.userName)}</strong> has requested an overnight reservation and needs approval before it is confirmed.</p>
        <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;margin-top:8px;">
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Driver</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(reservation.userName)} &lt;${escapeHtml(reservation.userEmail)}&gt;</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Vehicle</td><td style="padding:4px 0;">${escapeHtml(vehicleLabel)}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Start</td><td style="padding:4px 0;">${startDate}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">End</td><td style="padding:4px 0;">${endDate}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Purpose</td><td style="padding:4px 0;">${escapeHtml(reservation.purpose || 'N/A')}</td></tr>
        </table>
        <h3 style="margin-top:20px;">Overnight justification, security &amp; parking details</h3>
        <div style="background:#f6f6f6;border-left:4px solid #14b8a6;padding:12px 16px;font-family:sans-serif;font-size:14px;">
          ${detailsHtml || '<em>(none provided)</em>'}
        </div>
        <p style="margin-top:24px;">
          <a href="${approvalLink}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-family:sans-serif;font-size:14px;">Review &amp; decide</a>
        </p>
        <p style="color:#666;font-size:12px;margin-top:16px;">If the button doesn't work, paste this URL into your browser:<br/><a href="${approvalLink}">${approvalLink}</a></p>
      `,
    },
    toRecipients: uniqueRecipients.map((address) => ({
      emailAddress: { address },
    })),
  };

  try {
    const client = createAppGraphClient();
    await client
      .api(`/users/${sender}/sendMail`)
      .post({ message, saveToSentItems: false });
    console.log(
      `[sendOvernightApprovalRequestEmail] Sent to ${uniqueRecipients.length} approver(s) from ${sender} for reservation ${reservation.id}`,
    );
  } catch (err) {
    console.error(
      '[sendOvernightApprovalRequestEmail] Failed to send:',
      err.message || err,
    );
  }
}

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { sendOvernightApprovalRequestEmail };
