const express = require('express');
const { one, all, run } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { parseInks, str, ValidationError } = require('../lib/validate');

const router = express.Router();

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
  };
}

/** Public: the preset list offered in the scouting modal. */
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

/** Admin: add a preset the meta threw up mid-event. */
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const name = str(req.body?.name, { max: 80, field: 'name' });
    if (!name) throw new ValidationError('Archetype name is required');

    const inks = parseInks(req.body?.inks);
    const style = str(req.body?.style, { max: 30, field: 'style' });
    const note = str(req.body?.note, { max: 200, field: 'note' });

    const existing = await one('SELECT id FROM archetypes WHERE name = ?', [name]);
    if (existing) throw new ValidationError('That archetype already exists');

    const info = await run(
      `INSERT INTO archetypes (name, inks, style, note, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, JSON.stringify(inks), style, note, 500, new Date().toISOString()]
    );

    // libSQL hands back a BigInt here, which is not a thing to bind straight back into a
    // query or hand to JSON.
    const row = await one('SELECT * FROM archetypes WHERE id = ?', [
      Number(info.lastInsertRowid),
    ]);
    res.status(201).json({ archetype: toArchetype(row) });
  } catch (err) {
    next(err);
  }
});

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
