/**
 * The whole API as one Vercel function.
 *
 * Vercel turns every file under /api into a function, and a `(req, res)` handler is exactly
 * what an Express app already is — so this file is a re-export and nothing more. The routing
 * inside stays Express's problem; `vercel.json` sends all of /api/* here.
 *
 * One function rather than one per route on purpose: they share a database client and a
 * warmed isolate, and splitting them would mean a cold start per endpoint.
 *
 * `backend/src/index.js` is the other entry point — the plain listening server used by
 * `yarn dev`. Both import the same `app.js`, so there is one app and two ways to run it.
 */
module.exports = require('../backend/src/app');
