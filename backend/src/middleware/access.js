const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const {
  ACCESS_PASSWORD_HASH,
  ACCESS_PASSWORD,
  ACCESS_TTL_DAYS,
  JWT_SECRET,
  NODE_ENV,
} = require('../config');

const ACCESS_COOKIE = 'rph_access';

/* ───────────────────────────────── the shared password ─────────────────────────────────
   Hashing happens here and nowhere else. The browser sends the password it was typed, over
   TLS, and this process compares it against the stored hash — the plaintext is never written
   down on either side.

   The tempting alternative, hashing in the browser and comparing two hashes, does not work
   and would not help if it did: bcrypt salts every hash, so the same password hashes to a
   different string every time and `hash(typed) === stored` is false even when the password is
   right. And whatever the client sends is what actually opens the door, so a client-side hash
   just renames the password — anyone who sniffs it replays it verbatim.                    */

/**
 * `$2a`/`$2b`/`$2y`, a cost bcryptjs will actually accept, then 53 characters of its own base64.
 *
 * Tighter than it looks necessary, in both places it is tight. The variant letter is required,
 * because `$2$10$…` is a shape bcryptjs rejects at compare time — which would land us back at
 * "correct password refused forever", the exact thing this check exists to prevent. And the
 * cost is bounded to 04–31 rather than `\d\d`, because bcryptjs *throws* outside that range;
 * Express 5 would forward the rejection to the error handler and answer 500 to a login form.
 */
const BCRYPT_SHAPE = /^\$2[aby]\$(0[4-9]|[12]\d|3[01])\$[./A-Za-z0-9]{53}$/;

/**
 * A hash that is not a hash is the failure worth spending code on.
 *
 * bcryptjs does not throw on a malformed hash — `compare` simply resolves false. So one wrong
 * paste (the apostrophes from the .env line carried into the Vercel form is the way this
 * happens) would reject the *correct* password, for everyone, forever, with the UI calmly
 * saying „Nieprawidłowe hasło.” Nothing in that symptom points at the variable.
 *
 * So the shape is checked once, here, and a bad one is treated as a broken deploy rather than
 * as a password nobody can guess.
 */
const HASH_INVALID = Boolean(ACCESS_PASSWORD_HASH) && !BCRYPT_SHAPE.test(ACCESS_PASSWORD_HASH);

const PASSWORD_HASH = HASH_INVALID
  ? null
  : ACCESS_PASSWORD_HASH || (ACCESS_PASSWORD ? bcrypt.hashSync(ACCESS_PASSWORD, 10) : null);

/** No password configured means no gate. Fine locally; refused in production, see below. */
const ACCESS_ENABLED = Boolean(PASSWORD_HASH);

/* ────────────────────────── reasons the gate cannot be trusted ──────────────────────────
   Anything in here means every request is refused — including the ones that would otherwise
   succeed. All four are misconfigurations only the owner of the deploy can fix, and all four
   are worse than a closed door if we let them through quietly.

   `insecure_secret` is the one that surprised us into writing this block. The gate's pass is
   only unforgeable because JWT_SECRET is a secret, and JWT_SECRET has a *committed default*.
   The refusal that catches it lived in index.js, which — as its own header says — never runs
   on Vercel: there the entrypoint is app.js. So on the primary deployment target, forgetting
   JWT_SECRET would have produced a gate anybody could mint their own pass for, with no symptom
   at all. Fail-closed checks belong on the request path, not at a boot that does not happen. */

const REASONS = [];
if (HASH_INVALID) {
  REASONS.push('bad_hash');
} else if (NODE_ENV === 'production' && !ACCESS_PASSWORD_HASH) {
  // Plaintext works, but "the password is never stored" is a promise this file makes, and in
  // production it has to be true.
  REASONS.push(ACCESS_PASSWORD ? 'plaintext_password' : 'missing_hash');
}
if (NODE_ENV === 'production' && JWT_SECRET.startsWith('dev-only')) {
  REASONS.push('insecure_secret');
}

const GATE_BROKEN = REASONS.length > 0;

/** First reason, for the screen that has to explain itself. Null when nothing is wrong. */
const GATE_REASON = REASONS[0] ?? null;

if (GATE_BROKEN) {
  console.error(
    `[access] The gate is refusing every request: ${REASONS.join(', ')}.\n` +
      '         bad_hash / missing_hash   → ACCESS_PASSWORD_HASH, from `yarn hash-password`,\n' +
      '                                     pasted with no quotes around it.\n' +
      '         plaintext_password        → production needs the hash, not ACCESS_PASSWORD.\n' +
      '         insecure_secret           → JWT_SECRET is still the committed default.'
  );
}

/**
 * A short fingerprint of the password, carried in every pass we issue.
 *
 * This is what makes changing the password mean something. Without it, rotating
 * ACCESS_PASSWORD_HASH — because somebody left the team, or the password made it into a group
 * chat — would lock out nobody: every browser already holding a cookie keeps walking in for
 * the rest of the TTL, which is half a year. A pass minted under the old password no longer
 * matches and is treated as absent.
 *
 * HMAC over the material rather than a digest of `PASSWORD_HASH`, for two separate reasons.
 * The salt: in the ACCESS_PASSWORD path the hash is minted fresh at every module load, so a
 * digest of it changed on every restart and threw everybody out — under `node --watch`, on
 * every file save. And the key: this value travels to the browser inside the JWT, so it must
 * not be an offline-crackable digest of the password itself.
 */
const PASSWORD_ID = PASSWORD_HASH
  ? crypto
      .createHmac('sha256', JWT_SECRET)
      .update(ACCESS_PASSWORD_HASH || ACCESS_PASSWORD || '')
      .digest('hex')
      .slice(0, 12)
  : null;

const TTL_MS = ACCESS_TTL_DAYS * 24 * 60 * 60 * 1000;

const accessCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: NODE_ENV === 'production',
  path: '/',
  maxAge: TTL_MS,
};

/** Resolves true only for the configured password. Always awaits bcrypt, never string-compares. */
function verifyAccessPassword(password) {
  if (!ACCESS_ENABLED) return Promise.resolve(false);
  return bcrypt.compare(String(password ?? ''), PASSWORD_HASH);
}

function signAccessToken() {
  return jwt.sign({ typ: 'access', pid: PASSWORD_ID }, JWT_SECRET, {
    expiresIn: `${ACCESS_TTL_DAYS}d`,
  });
}

function grantAccess(res) {
  res.cookie(ACCESS_COOKIE, signAccessToken(), accessCookieOptions);
}

function revokeAccess(res) {
  res.clearCookie(ACCESS_COOKIE, { ...accessCookieOptions, maxAge: undefined });
}

/** Decode the pass if the browser sent one. Never throws — absence just means "not yet let in". */
function readAccess(req) {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (!token) return null;
  try {
    const claims = jwt.verify(token, JWT_SECRET);
    // Both cookies are signed with the same secret, so the type claim is what stops an admin
    // token from being replayed as a gate pass and — far more importantly, see auth.js — the
    // other way round.
    if (claims?.typ !== 'access') return null;
    if (claims.pid !== PASSWORD_ID) return null;
    return claims;
  } catch {
    return null;
  }
}

/**
 * Attaches req.access for every request. Runs after `withAdmin`, because an admin has already
 * proved more than the gate asks for: an organiser whose session predates a password rotation
 * should not be locked out of their own panel by it.
 */
function withAccess(req, _res, next) {
  // A misconfiguration is never "no gate configured, carry on" — not even locally, where
  // silently opening the app would hide the typo until it shipped.
  const gateOff = !ACCESS_ENABLED && !GATE_BROKEN && NODE_ENV !== 'production';
  req.access = !GATE_BROKEN && (gateOff || Boolean(req.admin) || Boolean(readAccess(req)));
  next();
}

const REASON_TEXT = {
  bad_hash: 'ACCESS_PASSWORD_HASH is not a bcrypt hash.',
  missing_hash: 'Access gate is not configured. Set ACCESS_PASSWORD_HASH.',
  plaintext_password: 'Production needs ACCESS_PASSWORD_HASH, not ACCESS_PASSWORD.',
  insecure_secret: 'JWT_SECRET is still the committed default, so a pass would be forgeable.',
};

/**
 * The gate itself. Two failures, deliberately different: `access_required` is a visitor who has
 * not typed the password yet and gets shown the form, `access_unconfigured` is a deploy the
 * owner has to fix (see REASONS above).
 *
 * The second one fails closed on purpose. Serving the roster wide open because an environment
 * variable did not make it into Vercel would defeat the entire point of the feature, silently,
 * and nobody would notice until the wrong person had the link.
 */
function requireAccess(req, res, next) {
  // Production with no password at all is already in REASONS as `missing_hash`, so this one
  // branch covers every way the gate can be broken.
  if (GATE_BROKEN) {
    return res.status(503).json({
      error: REASON_TEXT[GATE_REASON] ?? 'The access gate is misconfigured.',
      code: 'access_unconfigured',
      reason: GATE_REASON,
    });
  }
  if (req.access) return next();
  return res.status(401).json({ error: 'Access password required', code: 'access_required' });
}

module.exports = {
  ACCESS_COOKIE,
  ACCESS_ENABLED,
  ACCESS_TTL_DAYS,
  GATE_BROKEN,
  GATE_REASON,
  REASON_TEXT,
  withAccess,
  requireAccess,
  verifyAccessPassword,
  grantAccess,
  revokeAccess,
};
