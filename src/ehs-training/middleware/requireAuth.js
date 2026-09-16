const jwt = require('jsonwebtoken');
const { config } = require('../config');
const { usersRepo } = require('../db');

// Todas las rutas protegidas de ehs-training usan el JWT de sesion propio emitido por
// POST /api/ehs-training/auth/session (no el checkJwt de Azure AD que usa el resto de
// vehicles-backend). Mismo mecanismo de autorizacion sin importar si el login fue mock o real.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });

  try {
    const decoded = jwt.verify(token, config.sessionSecret);
    const user = await usersRepo.findById(decoded.sub);
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesion invalida o expirada' });
  }
}

module.exports = { requireAuth };
