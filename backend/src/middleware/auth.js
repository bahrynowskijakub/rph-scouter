const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');

const COOKIE_NAME = 'rph_admin';

/** Decode the admin cookie if present. Never throws — absence just means "visitor". */
function readAdmin(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    const claims = jwt.verify(token, JWT_SECRET);
    // The role has to be checked, not assumed. Every cookie this app issues is signed with the
    // same JWT_SECRET, so since the access gate started handing out passes of its own, a
    // visitor could paste their gate token into the `rph_admin` cookie and — on a bare
    // `jwt.verify` — be handed the admin panel. Different cookie names are not a boundary;
    // the claim is.
    if (claims?.role !== 'admin') return null;
    return claims;
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
