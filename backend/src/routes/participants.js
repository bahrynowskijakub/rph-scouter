const express = require('express');
const {
  getEventId,
  getEventMeta,
  getSyncedAt,
  syncRoster,
  listRoster,
  getParticipant,
  cursorNow,
  pollState,
  changedSince,
} = require('../lib/roster');
const { parseRegistrationId } = require('../lib/validate');

const router = express.Router();

/**
 * The whole roster screen in one request: the tournament's name and every player with their
 * report already joined in. Two endpoints used to be needed for this (`/event` for the name,
 * `/participants` for the list), which meant two round trips and two roster freshness checks
 * before anything could be drawn.
 *
 * Searching happens client-side: the field is at most a few hundred players, so shipping the
 * list once keeps typing instant and keeps working when the venue wifi dies.
 */
router.get('/', async (req, res, next) => {
  try {
    const eventId = await getEventId();

    let syncWarning = null;
    try {
      const sync = await syncRoster(eventId);
      syncWarning = sync.error || null;
    } catch (err) {
      // Nothing cached and upstream is down: there is genuinely nothing to draw.
      const cached = await listRoster(eventId);
      if (!cached.length) {
        return res.status(err.status || 502).json({ error: err.message, participants: [] });
      }
      syncWarning = err.message;
    }

    // Read before the list, never after: a cursor from after the rows would let a client that
    // already applied a patch accept this older list as the newer one. Ahead of the rows the
    // worst case is one wasted refetch.
    //
    // Unlike the delta below, this endpoint is not the hot one — one call per phone per five
    // minutes — so it reads the plain way and gets `getSyncedAt`'s fallback for databases
    // written before that value was kept in settings.
    const cursor = await cursorNow(eventId);
    const [eventName, participants, rosterSyncedAt] = await Promise.all([
      getEventMeta(eventId).then((meta) => meta?.name || null),
      listRoster(eventId),
      getSyncedAt(eventId),
    ]);

    // `no-cache` means "keep it, but always revalidate", which together with Express's ETag
    // turns the slow background poll into an empty 304 whenever nobody has filed anything.
    res.set('Cache-Control', 'no-cache');
    res.json({
      eventId,
      eventName,
      participants,
      cursor,
      rosterSyncedAt,
      ...(syncWarning ? { syncWarning } : {}),
    });
  } catch (err) {
    next(err);
  }
});

/* ──────────────────────────────── the delta poll ────────────────────────────────
   What replaced the SSE stream. A phone sends the cursor it last applied and gets one of
   three answers: nothing moved, here are the players whose report changed, or `stale` —
   "that cursor is one I cannot explain, re-read the list".

   Nothing is held open, so there is nothing to keep alive, nothing to resume, and no
   subscriber list living in this process's memory. That last one is the point: it is what
   lets this run behind more than one instance, or on a platform that gives you no
   long-lived instance at all.

   One round trip in the common case, deliberately — this is the request the whole hall
   repeats every few seconds, and its cost is now measured in network calls.

   Registered above `/:registrationId` — below it, `delta` would be parsed as a registration
   id and answered with a validation error.                                              */
router.get('/delta', async (req, res, next) => {
  try {
    const eventId = await getEventId();
    const { cursor, rosterSyncedAt } = await pollState(eventId);
    const since = Number(req.query.since);
    const usable = Number.isInteger(since) && since >= 0 && since <= cursor;

    // The `rosterSyncedAt` half is not a scouting change at all: players registering at the
    // door or dropping out rewrites rows no history id describes, and this is what tells the
    // hall to re-read the list when a pull lands.
    const payload = { eventId, cursor, rosterSyncedAt };

    res.set('Cache-Control', 'no-store');

    // Overwhelmingly the common case: one query and ~90 bytes on the wire.
    if (usable && since === cursor) return res.json(payload);

    // Unusable covers a cursor from another tournament, one this event's history never
    // issued, and a client somehow ahead of us (a restored database). We cannot say what it
    // missed, so we say exactly that instead of guessing.
    const changed = usable ? await changedSince(eventId, since) : null;

    res.json(changed ? { ...payload, changed } : { ...payload, stale: true });
  } catch (err) {
    next(err);
  }
});

/** Full record for one player, including the fields the list no longer carries. */
router.get('/:registrationId', async (req, res, next) => {
  try {
    const participant = await getParticipant(
      await getEventId(),
      parseRegistrationId(req.params.registrationId)
    );
    if (!participant) return res.status(404).json({ error: 'Participant not found' });
    res.json({ participant });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
