const fs = require('fs');
const path = require('path');
const { db, one, all, batch } = require('../src/db');
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

  -- Archetype presets the scouting sheet offers for the deck's ink pair. Seeded from the meta
  -- list, and extended by whoever is scouting when the meta throws up something new.
  --
  -- Keyed on (name, inks), NOT on name. The name is the bare label inkdecks puts in its
  -- Archetype column — "Elinor", "Midrange" — because the pair is already on screen as two ink
  -- plates and spelling it into the text as well is the same thing said twice. The consequence
  -- is that a label does not identify an archetype: eleven of the 44 are shared between pairs,
  -- "Midrange" across four of them. Only the pair makes it unambiguous.
  --
  -- The source column is what makes the preset list refreshable: 'seed' rows are replaced
  -- wholesale by the list in lib/seed.js on every migrate, 'user' rows are never touched.
  CREATE TABLE IF NOT EXISTS archetypes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    inks       TEXT    NOT NULL DEFAULT '[]',
    style      TEXT,
    note       TEXT,
    sort_order INTEGER NOT NULL DEFAULT 100,
    source     TEXT    NOT NULL DEFAULT 'seed',
    created_at TEXT    NOT NULL,
    UNIQUE (name, inks)
  );
`;

/**
 * `CREATE TABLE IF NOT EXISTS` says nothing about a table that already exists, so a column
 * added to the schema above has to be added to older databases by hand. SQLite has no
 * `ADD COLUMN IF NOT EXISTS`; PRAGMA is the way to ask.
 */
async function addColumnIfMissing(table, column, definition) {
  const columns = await all(`PRAGMA table_info(${table})`);
  if (columns.some((c) => c.name === column)) return false;
  await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`[migrate] ${table}.${column} added`);
  return true;
}

/**
 * Rebuild the table when it still carries the old `UNIQUE (name)` constraint.
 *
 * SQLite cannot drop a constraint, so this is the copy-and-rename dance. It is needed because
 * the presets stopped spelling the ink pair into their own names: the labels are now the bare
 * ones inkdecks uses, eleven of which are shared between pairs, so uniqueness has to move to
 * (name, inks) or the second pair wanting "Midrange" collides with the first.
 *
 * Everything is carried over, `source` and all. `INSERT OR IGNORE` covers the one way the copy
 * can fail: an old row whose (name, inks) already arrived from another row — nothing in the old
 * seed collides that way, but a hand-added duplicate is not worth aborting a migration for.
 */
async function rebuildForPairUniqueness() {
  const row = await one("SELECT sql FROM sqlite_master WHERE type='table' AND name='archetypes'");
  if (!row?.sql || /UNIQUE\s*\(\s*name\s*,\s*inks\s*\)/i.test(row.sql)) return false;

  await db.executeMultiple(`
    CREATE TABLE archetypes_new (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      inks       TEXT    NOT NULL DEFAULT '[]',
      style      TEXT,
      note       TEXT,
      sort_order INTEGER NOT NULL DEFAULT 100,
      source     TEXT    NOT NULL DEFAULT 'seed',
      created_at TEXT    NOT NULL,
      UNIQUE (name, inks)
    );

    INSERT OR IGNORE INTO archetypes_new
      (name, inks, style, note, sort_order, source, created_at)
      SELECT name, inks, style, note, sort_order, source, created_at FROM archetypes;

    DROP TABLE archetypes;
    ALTER TABLE archetypes_new RENAME TO archetypes;
  `);

  console.log('[migrate] archetypes rebuilt with UNIQUE (name, inks)');
  return true;
}

/**
 * Decide, once, which rows in a pre-`source` database were presets and which were people.
 *
 * The column defaults to 'seed', and `syncPresets` deletes seed rows that are no longer on the
 * list — so without this step the first migrate after the rename would take an archetype
 * somebody added through the old admin endpoint and delete it as a retired preset. Which is
 * precisely the one thing the source column exists to prevent.
 *
 * The old seed's names are the only reliable way to tell them apart, so they are written out
 * here. They all carry a slash, the current list never does, and nothing else in the codebase
 * needs to remember them.
 */
const LEGACY_SEED_NAMES = [
  'Amber/Emerald Elinor',
  'Amber/Ruby Boost',
  'Amber/Amethyst Midrange',
  'Amber/Steel Steelsong',
  'Amethyst/Ruby Evasive',
  'Amber/Emerald Aggro',
  'Sapphire/Steel Detectives',
  'Amethyst/Steel Dwarfs',
  'Amethyst/Sapphire Blurple',
  'Emerald/Ruby Sid',
  'Ruby/Steel Supers',
  'Emerald/Steel Merida',
  'Emerald/Sapphire Support',
  'Ruby/Sapphire Items',
  'Amber/Sapphire Madrigals',
  'Amethyst/Emerald Burn',
  'Amber/Ruby Monsters',
];

async function classifyLegacyRows() {
  const placeholders = LEGACY_SEED_NAMES.map(() => '?').join(', ');
  const promoted = await db.execute({
    sql: `UPDATE archetypes SET source = 'user' WHERE name NOT IN (${placeholders})`,
    args: LEGACY_SEED_NAMES,
  });
  const n = Number(promoted.rowsAffected) || 0;
  console.log(
    n
      ? `[migrate] ${n} archetype(s) not from the old seed list kept as source='user'`
      : '[migrate] no hand-added archetypes found in the old list'
  );
}

/**
 * Bring the preset rows in line with lib/seed.js, and leave everything a scout added alone.
 *
 * The old behaviour — seed only into an empty table — meant the presets could never be
 * corrected: the first `yarn db:migrate` fixed them in place forever, and a list built from the
 * meta needs to follow the meta. So the seed is now authoritative over `source='seed'` rows and
 * blind to `source='user'` ones, which is the whole reason that column exists. Retired presets
 * are dropped; a name that moves from the seed list to nowhere stops being offered.
 *
 * A report that already names a retired preset is untouched — `scouting.archetype` is text, not
 * a foreign key, and the sheet always offers the value it was given even when the list has
 * forgotten it.
 */
async function syncPresets() {
  const now = new Date().toISOString();
  /** The natural key, as text, so the retire step can ask "still on the list?" in one query. */
  const keys = SEED_ARCHETYPES.map((a) => `${a.name}|${JSON.stringify(a.inks)}`);

  await batch(
    SEED_ARCHETYPES.map((a, i) => ({
      sql: `INSERT INTO archetypes (name, inks, style, note, sort_order, source, created_at)
            VALUES (?, ?, ?, ?, ?, 'seed', ?)
            ON CONFLICT(name, inks) DO UPDATE SET
              style = excluded.style,
              note = excluded.note,
              sort_order = excluded.sort_order,
              source = 'seed'`,
      args: [a.name, JSON.stringify(a.inks), a.style ?? null, a.note ?? null, i * 10, now],
    }))
  );

  const placeholders = keys.map(() => '?').join(', ');
  const retired = await db.execute({
    sql: `DELETE FROM archetypes
           WHERE source = 'seed'
             AND name || '|' || inks NOT IN (${placeholders || "''"})`,
    args: keys,
  });

  const total = (await one('SELECT COUNT(*) AS n FROM archetypes'))?.n ?? 0;
  const userAdded =
    (await one("SELECT COUNT(*) AS n FROM archetypes WHERE source = 'user'"))?.n ?? 0;

  console.log(
    `[migrate] archetypes: ${SEED_ARCHETYPES.length} presets synced` +
      `, ${Number(retired.rowsAffected) || 0} retired` +
      `, ${userAdded} kept from scouts (${total} total)`
  );
}

async function migrate() {
  // Only local file mode has a directory to create; a libsql:// URL has nothing to mkdir.
  if (DB_URL.startsWith('file:')) {
    fs.mkdirSync(path.dirname(DB_URL.slice('file:'.length)), { recursive: true });
  }

  await db.executeMultiple(SCHEMA);
  console.log('[migrate] schema up to date');

  // Order matters: the source column has to exist, and legacy rows have to be classified while
  // their old names are still in place, before the table is rebuilt around the new key.
  if (await addColumnIfMissing('archetypes', 'source', "TEXT NOT NULL DEFAULT 'seed'")) {
    await classifyLegacyRows();
  }
  await rebuildForPairUniqueness();

  await syncPresets();
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[migrate] failed:', err.message);
    process.exit(1);
  });
