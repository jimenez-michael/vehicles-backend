const dayjs = require('dayjs');
const { createAppGraphClient } = require('./graphAppClient');

/**
 * Notify the driver that their overnight reservation was approved or rejected.
 */
async function sendOvernightApprovalDecisionEmail(reservation) {
  const sender = reservation.approvedByEmail;

  if (!sender) {
    console.error(
      '[sendOvernightApprovalDecisionEmail] reservation has no approvedByEmail; skipping email',
    );
    return;
  }

  const approved = reservation.status === 'CONFIRMED';
  const vehicle = reservation.vehicle;
  const vehicleLabel = vehicle
    ? `${vehicle.year} ${vehicle.make} ${vehicle.model} — ${vehicle.licensePlate}`
    : 'Unknown Vehicle';

  const startDate = dayjs(reservation.startDate).format('MMM D, YYYY — h:mm A');
  const endDate = dayjs(reservation.endDate).format('MMM D, YYYY — h:mm A');

  const headline = approved
    ? 'Your overnight reservation was approved'
    : 'Your overnight reservation was rejected';

  const banner = approved
    ? '<div style="background:#ecfdf5;border-left:4px solid #059669;padding:12px 16px;font-family:sans-serif;font-size:14px;"><strong>Approved</strong> — you are cleared to keep the vehicle overnight for this trip.</div>'
    : '<div style="background:#fef2f2;border-left:4px solid #dc2626;padding:12px 16px;font-family:sans-serif;font-size:14px;"><strong>Rejected</strong> — this reservation has not been approved.</div>';

  const notesHtml = reservation.approvalDecisionNotes
    ? `<h3 style="margin-top:20px;">Decision notes</h3><div style="background:#f6f6f6;padding:12px 16px;font-family:sans-serif;font-size:14px;">${escapeHtml(reservation.approvalDecisionNotes)}</div>`
    : '';

  const message = {
    subject: `${headline} — ${vehicleLabel}`,
    body: {
      contentType: 'HTML',
      content: `
        <h2>${headline}</h2>
        ${banner}
        <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;margin-top:12px;">
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Vehicle</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(vehicleLabel)}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Start</td><td style="padding:4px 0;">${startDate}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">End</td><td style="padding:4px 0;">${endDate}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Decided by</td><td style="padding:4px 0;">${escapeHtml(reservation.approvedByName || '')} &lt;${escapeHtml(reservation.approvedByEmail || '')}&gt;</td></tr>
        </table>
        ${notesHtml}
      `,
    },
    toRecipients: [
      {
        emailAddress: {
          address: reservation.userEmail,
          name: reservation.userName,
        },
      },
    ],
  };

  try {
    const client = createAppGraphClient();
    await client
      .api(`/users/${sender}/sendMail`)
      .post({ message, saveToSentItems: false });
    console.log(
      `[sendOvernightApprovalDecisionEmail] Sent ${reservation.status} notice to ${reservation.userEmail} from ${sender}`,
    );
  } catch (err) {
    console.error(
      '[sendOvernightApprovalDecisionEmail] Failed to send:',
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

module.exports = { sendOvernightApprovalDecisionEmail };
