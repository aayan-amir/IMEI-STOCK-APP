'use strict';

const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { Session, Client, getTenantDb } = require('../db');

const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || null;
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

// ── Session Helpers ────────────────────────────────────────────────────────
async function createSession(data) {
  const token = crypto.randomBytes(32).toString('hex');
  await Session.create({ token, ...data, expiresAt: new Date(Date.now() + TOKEN_TTL_MS) });
  return token;
}

async function getSession(token) {
  if (!token) return null;
  const session = await Session.findOne({ token, expiresAt: { $gt: new Date() } });
  if (!session || !['admin', 'shop'].includes(session.role)) return null;
  const client = await Client.findOne({ clientId: session.clientId }, 'clientId status shops authVersion');
  if (!client || client.status !== 'active' || (client.authVersion || null) !== (session.authVersion || null)) return null;
  const shops = (client.shops || []).map(shop => shop.id).filter(id => typeof id === 'string');
  if (session.role === 'shop' && !shops.includes(session.shop)) return null;
  session.validShops = shops;
  return session;
}

async function deleteSession(token) {
  await Session.deleteOne({ token });
}

// Constant-time string comparison to prevent timing attacks
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  try {
    const ba = Buffer.from(String(a || ''), 'utf8');
    const bb = Buffer.from(String(b || ''), 'utf8');
    if (ba.length !== bb.length) {
      crypto.timingSafeEqual(ba, ba); // burn time, always false
      return false;
    }
    return crypto.timingSafeEqual(ba, bb);
  } catch { return false; }
}

// ── Auth Middleware ────────────────────────────────────────────────────────
function requireAuth(roles = ['admin', 'shop']) {
  return async (req, res, next) => {
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const session = req.session || await getSession(token);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(session.role)) return res.status(403).json({ error: 'Forbidden' });
    req.authRole = session.role;
    req.authShop = session.shop || null;
    req.session = session;
    next();
  };
}

const adminOnly = requireAuth(['admin']);
const anyAuth   = requireAuth(['admin', 'shop']);

// Fire-and-forget audit log writer
function logAction(models, action, shop, role, details) {
  models.AuditLog.create({ action, shop: shop || null, role: role || null, details })
    .catch(err => console.error('Audit log error:', err));
}

// Strict rate limiter for the auth endpoint: 15 attempts per 15 minutes
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { ok: false, error: 'Too many attempts, please try again later.' },
});

// Rate limiter for superadmin verify: skips successful logins so valid users are never locked out
const superAdminLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { ok: false, error: 'Too many superadmin attempts, locked for 15 minutes.' },
});


// ── Tenant Middleware ──────────────────────────────────────────────────────
// Reads clientId from header/session, attaches req.models and req.validShops
async function tenantMiddleware(req, res, next) {
  if (req.path === '/auth' || req.path.startsWith('/clients/lookup') || req.path.startsWith('/superadmin')) {
    return next();
  }

  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const session = token ? await getSession(token) : null;
  if (!session?.clientId) return res.status(401).json({ error: 'Unauthorized' });
  req.session = session;
  const tenantDb = getTenantDb(session.clientId);
  req.tenantDb = tenantDb;
  req.models = require('../services/backup-validation').getModels(tenantDb);
  req.models.HQStockModel = req.models.HQStock;
  req.validShops = session ? (session.validShops || []) : [];
  next();
}

module.exports = {
  SUPER_ADMIN_PASSWORD,
  createSession,
  getSession,
  deleteSession,
  safeCompare,
  requireAuth,
  adminOnly,
  anyAuth,
  logAction,
  authLimiter,
  superAdminLimiter,
  tenantMiddleware,
};
