'use strict';

const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const helmet = require('helmet');
const { readRuntimeConfig } = require('./config/runtime');
const { HttpError } = require('./utils/http-error');
const { createWorkTracker, trackHandler, trackRouterWork } = require('./services/request-work');

function createApp({ config = readRuntimeConfig(), database = require('./db') } = {}) {
  const app = express();
  app.locals.requestWork = createWorkTracker();
  app.locals.stocktakesEnabled = config.stocktakesEnabled === true;
  app.locals.fullyPaidSalesEnabled = config.fullyPaidSalesEnabled === true;
  app.locals.customerReturnsEnabled = config.customerReturnsEnabled === true;
  app.locals.verifiedCashEnabled = config.verifiedCashEnabled === true && app.locals.fullyPaidSalesEnabled && app.locals.customerReturnsEnabled;
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.set('X-Request-ID', req.requestId);
    next();
  });
  app.set('trust proxy', config.trustProxy);
  if (config.nodeEnv === 'production') {
    app.use((req, res, next) => {
      if (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
        return res.redirect(301, `https://${req.hostname}${req.originalUrl}`);
      }
      next();
    });
  }
  app.use(cors((req, callback) => callback(null, {
    origin(origin, done) {
      const sameOrigin = `${req.protocol}://${req.get('host')}`;
      done(null, !origin || origin === sameOrigin || config.allowedOrigins.includes(origin));
    },
  })));
  app.use(helmet({ contentSecurityPolicy: { directives: {
    ...helmet.contentSecurityPolicy.getDefaultDirectives(),
    'script-src': ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
    'script-src-attr': ["'unsafe-inline'"],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com'],
    'img-src': ["'self'", 'data:'],
    'connect-src': ["'self'"],
    'upgrade-insecure-requests': null,
  } } }));
  app.use('/api/superadmin', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/health/live', (req, res) => res.json({ status: 'ok' }));
  app.get('/health/ready', (req, res) => {
    const ready = !app.locals.draining && database.mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable' });
  });
  app.use('/api/restore', express.json({ limit: '9mb' }));
  app.use('/api/days', express.json({ limit: '2mb' }));
  app.use(express.json());
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
  app.get('/superadmin', (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    res.sendFile(path.join(__dirname, 'public', 'superadmin.html'));
  });
  app.get('/superadmin.html', (req, res) => res.redirect(302, '/superadmin'));
  app.get('/dashboard', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
  app.get(['/index.html', '/dashboard/index.html'], (req, res) => {
    const queryAt = req.originalUrl.indexOf('?');
    res.redirect(302, '/dashboard' + (queryAt === -1 ? '' : req.originalUrl.slice(queryAt)));
  });
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));
  app.use('/api/clients/lookup', rateLimit({
    windowMs: 15 * 60_000, limit: 100, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many lookup attempts, please try again later.' },
  }));
  app.use('/api', (req, res, next) => {
    if (app.locals.draining) return res.status(503).json({ error: 'Server is restarting. Retry shortly.', code: 'SERVER_DRAINING', requestId: req.requestId });
    if (database.mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'Database not ready, please try again shortly.' });
    }
    next();
  });
  app.use('/api', trackHandler(require('./middleware/auth').tenantMiddleware));
  for (const route of ['clients', 'stock', 'sales', 'days', 'expenses', 'warehouse', 'customers', 'logs', 'analytics', 'reports', 'backup', 'products', 'stocktakes', 'returns', 'cash']) {
    app.use('/api', trackRouterWork(require('./services/recovery-control').protectRouter(require(`./routes/${route}`))));
  }
  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found', code: 'NOT_FOUND', requestId: req.requestId }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const invalidJson = err.type === 'entity.parse.failed';
    const tooLarge = err.type === 'entity.too.large';
    const status = err instanceof HttpError ? err.status : invalidJson ? 400 : tooLarge ? 413 : 500;
    if (status === 500) console.error({ requestId: req.requestId, code: 'INTERNAL_ERROR', message: 'Request failed' });
    res.status(status).json({
      error: err instanceof HttpError ? err.message : invalidJson ? 'Invalid JSON request' : tooLarge ? 'Request body is too large' : 'Internal server error',
      code: err instanceof HttpError ? err.code : invalidJson ? 'INVALID_JSON' : tooLarge ? 'BODY_TOO_LARGE' : 'INTERNAL_ERROR',
      requestId: req.requestId,
    });
  });
  return app;
}

module.exports = { createApp };
