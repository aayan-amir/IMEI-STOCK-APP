'use strict';

require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');

const { mongoose, connectMongo } = require('./db');
const { tenantMiddleware }       = require('./middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Trust Proxy ────────────────────────────────────────────────────────────
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy !== undefined) {
  if (trustProxy === 'true')       app.set('trust proxy', true);
  else if (trustProxy === 'false') app.set('trust proxy', false);
  else {
    const parsed = Number(trustProxy);
    if (Number.isInteger(parsed) && parsed >= 0) {
      app.set('trust proxy', parsed);
    } else {
      console.warn(`Invalid TRUST_PROXY value "${trustProxy}", defaulting to trust proxy = 1`);
      app.set('trust proxy', 1);
    }
  }
} else if (process.env.NODE_ENV === 'production') {
  // Most hosted deployments (e.g., Render/Heroku) run behind one reverse proxy
  app.set('trust proxy', 1);
}

// ── Global Middleware ──────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Rate limiting — 300 requests per minute per IP
app.use('/api/', rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }));

// Return 503 immediately when MongoDB is not ready (prevents 10 s buffer timeout)
app.use('/api/', (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'Database not ready, please try again shortly.' });
  }
  next();
});

// Tenant middleware — attaches req.models and req.validShops to every /api route
app.use('/api', tenantMiddleware);

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api', require('./routes/clients'));
app.use('/api', require('./routes/stock'));
app.use('/api', require('./routes/sales'));
app.use('/api', require('./routes/days'));
app.use('/api', require('./routes/expenses'));
app.use('/api', require('./routes/warehouse'));
app.use('/api', require('./routes/customers'));
app.use('/api', require('./routes/logs'));
app.use('/api', require('./routes/analytics'));
app.use('/api', require('./routes/reports'));
app.use('/api', require('./routes/backup'));

// ── Start ──────────────────────────────────────────────────────────────────
connectMongo();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
