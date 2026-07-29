const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ADMIN_USERNAME, ADMIN_PASSWORD, JWT_SECRET, JWT_TTL, NODE_ENV } = require('../config');
const { COOKIE_NAME, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Hash the configured password once at boot; the comparison below is then constant-time.
const ADMIN_HASH = bcrypt.hashSync(ADMIN_PASSWORD, 10);

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

router.post('/login', async (req, res) => {
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
