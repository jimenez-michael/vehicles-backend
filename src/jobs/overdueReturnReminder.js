const cron = require('node-cron');
const dayjs = require('dayjs');

/**
 * Daily job at 8:00 AM that finds trips still open after 24 hours and sends
 * a return reminder to the driver and admin recipients.
 *
 * Uses a 24–48h pickup window so each trip receives exactly one automated
 * reminder without needing a dedicated DB column to track sends.
 */
function scheduleOverdueReturnReminder(prisma) {
  cron.schedule('0 8 * * *', async () => {
    console.log('[overdueReturnReminder] Checking for overdue trips...');
    try {
      const { sendReturnReminderEmail } = require('../utils/sendReturnReminderEmail');

      const now = dayjs();
      const windowEnd = now.subtract(24, 'hour').toDate();
      const windowStart = now.subtract(48, 'hour').toDate();

      const overdueTrips = await prisma.vehicleUsage.findMany({
        where: {
          status: 'IN_USE',
          pickupDate: { gte: windowStart, lte: windowEnd },
        },
        include: { vehicle: true },
      });

      console.log(`[overdueReturnReminder] Found ${overdueTrips.length} overdue trip(s)`);

      for (const trip of overdueTrips) {
        await sendReturnReminderEmail(trip, trip.vehicle).catch((err) =>
          console.error(
            `[overdueReturnReminder] Failed for usage ${trip.id}:`,
            err.message || err,
          ),
        );
      }
    } catch (err) {
      console.error('[overdueReturnReminder] Job failed:', err.message || err);
    }
  });

  console.log('⏰ Overdue return reminder scheduled (daily at 8:00 AM)');
}

module.exports = { scheduleOverdueReturnReminder };
