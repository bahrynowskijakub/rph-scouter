import { queryClient } from './queryClient';
import type { AccessState } from './types';

export const ACCESS_KEY = ['access'] as const;

/* ────────────────────────────────── the first frame ──────────────────────────────────
   The real pass is an httpOnly cookie, which JavaScript cannot read. So the page has no way
   to know whether it is let in without asking the server, and asking takes a round trip that
   on a cold serverless start is not fast.

   Painting nothing for that round trip would be a blank screen on every single visit. Painting
   the password screen would flash it at people who are already let in, which is exactly what
   "raz zalogowany user nie jest już pytany" is supposed to rule out.

   So the same trick the roster already uses for its rows: leave a note in localStorage saying
   we were let in last time, paint the app on it, and let the answer arrive behind the paint. A
   forged note buys nothing — every request still carries the cookie or fails, and the failure
   below puts the screen back up.                                                            */

const HINT_KEY = 'rph-scouter:access';

export function readAccessHint(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    // Safari in private mode throws on localStorage. One round trip, then.
    return false;
  }
}

function writeAccessHint(granted: boolean) {
  try {
    if (granted) localStorage.setItem(HINT_KEY, '1');
    else localStorage.removeItem(HINT_KEY);
  } catch {
    /* nothing to do: the hint is an optimisation, not state */
  }
}

/**
 * Bumped every time a password is accepted. A request carries the epoch it was issued under, so
 * a 401 from before the login cannot throw away the pass the login just won — which would put
 * the screen back up on somebody who had typed the right password a moment earlier.
 */
let epoch = 0;

export function accessEpoch() {
  return epoch;
}

/** The password was accepted. Cookie is set; skip the confirming round trip. */
export function grantAccess() {
  epoch += 1;
  writeAccessHint(true);
  queryClient.setQueryData<AccessState>(ACCESS_KEY, { granted: true, configured: true });
}

/**
 * A request answered `access_required` — the pass expired, or the password was rotated out from
 * under this browser. Puts the screen back up mid-session instead of leaving a phone staring at
 * a roster whose every save fails.
 */
export function revokeAccess(issuedAtEpoch?: number) {
  if (issuedAtEpoch !== undefined && issuedAtEpoch !== epoch) return;
  if (!queryClient.getQueryData<AccessState>(ACCESS_KEY)?.granted && !readAccessHint()) return;
  writeAccessHint(false);
  queryClient.setQueryData<AccessState>(ACCESS_KEY, { granted: false, configured: true });
}

/** Keeps the note in step with what the server actually said. */
export function syncAccessHint(state: AccessState | undefined) {
  if (!state) return;
  writeAccessHint(state.granted);
}
