const app = require('./app');
const { PORT, ADMIN_PASSWORD, JWT_SECRET, NODE_ENV, DB_URL } = require('./config');
const { getEventId } = require('./lib/roster');

/* ───────────────────────────── the local development server ─────────────────────────────
   In production the app is a serverless function and this file never runs — Vercel imports
   `app.js` through api/index.js instead. Everything here exists so `yarn dev` still gives a
   plain server on a port.

   Nothing bootstraps the schema any more either. `yarn db:migrate` does that, once, because
   a serverless cold start is a bad place to be creating tables.                          */

if (NODE_ENV === 'production') {
  if (ADMIN_PASSWORD === 'rph-admin' || JWT_SECRET.startsWith('dev-only')) {
    console.error(
      '[fatal] Refusing to start in production with the default ADMIN_PASSWORD/JWT_SECRET. Set them in .env.'
    );
    process.exit(1);
  }
}

const server = app.listen(PORT, async () => {
  console.log(`RPH Scouter API on http://localhost:${PORT}`);
  console.log(`  db       ${DB_URL.startsWith('file:') ? DB_URL : 'Turso (remote)'}`);
  console.log(`  event    ${await getEventId()}`);
  console.log('  live     delta poll on /api/participants/delta');
  if (ADMIN_PASSWORD === 'rph-admin') {
    console.log('  admin    using the default dev password — set ADMIN_PASSWORD in .env');
  }
});

// Every request answers and ends, so a restart no longer waits on held-open streams. The
// keep-alive sockets the poll leaves behind still count though, and server.close() waits on
// those rather than reaping them — next tick, so the final write has flushed.
function shutdown() {
  server.close(() => process.exit(0));
  setImmediate(() => server.closeIdleConnections?.());
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
