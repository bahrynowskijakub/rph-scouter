const express = require('express');
const { one, all, batch } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { getEventId, getRosterEntry, parseJsonArray, cursorNow } = require('../lib/roster');
const { parseScouting, parseRegistrationId } = require('../lib/validate');

const router = express.Router();

const UPSERT_REPORT = `
  INSERT INTO scouting (
    event_id, registration_id, inks, archetype, tech_cards, notes,
    confidence, scout_name, created_at, updated_at
  ) VALUES (
    @eventId, @registrationId, @inks, @archetype, @techCards, @notes,
    @confidence, @scoutName, @now, @now
  )
  ON CONFLICT (event_id, registration_id) DO UPDATE SET
    inks       = excluded.inks,
    archetype  = excluded.archetype,
    tech_cards = excluded.tech_cards,
    notes      = excluded.notes,
    confidence = excluded.confidence,
    scout_name = excluded.scout_name,
    updated_at = excluded.updated_at
`;

const INSERT_HISTORY = `
  INSERT INTO scouting_history (
    event_id, registration_id, action, payload, scout_name, actor, created_at
  ) VALUES (@eventId, @registrationId, @action, @payload, @scoutName, @actor, @now)
`;

/**
 * Anyone may file or update a report — that is the point of a shared scouting sheet. Every
 * write is appended to the history table so the admin can see who changed what, and the two
 * go in one batch: libSQL wraps it in a transaction, so the cursor the history row defines
 * can never name a state the scouting table has not reached.
 */
function saveReport(eventId, registrationId, data, actor) {
  const now = new Date().toISOString();
  return batch([
    {
      sql: UPSERT_REPORT,
      args: {
        eventId,
        registrationId,
        inks: JSON.stringify(data.inks),
        archetype: data.archetype,
        techCards: JSON.stringify(data.techCards),
        notes: data.notes,
        confidence: data.confidence,
        scoutName: data.scoutName,
        now,
      },
    },
    {
      sql: INSERT_HISTORY,
      args: {
        eventId,
        registrationId,
        action: 'save',
        payload: JSON.stringify(data),
        scoutName: data.scoutName,
        actor,
        now,
      },
    },
  ]);
}

/**
 * Clearing a report, without an interactive transaction.
 *
 * The read has to happen first — the history row carries what was there — but it happens
 * *outside* the write, so by the time the batch runs the row may already be gone. The guard
 * is therefore in the SQL: the history INSERT is conditional on the row still existing, and
 * it runs before the DELETE so it can still see it. Two scouts clearing the same player at
 * the same moment produce one deletion and one log line, not two.
 *
 * Answering from the DELETE's own `rowsAffected` is what makes the 404 honest.
 */
async function deleteReport(eventId, registrationId, actor, scoutName) {
  const existing = await one(
    'SELECT * FROM scouting WHERE event_id = ? AND registration_id = ?',
    [eventId, registrationId]
  );
  if (!existing) return false;

  const now = new Date().toISOString();
  const [, removed] = await batch([
    {
      sql: `INSERT INTO scouting_history
              (event_id, registration_id, action, payload, scout_name, actor, created_at)
            SELECT ?, ?, 'delete', ?, ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM scouting WHERE event_id = ? AND registration_id = ?)`,
      args: [
        eventId,
        registrationId,
        JSON.stringify(existing),
        scoutName || null,
        actor,
        now,
        eventId,
        registrationId,
      ],
    },
    {
      sql: 'DELETE FROM scouting WHERE event_id = ? AND registration_id = ?',
      args: [eventId, registrationId],
    },
  ]);

  return removed.rowsAffected > 0;
}

/** Public: every report for the current event, keyed by registration id. */
router.get('/', async (req, res, next) => {
  try {
    const eventId = await getEventId();
    const rows = await all('SELECT * FROM scouting WHERE event_id = ?', [eventId]);
    res.json({
      eventId,
      reports: Object.fromEntries(rows.map((r) => [r.registration_id, r])),
    });
  } catch (err) {
    next(err);
  }
});

/** The stored report in API shape, so validation never has to know the column names. */
async function previousReport(eventId, registrationId) {
  const row = await one(
    'SELECT * FROM scouting WHERE event_id = ? AND registration_id = ?',
    [eventId, registrationId]
  );
  if (!row) return null;

  return {
    inks: parseJsonArray(row.inks),
    archetype: row.archetype || null,
    techCards: parseJsonArray(row.tech_cards),
    notes: row.notes || null,
    confidence: row.confidence || 'confirmed',
    scoutName: row.scout_name || null,
  };
}

/**
 * Public write: mark what deck a player is on. The payload only has to carry the fields it
 * wants to change — see `parseScouting`.
 */
router.put('/:registrationId', async (req, res, next) => {
  try {
    const eventId = await getEventId();
    const registrationId = parseRegistrationId(req.params.registrationId);

    if (!(await getRosterEntry(eventId, registrationId))) {
      return res.status(404).json({ error: 'That player is not on this event roster' });
    }

    const data = parseScouting(req.body, await previousReport(eventId, registrationId));
    await saveReport(eventId, registrationId, data, req.admin ? 'admin' : 'visitor');

    // Answer with the list-shaped player, so the client can patch its cached roster instead
    // of re-downloading every row after one save. Same shape the delta poll returns, so the
    // writer's own phone and every other one apply it through one path.
    const participant = await getRosterEntry(eventId, registrationId);
    // The cursor rides along so this response is orderable against the deltas the writer may
    // already have applied. Without it a slow response can arrive after a newer delta about
    // the same player and quietly revert it on the writer's phone only.
    res.json({ participant, cursor: await cursorNow(eventId) });
  } catch (err) {
    next(err);
  }
});

/** Public: clear a report you filed by mistake. Recorded in history either way. */
router.delete('/:registrationId', async (req, res, next) => {
  try {
    const eventId = await getEventId();
    const registrationId = parseRegistrationId(req.params.registrationId);

    const removed = await deleteReport(
      eventId,
      registrationId,
      req.admin ? 'admin' : 'visitor',
      req.query.scoutName
    );
    if (!removed) return res.status(404).json({ error: 'Nothing to clear' });

    // A clear is not a shape of its own — the entry just comes back with scouting: null now
    // that the joined row is gone, which is exactly what a delta carries too.
    const participant = await getRosterEntry(eventId, registrationId);
    res.json({ participant, cursor: await cursorNow(eventId) });
  } catch (err) {
    next(err);
  }
});

/** Admin: the audit trail behind the public numbers. */
router.get('/history/all', requireAdmin, async (req, res, next) => {
  try {
    const eventId = await getEventId();
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

    const rows = await all(
      `SELECT h.*, p.display_name
         FROM scouting_history h
         LEFT JOIN participants p
           ON p.event_id = h.event_id AND p.registration_id = h.registration_id
        WHERE h.event_id = ?
        ORDER BY h.created_at DESC, h.id DESC
        LIMIT ?`,
      [eventId, limit]
    );

    res.json({
      history: rows.map((r) => ({
        id: r.id,
        registrationId: r.registration_id,
        displayName: r.display_name || `#${r.registration_id}`,
        action: r.action,
        scoutName: r.scout_name,
        actor: r.actor,
        createdAt: r.created_at,
        payload: (() => {
          try {
            return JSON.parse(r.payload);
          } catch {
            return null;
          }
        })(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
