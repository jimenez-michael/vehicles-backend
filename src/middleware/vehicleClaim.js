// src/middleware/vehicleClaim.js
const {
  VECTOR_CONTROL_EMAIL_DOMAIN,
  VECTOR_CONTROL_PROGRAM,
} = require('./adminScope');

// Same grace window the pickup screen uses, so the UI and the API agree on
// who is "next in line" for a vehicle.
const RESERVATION_BUFFER_MINUTES = 30;

// True when the caller is the driver who is next in line for this vehicle:
// either they hold a confirmed reservation covering now (with the same 30-min
// grace as the pickup screen), or it is a Vector Control vehicle and they are
// a Vector Control user — those are assigned daily, without reservations.
async function mayClaimVehicle(context, vehicle) {
  if (!vehicle) return false;

  const email = (context.user.preferred_username || '').toLowerCase();

  if (vehicle.program === VECTOR_CONTROL_PROGRAM) {
    return email.endsWith(VECTOR_CONTROL_EMAIL_DOMAIN);
  }

  const userId = context.user.oid || context.user.sub;
  if (!userId) return false;

  const buffer = RESERVATION_BUFFER_MINUTES * 60 * 1000;
  const now = Date.now();

  const reservation = await context.prisma.reservation.findFirst({
    where: {
      vehicleId: vehicle.id,
      userId,
      status: 'CONFIRMED',
      startDate: { lte: new Date(now + buffer) },
      endDate: { gte: new Date(now - buffer) },
    },
    select: { id: true },
  });

  return reservation !== null;
}

module.exports = {
  RESERVATION_BUFFER_MINUTES,
  mayClaimVehicle,
};
