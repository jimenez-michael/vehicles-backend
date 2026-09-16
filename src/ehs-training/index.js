const { Router } = require('express');
const { config } = require('./config');
const authRoutes = require('./routes/auth');
const trainingsRoutes = require('./routes/trainings');
const reservationsRoutes = require('./routes/reservations');

// Router aislado de la app EHS Training Reservations, montado en vehicles-backend bajo
// /api/ehs-training. Usa su propia sesion (EHS_SESSION_SECRET) en vez del checkJwt de
// Azure AD que protege el resto de este backend — se monta antes de ese middleware
// en index.js para no pasar por el.
const router = Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, mockAuth: config.mockAuth });
});

router.use('/auth', authRoutes);
router.use('/trainings', trainingsRoutes);
router.use('/', reservationsRoutes); // expone /me/reservations, /reservations/:id, /trainings/:id/reserve

module.exports = router;
