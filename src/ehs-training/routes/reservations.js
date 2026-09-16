const { Router } = require('express');
const { trainingsRepo, reservationsRepo } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { requireAdmin } = require('../middleware/requireAdmin');

const router = Router();

// GET /api/ehs-training/me/reservations - las reservaciones del empleado autenticado
router.get('/me/reservations', requireAuth, async (req, res) => {
  const all = await reservationsRepo.listByUser(req.user.id);
  const confirmed = all.filter((r) => r.status === 'confirmed');
  const rows = await Promise.all(
    confirmed.map(async (r) => {
      const training = await trainingsRepo.findById(r.trainingId);
      return {
        id: r.id,
        status: r.status,
        reserved_at: r.reservedAt,
        checked_in_at: r.checkedInAt,
        training_id: training?.id,
        title: training?.title,
        start_at: training?.startAt,
        end_at: training?.endAt,
        location: training?.location,
      };
    }),
  );
  rows.sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
  res.json(rows);
});

// POST /api/ehs-training/trainings/:id/reserve - el empleado reserva su cupo
router.post('/trainings/:id/reserve', requireAuth, async (req, res) => {
  const training = await trainingsRepo.findById(req.params.id);
  if (!training) return res.status(404).json({ error: 'Adiestramiento no encontrado' });

  const confirmedCount = await reservationsRepo.countConfirmed(training.id);
  if (confirmedCount >= training.capacity) {
    return res.status(409).json({ error: 'No quedan cupos disponibles' });
  }

  const existing = await reservationsRepo.findByTrainingAndUser(training.id, req.user.id);
  if (existing) {
    if (existing.status === 'confirmed') {
      return res.status(409).json({ error: 'Ya tienes una reservacion para este adiestramiento' });
    }
    await reservationsRepo.setStatus(existing.id, 'confirmed');
    return res.status(200).json({ id: existing.id });
  }

  const reservation = await reservationsRepo.create({ trainingId: training.id, userId: req.user.id });
  res.status(201).json({ id: reservation.id });
});

// DELETE /api/ehs-training/reservations/:id - cancelar mi propia reservacion
router.delete('/reservations/:id', requireAuth, async (req, res) => {
  const reservation = await reservationsRepo.findById(req.params.id);
  if (!reservation || reservation.userId !== req.user.id) {
    return res.status(404).json({ error: 'Reservacion no encontrada' });
  }
  await reservationsRepo.setStatus(req.params.id, 'cancelled');
  res.status(204).end();
});

// POST /api/ehs-training/reservations/:id/checkin - marcar asistencia (solo admin)
router.post('/reservations/:id/checkin', requireAuth, requireAdmin, async (req, res) => {
  const reservation = await reservationsRepo.checkin(req.params.id, req.user.email);
  if (!reservation) return res.status(404).json({ error: 'Reservacion no encontrada' });
  res.json({ ok: true });
});

// POST /api/ehs-training/reservations/:id/checkin/undo - revertir un check-in marcado por error
router.post('/reservations/:id/checkin/undo', requireAuth, requireAdmin, async (req, res) => {
  const reservation = await reservationsRepo.undoCheckin(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'Reservacion no encontrada' });
  res.json({ ok: true });
});

module.exports = router;
