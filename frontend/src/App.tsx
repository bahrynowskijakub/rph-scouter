import { Route, Routes } from 'react-router-dom';
import { useEventName } from '@/lib/hooks';
import RosterPage from '@/features/roster/RosterPage';
import AdminPage from '@/features/admin/AdminPage';
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
