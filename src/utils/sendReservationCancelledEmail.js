const dayjs = require('dayjs');
const { createAppGraphClient } = require('./graphAppClient');

/**
 * Send cancellation notification email to the reservation owner.
 * Sent from the admin who cancelled it via MS Graph application flow.
 */
async function sendReservationCancelledEmail(reservation, cancelledByEmail) {
  const vehicle = reservation.vehicle;
  const vehicleLabel = vehicle
    ? `${vehicle.vehicleNumber} (${vehicle.licensePlate})`
    : 'Unknown Vehicle';

  const startDate = dayjs(reservation.startDate).format('MMM D, YYYY — h:mm A');
  const endDate = dayjs(reservation.endDate).format('h:mm A');

  const message = {
    subject: `Reservation Cancelled — ${vehicleLabel}`,
    body: {
      contentType: 'HTML',
      content: `
        <h2>Your Vehicle Reservation Has Been Cancelled</h2>
        <p>An administrator has cancelled your reservation. Details below:</p>
        <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Vehicle</td><td style="padding:4px 0;font-weight:600;">${vehicleLabel}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Date</td><td style="padding:4px 0;">${startDate} — ${endDate}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Purpose</td><td style="padding:4px 0;">${reservation.purpose || 'N/A'}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666;">Cancelled By</td><td style="padding:4px 0;">${cancelledByEmail}</td></tr>
        </table>
        <p style="margin-top:12px;color:#666;">If you believe this was done in error, please contact your administrator.</p>
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
      .api(`/users/${cancelledByEmail}/sendMail`)
      .post({ message, saveToSentItems: false });
    console.log(
      `[sendReservationCancelledEmail] Sent to ${reservation.userEmail} from ${cancelledByEmail}`,
    );
  } catch (err) {
    console.error('[sendReservationCancelledEmail] Failed to send:', err.message || err);
  }
}

module.exports = { sendReservationCancelledEmail };
