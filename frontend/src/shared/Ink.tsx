import type { CSSProperties } from 'react';
import type { InkId } from '@/lib/types';
import { INK_ART, INK_PLATE, INK_VIEWBOX } from './inkArt';
import { INK_BY_ID, inkPairLabel, sortInks } from './inks';

/** Plate heights. The width follows from the hexagon's ratio, applied once in `.ink`. */
type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const sizeClass: Record<Size, string> = {
  xs: 'ink-xs',
  sm: 'ink-sm',
  md: '',
  lg: 'ink-lg',
  xl: 'ink-xl',
};

interface InkProps {
  id: InkId;
  size?: Size;
  title?: string;
}

/**
 * One hexagonal ink plate, straight from the artwork. Its three colours are written out
 * as custom properties rather than baked into the paths, so whatever surrounds a plate
 * can be tinted in the same shades — and so the picker can drain a deselected plate of
 * colour without swapping geometry.
 */
export function Ink({ id, size = 'md', title }: InkProps) {
  const ink = INK_BY_ID[id];
  const art = INK_ART[id];
  if (!ink || !art) return null;

  return (
    <span
      className={`ink ${sizeClass[size]}`.trim()}
      title={title ?? ink.label}
      aria-hidden="true"
      style={
        {
          '--core': art.core,
          '--rim': art.rim,
          '--glyph': art.glyph,
        } as CSSProperties
      }
    >
      <svg viewBox={INK_VIEWBOX} role="presentation">
        <path d={INK_PLATE} fill="var(--core)" stroke="var(--rim)" strokeWidth="8" />
        <g fill="var(--glyph)" stroke="var(--glyph)" strokeWidth="1">
          {art.paths.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
      </svg>
    </span>
  );
}

/**
 * The empty socket: the same hexagon as a dashed outline. A player with no report shows
 * this instead of plates, so the row reads as a slot waiting for paint rather than as a
 * row where something failed to load.
 */
export function InkSlot({ size = 'md' }: { size?: Size }) {
  return (
    <span className={`ink ink-slot ${sizeClass[size]}`.trim()} aria-hidden="true">
      <svg viewBox={INK_VIEWBOX} role="presentation">
        <path
          d={INK_PLATE}
          fill="none"
          stroke="currentColor"
          strokeWidth="7"
          strokeDasharray="24 19"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

interface InkPairProps {
  inks: InkId[];
  size?: Size;
  /** Draw the dashed socket when there are no inks on file, instead of nothing. */
  placeholder?: boolean;
}

/**
 * A deck's whole identity as one mark: one or two plates interlocked along their flat
 * edges the way they would sit in a honeycomb. The overlap keeps a pair narrow enough to
 * ride at the end of a list row on a phone and still be countable at a glance.
 */
export function InkPair({ inks, size = 'md', placeholder = false }: InkPairProps) {
  const ordered = sortInks(inks ?? []);

  if (!ordered.length) {
    return placeholder ? (
      <span className="ink-pair" role="img" aria-label="Brak decka">
        <InkSlot size={size} />
      </span>
    ) : null;
  }

  return (
    <span className="ink-pair" role="img" aria-label={inkPairLabel(ordered)}>
      {ordered.map((id) => (
        <Ink key={id} id={id} size={size} />
      ))}
    </span>
  );
}
