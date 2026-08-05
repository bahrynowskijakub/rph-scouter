const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const DATA_DIR = path.resolve(__dirname, '../data');

/** A typo in a duration is worse than a default: `Number('30 dni')` is NaN, and NaN days is
 *  a cookie the browser drops on the floor without saying anything. */
function positiveNumber(raw, fallback) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

module.exports = {
  PORT: Number(process.env.PORT || 4000),
  NODE_ENV: process.env.NODE_ENV || 'development',

  /**
   * libSQL, which is SQLite with a network in front of it. `file:` for local development —
   * same file the app always used — and `libsql://…` for Turso in production, which is what
   * makes a platform with no writable disk possible at all.
   */
  DB_URL: process.env.DB_URL || `file:${path.join(DATA_DIR, 'scouter.db')}`,
  /** Only Turso needs one; a local file has nothing to authenticate against. */
  DB_AUTH_TOKEN: process.env.DB_AUTH_TOKEN || null,

  /** Single admin account. Password is hashed at boot; the plaintext never leaves this process. */
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'rph-admin',

  /**
   * The front door. One shared password handed to the people who should see the hall's
   * decklists — no accounts, no usernames, nothing to administer between tournaments.
   * Everything under /api stays closed until a browser has answered it.
   *
   * Only the bcrypt hash belongs in the environment; `yarn hash-password` prints one. A hash
   * is safe to paste into Vercel, read off a screen or leave in a shell history, because it
   * is not the password and cannot be turned back into it.
   */
  ACCESS_PASSWORD_HASH: process.env.ACCESS_PASSWORD_HASH || null,
  /**
   * Plaintext shortcut, hashed at boot exactly like ADMIN_PASSWORD. Only for local work —
   * the hash above wins if both are set, and production should never use this one.
   */
  ACCESS_PASSWORD: process.env.ACCESS_PASSWORD || null,
  /**
   * How long a browser stays let in. Deliberately long: being asked again halfway through
   * a tournament is the failure this whole thing is meant to avoid.
   */
  ACCESS_TTL_DAYS: positiveNumber(process.env.ACCESS_TTL_DAYS, 180),

  JWT_SECRET: process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me',
  JWT_TTL: process.env.JWT_TTL || '30d',

  CORS_ORIGIN: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  /** Ravensburger Play tournament API. */
  RPH_BASE_URL:
    process.env.RPH_BASE_URL || 'https://api.cloudflare.ravensburgerplay.com/hydraproxy/api/v2',
  /** Event used until an admin sets one. */
  DEFAULT_EVENT_ID: process.env.DEFAULT_EVENT_ID || '767473',
  /** How long a cached roster stays fresh before we re-fetch upstream (ms). */
  ROSTER_TTL_MS: Number(process.env.ROSTER_TTL_MS || 5 * 60 * 1000),
  RPH_TIMEOUT_MS: Number(process.env.RPH_TIMEOUT_MS || 20000),
};
