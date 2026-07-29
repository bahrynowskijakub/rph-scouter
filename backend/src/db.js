const { createClient } = require('@libsql/client');
const { DB_URL, DB_AUTH_TOKEN } = require('./config');

/* ────────────────────────────────── the database ──────────────────────────────────
   libSQL, which is SQLite: every statement in this codebase is the one it always was —
   AUTOINCREMENT, ON CONFLICT DO UPDATE, COLLATE NOCASE, JSON kept in TEXT columns. What
   changed is that the driver talks over a network, so nothing is synchronous any more.

   That is the whole point. The app used to be a process holding a file open, which is a
   thing a serverless platform cannot give you. Now it is a process holding a URL.

   One client per process — on Vercel, one per warm isolate. The client is a pool, not a
   connection, so there is nothing to close and nothing to reconnect.                  */

const db = createClient({
  url: DB_URL,
  ...(DB_AUTH_TOKEN ? { authToken: DB_AUTH_TOKEN } : {}),
});

/*
 * The schema is deliberately NOT created here.
 *
 * Module init runs on every cold start, and a dozen `CREATE TABLE IF NOT EXISTS` round
 * trips would stand between a phone and its first response — paid for again every time the
 * platform decides to spin a fresh isolate. The schema is a deploy-time concern now:
 * `yarn db:migrate`, see backend/scripts/migrate.js.
 */

/** Statement rows come back plain-object-shaped: spreading and JSON.stringify both work. */
const shape = (sql, args) => (args === undefined ? sql : { sql, args });

/** First row, or null. */
async function one(sql, args) {
  const { rows } = await db.execute(shape(sql, args));
  return rows[0] ?? null;
}

/** Every row. */
async function all(sql, args) {
  const { rows } = await db.execute(shape(sql, args));
  return rows;
}

/** A write. Returns the ResultSet so callers can read `rowsAffected`. */
function run(sql, args) {
  return db.execute(shape(sql, args));
}

/**
 * Atomic multi-statement write — what replaced `db.transaction()`. libSQL wraps the batch in
 * BEGIN IMMEDIATE and rolls all of it back if any statement fails.
 *
 * The difference that matters: **a batch cannot branch.** Anything that read a row and then
 * decided what to write has to express the decision in SQL instead. There is also an
 * interactive `db.transaction()`, but it holds a write lock with a five-second timeout
 * against a remote database, which is not a thing to reach for casually.
 *
 * One caveat inherited from the driver: a *missing* named parameter binds NULL rather than
 * throwing, which better-sqlite3 would not have allowed. A typo in an argument key is
 * therefore a silent NULL, caught only by whatever NOT NULL constraint it lands on.
 */
function batch(statements) {
  return db.batch(statements, 'write');
}

const SETTING_UPSERT = `
  INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value
`;

const getSetting = async (key) =>
  (await one('SELECT value FROM settings WHERE key = ?', [key]))?.value;

/** The upsert as a statement object, for callers that need it inside a batch. */
const settingStmt = (key, value) => ({
  sql: SETTING_UPSERT,
  args: [key, value == null ? null : String(value)],
});

module.exports = {
  db,
  one,
  all,
  run,
  batch,
  getSetting,
  setSetting: (key, value) => run(SETTING_UPSERT, [key, value == null ? null : String(value)]),
  settingStmt,
};
