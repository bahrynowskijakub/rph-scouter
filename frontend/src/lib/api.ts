import type {
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
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
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
    const message =
      (body as { error?: string } | null)?.error || `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }

  return body as T;
}

export const api = {
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
