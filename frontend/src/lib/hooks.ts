import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Participant, RosterDelta, RosterState, ScoutingInput } from './types';

export const keys = {
  roster: ['roster'] as const,
  rosterDelta: ['roster-delta'] as const,
  event: ['event'] as const,
  me: ['me'] as const,
  history: ['history'] as const,
};

/* ───────────────────────────── offline roster snapshot ─────────────────────────────
   The list is the app. Keeping the last good copy in localStorage means a second visit
   paints players in the first frame instead of after a round trip — and a phone that
   loses the hall's wifi mid-tournament still shows what it knew.                     */

const SNAPSHOT_KEY = 'rph-scouter:roster';

/**
 * Every save anywhere in the hall bumps `dataUpdatedAt`, and each bump used to mean 8.5 kB
 * of JSON.stringify plus a synchronous localStorage write on the main thread of a phone
 * somebody is scrolling.
 */
const SNAPSHOT_DEBOUNCE_MS = 3_000;

interface Snapshot {
  at: number;
  data: RosterState;
}

function readSnapshot(): Snapshot | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Snapshot;
    // Anything without players is not worth painting.
    if (!parsed?.at || !Array.isArray(parsed.data?.participants)) return null;
    return parsed;
  } catch {
    return null;
  }
}

let snapshotTimer: number | undefined;
let snapshotPending: Snapshot | null = null;

/**
 * Trailing, and deliberately not restarting on each call: a debounce that resets would go
 * on postponing the write for exactly as long as the tournament stays busy, which is the
 * one stretch worth having a snapshot of. This writes at most once per window, with
 * whatever the newest copy was when the window closed.
 */
function queueSnapshot(data: RosterState, at: number) {
  snapshotPending = { at, data };
  if (snapshotTimer !== undefined) return;
  snapshotTimer = window.setTimeout(flushSnapshot, SNAPSHOT_DEBOUNCE_MS);
}

function flushSnapshot() {
  snapshotTimer = undefined;
  const next = snapshotPending;
  if (!next) return;

  // Nobody is reading a backgrounded tab's first frame. The copy stays pending rather
  // than being dropped — coming back to the tab refetches, which queues it again.
  if (document.visibilityState === 'hidden') return;
  snapshotPending = null;

  try {
    // A stale sync warning would outlive the outage it describes, and a stored cursor or
    // sync timestamp would let a restored copy claim a freshness it cannot have — it may
    // not even belong to the tournament that is loaded now.
    const {
      syncWarning: _warning,
      cursor: _cursor,
      rosterSyncedAt: _syncedAt,
      ...rest
    } = next.data;
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ at: next.at, data: rest }));
  } catch {
    /* private mode, or quota — the app works fine without a snapshot */
  }
}

/** Used when the tournament changes underneath us; see `applyDelta`. */
function dropSnapshot() {
  // Cancel first, or a queued copy of the previous tournament gets written straight back
  // over the removal three seconds later.
  if (snapshotTimer !== undefined) {
    clearTimeout(snapshotTimer);
    snapshotTimer = undefined;
  }
  snapshotPending = null;
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    /* nothing to undo */
  }
}

/* ──────────────────────────────── cache maintenance ──────────────────────────────── */

/**
 * The history panel has no staleTime, so every invalidate is a real request. Without a
 * debounce that would be one request per save filed anywhere in the hall, for as long as
 * an organiser leaves /admin open.
 */
const HISTORY_DEBOUNCE_MS = 2_000;
let historyTimer: number | undefined;

function invalidateHistorySoon(qc: QueryClient) {
  if (historyTimer !== undefined) return;
  historyTimer = window.setTimeout(() => {
    historyTimer = undefined;
    void qc.invalidateQueries({ queryKey: keys.history });
  }, HISTORY_DEBOUNCE_MS);
}

/**
 * Replace one player in the cached roster. Both the writer's own response and everybody
 * else's polled copy come through here, and both are the object `getRosterEntry` returns —
 * a cleared deck is that object with `scouting: null`, not a separate kind of update.
 */
function patchRoster(qc: QueryClient, participant: Participant, cursor?: number) {
  const current = qc.getQueryData<RosterState>(keys.roster);
  const existing = current?.participants.find(
    (p) => p.registrationId === participant.registrationId
  );

  if (!current || !existing) {
    // A player this tab has never heard of: a phone still painting a stale snapshot while
    // somebody registered at the door. A `.map` would drop the update on the floor and the
    // row would stay missing until the next full read of the list.
    void qc.invalidateQueries({ queryKey: keys.roster });
    invalidateHistorySoon(qc);
    return;
  }

  // Older than what this tab has already applied. The classic case is two scouts on one
  // player: B's clear arrives by poll, then A's own slower save response lands behind it
  // carrying the deck B just removed — and only A's phone would show it back. The server
  // is the authority on a conflict, so re-read rather than guess which write won.
  if (cursor != null && current.cursor != null && cursor < current.cursor) {
    void qc.invalidateQueries({ queryKey: keys.roster });
    invalidateHistorySoon(qc);
    return;
  }

  // The row is already exactly this. Overwhelmingly this is the poll re-reporting a save
  // that this tab applied from its own mutation response a moment earlier, and writing it
  // again would hand the list a new object identity and restart the row's settle animation
  // under the sheet closing over it. Comparing the row is what replaced the per-tab client
  // id the stream needed in order to recognise its own echo.
  if (JSON.stringify(existing) === JSON.stringify(participant)) {
    if (cursor != null) bumpCachedCursor(qc, cursor);
    return;
  }

  qc.setQueryData<RosterState>(keys.roster, {
    ...current,
    // Carried forward with the rows it describes, or the freshness check above would read
    // its own patch as a stale answer and refetch the whole list after every save.
    cursor: cursor ?? current.cursor,
    participants: current.participants.map((p) =>
      p.registrationId === participant.registrationId ? participant : p
    ),
  });

  invalidateHistorySoon(qc);
}

/**
 * Move the cached roster's cursor forward without touching a row.
 *
 * The poll asks "what changed since?" using the cursor stored beside the rows, so it has to
 * advance even on a tick that patched nothing — a save this tab already held, or a player
 * whose history rows outlived their place on the roster. Without this the same delta comes
 * back every interval, forever.
 */
function bumpCachedCursor(qc: QueryClient, cursor: number) {
  qc.setQueryData<RosterState>(keys.roster, (prev) =>
    prev && (prev.cursor == null || prev.cursor < cursor) ? { ...prev, cursor } : prev
  );
}

/* ─────────────────────────────────── the delta poll ───────────────────────────────────
   What replaced the SSE stream. Every few seconds the tab hands the server the cursor it
   last applied and gets back one of three answers: nothing moved (the usual, under a
   hundred bytes), the players whose report changed, or "re-read the list".

   What this does *not* need, all of which the stream did: no connection held open, so
   nothing to keep alive with heartbeats and nothing to reconnect; no watchdog for a socket
   that died silently while a phone was in a pocket; no visibility or bfcache handling,
   because React Query stops the interval on a blurred window by itself and resumes it on
   focus; and no epoch or replay bookkeeping, because a full refetch is always a valid
   recovery and the server can simply ask for one.

   A stale list response needs no catching either. If a GET that was already in flight
   resolves after a patch and overwrites it with an older list, that list carries its own
   older cursor — so the very next poll asks from there and is handed back everything filed
   since. Being self-healing on a fixed interval is the whole reason this is smaller.    */

/**
 * The worst case a scout waits to see somebody else's save. Cheap to shorten, but every
 * halving doubles the request count for a hall full of phones — see DEPLOY.md.
 */
const POLL_MS = 5_000;

/**
 * One poll's answer. Called for effect: it patches the roster cache and returns nothing
 * anybody renders.
 */
function applyDelta(qc: QueryClient, delta: RosterDelta) {
  const current = qc.getQueryData<RosterState>(keys.roster);
  // Nothing to patch yet. The list's own fetch is what seeds the cache, and it is already
  // in flight — this tick has no work to do.
  if (!current) return;

  // The admin pointed the whole app at a different tournament. Everything this phone is
  // holding, cache and snapshot alike, belongs to the previous one.
  if (current.eventId !== delta.eventId) {
    dropSnapshot();
    void qc.invalidateQueries({ queryKey: keys.roster });
    return;
  }

  // A roster pull landed upstream: players registered at the door, or dropped out. No
  // cursor describes that, so the list has to be re-read rather than patched.
  if (current.rosterSyncedAt != null && delta.rosterSyncedAt !== current.rosterSyncedAt) {
    void qc.invalidateQueries({ queryKey: keys.roster });
    return;
  }

  if (delta.stale) {
    void qc.invalidateQueries({ queryKey: keys.roster });
    invalidateHistorySoon(qc);
    return;
  }

  if (delta.changed?.length) {
    for (const participant of delta.changed) patchRoster(qc, participant, delta.cursor);
  }

  bumpCachedCursor(qc, delta.cursor);
}

/**
 * Poll from exactly one place — the roster list. `useRosterQuery` runs twice per page (the
 * list and the header), and an interval started in there would double up in production and
 * poll on /admin, where nobody is looking at a roster.
 */
function useRosterDelta() {
  const qc = useQueryClient();

  useQuery({
    queryKey: keys.rosterDelta,
    queryFn: async () => {
      const cursor = qc.getQueryData<RosterState>(keys.roster)?.cursor;
      // No cursor: a cold start, or a restored snapshot whose freshness is unknowable. The
      // list's own fetch is what dates the cache, and it is on its way.
      if (cursor == null) return null;

      const delta = await api.roster.delta(cursor);
      applyDelta(qc, delta);
      return delta.cursor;
    },
    refetchInterval: POLL_MS,
    // Nothing reads this query's data, so there is no such thing as a fresh copy of it.
    staleTime: 0,
    gcTime: 0,
    // One missed tick over venue wifi is not worth a burst of retries; the next interval
    // is a second away and asks the same question.
    retry: false,
  });
}

/* ──────────────────────────────────── the roster ──────────────────────────────────── */

/**
 * Matched to the backend's ROSTER_TTL_MS. A shorter interval only pays for reads that
 * cannot pull anything new, and it is not what makes registrations show up any more:
 * `rosterSyncedAt` on the delta is, within one poll of a pull actually landing.
 *
 * Keep it though, and this is now load-bearing rather than merely useful. `syncRoster()` — the
 * only thing that ever pulls new registrations and drop-outs down from Ravensburger Play —
 * runs as a side effect of a read of this list and *nothing else at all*: there is no warm-up
 * at boot any more, because serverless has no boot worth warming, and the platform's free tier
 * allows a cron job once a day, which is not a roster refresh.
 *
 * Delete this interval and a player who registers at the door never appears on anybody's list,
 * silently, for the rest of the tournament.
 */
const ROSTER_REFETCH_MS = 300_000;

/**
 * Every observer of the roster has to agree on these options, `initialData` above all.
 * React Query honours `initialData` only when the query is *created*, so a second hook
 * that left it out could win the race and cost the snapshot its first-frame paint — the
 * header reads the roster too, and it mounts before the list does.
 *
 * `live` is what separates them: the list drives the fetching, the header only watches
 * the cache, so opening /admin does not start polling a roster nobody is looking at.
 */
function useRosterQuery(live: boolean) {
  // Read once, on the first render, so the snapshot is available before the first paint.
  const [snapshot] = useState(readSnapshot);

  const query = useQuery({
    queryKey: keys.roster,
    queryFn: api.roster.get,
    staleTime: 30_000,
    enabled: live,
    refetchInterval: live ? ROSTER_REFETCH_MS : false,
    refetchOnWindowFocus: live,
    ...(snapshot
      ? // Dated in the past on purpose: the list paints instantly and revalidates behind it.
        { initialData: snapshot.data, initialDataUpdatedAt: snapshot.at }
      : {}),
  });

  return { query, snapshot };
}

export function useRoster() {
  const { query, snapshot } = useRosterQuery(true);
  useRosterDelta();

  // Seeded with the snapshot's own timestamp, so the very data we just restored is not
  // immediately written back over itself on every mount.
  const savedAt = useRef(snapshot?.at ?? 0);
  useEffect(() => {
    if (!query.data || query.dataUpdatedAt <= savedAt.current) return;
    savedAt.current = query.dataUpdatedAt;
    queueSnapshot(query.data, query.dataUpdatedAt);
  }, [query.data, query.dataUpdatedAt]);

  return query;
}

/**
 * The tournament's name for the header, read off whatever the list has already loaded.
 * Never fetches on its own — on /admin there is no roster screen to pay for one, and no
 * poll either.
 */
export function useEventName(): string | null {
  return useRosterQuery(false).query.data?.eventName ?? null;
}

/* ──────────────────────────────────── writes ──────────────────────────────────── */

/**
 * A save answers with the affected player, so the cached roster is patched in place.
 * Waiting for the next poll would leave the scout who filed it looking at a stale row for
 * up to POLL_MS, which is the one place the delay would actually be noticed.
 */
function usePatchRoster() {
  const qc = useQueryClient();
  return (participant: Participant, cursor?: number) =>
    patchRoster(qc, participant, cursor);
}

export function useSaveScouting() {
  const patch = usePatchRoster();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: ScoutingInput }) =>
      api.scouting.save(id, input),
    onSuccess: ({ participant, cursor }) => patch(participant, cursor),
  });
}

export function useClearScouting() {
  const patch = usePatchRoster();
  return useMutation({
    mutationFn: ({ id }: { id: number }) => api.scouting.clear(id),
    onSuccess: ({ participant, cursor }) => patch(participant, cursor),
  });
}

/* ──────────────────────────────────── admin ──────────────────────────────────── */

export function useEvent() {
  return useQuery({ queryKey: keys.event, queryFn: api.event.get, staleTime: 60_000 });
}

export function useAdmin() {
  return useQuery({ queryKey: keys.me, queryFn: api.auth.me, staleTime: 5 * 60_000 });
}

/* ──────────────────────────────────── utils ──────────────────────────────────── */

export function useDebounced<T>(value: T, delay = 140): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
