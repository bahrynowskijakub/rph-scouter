import { useMemo, useState } from 'react';
import { useDebounced, useRoster } from '@/lib/hooks';
import { normalize } from '@/lib/format';
import type { Participant } from '@/lib/types';
import ScoutModal from '@/features/scouting/ScoutModal';
import RosterRow from './RosterRow';

/** The nick is what the list reads; a handful of registrations only have a real name. */
const nickOf = (p: Participant) => p.handle?.trim() || p.displayName;

function SearchIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="10.6" cy="10.6" r="6.9" />
      <path d="M15.7 15.7 20.7 20.7" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
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

export default function RosterPage() {
  const { data, isPending, error } = useRoster();

  const [query, setQuery] = useState('');

  /**
   * The open player is *held*, not looked up. Deriving it from the list meant any change
   * that removed the row — a drop-out arriving in a refresh, and now any live push at all —
   * unmounted the sheet mid-edit and took the scout's half-typed note with it. Push turned
   * that from a ninety-second window into an instant one.
   */
  const [selected, setSelected] = useState<Participant | null>(null);

  // Typing stays smooth on a phone even with a few hundred rows in the tree.
  const search = useDebounced(query.trim());

  const participants = data?.participants ?? [];

  /**
   * One pass over the roster: search index, then the only ordering this app has —
   * everyone already scouted first, alphabetical by nick inside each half. Players who
   * withdrew sink to the bottom of their group.
   */
  const { scouted, rest } = useMemo(() => {
    const needle = normalize(search);

    const matched = participants.filter((p) => {
      if (!needle) return true;
      // Both names go into the haystack: the list reads by nick, but a pairing slip
      // shows the real name.
      return normalize(`${p.handle ?? ''} ${p.displayName}`).includes(needle);
    });

    const byNick = (a: Participant, b: Participant) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return nickOf(a).localeCompare(nickOf(b), 'pl', { sensitivity: 'base' });
    };

    return {
      scouted: matched.filter((p) => p.scouting).sort(byNick),
      rest: matched.filter((p) => !p.scouting).sort(byNick),
    };
  }, [participants, search]);

  // Both groups are drawn, so the running index keeps the arrival cascade in order.
  let row = 0;

  const found = scouted.length + rest.length;

  return (
    <>
      {/* Chrome, not content: the search runs edge to edge straight under the nameplate
          and sticks there, so it is never something you scroll back up to look for. */}
      <div className="searchbar">
        <div className="container">
          <div className="search">
            <span className="search-icon">
              <SearchIcon />
            </span>
            <input
              className="search-field"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Szukaj gracza"
              aria-label="Szukaj gracza"
              enterKeyHint="search"
              inputMode="search"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {query && (
              <>
                <span className="search-count" aria-live="polite">
                  {found}
                </span>
                <button
                  type="button"
                  className="search-clear"
                  onClick={() => setQuery('')}
                  aria-label="Wyczyść szukanie"
                >
                  <CloseIcon />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* No heading over the list: the tournament's name rides in the header, where it
          survives the scroll and costs no vertical space on a phone. */}
      <div className="container">
        <div className="roster roster-enter">
          {/* A failed refresh never blanks the list — say so and keep showing what we have.
              Which side broke matters at a venue: your phone, or Ravensburger Play. */}
          {data && (error || data.syncWarning) && (
            <p className="notice" role="status">
              {error
                ? 'Brak połączenia. Pokazuję listę zapisaną na tym telefonie.'
                : 'Nie udało się odświeżyć listy z Ravensburger Play. Pokazuję ostatnią zapisaną kopię.'}
            </p>
          )}

          {isPending ? (
            <div className="group-cards">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="skeleton skeleton-player" />
              ))}
            </div>
          ) : !data ? (
            <p className="roster-error">{(error as Error)?.message ?? 'Nie udało się wczytać listy.'}</p>
          ) : scouted.length === 0 && rest.length === 0 ? (
            <p className="roster-empty">
              {participants.length === 0
                ? 'Brak zawodników na liście.'
                : `Nikt nie pasuje do „${search}”.`}
            </p>
          ) : (
            <>
              {/* Two groups, deliberately built as two different things: filed reports are
                  cards with air around them, everyone else is a ruled index. The change of
                  texture is what tells you where the intelligence stops. */}
              {scouted.length > 0 && (
                <section className="group">
                  <h2 className="group-label">
                    Zescoutowani
                    <span className="group-count">{scouted.length}</span>
                  </h2>
                  <div className="group-cards">
                    {scouted.map((p) => (
                      <RosterRow
                        key={p.registrationId}
                        participant={p}
                        nick={nickOf(p)}
                        index={row++}
                        onSelect={() => setSelected(p)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {rest.length > 0 && (
                <section className="group">
                  {/* Unlabelled when it is the only group — there is nothing to tell it
                      apart from. */}
                  {scouted.length > 0 && (
                    <h2 className="group-label">
                      Pozostali
                      <span className="group-count">{rest.length}</span>
                    </h2>
                  )}
                  <div className="group-rows">
                    {rest.map((p) => (
                      <RosterRow
                        key={p.registrationId}
                        participant={p}
                        nick={nickOf(p)}
                        index={row++}
                        onSelect={() => setSelected(p)}
                      />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          <p className="footnote">
            Disney Lorcana i symbole atramentów są znakami towarowymi Ravensburger AG. Ta
            aplikacja jest niezależnym narzędziem fanowskim i nie jest z nimi powiązana.
          </p>
        </div>
      </div>

      {selected && (
        <ScoutModal
          participant={selected}
          nick={nickOf(selected)}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
