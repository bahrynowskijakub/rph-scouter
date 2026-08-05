const express = require('express');
const { one, all, run } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { parseInks, str, ValidationError } = require('../lib/validate');

const router = express.Router();

/**
 * A ceiling, because anyone past the shared password can add to this list and the list is then
 * offered to everyone. Nothing legitimate approaches it: fifteen ink pairs times a handful of
 * archetypes each is well under a hundred, and the whole point of presets is a list short
 * enough to pick from with a thumb.
 */
const MAX_ARCHETYPES = 300;

function toArchetype(row) {
  let inks = [];
  try {
    inks = JSON.parse(row.inks);
  } catch {
    inks = [];
  }
  return {
    id: row.id,
    name: row.name,
    inks: Array.isArray(inks) ? inks : [],
    style: row.style || null,
    note: row.note || null,
    /** 'seed' is a preset off the meta list; 'user' was typed into the sheet by a scout. */
    source: row.source || 'seed',
  };
}

/** Public: the preset list the scouting sheet filters by the deck's inks. */
router.get('/', async (_req, res, next) => {
  try {
    const rows = await all(
      'SELECT * FROM archetypes ORDER BY sort_order ASC, name COLLATE NOCASE ASC'
    );
    res.json({ archetypes: rows.map(toArchetype) });
  } catch (err) {
    next(err);
  }
});

/**
 * Add an archetype the list does not have yet. Open to anyone past the gate, deliberately:
 * scouting is anonymous by design, the meta moves during an event, and a picker that only the
 * one person holding the admin password can extend would send everybody else back to typing
 * the deck into the free-text note — which is the mess the presets exist to replace.
 *
 * Idempotent rather than strict. Two scouts naming the same new deck a minute apart is the
 * expected case, not an error worth showing them: whoever is second gets the row that already
 * exists, and the sheet selects it as if they had created it.
 *
 * The name is the bare label — "Sid combo", not "Emerald Ruby Sid combo". The pair travels in
 * `inks` and is drawn as plates, so the two together are the identity and neither repeats the
 * other.
 */
router.post('/', async (req, res, next) => {
  try {
    const name = str(req.body?.name, { max: 60, field: 'name' })?.replace(/\s+/g, ' ') ?? null;
    if (!name) throw new ValidationError('Archetype name is required');

    const inks = parseInks(req.body?.inks);
    if (!inks.length) throw new ValidationError('Pick the deck inks first');

    const style = str(req.body?.style, { max: 30, field: 'style' });
    const note = str(req.body?.note, { max: 200, field: 'note' });

    // `parseInks` sorts, so the JSON is canonical and comparable as text.
    const inksJson = JSON.stringify(inks);

    /**
     * Looked up by name *and* inks, the same key the table is unique on. "Midrange" belongs to
     * four different pairs in the current meta, so a name on its own would hand an Amber/Amethyst
     * scout the Amethyst/Steel row.
     *
     * NOCASE on the name because "Elinor" and "elinor" are one preset, and a list holding both is
     * a list nobody trusts. The UNIQUE index is case-sensitive, hence the explicit collation.
     */
    const find = () =>
      one('SELECT * FROM archetypes WHERE name = ? COLLATE NOCASE AND inks = ?', [name, inksJson]);

    const existing = await find();
    if (existing) return res.json({ archetype: toArchetype(existing), created: false });

    const total = (await one('SELECT COUNT(*) AS n FROM archetypes'))?.n ?? 0;
    if (total >= MAX_ARCHETYPES) {
      throw new ValidationError('The archetype list is full — an admin has to prune it');
    }

    // Sorted after every preset, so the meta list stays at the top of each pair's picker — and
    // the top of that list is what the sheet preselects — with additions underneath, in the
    // order somebody thought of them.
    const sortOrder = 1000 + total;

    try {
      await run(
        `INSERT INTO archetypes (name, inks, style, note, sort_order, source, created_at)
         VALUES (?, ?, ?, ?, ?, 'user', ?)`,
        [name, inksJson, style, note, sortOrder, new Date().toISOString()]
      );
    } catch (err) {
      // Lost the race to another scout adding the same one. Their row is the answer.
      const raced = await find();
      if (!raced) throw err;
      return res.json({ archetype: toArchetype(raced), created: false });
    }

    res.status(201).json({ archetype: toArchetype(await find()), created: true });
  } catch (err) {
    next(err);
  }
});

/** Admin only: pruning is the one direction that can throw away somebody else's work. */
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const info = await run('DELETE FROM archetypes WHERE id = ?', [Number(req.params.id)]);
    if (!info.rowsAffected) return res.status(404).json({ error: 'Archetype not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
