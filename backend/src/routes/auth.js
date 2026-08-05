const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ADMIN_USERNAME, ADMIN_PASSWORD, JWT_SECRET, JWT_TTL, NODE_ENV } = require('../config');
const { COOKIE_NAME, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Hash the configured password once at boot; the comparison below is then constant-time.
const ADMIN_HASH = bcrypt.hashSync(ADMIN_PASSWORD, 10);

/**
 * The committed default is not a password, and in production it must not open anything.
 *
 * index.js refuses to boot on it, but index.js does not run on Vercel — there the entrypoint
 * is app.js, so the check has to be on the request path to exist at all. Same lesson as
 * `insecure_secret` in middleware/access.js: a guard at a boot that never happens is not a
 * guard. Local development keeps working on the default, which is the point of having one.
 */
const ADMIN_PASSWORD_IS_DEFAULT = NODE_ENV === 'production' && ADMIN_PASSWORD === 'rph-admin';

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

router.post('/login', async (req, res) => {
  if (ADMIN_PASSWORD_IS_DEFAULT) {
    return res.status(503).json({
      error: 'ADMIN_PASSWORD is still the committed default. Set it and redeploy.',
      code: 'admin_unconfigured',
    });
  }

  const { username, password } = req.body || {};

  const userOk = String(username || '') === ADMIN_USERNAME;
  // Always run the hash comparison so a wrong username is not faster than a wrong password.
  const passOk = await bcrypt.compare(String(password || ''), ADMIN_HASH);

  if (!userOk || !passOk) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ sub: ADMIN_USERNAME, role: 'admin' }, JWT_SECRET, {
    expiresIn: JWT_TTL,
  });

  res.cookie(COOKIE_NAME, token, cookieOptions);
  res.json({ admin: { username: ADMIN_USERNAME } });
});

router.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: undefined });
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ admin: req.admin ? { username: req.admin.sub } : null });
});

router.get('/verify', requireAdmin, (req, res) => {
  res.json({ admin: { username: req.admin.sub } });
});

module.exports = router;
