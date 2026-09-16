function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: 'Se requiere rol de administrador' });
  }
  next();
}

module.exports = { requireAdmin };
