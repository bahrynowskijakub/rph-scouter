import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { keys } from '@/lib/hooks';

/**
 * Shown when /admin is opened without a session. Navigating to the route is the whole
 * login affordance — the rest of the app never shows a "log in" button, so visitors
 * have no reason to think there is an account to make.
 */
export default function LoginGate() {
  const qc = useQueryClient();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.auth.login(username, password);
      await qc.invalidateQueries({ queryKey: keys.me });
    } catch (err) {
      setError((err as Error).message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container gate">
      <div className="gate-mark">
        <img src="/favicon_192.webp" alt="" width={52} height={52} decoding="async" />
      </div>

      <form className="panel" onSubmit={submit}>
        <div className="panel-body">
          <div>
            <h1 className="gate-title">Panel admina</h1>
            <p className="gate-sub">
              Tylko dla organizatora. Scoutowanie decków nie wymaga logowania.
            </p>
          </div>

          <div>
            <span className="label">Login</span>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="off"
            />
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
        </div>
      </form>
    </div>
  );
}
