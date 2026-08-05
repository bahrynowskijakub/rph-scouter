import { Route, Routes } from 'react-router-dom';
import { useAccess, useEventName } from '@/lib/hooks';
import RosterPage from '@/features/roster/RosterPage';
import AdminPage from '@/features/admin/AdminPage';
import AccessGate from '@/features/access/AccessGate';
import NotFoundPage from '@/features/NotFoundPage';

/**
 * Nameplate on the left, the tournament you are standing in on the right.
 *
 * The event used to be a display heading over the list. It is context, not content — you
 * read it once on arrival and never again — so it belongs in the chrome, where it costs
 * no vertical space and is still there after you have scrolled to the eightieth player.
 *
 * No theme switch: this is a phone screen in a badly lit hall, and it is dark. No
 * navigation: the roster is the whole app. No status pip either.
 */
function TopBar() {
  const eventName = useEventName();

  return (
    <header className="topbar">
      <div className="container topbar-inner">
        <span className="wordmark">
          <img src="/favicon_192.webp" alt="" width={26} height={26} decoding="async" />
          RPH Scouter
        </span>

        {/* Nothing rather than a skeleton: on /admin this never loads a roster of its
            own, and a chip that shimmers forever is worse than one that arrives late. */}
        {eventName && (
          <span className="event-badge" title={eventName}>
            {eventName}
          </span>
        )}
      </div>
    </header>
  );
}

export default function App() {
  const { data: access, isPending } = useAccess();

  // Nothing, not a skeleton. This is the first request of a cold visit and it either says
  // "type the password" or "here is the roster" — a shimmer of one before the other would be
  // a screen that changes its mind. A returning phone never reaches this branch: its
  // localStorage hint seeds `access` before the first render (see `useAccess`).
  if (isPending) return <div className="shell" />;

  if (!access?.granted) {
    // The gate stands alone — no topbar. The header reads the roster cache, and nothing has
    // any business fetching a roster on the wrong side of the front door.
    return (
      <div className="shell">
        <main style={{ flex: 1 }}>
          <AccessGate configured={access?.configured ?? true} problem={access?.reason} />
        </main>
      </div>
    );
  }

  return (
    <div className="shell">
      <TopBar />
      {/* No nav: the roster is the app, and /admin is reached by typing the URL. */}
      <main style={{ flex: 1 }}>
        <Routes>
          <Route path="/" element={<RosterPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  );
}
