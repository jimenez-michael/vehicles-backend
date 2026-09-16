const { Router } = require('express');
const { trainingsRepo, reservationsRepo, usersRepo } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { requireAdmin } = require('../middleware/requireAdmin');

const router = Router();

async function toDto(t) {
  const reserved = await reservationsRepo.countConfirmed(t.id);
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    location: t.location,
    startAt: t.startAt,
    endAt: t.endAt,
    capacity: t.capacity,
    reserved,
    seatsLeft: Math.max(t.capacity - reserved, 0),
  };
}

// GET /api/ehs-training/trainings - listado de proximos adiestramientos (empleado autenticado)
router.get('/', requireAuth, async (req, res) => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // incluye eventos de las ultimas 24h
  const all = await trainingsRepo.list();
  const rows = all.filter((t) => new Date(t.startAt).getTime() >= cutoff);
  res.json(await Promise.all(rows.map(toDto)));
});

router.get('/:id', requireAuth, async (req, res) => {
  const t = await trainingsRepo.findById(req.params.id);
  if (!t) return res.status(404).json({ error: 'Adiestramiento no encontrado' });
  res.json(await toDto(t));
});

// ---- Administracion de fechas (solo admin) ----

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { title, description, location, startAt, endAt, capacity } = req.body || {};
  if (!title || !startAt) {
    return res.status(400).json({ error: 'title y startAt son requeridos' });
  }
  const training = await trainingsRepo.create({
    title,
    description,
    location,
    startAt,
    endAt,
    capacity,
    createdBy: req.user.email,
  });
  res.status(201).json(await toDto(training));
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const existing = await trainingsRepo.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Adiestramiento no encontrado' });
  const { title, description, location, startAt, endAt, capacity } = req.body || {};
  const updated = await trainingsRepo.update(req.params.id, {
    title: title ?? existing.title,
    description: description ?? existing.description,
    location: location ?? existing.location,
    startAt: startAt ?? existing.startAt,
    endAt: endAt ?? existing.endAt,
    capacity: capacity ? Number(capacity) : existing.capacity,
  });
  res.json(await toDto(updated));
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  await trainingsRepo.remove(req.params.id);
  res.status(204).end();
});

// GET /api/ehs-training/trainings/:id/reservations - lista de inscritos, base para el check-in
router.get('/:id/reservations', requireAuth, requireAdmin, async (req, res) => {
  const all = await reservationsRepo.listByTraining(req.params.id);
  const confirmed = all.filter((r) => r.status === 'confirmed');
  const rows = await Promise.all(
    confirmed.map(async (r) => {
      const user = await usersRepo.findById(r.userId);
      return {
        id: r.id,
        status: r.status,
        reserved_at: r.reservedAt,
        checked_in_at: r.checkedInAt,
        checked_in_by: r.checkedInBy,
        name: user?.name,
        email: user?.email,
        job_title: user?.jobTitle,
        department: user?.department,
      };
    }),
  );
  rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  res.json(rows);
});

module.exports = router;
