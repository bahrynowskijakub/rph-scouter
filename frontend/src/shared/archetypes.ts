import type { Archetype, InkId } from '@/lib/types';
import { sortInks } from './inks';

/* ────────────────────────────── archetypes and their pair ──────────────────────────────
   An archetype is a label plus an ink pair, and the label alone is not enough: inkdecks lists
   "Midrange" for four different pairs and "Evasive" for four more. So everything here takes the
   pair as an argument, and the backend keys its table on (name, inks) to match.

   The label is stored bare — "Elinor", not "Amber Emerald Elinor" — because wherever it is
   rendered the two ink plates are rendered beside it. Saying the colours twice is what the
   plates exist to avoid.                                                                    */

/** Same ink set, order-insensitive. Presets are pairs, and so is the picker. */
function sameInks(a: InkId[], b: InkId[]): boolean {
  if (a.length !== b.length) return false;
  return sortInks(a).join(',') === sortInks(b).join(',');
}

/**
 * The presets to offer for the inks currently picked, most popular first.
 *
 * Ordering is the server's: `sort_order` follows inkdecks' own row order, which is metashare
 * descending. That is load-bearing rather than cosmetic — the first entry is what the sheet
 * preselects when a pair is tapped in, so it has to be the likeliest deck, not the alphabetically
 * luckiest one.
 *
 * With one ink chosen the list is everything containing it, which gives the picker something in
 * it before the second tap. With two, it narrows to that exact pair.
 *
 * `current` is always included, even when it belongs to another pair or to no preset at all.
 * Without that, a report whose inks were edited would drop its own archetype out of the select,
 * and the next save would quietly clear something somebody else filed.
 */
export function archetypesFor(
  all: Archetype[],
  inks: InkId[],
  current?: string | null
): Archetype[] {
  const matches =
    inks.length === 0
      ? []
      : inks.length === 1
        ? all.filter((a) => a.inks.includes(inks[0]))
        : all.filter((a) => sameInks(a.inks, inks));

  if (!current) return matches;
  if (matches.some((a) => a.name.toLowerCase() === current.toLowerCase())) return matches;

  // An orphan: filed under a pair this deck no longer runs, or a preset since retired. Offered
  // first so the select opens showing what is actually stored.
  return [
    { id: -1, name: current, inks: sortInks(inks), style: null, note: null, source: 'user' },
    ...matches,
  ];
}

/**
 * The archetype to start on for a pair: the most popular one the meta lists for it.
 *
 * Null when the pair has no presets at all — Ruby/Sapphire has none in the current meta — which
 * leaves the select on its blank line with only the add option under it. That is the honest
 * state, not a bug to paper over with another pair's archetype.
 */
export function defaultArchetypeFor(all: Archetype[], inks: InkId[]): string | null {
  if (inks.length < 2) return null;
  return archetypesFor(all, inks)[0]?.name ?? null;
}
