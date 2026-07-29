const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { CORS_ORIGIN, NODE_ENV } = require('./config');
const { withAdmin } = require('./middleware/auth');

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

app.get('/api/health', (_req, res) => res.json({ ok: true }));

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
