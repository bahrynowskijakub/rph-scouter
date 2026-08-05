const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { CORS_ORIGIN, NODE_ENV } = require('./config');
const { withAdmin } = require('./middleware/auth');
const { withAccess, requireAccess } = require('./middleware/access');

const accessRoutes = require('./routes/access');
const authRoutes = require('./routes/auth');
const eventRoutes = require('./routes/event');
const participantRoutes = require('./routes/participants');
const scoutingRoutes = require('./routes/scouting');
const archetypeRoutes = require('./routes/archetypes');
const statsRoutes = require('./routes/stats');

const app = express();

app.use(
  cors({
    origin: CORS_ORIGIN,
    credentials: true,
  })
);
app.use(express.json({ limit: '128kb' }));
app.use(cookieParser());
app.use(withAdmin);
app.use(withAccess);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// The gate's own endpoints, above the gate — a browser that has not been let in still has to
// be able to ask whether it needs to be, and to answer.
app.use('/api/access', accessRoutes);

/* Everything past this line needs the shared password. It is one line on purpose: the front
   end's password screen is a courtesy, and a courtesy is not a boundary. Without this the
   whole roster would still be one `curl /api/participants` away from anybody with the URL.

   The admin login sits behind it too. An organiser types the shared password like everyone
   else, and in exchange nobody can even reach `POST /api/auth/login` to grind at it. */
app.use('/api', requireAccess);

app.use('/api/auth', authRoutes);
app.use('/api/event', eventRoutes);
app.use('/api/participants', participantRoutes);
app.use('/api/scouting', scoutingRoutes);
app.use('/api/archetypes', archetypeRoutes);
app.use('/api/stats', statsRoutes);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: err.message || 'Internal Server Error',
    ...(NODE_ENV === 'development' && status >= 500 ? { stack: err.stack } : {}),
  });
});

module.exports = app;
