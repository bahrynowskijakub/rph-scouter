const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const DATA_DIR = path.resolve(__dirname, '../data');

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
