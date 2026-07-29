const fs = require('fs');
const path = require('path');
const { db, one, batch } = require('../src/db');
const { DB_URL } = require('../src/config');
const { SEED_ARCHETYPES } = require('../src/lib/seed');

/* ─────────────────────────────────── the migration ───────────────────────────────────
   The schema used to be created at module load, which was free when the database was a
   file this process owned. Against a database over a network it is a dozen round trips on
   every cold start, paid for again each time the platform spins a fresh isolate — so it
   moved here, and runs once per deploy.

   Idempotent on purpose: `IF NOT EXISTS` throughout and a seed that only fires into an
   empty table, so running it twice, or against a database that predates it, is safe.   */

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  -- Roster snapshot pulled from the Ravensburger Play API. Kept locally so the app
  -- still works when the venue wifi (or upstream) dies mid-tournament.
  CREATE TABLE IF NOT EXISTS participants (
    event_id        TEXT    NOT NULL,
    registration_id INTEGER NOT NULL,
    user_id         INTEGER,
    display_name    TEXT    NOT NULL,
    handle          TEXT,
    status          TEXT,
    is_guest        INTEGER NOT NULL DEFAULT 0,
    country_code    TEXT,
    pronouns        TEXT,
    team_name       TEXT,
    matches_won     INTEGER NOT NULL DEFAULT 0,
    matches_lost    INTEGER NOT NULL DEFAULT 0,
    matches_drawn   INTEGER NOT NULL DEFAULT 0,
    match_points    INTEGER NOT NULL DEFAULT 0,
    final_place     INTEGER,
    registered_at   TEXT,
    avatar_url      TEXT,
    search_blob     TEXT    NOT NULL DEFAULT '',
    -- 0 once a player stops appearing upstream (dropped / registration cancelled).
    -- We never delete rows, so their scouting report survives a withdrawal.
    active          INTEGER NOT NULL DEFAULT 1,
    synced_at       TEXT    NOT NULL,
    PRIMARY KEY (event_id, registration_id)
  );

  CREATE INDEX IF NOT EXISTS idx_participants_event ON participants (event_id);
  CREATE INDEX IF NOT EXISTS idx_participants_search ON participants (event_id, search_blob);

  -- One scouting report per registration. Written by anyone, read by everyone.
  CREATE TABLE IF NOT EXISTS scouting (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id        TEXT    NOT NULL,
    registration_id INTEGER NOT NULL,
    inks            TEXT    NOT NULL DEFAULT '[]',
    archetype       TEXT,
    tech_cards      TEXT    NOT NULL DEFAULT '[]',
    notes           TEXT,
    confidence      TEXT    NOT NULL DEFAULT 'confirmed',
    scout_name      TEXT,
    created_at      TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL,
    UNIQUE (event_id, registration_id)
  );

  CREATE INDEX IF NOT EXISTS idx_scouting_event ON scouting (event_id);

  -- Append-only trail. Public writes need accountability, and the admin needs undo material.
  CREATE TABLE IF NOT EXISTS scouting_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id        TEXT    NOT NULL,
    registration_id INTEGER NOT NULL,
    action          TEXT    NOT NULL,
    payload         TEXT    NOT NULL,
    scout_name      TEXT,
    actor           TEXT    NOT NULL DEFAULT 'visitor',
    created_at      TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_history_event ON scouting_history (event_id, created_at DESC);

  -- The delta poll asks "what is the newest history id for this event?" on every tick from
  -- every phone in the hall. Without an index on the id itself that is a walk of every
  -- history row for the event: unmeasurable on a local file, but this is the one query the
  -- whole room repeats, and on a database billed per row read it is the bill.
  CREATE INDEX IF NOT EXISTS idx_history_cursor ON scouting_history (event_id, id DESC);

  -- Archetype presets offered in the scouting modal. Seeded, then admin-editable.
  CREATE TABLE IF NOT EXISTS archetypes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    inks       TEXT    NOT NULL DEFAULT '[]',
    style      TEXT,
    note       TEXT,
    sort_order INTEGER NOT NULL DEFAULT 100,
    created_at TEXT    NOT NULL
  );
`;

async function migrate() {
  // Only local file mode has a directory to create; a libsql:// URL has nothing to mkdir.
  if (DB_URL.startsWith('file:')) {
    fs.mkdirSync(path.dirname(DB_URL.slice('file:'.length)), { recursive: true });
  }

  await db.executeMultiple(SCHEMA);
  console.log('[migrate] schema up to date');

  const count = (await one('SELECT COUNT(*) AS n FROM archetypes'))?.n ?? 0;
  if (count > 0) {
    console.log(`[migrate] archetypes: ${count} already present, not seeding`);
    return;
  }

  const now = new Date().toISOString();
  await batch(
    SEED_ARCHETYPES.map((a, i) => ({
      sql: `INSERT INTO archetypes (name, inks, style, note, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [a.name, JSON.stringify(a.inks), a.style, a.note, i * 10, now],
    }))
  );
  console.log(`[migrate] seeded ${SEED_ARCHETYPES.length} archetype presets`);
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[migrate] failed:', err.message);
    process.exit(1);
  });
