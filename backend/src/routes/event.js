const express = require('express');
const { one } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { parseEventId } = require('../lib/validate');
const { fetchEvent } = require('../lib/rphClient');
const {
  getEventId,
  setEventId,
  getEventMeta,
  getSyncedAt,
  syncRoster,
} = require('../lib/roster');

const router = express.Router();

async function eventPayload(eventId, sync) {
  const [counted, meta, syncedAt] = await Promise.all([
    one('SELECT COUNT(*) AS n FROM participants WHERE event_id = ? AND active = 1', [eventId]),
    getEventMeta(eventId),
    getSyncedAt(eventId),
  ]);

  return {
    eventId,
    meta,
    participantCount: counted.n,
    syncedAt,
    ...(sync?.error ? { syncWarning: sync.error } : {}),
  };
}

/** Public: which event are we scouting, and how fresh is the roster. */
router.get('/', async (req, res, next) => {
  try {
    const eventId = await getEventId();
    let sync = null;
    try {
      sync = await syncRoster(eventId);
    } catch (err) {
      // Never seen this event before and upstream is down — report it, don't 500.
      return res.status(err.status || 502).json({
        error: err.message,
        eventId,
        meta: null,
        participantCount: 0,
        syncedAt: null,
      });
    }
    res.json(await eventPayload(eventId, sync));
  } catch (err) {
    next(err);
  }
});

/** Admin: point the whole app at a different tournament. */
router.put('/', requireAdmin, async (req, res, next) => {
  try {
    const eventId = parseEventId(req.body?.eventId);

    // Confirm the event exists upstream before committing, so a typo cannot brick the app.
    const meta = await fetchEvent(eventId);

    // Before the response, never after: until the new roster is written there is nothing for
    // the phones to refetch, and the very next delta poll will already be telling them to.
    // Nothing is pushed — every delta carries the current event id, so a phone learns it is
    // looking at the wrong tournament within one poll interval.
    await setEventId(eventId);
    const sync = await syncRoster(eventId, { force: true });

    res.json({ ...(await eventPayload(eventId, sync)), meta, changed: true });
  } catch (err) {
    next(err);
  }
});

/** Re-pull the roster. Visitors are limited by the cache TTL; admins can force it. */
router.post('/refresh', async (req, res, next) => {
  try {
    const eventId = await getEventId();

    // A pull that landed moved `roster_synced_at`, and that is what the delta poll compares —
    // so the hall re-reads the list within one interval, and a TTL-throttled no-op costs
    // nobody a refetch. Neither case needs anything pushed.
    const sync = await syncRoster(eventId, { force: !!req.admin });
    res.json({ ...(await eventPayload(eventId, sync)), synced: sync.synced });
  } catch (err) {
    next(err);
  }
});

/** Admin: preview an event id without switching to it. */
router.get('/lookup/:eventId', requireAdmin, async (req, res, next) => {
  try {
    const meta = await fetchEvent(parseEventId(req.params.eventId));
    res.json({ meta });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
