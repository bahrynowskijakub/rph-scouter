import { useEffect, useState } from 'react';
import type { InkId, Participant } from '@/lib/types';
import { useArchetypes, useClearScouting, useSaveScouting } from '@/lib/hooks';
import { defaultArchetypeFor } from '@/shared/archetypes';
import { inkPairLabel, sortInks } from '@/shared/inks';
import { InkPair } from '@/shared/Ink';
import Sheet from '@/shared/Sheet';
import InkPicker from './InkPicker';
import ArchetypePicker from './ArchetypePicker';

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
 * A swipeable bottom sheet with three things in it: which inks the deck runs, which archetype
 * it is, and a description. Every write is still appended to `scouting_history` with `actor`
 * (visitor/admin) — there is no longer a field asking the scout for their own nick, so
 * that column is all the attribution the audit trail gets.
 *
 * The archetype sits between the two on purpose: the inks above it decide which presets it can
 * offer, and it takes over most of what people were writing into the note below it — a picked
 * archetype is countable, the same words typed freehand are not.
 *
 * The gesture, the scroll lock and Escape all live in `Sheet`; what is left here is the
 * form and the two writes it can make.
 */
export default function ScoutModal({ participant, nick, onClose }: Props) {
  const existing = participant.scouting;

  const [inks, setInks] = useState<InkId[]>(() => sortInks(existing?.inks ?? []));
  const [archetype, setArchetype] = useState<string | null>(existing?.archetype ?? null);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const { data: presets } = useArchetypes();
  const save = useSaveScouting();
  const clear = useClearScouting();
  const busy = save.isPending || clear.isPending;

  /* ───────────────────────── the archetype the pair starts on ─────────────────────────
     Tapping in a pair preselects the deck the meta says is most likely for it, because on the
     overwhelming majority of players that guess is simply right, and one tap beats two.

     `settledPair` is what keeps that from being destructive. It starts as the pair of the report
     already on file, so opening a sheet never rewrites what somebody filed — not even when their
     archetype disagrees with their inks, which is a mismatch a human should see rather than have
     silently corrected. It only advances once a default has actually been applied, so the pair
     changing while the preset list is still in flight does not lose the default; the effect
     re-runs when the list lands.

     And because it advances, whatever the scout picks instead of the default sticks: the deps
     stop changing, so nothing re-fills it until the colours are touched again.                */
  const pairKey = sortInks(inks).join(',');
  const [settledPair, setSettledPair] = useState(() => sortInks(existing?.inks ?? []).join(','));

  useEffect(() => {
    if (pairKey === settledPair) return;

    if (!pairKey) {
      // Every colour deselected. A preset belongs to a pair, so there is nothing left to hold.
      setSettledPair('');
      setArchetype(null);
      return;
    }

    if (!presets) return;

    setSettledPair(pairKey);
    setArchetype(defaultArchetypeFor(presets, sortInks(inks)));
  }, [pairKey, settledPair, presets, inks]);

  const empty = inks.length === 0 && !archetype && !notes.trim();

  const submit = async () => {
    setError(null);
    try {
      await save.mutateAsync({
        id: participant.registrationId,
        input: { inks: sortInks(inks), archetype, notes: notes.trim() || null },
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
        <span className="label">Archetyp</span>
        <ArchetypePicker
          inks={inks}
          presets={presets ?? []}
          value={archetype}
          onChange={setArchetype}
        />
      </div>

      <div>
        <span className="label">Opis</span>
        <textarea
          className="input textarea"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Tech karty, co zagrał, na co uważać"
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
