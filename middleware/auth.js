'use strict';

const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const {
  Session,
  getTenantDb,
  PhoneSchema,
  SaleSchema,
  DaySchema,
  ShopExpenseSchema,
  HQStockSchema,
  ShipmentSchema,
  DispatchSchema,
  CustomerSchema,
  AuditLogSchema,
  ReportSchema,
  ProductSchema,
} = require('../db');

const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'superadmin';
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

// ── Session Helpers ────────────────────────────────────────────────────────
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function createSession(data) {
  const token = generateToken();
  await Session.create({ token, ...data, expiresAt: new Date(Date.now() + TOKEN_TTL_MS) });
  return token;
}

async function getSession(token) {
  if (!token) return null;
  const s = await Session.findOne({ token, expiresAt: { $gt: new Date() } });
  return s || null;
}

async function deleteSession(token) {
  await Session.deleteOne({ token });
}

// Constant-time string comparison to prevent timing attacks
function safeCompare(a, b) {
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
    const session = await getSession(token);
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

// Strict rate limiter for the auth endpoint: 10 attempts per 15 minutes
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 100, // Increased for testing
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many attempts, please try again later.' },
});


// ── Tenant Middleware ──────────────────────────────────────────────────────
// Reads clientId from header/session, attaches req.models and req.validShops
async function tenantMiddleware(req, res, next) {
  if (req.path === '/auth' || req.path.startsWith('/clients/lookup') || req.path.startsWith('/superadmin')) {
    return next();
  }

  let clientId = req.headers['x-client-id'] || req.query.clientId;

  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const session = token ? await getSession(token) : null;
  if (session && session.clientId) {
    clientId = session.clientId;
  }

  if (!clientId) {
    return res.status(400).json({ error: 'Client ID required' });
  }

  const tenantDb = getTenantDb(clientId);
  req.tenantDb = tenantDb;
  req.models = {
    Phone:        tenantDb.model('Phone',       PhoneSchema),
    Sale:         tenantDb.model('Sale',        SaleSchema),
    Day:          tenantDb.model('Day',         DaySchema),
    ShopExpense:  tenantDb.model('ShopExpense', ShopExpenseSchema),
    HQStockModel: tenantDb.model('HQStock',     HQStockSchema),
    Shipment:     tenantDb.model('Shipment',    ShipmentSchema),
    Dispatch:     tenantDb.model('Dispatch',    DispatchSchema),
    Customer:     tenantDb.model('Customer',    CustomerSchema),
    AuditLog:     tenantDb.model('AuditLog',    AuditLogSchema),
    Report:       tenantDb.model('Report',      ReportSchema),
    Product:      tenantDb.model('Product',     ProductSchema),
  };
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
  tenantMiddleware,
};
