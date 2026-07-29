import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { keys, useAdmin, useEvent } from '@/lib/hooks';
import { plural, relativeTime } from '@/lib/format';
import { InkPair } from '@/shared/Ink';
import LoginGate from './LoginGate';

/**
 * The event's state as three readouts before any control — which tournament is loaded,
 * how many players came back with it, and how long ago. An organiser opens this page to
 * check exactly those, usually with a hall waiting on them.
 */
function EventPanel() {
  const { data: event } = useEvent();
  const qc = useQueryClient();
  const [eventId, setEventId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: keys.event });
    void qc.invalidateQueries({ queryKey: keys.roster });
  };

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setMessage(await action());
      refreshAll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const switchEvent = () =>
    run(async () => {
      const result = await api.event.set(eventId.trim());
      setEventId('');
      return `Przełączono na „${result.meta?.name ?? eventId}” (${result.participantCount} graczy).`;
    });

  const refreshRoster = () =>
    run(async () => {
      const result = await api.event.refresh();
      return `Lista odświeżona — ${result.participantCount} graczy.`;
    });

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Wydarzenie</h2>
        <p className="panel-note">ID {event?.eventId ?? '—'}</p>
      </div>

      <div className="panel-body">
        <div className="stat-strip">
          <div className="stat">
            <span className="stat-key">Turniej</span>
            <span className="stat-val" title={event?.meta?.name ?? undefined}>
              {event?.meta?.name ?? '—'}
            </span>
          </div>
          <div className="stat">
            <span className="stat-key">Gracze</span>
            <span className="stat-val">{event?.participantCount ?? 0}</span>
          </div>
          <div className="stat">
            <span className="stat-key">Odświeżone</span>
            <span className="stat-val">{relativeTime(event?.syncedAt ?? null)}</span>
          </div>
        </div>

        <div>
          <span className="label">Nowe ID wydarzenia</span>
          <input
            className="input"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            placeholder="np. 767473"
            inputMode="numeric"
          />
        </div>

        <div className="field-row">
          <button
            type="button"
            className="btn btn-primary btn-grow"
            onClick={switchEvent}
            disabled={busy || !eventId.trim()}
          >
            Przełącz
          </button>
          <button type="button" className="btn btn-grow" onClick={refreshRoster} disabled={busy}>
            Odśwież listę
          </button>
        </div>

        <p className="panel-hint">
          ID znajdziesz w adresie wydarzenia na Ravensburger Play. Sprawdzam je w API przed
          zapisaniem, więc literówka nic nie zepsuje.
        </p>

        {message && <p className="panel-said">{message}</p>}
        {error && <p className="error-text">{error}</p>}
      </div>
    </section>
  );
}

/**
 * Public writes are anonymous by design, so `actor` plus a timestamp is the whole audit
 * trail. The ink pair rides along because "kto ruszył Kubę" is nearly always really
 * "na co zmienili Kubę".
 */
function HistoryPanel() {
  const { data } = useQuery({
    queryKey: keys.history,
    queryFn: () => api.scouting.history(120),
  });

  const history = data?.history ?? [];

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Historia zmian</h2>
        <p className="panel-note">
          {history.length
            ? `${history.length} ${plural(history.length, 'wpis', 'wpisy', 'wpisów')}`
            : 'pusto'}
        </p>
      </div>

      <div className="panel-body">
        {history.length === 0 ? (
          <p className="log-empty">Jeszcze nic się nie stało.</p>
        ) : (
          <div className="log">
            {history.map((h) => (
              <div key={h.id} className="log-row">
                <span className={h.action === 'delete' ? 'badge badge-danger' : 'badge'}>
                  {h.action === 'delete' ? 'usunięto' : 'zapis'}
                </span>
                {h.payload?.inks && h.payload.inks.length > 0 && (
                  <InkPair inks={h.payload.inks} size="xs" />
                )}
                <span className="log-name">{h.displayName}</span>
                <span className="log-time">
                  {h.scoutName || h.actor} · {relativeTime(h.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default function AdminPage() {
  const { data, isPending } = useAdmin();
  const qc = useQueryClient();

  if (isPending) {
    return (
      <div className="container" style={{ paddingTop: 28 }}>
        <div className="skeleton" style={{ height: 150, borderRadius: 18 }} />
      </div>
    );
  }

  // Reaching this route IS the login prompt — there is no login button anywhere else.
  if (!data?.admin) return <LoginGate />;

  return (
    <div className="container page">
      <div className="page-head">
        <div className="page-head-body">
          <h1 className="page-title">Panel admina</h1>
          <p className="page-sub">Zalogowany jako {data.admin.username}.</p>
        </div>
        <button
          type="button"
          className="btn btn-sm"
          onClick={async () => {
            await api.auth.logout();
            void qc.invalidateQueries({ queryKey: keys.me });
          }}
        >
          Wyloguj
        </button>
      </div>

      <EventPanel />
      <HistoryPanel />
    </div>
  );
}
