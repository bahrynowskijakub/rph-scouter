export type InkId = 'amber' | 'amethyst' | 'emerald' | 'ruby' | 'sapphire' | 'steel';

/** Why a deploy has no usable gate. Only the owner can act on any of them. */
export type AccessProblem =
  | 'missing_hash'
  | 'bad_hash'
  | 'plaintext_password'
  | 'insecure_secret';

/**
 * GET /api/access/status — the front door, and the only thing the app may ask before it has
 * been let in. `configured` is false when there is no password to type because the deploy is
 * misconfigured and the API is refusing everything; `reason` says which way.
 */
export interface AccessState {
  granted: boolean;
  configured: boolean;
  reason?: AccessProblem;
}

/** What a scout files: the deck's inks, its archetype, and a free-text description. */
export interface ScoutingReport {
  inks: InkId[];
  /**
   * The archetype label on its own — "Elinor", "Midrange" — with no ink pair spelled into it,
   * because `inks` above is right there and gets drawn as plates. The pair is what disambiguates
   * it: four different pairs run something called "Midrange".
   */
  archetype: string | null;
  notes: string | null;
}

/**
 * A preset in the picker. `inks` is the pair it belongs to, which is what the sheet filters
 * on — pick Amber and Emerald and only Amber/Emerald archetypes are offered.
 */
export interface Archetype {
  id: number;
  name: string;
  inks: InkId[];
  style: string | null;
  note: string | null;
  /** 'seed' came off the meta list; 'user' was typed into the sheet by somebody scouting. */
  source: 'seed' | 'user';
}

/**
 * Deliberately thin. The roster is fetched whole on every load, so anything the list does
 * not render is weight on venue wifi — the signed avatar URLs alone were several hundred
 * bytes per player. `displayName` is carried but never shown: it is the real name from
 * Ravensburger Play, and people search by it even though the list reads by nick.
 */
export interface Participant {
  registrationId: number;
  /** Real name — search only. */
  displayName: string;
  /** The nick, which is what the list shows. Null for a few registrations. */
  handle: string | null;
  /** False once a player disappears from the upstream roster. */
  active: boolean;
  scouting: ScoutingReport | null;
}

/** One request serves the whole first screen: the tournament's name and every player. */
export interface RosterState {
  eventId: string;
  eventName: string | null;
  participants: Participant[];
  /** Set when the upstream refresh failed and this is the last good copy. */
  syncWarning?: string;
  /**
   * `scouting_history.id` at the instant this list was read — the number the delta poll
   * hands back to ask what changed since. It also dates the response: a GET issued before
   * a patch can resolve after it, and without a number to compare the older list silently
   * wins. Absent on a restored offline snapshot, which has no honest claim to one.
   */
  cursor?: number;
  /**
   * When the roster was last pulled from Ravensburger Play. Compared rather than read: a
   * change means players registered or dropped out, which no cursor describes. Absent on a
   * restored snapshot for the same reason `cursor` is.
   */
  rosterSyncedAt?: string | null;
}

/**
 * One answer from GET /api/participants/delta.
 *
 * `changed` and `stale` are mutually exclusive and both optional — neither present is the
 * common case and means nothing moved. `stale` is the server saying it cannot explain the
 * cursor it was given (another tournament, a restored database, or too far behind to
 * patch); the only answer to it is to re-read the whole list.
 */
export interface RosterDelta {
  eventId: string;
  cursor: number;
  rosterSyncedAt: string | null;
  /** Players whose report changed, newest state each — same shape as the list carries. */
  changed?: Participant[];
  stale?: true;
}

/**
 * What the sheet sends. Fields the app no longer collects (archetype, tech cards,
 * confidence) are simply absent, and the API keeps whatever it already had for them
 * rather than wiping older reports.
 */
/**
 * A save is merging, not replacing — a key left out keeps whatever the stored report had, and
 * `null` is what clears one. Hence the optional keys: the sheet sends all three, but the
 * distinction is load-bearing on the backend (`parseScouting`).
 */
export interface ScoutingInput {
  inks: InkId[];
  archetype?: string | null;
  notes: string | null;
}

export interface EventMeta {
  id: string;
  name: string;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  address: string | null;
  registeredCount: number | null;
  startingPlayerCount: number | null;
  headerImageUrl: string | null;
}

/** Admin-only view of the event: everything the roster screen no longer needs. */
export interface EventState {
  eventId: string;
  meta: EventMeta | null;
  participantCount: number;
  syncedAt: string | null;
  syncWarning?: string;
  error?: string;
}

/**
 * History rows are whatever the report looked like when it was written, including fields
 * this app no longer collects — hence every key optional.
 */
export interface ScoutingSnapshot {
  inks?: InkId[];
  archetype?: string | null;
  notes?: string | null;
  scoutName?: string | null;
}

export interface HistoryEntry {
  id: number;
  registrationId: number;
  displayName: string;
  action: string;
  scoutName: string | null;
  actor: string;
  createdAt: string;
  payload: ScoutingSnapshot | null;
}
