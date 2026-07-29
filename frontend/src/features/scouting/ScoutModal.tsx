import { useState } from 'react';
import type { InkId, Participant } from '@/lib/types';
import { useClearScouting, useSaveScouting } from '@/lib/hooks';
import { inkPairLabel, sortInks } from '@/shared/inks';
import { InkPair } from '@/shared/Ink';
import Sheet from '@/shared/Sheet';
import InkPicker from './InkPicker';

function CloseIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5" />
    </svg>
  );
}

interface Props {
  participant: Participant;
  nick: string;
  onClose: () => void;
}

/**
 * A swipeable bottom sheet with exactly two things in it: which inks the deck runs, and a
 * description. Every write is still appended to `scouting_history` with `actor`
 * (visitor/admin) — there is no longer a field asking the scout for their own nick, so
 * that column is all the attribution the audit trail gets.
 *
 * The gesture, the scroll lock and Escape all live in `Sheet`; what is left here is the
 * form and the two writes it can make.
 */
export default function ScoutModal({ participant, nick, onClose }: Props) {
  const existing = participant.scouting;

  const [inks, setInks] = useState<InkId[]>(() => sortInks(existing?.inks ?? []));
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = useSaveScouting();
  const clear = useClearScouting();
  const busy = save.isPending || clear.isPending;

  const empty = inks.length === 0 && !notes.trim();

  const submit = async () => {
    setError(null);
    try {
      await save.mutateAsync({
        id: participant.registrationId,
        input: { inks: sortInks(inks), notes: notes.trim() || null },
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onClear = async () => {
    setError(null);
    try {
      await clear.mutateAsync({ id: participant.registrationId });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Sheet
      label={`Deck: ${nick}`}
      locked={busy}
      onClose={onClose}
      head={
        <>
          {/* The mark assembles under your thumb as you tap — the deck taking shape at
              full size while you file it, instead of only after you save. */}
          <span className="sheet-hero">
            <InkPair inks={inks} size="lg" placeholder />
          </span>

          <h2 className="sheet-title">
            <span className="sheet-kicker">
              {inks.length ? inkPairLabel(inks) : 'Deck gracza'}
            </span>
            {nick}
          </h2>

          <button type="button" className="icon-btn" onClick={onClose} aria-label="Zamknij">
            <CloseIcon />
          </button>
        </>
      }
      foot={
        <>
          {existing && (
            <button type="button" className="btn btn-danger" onClick={onClear} disabled={busy}>
              Wyczyść
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary btn-grow"
            onClick={submit}
            disabled={busy || empty}
            title={empty ? 'Wybierz atrament albo napisz opis' : undefined}
          >
            {save.isPending && <span className="spinner" aria-hidden="true" />}
            Zapisz
          </button>
        </>
      }
    >
      <div>
        <span className="label">
          Kolory
          {inks.length > 0 && <span className="label-count">{inks.length}/2</span>}
        </span>
        <InkPicker value={inks} onChange={setInks} />
      </div>

      <div>
        <span className="label">Opis</span>
        <textarea
          className="input textarea"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Archetyp, tech karty itp."
        />
      </div>

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}
