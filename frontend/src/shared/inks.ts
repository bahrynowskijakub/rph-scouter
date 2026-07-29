import type { InkId } from '@/lib/types';

export interface InkDef {
  id: InkId;
  label: string;
  /** What the plate depicts — documentation for whoever redraws the SVG. */
  motif: string;
}

/**
 * The six inks in Lorcana's own order. The artwork lives in `public/inkColors` and is
 * compiled into `inkArt.ts` by `scripts/gen-ink-art.mjs`; this list carries only the
 * naming and the ordering — and the ordering is what guarantees a deck always reads
 * "Amber / Steel" and never "Steel / Amber".
 */
export const INKS: InkDef[] = [
  { id: 'amber', label: 'Amber', motif: 'sun' },
  { id: 'amethyst', label: 'Amethyst', motif: 'swirl' },
  { id: 'emerald', label: 'Emerald', motif: 'sprig' },
  { id: 'ruby', label: 'Ruby', motif: 'flame' },
  { id: 'sapphire', label: 'Sapphire', motif: 'cut stone' },
  { id: 'steel', label: 'Steel', motif: 'blade' },
];

export const INK_BY_ID: Record<InkId, InkDef> = Object.fromEntries(
  INKS.map((ink) => [ink.id, ink])
) as Record<InkId, InkDef>;

export const INK_ORDER: InkId[] = INKS.map((i) => i.id);

/** Canonical order, so Amber/Steel never also renders as Steel/Amber. */
export function sortInks(inks: InkId[]): InkId[] {
  return [...inks].sort((a, b) => INK_ORDER.indexOf(a) - INK_ORDER.indexOf(b));
}

export function inkPairLabel(inks: InkId[]): string {
  if (!inks.length) return 'Nieznany';
  return sortInks(inks)
    .map((i) => INK_BY_ID[i]?.label ?? i)
    .join(' / ');
}
