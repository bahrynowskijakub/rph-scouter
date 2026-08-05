import type { CSSProperties } from 'react';
import type { Participant } from '@/lib/types';
import { InkPair } from '@/shared/Ink';
import { inkPairLabel, sortInks } from '@/shared/inks';

interface Props {
  participant: Participant;
  nick: string;
  /** Position in the rendered list, for the staggered arrival. */
  index: number;
  onSelect: () => void;
}

/**
 * Two lines: who they are and what they play on the first, what somebody saw on the
 * second. The card carries no marker beside the nick — its own fill is washed with the
 * deck's colours instead, so the colour of a row *is* the deck rather than a stripe
 * reporting on it, and scrolling the list is still reading a column of paint.
 */
export default function RosterRow({ participant, nick, index, onSelect }: Props) {
  const { scouting } = participant;
  // Sorted once here so the wash, the plates and the label all agree on which ink leads.
  const inks = sortInks(scouting?.inks ?? []);
  // Just "Elinor" — the plates two centimetres to the right are saying the colours, in colour,
  // which is why the stored label does not carry them.
  const archetype = scouting?.archetype || null;

  const classes = ['player'];
  if (!scouting) classes.push('player-blank');
  if (!participant.active) classes.push('player-out');

  return (
    <button
      type="button"
      className={classes.join(' ')}
      onClick={onSelect}
      aria-label={
        scouting
          ? `${nick} — ${inkPairLabel(inks)}${archetype ? `, ${archetype}` : ''}. Edytuj.`
          : `${nick} — brak decka. Uzupełnij.`
      }
      style={
        {
          // Past a dozen rows the cascade would outrun the scroll, so the delay caps.
          '--i': Math.min(index, 11),
          // The wash reads left to right in the same order as the plates on the right.
          // A mono-ink deck repeats itself; an empty one leaves both unset, and the
          // gradient collapses to nothing.
          '--c1': inks[0] ? `var(--ink-${inks[0]})` : undefined,
          '--c2': inks[1] ? `var(--ink-${inks[1]})` : inks[0] ? `var(--ink-${inks[0]})` : undefined,
        } as CSSProperties
      }
    >
      <span className="player-head">
        <span className="player-nick">{nick}</span>
        {/* The archetype rides with the nick rather than down on the note line: it is the
            answer to "what does he play", which is the question the row exists for, and the
            note underneath is clamped to two lines it would have to compete for. */}
        {archetype && <span className="player-arch">{archetype}</span>}
        {/* Plates for a filed deck, the dashed socket for an empty one — every row ends
            in the same hexagonal footprint, so the column never goes ragged. */}
        <span className="player-inks">
          <InkPair inks={inks} placeholder />
        </span>
      </span>

      {scouting?.notes && <span className="player-note">{scouting.notes}</span>}
    </button>
  );
}
