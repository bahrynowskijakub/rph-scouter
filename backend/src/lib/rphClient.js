const { RPH_BASE_URL, RPH_TIMEOUT_MS } = require('../config');

class UpstreamError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function getJson(pathname, search = {}) {
  const url = new URL(`${RPH_BASE_URL}${pathname}`);
  for (const [key, value] of Object.entries(search)) {
    if (value != null) url.searchParams.set(key, String(value));
  }

  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'rph-scouter/1.0' },
      signal: AbortSignal.timeout(RPH_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    throw new UpstreamError(
      timedOut
        ? 'Ravensburger Play API did not respond in time'
        : `Could not reach Ravensburger Play API: ${err.message}`,
      504
    );
  }

  if (res.status === 404) throw new UpstreamError('Event not found', 404);
  if (res.status === 401 || res.status === 403) {
    throw new UpstreamError('This event is not publicly visible', 403);
  }
  if (!res.ok) {
    throw new UpstreamError(`Ravensburger Play API returned ${res.status}`, 502);
  }

  try {
    return await res.json();
  } catch {
    throw new UpstreamError('Ravensburger Play API returned a malformed response', 502);
  }
}

/** Event metadata: name, dates, venue, player counts. */
async function fetchEvent(eventId) {
  const data = await getJson(`/events/${encodeURIComponent(eventId)}/`);
  return {
    id: String(data.id ?? eventId),
    name: data.name || `Event ${eventId}`,
    description: data.description || null,
    startsAt: data.start_datetime || null,
    endsAt: data.end_datetime || null,
    address: data.full_address || null,
    registeredCount: data.registered_user_count ?? null,
    startingPlayerCount: data.starting_player_count ?? null,
    headerImageUrl: data.full_header_image_url || null,
  };
}

/**
 * Every registration for an event. The API pages, so follow next_page_number until it
 * runs out; page_size=250 is the largest the server honours in practice.
 */
async function fetchRegistrations(eventId) {
  const all = [];
  let page = 1;

  // Hard stop so a misbehaving upstream cursor can never spin forever.
  for (let guard = 0; guard < 40; guard += 1) {
    let data;
    try {
      data = await getJson(`/events/${encodeURIComponent(eventId)}/registrations/`, {
        page_size: 250,
        page,
      });
    } catch (err) {
      // Upstream 404s an out-of-range page, so a later page failing should not throw away
      // the players we already have. Only a failed first page is fatal.
      if (page === 1) throw err;
      break;
    }

    const results = Array.isArray(data?.results) ? data.results : [];
    all.push(...results);

    // `next_page_number` is an integer page, not a URL, and is null on the last page.
    if (!data?.next_page_number || results.length === 0) break;
    page = data.next_page_number;
  }

  return all;
}

/** Flatten an upstream registration into the shape we store and serve. */
function normalizeRegistration(raw) {
  const user = raw.user || {};
  // `user.best_identifier` is the real name, the top-level one is the screen name.
  const displayName =
    user.best_identifier || raw.best_identifier || raw.special_user_identifier || 'Unknown player';
  const handle =
    raw.best_identifier && raw.best_identifier !== displayName ? raw.best_identifier : null;

  return {
    registrationId: raw.id,
    userId: user.id ?? null,
    displayName,
    handle,
    status: raw.registration_status || null,
    isGuest: raw.is_guest ? 1 : 0,
    countryCode: user.country_code || null,
    pronouns: user.pronouns || null,
    teamName: raw.team_name || null,
    matchesWon: raw.matches_won ?? 0,
    matchesLost: raw.matches_lost ?? 0,
    matchesDrawn: raw.matches_drawn ?? 0,
    matchPoints: raw.total_match_points ?? 0,
    finalPlace: raw.final_place_in_standings ?? null,
    registeredAt: raw.registration_completed_datetime || null,
    // Signed GCS url that expires within ~24h; refreshed on every roster sync.
    avatarUrl: raw.full_profile_picture_url || null,
  };
}

module.exports = { fetchEvent, fetchRegistrations, normalizeRegistration, UpstreamError };
