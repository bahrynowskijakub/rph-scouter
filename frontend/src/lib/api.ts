import { accessEpoch, revokeAccess } from './access';
import type {
  AccessState,
  EventMeta,
  EventState,
  HistoryEntry,
  Participant,
  RosterDelta,
  RosterState,
  ScoutingInput,
} from './types';

export class ApiError extends Error {
  status: number;
  /** The backend's own label for the failure, where it has one — `access_required` and friends. */
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  // Read before the request goes out, so a 401 that lands after somebody has since typed the
  // password can be recognised as belonging to the previous, already-abandoned session.
  const issuedAt = accessEpoch();

  try {
    res = await fetch(`/api${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    // fetch only rejects when the request never reached the server. Its own message is
    // "Failed to fetch", which would be the one piece of English in a Polish UI — and it
    // tells a scout in a hall with bad wifi nothing useful.
    throw new ApiError('Brak połączenia z serwerem.', 0);
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    const failure = body as { error?: string; code?: string } | null;
    const message = failure?.error || `Request failed (${res.status})`;

    // The pass ran out, or the shared password was changed. Whatever this call was, the answer
    // is the password screen — put it up here rather than letting every caller learn to.
    if (failure?.code === 'access_required') revokeAccess(issuedAt);

    throw new ApiError(message, res.status, failure?.code);
  }

  return body as T;
}

export const api = {
  /**
   * The front door. `status` is the one call the app may make before it has been let in —
   * everything else under /api answers 401 until `login` has set the cookie.
   */
  access: {
    status: () => request<AccessState>('/access/status'),
    login: (password: string) =>
      request<{ granted: true; days: number }>('/access/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      }),
    logout: () => request<{ ok: true }>('/access/logout', { method: 'POST' }),
  },

  /** The whole roster screen in one round trip: tournament name plus every player. */
  roster: {
    get: () => request<RosterState>('/participants'),

    /**
     * The polling half of the roster: what changed since the cursor this tab last applied.
     * Cheap by design — the usual answer is "nothing", in under a hundred bytes.
     */
    delta: (since: number) =>
      request<RosterDelta>(`/participants/delta?since=${since}`),
  },

  /**
   * Both writes answer with the affected player, so the roster in cache can be patched
   * in place instead of re-downloading the whole list after every save. The poll will
   * report the same change a moment later; `patchRoster` recognises it as one it already
   * holds and leaves the cached row alone.
   */
  scouting: {
    save: (registrationId: number, input: ScoutingInput) =>
      request<{ participant: Participant; cursor: number }>(`/scouting/${registrationId}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    clear: (registrationId: number) =>
      request<{ participant: Participant; cursor: number }>(`/scouting/${registrationId}`, {
        method: 'DELETE',
      }),
    history: (limit = 150) =>
      request<{ history: HistoryEntry[] }>(`/scouting/history/all?limit=${limit}`),
  },

  /** Admin only — the roster screen never asks for this. */
  event: {
    get: () => request<EventState>('/event'),
    set: (eventId: string) =>
      request<EventState & { meta: EventMeta }>('/event', {
        method: 'PUT',
        body: JSON.stringify({ eventId }),
      }),
    refresh: () => request<EventState & { synced: boolean }>('/event/refresh', { method: 'POST' }),
  },

  auth: {
    me: () => request<{ admin: { username: string } | null }>('/auth/me'),
    login: (username: string, password: string) =>
      request<{ admin: { username: string } }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  },
};
