const express = require('express');
const {
  ACCESS_ENABLED,
  ACCESS_TTL_DAYS,
  GATE_BROKEN,
  GATE_REASON,
  REASON_TEXT,
  verifyAccessPassword,
  grantAccess,
  revokeAccess,
} = require('../middleware/access');

const router = express.Router();

/* ─────────────────────────────── guessing the password ───────────────────────────────
   One shared password with no username in front of it is exactly the shape a script likes,
   so failed attempts are counted. Two caveats, stated plainly rather than discovered later:

   This counter lives in memory. On Vercel that means per warm instance — a few instances
   means a few counters, and a cold start means a fresh one. It raises the cost of a naive
   loop; it is not a wall.

   The real throttle is bcrypt. A cost-10 comparison is ~100 ms of CPU that the attacker
   cannot skip and that this endpoint spends before answering, whatever the answer is.     */

const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const ATTEMPT_LIMIT = 20;
/** A bound, so a spray across spoofed keys cannot grow the map until the function dies. */
const ATTEMPT_MAP_MAX = 5_000;

const attempts = new Map();

/**
 * The requesting address, taken from the **right** end of the forwarded chain.
 *
 * The left end is whatever the client wrote. Caddy's `reverse_proxy` (deploy/Caddyfile) appends
 * the peer it actually saw to any `X-Forwarded-For` that arrived, so a script sending a fresh
 * fake header per request would get a fresh 20-attempt budget every time — a limiter that
 * limits nobody. The last entry is the one written by the hop next to us, which is the one we
 * are behind on both deployment targets.
 *
 * Same reasoning rules out `req.ip`: without `trust proxy` set it is the proxy's own address,
 * so every phone in the hall would share one counter — and with it set naively it would trust
 * that same client-written left end.
 *
 * This assumes something is in front of us, which on both documented targets there is (Vercel's
 * edge, or Caddy). Expose this port straight to the internet and the last entry becomes
 * client-written again — the limiter degrades, and bcrypt's cost is what is left.
 */
function clientKey(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const chain = typeof forwarded === 'string' ? forwarded.split(',') : [];
  const nearest = chain.length ? chain[chain.length - 1].trim() : null;
  return nearest || req.socket?.remoteAddress || 'unknown';
}

function tooManyAttempts(key, now) {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) return false;
  return entry.count >= ATTEMPT_LIMIT;
}

/**
 * Only failures are counted, and a success clears the count.
 *
 * Counting every attempt would have made the budget a headcount: a tournament crew shares one
 * NAT address on the hall wifi, so twenty phones typing the *correct* password at the start of
 * an event would have spent the whole window and locked out the twenty-first — for ten minutes,
 * with „Za dużo prób.” and no way to tell it apart from an attack.
 */
function countFailure(key, now) {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    if (attempts.size >= ATTEMPT_MAP_MAX) {
      for (const [k, v] of attempts) if (v.resetAt <= now) attempts.delete(k);
      // Still full of live windows: drop the oldest insertion rather than stop counting.
      if (attempts.size >= ATTEMPT_MAP_MAX) attempts.delete(attempts.keys().next().value);
    }
    attempts.set(key, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

/**
 * The only endpoint the app may call before it has been let in, and the reason the gate can
 * be a screen rather than a redirect. `configured` is what separates "type the password" from
 * "this deploy has no password set" — a distinction only the owner can act on, and one that
 * gives away nothing, since a visitor who sees the form knows there is a password anyway.
 */
router.get('/status', (req, res) => {
  res.json({
    granted: Boolean(req.access),
    configured: ACCESS_ENABLED && !GATE_BROKEN,
    // Only ever set for the owner's benefit, and only when there is nothing to type anyway.
    ...(GATE_BROKEN ? { reason: GATE_REASON } : {}),
  });
});

router.post('/login', async (req, res) => {
  const { password } = req.body || {};
  const key = clientKey(req);
  const now = Date.now();

  if (GATE_BROKEN || !ACCESS_ENABLED) {
    return res.status(503).json({
      error: GATE_BROKEN ? REASON_TEXT[GATE_REASON] : REASON_TEXT.missing_hash,
      code: 'access_unconfigured',
      reason: GATE_BROKEN ? GATE_REASON : 'missing_hash',
    });
  }

  if (tooManyAttempts(key, now)) {
    return res.status(429).json({ error: 'Too many attempts', code: 'access_throttled' });
  }

  // bcrypt truncates at 72 bytes anyway, so a megabyte of "password" would only buy the
  // sender our CPU. express.json's own 128 kB limit is the outer bound; this is the inner one.
  const usable = typeof password === 'string' && password.length <= 200;

  if (!usable || !(await verifyAccessPassword(password))) {
    countFailure(key, now);
    return res.status(401).json({ error: 'Invalid password', code: 'access_denied' });
  }

  // Right password: this address is not the one we are throttling.
  attempts.delete(key);
  grantAccess(res);
  res.json({ granted: true, days: ACCESS_TTL_DAYS });
});

/**
 * No button in the UI points here. It exists for the one case that matters — a phone that
 * should stop being let in — and for tests.
 */
router.post('/logout', (_req, res) => {
  revokeAccess(res);
  res.json({ ok: true });
});

module.exports = router;
