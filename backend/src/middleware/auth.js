const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');

const COOKIE_NAME = 'rph_admin';

/** Decode the admin cookie if present. Never throws — absence just means "visitor". */
function readAdmin(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

/** Attaches req.admin for every request so routes can branch on it. */
function withAdmin(req, _res, next) {
  req.admin = readAdmin(req);
  next();
}

function requireAdmin(req, res, next) {
  if (!req.admin) return res.status(401).json({ error: 'Admin access required' });
  next();
}

module.exports = { withAdmin, requireAdmin, COOKIE_NAME };
