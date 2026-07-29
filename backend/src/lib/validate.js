const { INK_ORDER } = require('./roster');

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const CONFIDENCE = ['rumor', 'likely', 'confirmed'];
const MAX_INKS = 3;
const MAX_TECH_CARDS = 24;

function str(value, { max, field, trim = true }) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new ValidationError(`${field} must be text`);
  const out = trim ? value.trim() : value;
  if (!out) return null;
  if (out.length > max) throw new ValidationError(`${field} must be ${max} characters or fewer`);
  return out;
}

function parseEventId(value) {
  const id = String(value ?? '').trim();
  if (!/^\d{1,12}$/.test(id)) {
    throw new ValidationError('Event ID must be numeric, e.g. 767473');
  }
  return id;
}

function parseInks(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new ValidationError('inks must be an array');

  const unique = [...new Set(value.map((v) => String(v).toLowerCase()))];
  for (const ink of unique) {
    if (!INK_ORDER.includes(ink)) throw new ValidationError(`Unknown ink "${ink}"`);
  }
  if (unique.length > MAX_INKS) {
    throw new ValidationError(`A deck can have at most ${MAX_INKS} inks`);
  }
  return unique.sort((a, b) => INK_ORDER.indexOf(a) - INK_ORDER.indexOf(b));
}

function parseTechCards(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new ValidationError('techCards must be an array');
  if (value.length > MAX_TECH_CARDS) {
    throw new ValidationError(`At most ${MAX_TECH_CARDS} tech cards`);
  }

  const seen = new Set();
  const out = [];

  for (const entry of value) {
    // Accept either a plain card name or the full object the autocomplete returns.
    const raw = typeof entry === 'string' ? { name: entry } : entry || {};
    const name = str(raw.name, { max: 120, field: 'tech card name' });
    if (!name) continue;

    const title = str(raw.title, { max: 120, field: 'tech card title' });
    const id = `${name}|${title || ''}`;
    if (seen.has(id)) continue;
    seen.add(id);

    out.push({
      id,
      name,
      title,
      fullName: title ? `${name} — ${title}` : name,
      inks: Array.isArray(raw.inks)
        ? raw.inks.filter((i) => INK_ORDER.includes(String(i).toLowerCase()))
        : [],
      cost: Number.isFinite(raw.cost) ? raw.cost : null,
      type: str(raw.type, { max: 30, field: 'tech card type' }),
    });
  }

  return out;
}

/**
 * Merge semantics, not replace: a key the caller left out keeps whatever the stored
 * report already had. The app only collects inks and a note now, so a save from the
 * sheet must not silently wipe an archetype or tech card list somebody filed earlier
 * under the older UI.
 *
 * `null` still means "clear this field" — only a missing key is treated as "leave it".
 *
 * @param body      request payload
 * @param previous  the stored report in API shape, or null when there is none yet
 */
function parseScouting(body, previous = null) {
  const payload = body || {};
  const sent = (key) => payload[key] !== undefined;
  const kept = previous || {};

  const confidence = sent('confidence')
    ? String(payload.confidence || 'confirmed').toLowerCase()
    : kept.confidence || 'confirmed';
  if (!CONFIDENCE.includes(confidence)) {
    throw new ValidationError(`confidence must be one of ${CONFIDENCE.join(', ')}`);
  }

  const parsed = {
    inks: sent('inks') ? parseInks(payload.inks) : parseInks(kept.inks),
    archetype: sent('archetype')
      ? str(payload.archetype, { max: 80, field: 'archetype' })
      : kept.archetype || null,
    techCards: sent('techCards')
      ? parseTechCards(payload.techCards)
      : parseTechCards(kept.techCards),
    notes: sent('notes') ? str(payload.notes, { max: 1200, field: 'notes' }) : kept.notes || null,
    confidence,
    scoutName: sent('scoutName')
      ? str(payload.scoutName, { max: 40, field: 'scout name' })
      : kept.scoutName || null,
  };

  // An empty report is a delete in disguise — reject it so callers use DELETE explicitly.
  const empty =
    parsed.inks.length === 0 &&
    !parsed.archetype &&
    parsed.techCards.length === 0 &&
    !parsed.notes;
  if (empty) {
    throw new ValidationError('Add at least an ink or a note');
  }

  return parsed;
}

function parseRegistrationId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError('Invalid participant id');
  return id;
}

module.exports = {
  ValidationError,
  parseEventId,
  parseInks,
  parseTechCards,
  parseScouting,
  parseRegistrationId,
  str,
  CONFIDENCE,
};
