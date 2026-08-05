const app = require('./app');
const { PORT, ADMIN_PASSWORD, JWT_SECRET, NODE_ENV, DB_URL } = require('./config');
const { getEventId } = require('./lib/roster');
const { ACCESS_ENABLED, GATE_BROKEN, GATE_REASON, REASON_TEXT } = require('./middleware/access');

/* ───────────────────────────── the local development server ─────────────────────────────
   In production this file never runs. The backend is a Vercel service whose entrypoint is
   `app.js` (see `services.backend` in vercel.json) — Vercel's Express support takes the
   `module.exports = app` at the bottom of that file and wraps it as one function itself.
   Everything here exists so `yarn dev` still gives a plain server on a port.

   Nothing bootstraps the schema any more either. `yarn db:migrate` does that, once, because
   a serverless cold start is a bad place to be creating tables.                          */

if (NODE_ENV === 'production') {
  if (ADMIN_PASSWORD === 'rph-admin' || JWT_SECRET.startsWith('dev-only')) {
    console.error(
      '[fatal] Refusing to start in production with the default ADMIN_PASSWORD/JWT_SECRET. Set them in .env.'
    );
    process.exit(1);
  }
  // A broken gate answers 503 to every request anyway, so the process would stay up serving
  // nothing. Saying so at boot beats debugging it from the roster screen. The same conditions
  // are enforced per-request in middleware/access.js, because on Vercel this file never runs.
  if (GATE_BROKEN || !ACCESS_ENABLED) {
    console.error(
      `[fatal] Refusing to start in production: ${REASON_TEXT[GATE_REASON] ?? REASON_TEXT.missing_hash}` +
        '\n        Generate a hash with `yarn hash-password`.'
    );
    process.exit(1);
  }
}

const server = app.listen(PORT, async () => {
  console.log(`RPH Scouter API on http://localhost:${PORT}`);
  console.log(`  db       ${DB_URL.startsWith('file:') ? DB_URL : 'Turso (remote)'}`);
  console.log(`  event    ${await getEventId()}`);
  console.log('  live     delta poll on /api/participants/delta');
  console.log(
    GATE_BROKEN
      ? `  gate     BROKEN (${GATE_REASON}) — every request is 503`
      : ACCESS_ENABLED
        ? '  gate     shared password required'
        : '  gate     OPEN — set ACCESS_PASSWORD_HASH (yarn hash-password) before deploying'
  );
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
