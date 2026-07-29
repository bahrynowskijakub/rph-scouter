const express = require('express');
const { getEventId, listParticipants, INK_ORDER } = require('../lib/roster');

const router = express.Router();

/**
 * Meta breakdown of everything scouted so far. Computed on read — the field is small
 * enough that this is cheaper and always consistent with the roster.
 */
router.get('/', async (_req, res, next) => {
  try {
    const eventId = await getEventId();
    const participants = (await listParticipants(eventId)).filter((p) => p.active);
    const scouted = participants.filter((p) => p.scouting);

    const inkPairs = new Map();
    const archetypes = new Map();
    const inkUsage = new Map(INK_ORDER.map((ink) => [ink, 0]));
    const techCards = new Map();
    const scouts = new Map();

    for (const p of scouted) {
      const { inks, archetype, techCards: cards, scoutName } = p.scouting;

      if (inks.length) {
        const key = inks.join('/');
        const entry = inkPairs.get(key) || { inks, count: 0 };
        entry.count += 1;
        inkPairs.set(key, entry);
        for (const ink of inks) inkUsage.set(ink, (inkUsage.get(ink) || 0) + 1);
      }

      if (archetype) {
        const entry = archetypes.get(archetype) || { name: archetype, inks, count: 0 };
        entry.count += 1;
        archetypes.set(archetype, entry);
      }

      for (const card of cards) {
        const entry = techCards.get(card.id) || { ...card, count: 0 };
        entry.count += 1;
        techCards.set(card.id, entry);
      }

      if (scoutName) scouts.set(scoutName, (scouts.get(scoutName) || 0) + 1);
    }

    const byCount = (a, b) => b.count - a.count || a.name?.localeCompare?.(b.name) || 0;

    res.json({
      eventId,
      totals: {
        participants: participants.length,
        scouted: scouted.length,
        unscouted: participants.length - scouted.length,
        coverage: participants.length ? scouted.length / participants.length : 0,
      },
      inkPairs: [...inkPairs.values()]
        .map((e) => ({ ...e, name: e.inks.join('/') }))
        .sort(byCount),
      archetypes: [...archetypes.values()].sort(byCount),
      inkUsage: INK_ORDER.map((ink) => ({ ink, count: inkUsage.get(ink) || 0 })),
      topTechCards: [...techCards.values()].sort(byCount).slice(0, 15),
      scouts: [...scouts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
