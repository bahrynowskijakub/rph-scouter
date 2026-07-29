/**
 * Run work that has to outlive the response it was started from.
 *
 * On a long-lived server a dangling promise simply carries on. On a serverless platform the
 * isolate can be frozen the instant the response is flushed, which would kill a roster pull
 * halfway through writing its batch — `waitUntil` is how you say "not yet".
 *
 * Guarded twice on purpose: the package may not be installed, and even where it is, calling
 * it outside a request context (local `yarn dev`, a one-off script) is not valid. Either way
 * the promise still runs; it just runs unprotected, which is exactly the old behaviour.
 */
let waitUntil = null;
try {
  ({ waitUntil } = require('@vercel/functions'));
} catch {
  /* not on Vercel — a plain promise is the whole implementation */
}

function background(promise) {
  // Swallowed here rather than at every call site: an unhandled rejection on some platforms
  // takes the process with it, and a failed roster pull is reported through `lastError`.
  const settled = Promise.resolve(promise).catch(() => {});
  if (!waitUntil) return;
  try {
    waitUntil(settled);
  } catch {
    /* no request context to extend */
  }
}

module.exports = { background };
