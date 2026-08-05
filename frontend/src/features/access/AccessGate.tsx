import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { grantAccess } from '@/lib/access';
import type { AccessProblem } from '@/lib/types';

/**
 * What the owner of a broken deploy needs to read. Nobody else can ever see these: they only
 * appear when the API is refusing every request, so there is no password to type and nothing
 * here to leak to a visitor who would be locked out anyway.
 */
const PROBLEM_COPY: Record<AccessProblem, { title: string; body: React.ReactNode }> = {
  missing_hash: {
    title: 'Brak hasła dostępu',
    body: (
      <>
        Ten deploy nie ma ustawionego <code>ACCESS_PASSWORD_HASH</code>, więc API odmawia
        wszystkiego. Wygeneruj hash przez <code>yarn hash-password</code>, wstaw go w zmiennych
        środowiskowych i zredeployuj.
      </>
    ),
  },
  bad_hash: {
    title: 'Hash hasła jest zepsuty',
    body: (
      <>
        <code>ACCESS_PASSWORD_HASH</code> nie jest hashem bcrypta — najczęściej dlatego, że
        wartość trafiła do panelu razem z apostrofami z pliku <code>.env</code>. Wklej{' '}
        <strong>samą wartość, bez apostrofów</strong>, i zredeployuj.
      </>
    ),
  },
  plaintext_password: {
    title: 'Na produkcji potrzebny jest hash',
    body: (
      <>
        Ten deploy ma <code>ACCESS_PASSWORD</code> zamiast <code>ACCESS_PASSWORD_HASH</code>.
        Plaintext jest skrótem na lokalną pracę; na produkcji hasło nie ma leżeć w zmiennej.
        Wygeneruj hash przez <code>yarn hash-password</code>.
      </>
    ),
  },
  insecure_secret: {
    title: 'JWT_SECRET nie został ustawiony',
    body: (
      <>
        Ten deploy podpisuje ciasteczka wartością domyślną z repo, więc każdy mógłby wystawić
        sobie pass sam — dlatego bramka nie wpuszcza nikogo. Ustaw{' '}
        <code>JWT_SECRET</code> (<code>openssl rand -hex 32</code>) i zredeployuj.
      </>
    ),
  },
};

/**
 * The whole app behind one password, asked once per phone.
 *
 * No login, no e-mail, no account — the list is scouted by whoever is in the hall, and an
 * account per person would be a form to fill in at a table with a game waiting on it. One
 * password handed out by the organiser is the entire membership model.
 *
 * Deliberately not the admin gate: this one has no username field, and its copy says what a
 * visitor needs to hear rather than what an organiser does. Same shell styling, though.
 */
export default function AccessGate({
  configured,
  problem,
}: {
  configured: boolean;
  problem?: AccessProblem;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.access.login(password);
      // Nothing to invalidate: the cookie is set and the server just said so.
      grantAccess();
    } catch (err) {
      // The backend answers in English, like the rest of its errors, and the roster screen is
      // Polish. The status code carries everything this screen needs to say it itself.
      const status = err instanceof ApiError ? err.status : 0;
      setError(
        status === 401
          ? 'Nieprawidłowe hasło.'
          : status === 429
            ? 'Za dużo prób. Odczekaj kilka minut.'
            : status === 0
              ? 'Brak połączenia z serwerem.'
              : 'Nie udało się sprawdzić hasła. Spróbuj jeszcze raz.'
      );
      setPassword('');
      setBusy(false);
      return;
    }
    // No setBusy(false) on success: the app replaces this screen in the same commit, and
    // flipping the button back to idle first would flash it.
  };

  return (
    <div className="container gate">
      <div className="gate-mark">
        <img src="/favicon_192.webp" alt="" width={52} height={52} decoding="async" />
      </div>

      {configured ? (
        <form className="panel" onSubmit={submit}>
          <div className="panel-body">
            <div>
              <h1 className="gate-title">RPH Scouter</h1>
              <p className="gate-sub">
                Lista jest tylko dla ekipy. Podaj hasło otrzymane od organizatora.
              </p>
            </div>

            <div>
              <span className="label">Hasło</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoFocus
              />
            </div>

            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !password}
              style={{ width: '100%' }}
            >
              {busy && <span className="spinner" aria-hidden="true" />}
              Wejdź
            </button>

            <p className="panel-hint">
              Pytamy raz. To urządzenie zapamięta dostęp i wejdzie od razu następnym razem.
            </p>
          </div>
        </form>
      ) : (
        /* Named, not generic. Each of these would otherwise present as the same mystery — a
           password that is in fact correct being refused — and the difference between them is
           exactly what tells the owner which variable to go and fix. */
        <div className="panel">
          <div className="panel-body">
            <div>
              <h1 className="gate-title">
                {(PROBLEM_COPY[problem ?? 'missing_hash'] ?? PROBLEM_COPY.missing_hash).title}
              </h1>
              <p className="gate-sub">
                {(PROBLEM_COPY[problem ?? 'missing_hash'] ?? PROBLEM_COPY.missing_hash).body}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
