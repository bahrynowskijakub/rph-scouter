import type { CSSProperties } from 'react';
import type { InkId } from '@/lib/types';
import { INKS } from '@/shared/inks';
import { INK_ART } from '@/shared/inkArt';
import { Ink } from '@/shared/Ink';

interface Props {
  value: InkId[];
  onChange: (inks: InkId[]) => void;
  max?: number;
}

/**
 * Six plates, three across. The plates are the only artwork in the app and a single row
 * of six shrinks them to thumbnails; the sheet stays scroll-free by keeping the note
 * beneath it short rather than by squashing these.
 *
 * An unpicked colour is drained rather than hidden, so the grid still reads as the six
 * inks and picking one floods its tile back — the choice is the colour arriving, which
 * needs no checkmark to explain.
 */
export default function InkPicker({ value, onChange, max = 2 }: Props) {
  const toggle = (ink: InkId) => {
    if (value.includes(ink)) {
      onChange(value.filter((i) => i !== ink));
      return;
    }
    // A Lorcana deck is two inks, so selecting a third pushes the oldest one out
    // rather than blocking the tap.
    const next = [...value, ink];
    onChange(next.length > max ? next.slice(next.length - max) : next);
  };

  return (
    <div className="ink-grid" role="group" aria-label="Kolory decka">
      {INKS.map((ink) => {
        const on = value.includes(ink.id);
        return (
          <button
            key={ink.id}
            type="button"
            className="ink-tile"
            aria-pressed={on}
            onClick={() => toggle(ink.id)}
            // The tile lights up in the plate's own rim colour, so the glow behind a
            // symbol and the ring around it are literally the same paint.
            style={{ '--rim': INK_ART[ink.id].rim } as CSSProperties}
          >
            {/* Plate size is set by `.ink-tile .ink`, so the row can be retuned in one
                place without six props following it. */}
            <Ink id={ink.id} />
            {ink.label}
          </button>
        );
      })}
    </div>
  );
}
