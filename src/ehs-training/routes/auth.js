const { Router } = require('express');
const jwt = require('jsonwebtoken');
const { usersRepo } = require('../db');
const { config, isAdminEmail } = require('../config');
const { verifyEntraIdToken } = require('../auth/verifyEntraToken');

const router = Router();

async function upsertUser({ email, name, jobTitle, department }) {
  return usersRepo.upsert({
    email,
    name,
    jobTitle: jobTitle || null,
    department: department || null,
    isAdmin: isAdminEmail(email),
  });
}

function issueSessionToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, isAdmin: !!user.isAdmin }, config.sessionSecret, {
    expiresIn: '8h',
  });
}

function sanitize(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    jobTitle: user.jobTitle,
    department: user.department,
    isAdmin: !!user.isAdmin,
  };
}

// POST /api/ehs-training/auth/session
// Body en modo mock:  { profile: { email, name, jobTitle, department } }
// Body en modo real:  { idToken, profile: { jobTitle, department } }  (profile complementa
//                      campos que el ID token normalmente no trae, p.ej. jobTitle/department;
//                      el email/nombre autoritativo siempre sale del token verificado, nunca del body).
router.post('/session', async (req, res) => {
  try {
    if (config.mockAuth) {
      const { profile } = req.body || {};
      if (!profile?.email) {
        return res.status(400).json({ error: 'Falta profile.email en modo mock' });
      }
      const user = await upsertUser({
        email: profile.email.toLowerCase(),
        name: profile.name || profile.email,
        jobTitle: profile.jobTitle,
        department: profile.department,
      });
      return res.json({ token: issueSessionToken(user), user: sanitize(user) });
    }

    const { idToken, profile } = req.body || {};
    if (!idToken) return res.status(400).json({ error: 'Falta idToken' });

    const decoded = await verifyEntraIdToken(idToken);
    const email = (decoded.preferred_username || decoded.email || '').toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'El token de Microsoft no trae un correo utilizable' });
    }

    const user = await upsertUser({
      email,
      name: decoded.name || email,
      jobTitle: profile?.jobTitle,
      department: profile?.department,
    });

    return res.json({ token: issueSessionToken(user), user: sanitize(user) });
  } catch (err) {
    console.error('Error validando sesion de ehs-training:', err.message);
    return res.status(401).json({ error: 'No se pudo validar la sesion de Microsoft 365' });
  }
});

module.exports = router;
