const { one, all, batch, getSetting, setSetting, settingStmt } = require('../db');
const { DEFAULT_EVENT_ID, ROSTER_TTL_MS } = require('../config');
const { background } = require('./background');
const { fetchEvent, fetchRegistrations, normalizeRegistration } = require('./rphClient');

const EVENT_ID_KEY = 'event_id';

/** Dates the roster snapshot. Read on every delta poll, so it has to be cheap. */
const syncedAtKey = (eventId) => `roster_synced_at:${eventId}`;

async function getEventId() {
  return (await getSetting(EVENT_ID_KEY)) || DEFAULT_EVENT_ID;
}

function setEventId(eventId) {
  return setSetting(EVENT_ID_KEY, eventId);
}

async function getEventMeta(eventId) {
  const raw = await getSetting(`event_meta:${eventId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setEventMeta(eventId, meta) {
  return setSetting(`event_meta:${eventId}`, JSON.stringify(meta));
}

/**
 * When this event's roster was last pulled from upstream.
 *
 * Stored beside the rows rather than derived from MAX(synced_at): every delta poll reads it
 * to decide whether players have registered or dropped out, and a settings lookup is one row
 * where the aggregate is one per participant.
 */
async function getSyncedAt(eventId) {
  const stored = await getSetting(syncedAtKey(eventId));
  if (stored) return stored;

  // Written by a build that did not keep this in settings yet. Read the hard way once; the
  // next pull stores it and this branch never runs again for the event.
  const row = await one('SELECT MAX(synced_at) AS at FROM participants WHERE event_id = ?', [
    eventId,
  ]);
  return row?.at || null;
}

const UPSERT_PARTICIPANT = `
  INSERT INTO participants (
    event_id, registration_id, user_id, display_name, handle, status, is_guest,
    country_code, pronouns, team_name, matches_won, matches_lost, matches_drawn,
    match_points, final_place, registered_at, avatar_url, search_blob, active, synced_at
  ) VALUES (
    @eventId, @registrationId, @userId, @displayName, @handle, @status, @isGuest,
    @countryCode, @pronouns, @teamName, @matchesWon, @matchesLost, @matchesDrawn,
    @matchPoints, @finalPlace, @registeredAt, @avatarUrl, @searchBlob, 1, @syncedAt
  )
  ON CONFLICT (event_id, registration_id) DO UPDATE SET
    user_id       = excluded.user_id,
    display_name  = excluded.display_name,
    handle        = excluded.handle,
    status        = excluded.status,
    is_guest      = excluded.is_guest,
    country_code  = excluded.country_code,
    pronouns      = excluded.pronouns,
    team_name     = excluded.team_name,
    matches_won   = excluded.matches_won,
    matches_lost  = excluded.matches_lost,
    matches_drawn = excluded.matches_drawn,
    match_points  = excluded.match_points,
    final_place   = excluded.final_place,
    registered_at = excluded.registered_at,
    avatar_url    = excluded.avatar_url,
    search_blob   = excluded.search_blob,
    active        = 1,
    synced_at     = excluded.synced_at
`;

/** Strip diacritics so "Michał" is found by typing "michal". */
function searchable(...parts) {
  return parts
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * One atomic write for the whole snapshot: every player, plus the timestamp that dates them.
 *
 * The withdrawal pass runs *first* and unconditionally — everyone drops to `active = 0` and
 * the upserts below put back only those still in the snapshot. The previous shape was
 * `WHERE registration_id NOT IN (?,?,?…)`, one bound parameter per player, which is a
 * statement that grows with the tournament and eventually meets a parameter limit. Rows are
 * still never deleted, so a withdrawn player's scouting report survives them.
 */
async function writeRoster(eventId, registrations, syncedAt) {
  const statements = [
    { sql: 'UPDATE participants SET active = 0 WHERE event_id = ?', args: [eventId] },
  ];

  for (const raw of registrations) {
    const p = normalizeRegistration(raw);
    if (p.registrationId == null) continue;
    statements.push({
      sql: UPSERT_PARTICIPANT,
      args: {
        ...p,
        eventId,
        searchBlob: searchable(p.displayName, p.handle, p.teamName),
        syncedAt,
      },
    });
  }

  // Inside the batch, so nobody can read a timestamp claiming to describe rows this pull had
  // not finished writing.
  statements.push(settingStmt(syncedAtKey(eventId), syncedAt));

  await batch(statements);
}

/**
 * One upstream pull in flight per event, so two routes hitting at once share the work.
 *
 * Process-scoped, which on a serverless platform means per warm isolate rather than per
 * deployment. It still collapses the common case — a burst of requests landing on one
 * isolate — and the worst case it no longer prevents is two identical pulls writing two
 * identical snapshots, which is wasteful but not wrong.
 */
const inFlight = new Map();

/** Last failed refresh per event, surfaced as a warning on the next read. Same caveat. */
const lastError = new Map();

function pullRoster(eventId) {
  const running = inFlight.get(eventId);
  if (running) return running;

  const promise = (async () => {
    const [event, registrations] = await Promise.all([
      fetchEvent(eventId).catch(() => null),
      fetchRegistrations(eventId),
    ]);

    const now = new Date().toISOString();
    await writeRoster(eventId, registrations, now);
    if (event) await setEventMeta(eventId, event);

    return { syncedAt: now, count: registrations.length };
  })()
    .then((result) => {
      lastError.delete(eventId);
      return result;
    })
    .catch((err) => {
      lastError.set(eventId, err.message);
      throw err;
    })
    .finally(() => {
      inFlight.delete(eventId);
    });

  inFlight.set(eventId, promise);
  return promise;
}

/**
 * Serve the cached roster and refresh behind the response — a page load costs one database
 * read instead of a round trip to Ravensburger Play, which is the difference between the
 * list appearing instantly and appearing a second or two later on venue wifi.
 *
 * Waiting only happens when there is nothing cached to show (first ever load of an event) or
 * when the caller asked for it (`force`, i.e. the admin pressed refresh).
 *
 * Returns { synced, syncedAt, count?, fresh, error? } — a failed refresh with usable cached
 * data is reported, not thrown, so the tournament view never goes blank.
 */
async function syncRoster(eventId, { force = false } = {}) {
  const syncedAt = await getSyncedAt(eventId);
  const age = syncedAt ? Date.now() - new Date(syncedAt).getTime() : Infinity;
  const stale = age >= ROSTER_TTL_MS;

  // Nothing cached: the caller has nothing to render, so this one has to wait. A throw here
  // is the only way an upstream failure reaches the client.
  if (!syncedAt) {
    const result = await pullRoster(eventId);
    return { synced: true, syncedAt: result.syncedAt, count: result.count, fresh: true };
  }

  if (force) {
    try {
      const result = await pullRoster(eventId);
      return { synced: true, syncedAt: result.syncedAt, count: result.count, fresh: true };
    } catch (err) {
      return { synced: false, syncedAt, fresh: false, error: err.message };
    }
  }

  if (stale) {
    // Whatever it writes lands in a later request. Handed to the platform rather than left
    // dangling: a frozen isolate would otherwise abandon the batch halfway through.
    background(pullRoster(eventId));
  }

  const failed = lastError.get(eventId);
  return {
    synced: false,
    syncedAt,
    fresh: !stale,
    ...(stale && failed ? { error: failed } : {}),
  };
}

const INK_ORDER = ['amber', 'amethyst', 'emerald', 'ruby', 'sapphire', 'steel'];

function parseJsonArray(value, fallback = []) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** Canonical ink order keeps "Amber/Steel" from also appearing as "Steel/Amber". */
function sortInks(inks) {
  return [...inks].sort((a, b) => INK_ORDER.indexOf(a) - INK_ORDER.indexOf(b));
}

function rowToParticipant(row) {
  const scouting = row.scouting_id
    ? {
        inks: sortInks(parseJsonArray(row.inks)),
        archetype: row.archetype || null,
        techCards: parseJsonArray(row.tech_cards),
        notes: row.notes || null,
        confidence: row.confidence || 'confirmed',
        scoutName: row.scout_name || null,
        createdAt: row.scouting_created_at,
        updatedAt: row.scouting_updated_at,
      }
    : null;

  return {
    registrationId: row.registration_id,
    userId: row.user_id,
    displayName: row.display_name,
    handle: row.handle,
    status: row.status,
    isGuest: !!row.is_guest,
    countryCode: row.country_code,
    pronouns: row.pronouns,
    teamName: row.team_name,
    record: {
      won: row.matches_won,
      lost: row.matches_lost,
      drawn: row.matches_drawn,
      points: row.match_points,
      finalPlace: row.final_place,
    },
    registeredAt: row.registered_at,
    avatarUrl: row.avatar_url,
    active: !!row.active,
    scouting,
  };
}

const SELECT_JOINED = `
  SELECT p.*,
         s.id         AS scouting_id,
         s.inks, s.archetype, s.tech_cards, s.notes, s.confidence, s.scout_name,
         s.created_at AS scouting_created_at,
         s.updated_at AS scouting_updated_at
    FROM participants p
    LEFT JOIN scouting s
      ON s.event_id = p.event_id AND s.registration_id = p.registration_id
`;

async function listParticipants(eventId) {
  const rows = await all(
    `${SELECT_JOINED}
      WHERE p.event_id = ?
      ORDER BY p.active DESC, p.display_name COLLATE NOCASE ASC`,
    [eventId]
  );
  return rows.map(rowToParticipant);
}

async function getParticipant(eventId, registrationId) {
  const row = await one(
    `${SELECT_JOINED} WHERE p.event_id = ? AND p.registration_id = ?`,
    [eventId, registrationId]
  );
  return row ? rowToParticipant(row) : null;
}

/* ────────────────────────────── the roster the app reads ──────────────────────────────
   The whole list ships on every load, so the shape below is exactly what the screen draws
   and nothing else. The signed avatar URL alone ran to several hundred bytes per player, and
   match records, pronouns, countries and team names were never rendered — dropping them is
   the difference between a couple of hundred KB and a couple of dozen on the hall's wifi.

   Reports keep their archetype, tech cards and confidence in the database; they are just not
   sent, because nothing displays them any more.                                         */

const SELECT_ROSTER = `
  SELECT p.registration_id, p.display_name, p.handle, p.active,
         s.id AS scouting_id, s.inks, s.notes
    FROM participants p
    LEFT JOIN scouting s
      ON s.event_id = p.event_id AND s.registration_id = p.registration_id
`;

function rowToRosterEntry(row) {
  return {
    registrationId: row.registration_id,
    displayName: row.display_name,
    handle: row.handle,
    active: !!row.active,
    scouting: row.scouting_id
      ? { inks: sortInks(parseJsonArray(row.inks)), notes: row.notes || null }
      : null,
  };
}

async function listRoster(eventId) {
  const rows = await all(
    `${SELECT_ROSTER}
      WHERE p.event_id = ?
      ORDER BY p.active DESC, p.display_name COLLATE NOCASE ASC`,
    [eventId]
  );
  return rows.map(rowToRosterEntry);
}

async function getRosterEntry(eventId, registrationId) {
  const row = await one(
    `${SELECT_ROSTER} WHERE p.event_id = ? AND p.registration_id = ?`,
    [eventId, registrationId]
  );
  return row ? rowToRosterEntry(row) : null;
}

/* ─────────────────────────────── the roster's cursor ───────────────────────────────
   `scouting_history.id` is what dates the list. It is AUTOINCREMENT, append-only, and
   written inside the same batch as the scouting row itself, so it can never disagree with
   the data a client is about to be told about. The sequence is table-wide rather than per
   event, which is what makes a cursor still mean something after an admin switches
   tournaments mid-session.

   Clients poll it: they send back the cursor they last applied and get either "still the
   same", the players that changed since, or `null` from changedSince() meaning "too far
   behind to patch". There is no epoch, no session and nothing held open — a cursor the
   server cannot explain is answered with a full list, and a full list is always a valid
   recovery.                                                                            */

/** Beyond this many changed players a full refetch is cheaper — and safer — than patches. */
const MAX_DELTA = 50;

async function cursorNow(eventId) {
  const row = await one(
    'SELECT COALESCE(MAX(id), 0) AS cursor FROM scouting_history WHERE event_id = ?',
    [eventId]
  );
  return row.cursor;
}

/**
 * Everything one delta poll needs, in a single round trip.
 *
 * Two queries would be the obvious shape and it is the wrong one: this is the query the whole
 * hall repeats every few seconds, so its cost is measured in round trips to a database that
 * is now across a network, not in elegance.
 */
async function pollState(eventId) {
  const row = await one(
    `SELECT
       (SELECT COALESCE(MAX(id), 0) FROM scouting_history WHERE event_id = ?) AS cursor,
       (SELECT value FROM settings WHERE key = ?) AS synced_at`,
    [eventId, syncedAtKey(eventId)]
  );
  return { cursor: row.cursor, rosterSyncedAt: row.synced_at };
}

/**
 * The list-shaped players whose report changed since `since`, or null when there are more of
 * them than MAX_DELTA and the caller should just re-read the list.
 *
 * Two round trips, never one per player: a `getRosterEntry` in a loop was free against a
 * local file and is fifty sequential network calls against a remote one.
 */
async function changedSince(eventId, since) {
  const rows = await all(
    `SELECT registration_id
       FROM scouting_history
      WHERE event_id = ? AND id > ?
      GROUP BY registration_id
      ORDER BY MAX(id) ASC
      LIMIT ?`,
    [eventId, since, MAX_DELTA + 1]
  );

  if (rows.length > MAX_DELTA) return null;
  if (!rows.length) return [];

  const ids = rows.map((r) => r.registration_id);
  const entries = await all(
    `${SELECT_ROSTER}
      WHERE p.event_id = ? AND p.registration_id IN (${ids.map(() => '?').join(',')})`,
    [eventId, ...ids]
  );

  // Keyed and re-ordered by the history, not by whatever order the join came back in. A
  // player can also be missing entirely — withdrawn upstream and synced away — while their
  // history rows stay behind, so this is a filter as much as a sort.
  const byId = new Map(entries.map((row) => [row.registration_id, rowToRosterEntry(row)]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

module.exports = {
  getEventId,
  setEventId,
  getEventMeta,
  getSyncedAt,
  syncRoster,
  listParticipants,
  getParticipant,
  listRoster,
  getRosterEntry,
  cursorNow,
  pollState,
  changedSince,
  sortInks,
  parseJsonArray,
  INK_ORDER,
};
