const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const trustProxy = process.env.TRUST_PROXY;

if (trustProxy !== undefined) {
  if (trustProxy === 'true') app.set('trust proxy', true);
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
  // Most hosted deployments (e.g., Render/Heroku) run behind one reverse proxy.
  app.set('trust proxy', 1);
}

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

// ── MongoDB Connection ─────────────────────────
const MONGO_OPTS = {
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 30000,
  heartbeatFrequencyMS: 10000,
};
const MONGO_BASE_DELAY_MS = 1000;
const MONGO_MAX_DELAY_MS = 30000;

let reconnectAttempts = 0;
let reconnecting = false;

function connectMongo() {
  if (reconnecting) return;
  reconnecting = true;
  return mongoose.connect(process.env.MONGO_URI, MONGO_OPTS)
    .then(() => {
      console.log("✅ MongoDB connected");
      reconnectAttempts = 0;
      reconnecting = false;
    })
    .catch(err => {
      reconnecting = false;
      reconnectAttempts++;
      const delay = Math.min(MONGO_BASE_DELAY_MS * 2 ** reconnectAttempts, MONGO_MAX_DELAY_MS);
      console.error(`❌ MongoDB connection error (attempt ${reconnectAttempts}), retrying in ${delay}ms:`, err.message);
      setTimeout(connectMongo, delay);
    });
}

mongoose.connection.on('disconnected', () => {
  console.warn("⚠️  MongoDB disconnected – reconnecting…");
  connectMongo();
});

mongoose.connection.on('error', err => {
  console.error("❌ MongoDB error:", err.message);
});

connectMongo();

// ── Schemas ────────────────────────────────────
const PhoneSchema = new mongoose.Schema({
  imei: String,
  imei2: String,
  brand: String,
  model: String,
  color: String,
  storage: String,
  buyPrice: Number,
  salePrice: Number,
  status: { type: String, default: 'in_stock' },
  shop: String,
  soldByShop: String,
  cat: String,
  notes: String,
  addedAt: String,
  soldAt: String
}, { toJSON: { virtuals: true } });

const SaleSchema = new mongoose.Schema({
  imei: String,
  brand: String,
  model: String,
  buyPrice: Number,
  salePrice: Number,
  profit: Number,
  shop: String,
  soldByShop: String,
  buyerName: String,
  buyerPhone: String,
  notes: String,
  soldAt: String
});

const Phone = mongoose.model('Phone', PhoneSchema);
const Sale = mongoose.model('Sale', SaleSchema);

const DaySchema = new mongoose.Schema({
  shop: String,
  date: String,
  cats: mongoose.Schema.Types.Mixed,
  expenses: Array,
  purchases: Array,
  transfers: Array,
  carryForward: Number,
});
const Day = mongoose.model('Day', DaySchema);

const ShopExpenseSchema = new mongoose.Schema({
  shop: String,
  date: String,
  month: String,
  category: String,
  description: String,
  amount: Number,
  addedAt: String,
});
const ShopExpense = mongoose.model('ShopExpense', ShopExpenseSchema);

const HQStockSchema = new mongoose.Schema({
  key: { type: String, default: 'hq' },
  items: { type: Array, default: [] },
  updatedAt: String,
});
const HQStockModel = mongoose.model('HQStock', HQStockSchema);

const ShipmentSchema = new mongoose.Schema({
  date: String,
  supplier: String,
  ref: String,
  items: Array,
  addedAt: String,
});
const Shipment = mongoose.model('Shipment', ShipmentSchema);

const DispatchSchema = new mongoose.Schema({
  date: String,
  toShop: String,
  note: String,
  items: Array,
  addedAt: String,
});
const Dispatch = mongoose.model('Dispatch', DispatchSchema);

const CustomerSchema = new mongoose.Schema({
  name: String,
  phone: String,
  email: String,
  notes: String,
  addedAt: String,
});
const Customer = mongoose.model('Customer', CustomerSchema);

const AuditLogSchema = new mongoose.Schema({
  action: String,
  shop: String,
  role: String,
  details: mongoose.Schema.Types.Mixed,
  ts: { type: String, default: () => new Date().toISOString() },
});
const AuditLog = mongoose.model('AuditLog', AuditLogSchema);

const ReportSchema = new mongoose.Schema({
  type: String,   // 'daily' | 'monthly'
  shop: String,
  period: String, // YYYY-MM-DD or YYYY-MM
  data: mongoose.Schema.Types.Mixed,
  generatedAt: String,
});
const Report = mongoose.model('Report', ReportSchema);

// ── PASSWORDS (required — set via env vars, no defaults) ──────
if (!process.env.GATE_PASSWORD || !process.env.ADMIN_PASSWORD) {
  console.error('❌ GATE_PASSWORD and ADMIN_PASSWORD must be set as environment variables. Refusing to start.');
  process.exit(1);
}
const GATE_PASSWORD  = process.env.GATE_PASSWORD;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// ── VALID SHOPS (set via VALID_SHOPS env var as comma-separated list) ──
// Not a secret, but configure this to match your actual shop identifiers.
// Example: VALID_SHOPS=shopA,shopB,shopC
const VALID_SHOPS = process.env.VALID_SHOPS
  ? process.env.VALID_SHOPS.split(',').map(s => s.trim()).filter(Boolean)
  : ['456', '192', 'G15'];

// ── SESSION TOKENS ─────────────────────────────
// Simple in-memory store: token -> { role, shop, expiresAt }
const tokenStore = new Map();
const TOKEN_TTL = 8 * 60 * 60 * 1000; // 8 hours

// Expire old tokens periodically
setInterval(() => {
  const now = Date.now();
  for (const [tok, data] of tokenStore) {
    if (data.expiresAt < now) tokenStore.delete(tok);
  }
}, 60 * 60 * 1000);

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
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

// Auth middleware — verifies Bearer token in Authorization header
function requireAuth(roles = ['admin', 'shop']) {
  return (req, res, next) => {
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const session = tokenStore.get(token);
    if (!session || session.expiresAt < Date.now()) {
      if (session) tokenStore.delete(token);
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!roles.includes(session.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    req.authRole = session.role;
    req.authShop = session.shop; // null for admin
    next();
  };
}

const adminOnly = requireAuth(['admin']);
const anyAuth   = requireAuth(['admin', 'shop']);

// Fire-and-forget audit log writer
function logAction(action, shop, role, details) {
  AuditLog.create({ action, shop: shop || null, role: role || null, details })
    .catch(err => console.error('Audit log error:', err));
}

// Strict rate limiter for the auth endpoint: 10 attempts per 15 minutes
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many attempts, please try again later.' },
});

// ── ROUTES ─────────────────────────────────────

// Auth — validates passwords and issues session tokens (never exposes passwords)
app.post('/api/auth', authLimiter, (req, res) => {
  const { type, password, shop } = req.body || {};

  // Step 1: gate check (no token issued — just confirms the gate password)
  if (type === 'gate') {
    return res.json({ ok: safeCompare(password, GATE_PASSWORD) });
  }

  // Step 2a: admin login
  if (type === 'admin') {
    if (!safeCompare(password, ADMIN_PASSWORD)) return res.json({ ok: false });
    const token = generateToken();
    tokenStore.set(token, { role: 'admin', shop: null, expiresAt: Date.now() + TOKEN_TTL });
    return res.json({ ok: true, token, role: 'admin' });
  }

  // Step 2b: shop login — requires gate password to prevent gate bypass
  if (type === 'shop') {
    if (!safeCompare(password, GATE_PASSWORD)) return res.json({ ok: false });
    if (!VALID_SHOPS.includes(shop)) return res.status(400).json({ ok: false, error: 'Invalid shop' });
    const token = generateToken();
    tokenStore.set(token, { role: 'shop', shop, expiresAt: Date.now() + TOKEN_TTL });
    return res.json({ ok: true, token, role: 'shop', shop });
  }

  return res.status(400).json({ ok: false });
});

// Lookup single phone by IMEI (used by scan/sell flow)
app.get('/api/lookup/:imei', anyAuth, async (req, res) => {
  try {
    const phone = await Phone.findOne({ imei: req.params.imei });
    if (!phone) return res.json({});
    res.json(phone);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get stock — shop users are scoped to their own shop
app.get('/api/stock', anyAuth, async (req, res) => {
  const shop = req.authShop || (typeof req.query.shop === 'string' && VALID_SHOPS.includes(req.query.shop) ? req.query.shop : undefined);
  const query = shop ? { shop } : {};
  if (req.query.all !== 'true') query.status = 'in_stock';
  // Support querying phones by the shop that sold them (for cross-shop sale tracking in the daily sheet)
  if (req.query.soldByShop && typeof req.query.soldByShop === 'string' && VALID_SHOPS.includes(req.query.soldByShop)) {
    if (req.authRole !== 'admin' && req.query.soldByShop !== req.authShop) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    delete query.shop; // query across all shops' stock, not just the requesting shop's
    query.soldByShop = req.query.soldByShop;
  }
  const items = await Phone.find(query);
  res.json(items);
});

// Add stock — shop users can only add to their own shop
app.post('/api/stock/add', anyAuth, async (req, res) => {
  const body = { ...req.body };
  if (req.authRole === 'shop') body.shop = req.authShop;

  const { imei } = body;
  if (!imei) return res.status(400).json({ error: 'IMEI required' });
  if (!/^\d{15}$/.test(imei)) return res.status(400).json({ error: 'IMEI must be exactly 15 digits' });

  const exists = await Phone.findOne({ imei });
  if (exists) return res.status(409).json({ error: 'IMEI exists' });

  const phone = new Phone({ ...body, addedAt: new Date().toISOString() });
  await phone.save();
  logAction('stock_add', body.shop || null, req.authRole, { imei, brand: body.brand, model: body.model, buyPrice: body.buyPrice });
  res.json({ success: true, phone });
});

// Sell phone — any authenticated user can sell any in-stock phone
app.post('/api/stock/sell', anyAuth, async (req, res) => {
  try {
    const { imei, salePrice, buyerName, buyerPhone, notes, soldByShop } = req.body;

    if (!imei) return res.status(400).json({ error: 'IMEI required' });
    if (!/^\d{15}$/.test(imei)) return res.status(400).json({ error: 'IMEI must be exactly 15 digits' });
    if (salePrice === undefined || salePrice === null || salePrice === '') {
      return res.status(400).json({ error: 'salePrice required' });
    }

    const phone = await Phone.findOne({ imei });

    if (!phone) return res.status(404).json({ error: 'Not found' });
    if (phone.status === 'sold') return res.status(409).json({ error: 'Already sold' });

    const sp = Number(salePrice);
    if (Number.isNaN(sp) || sp <= 0) return res.status(400).json({ error: 'Sale price must be greater than zero' });

    // Determine the selling shop: explicit value from body, or the authenticated shop, or the stock-owning shop
    const effectiveSoldByShop = (soldByShop && VALID_SHOPS.includes(soldByShop))
      ? soldByShop
      : (req.authShop || phone.shop);

    const bp = Number(phone.buyPrice) || 0;
    const profit = sp - bp;

    phone.status = 'sold';
    phone.salePrice = sp;
    phone.soldAt = new Date().toISOString();
    phone.soldByShop = effectiveSoldByShop;
    // phone.shop intentionally not changed — keeps the stock-owning shop for audit

    await phone.save();

    const sale = new Sale({
      imei: phone.imei,
      brand: phone.brand,
      model: phone.model,
      buyPrice: bp,
      salePrice: sp,
      profit: profit,
      shop: phone.shop,
      soldByShop: effectiveSoldByShop,
      buyerName: buyerName || null,
      buyerPhone: buyerPhone || null,
      notes: notes || null,
      soldAt: phone.soldAt
    });

    try {
      await sale.save();
    } catch (saleErr) {
      phone.status = 'in_stock';
      phone.salePrice = undefined;
      phone.soldAt = undefined;
      await phone.save().catch(revertErr => console.error('Failed to revert phone after sale error:', revertErr));
      throw saleErr;
    }

    // Auto-upsert customer contact if buyer info is provided
    if (buyerName || buyerPhone) {
      try {
        const nameVal = (buyerName || '').trim();
        const phoneVal = (buyerPhone || '').trim();
        if (nameVal) {
          // Try to find existing customer by name (case-insensitive) or phone
          const orClauses = [{ name: { $regex: `^${nameVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }];
          if (phoneVal) orClauses.push({ phone: phoneVal });
          const existing = await Customer.findOne({ $or: orClauses });
          if (existing) {
            // Update phone if not already set
            if (phoneVal && !existing.phone) {
              existing.phone = phoneVal;
              await existing.save();
            }
          } else {
            await Customer.create({ name: nameVal, phone: phoneVal || undefined, addedAt: new Date().toISOString() });
          }
        }
      } catch (contactErr) {
        console.error('Auto-save contact error (non-fatal):', contactErr);
      }
    }

    logAction('stock_sell', effectiveSoldByShop || phone.shop || null, req.authRole, { imei: phone.imei, brand: phone.brand, model: phone.model, salePrice: sp, profit, buyerName: buyerName || null, stockShop: phone.shop || null, soldByShop: effectiveSoldByShop });
    res.json({ success: true, sale });
  } catch (err) {
    console.error('Sell endpoint error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Build a MongoDB query that matches sales for a given shop.
// Filters by soldByShop (the shop that performed the sale) with a backward-compat fallback
// to the shop field for older records that pre-date the soldByShop field.
function buildSalesByShopQuery(shop) {
  if (!shop || typeof shop !== 'string') return {};
  return { $or: [{ soldByShop: shop }, { soldByShop: { $exists: false }, shop }, { soldByShop: null, shop }] };
}

// Get sales — admin only
app.get('/api/sales', adminOnly, async (req, res) => {
  const shop = req.query.shop;
  const query = buildSalesByShopQuery(shop);
  const sales = await Sale.find(query);
  res.json(sales);
});

// Stats — shop users are scoped to their own shop
app.get('/api/stats', anyAuth, async (req, res) => {
  const rawShop = req.query.shop;
  const shop = req.authShop || (typeof rawShop === 'string' && VALID_SHOPS.includes(rawShop) ? rawShop : undefined);
  const stockQuery = shop ? { shop } : {};
  // Sales are attributed to the shop that performed the sale (soldByShop); fall back to shop field for older records
  const salesQuery = buildSalesByShopQuery(shop);
  const stock = await Phone.find(stockQuery);
  const sales = await Sale.find(salesQuery);

  res.json({
    inStock: stock.filter(p => p.status === 'in_stock').length,
    sold: stock.filter(p => p.status === 'sold').length,
    total: stock.length,
    totalRevenue: sales.reduce((s, x) => s + (x.salePrice || 0), 0),
    salesCount: sales.length
  });
});

// Batch edit phones — admin only
app.put('/api/stock/batch', adminOnly, async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids required' });
    }
    const validIds = ids.filter(id => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id));
    if (validIds.length !== ids.length) {
      return res.status(400).json({ error: 'Invalid phone ids' });
    }

    const { brand, model, color, storage, buyPrice, imei2, cat, notes, shop } = req.body || {};
    const allowed = { brand, model, color, storage, buyPrice, imei2, cat, notes, shop };
    Object.keys(allowed).forEach(k => {
      if (allowed[k] === undefined) delete allowed[k];
    });
    if (allowed.buyPrice !== undefined) {
      const bp = Number(allowed.buyPrice);
      if (Number.isNaN(bp) || bp < 0) return res.status(400).json({ error: 'Invalid buy price' });
      allowed.buyPrice = bp;
    }
    if (allowed.imei2 !== undefined) {
      allowed.imei2 = String(allowed.imei2 || '').replace(/\D/g, '');
      if (!allowed.imei2) delete allowed.imei2;
    }
    ['brand', 'model', 'color', 'storage', 'notes', 'cat', 'shop'].forEach(k => {
      if (typeof allowed[k] === 'string') {
        const v = allowed[k].trim();
        if (v) allowed[k] = v; else delete allowed[k];
      }
    });

    if (Object.keys(allowed).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const result = await Phone.updateMany({ _id: { $in: validIds } }, { $set: allowed });
    const updated = await Phone.find({ _id: { $in: validIds } });
    res.json({
      success: true,
      matched: result.matchedCount ?? updated.length,
      modified: result.modifiedCount ?? result.nModified ?? 0,
      phones: updated
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Edit phone — admin only
app.put('/api/stock/:id', adminOnly, async (req, res) => {
  try {
    const { brand, model, color, storage, buyPrice, imei2, cat, notes, shop } = req.body;
    const allowed = { brand, model, color, storage, buyPrice, imei2, cat, notes, shop };
    Object.keys(allowed).forEach(k => allowed[k] === undefined && delete allowed[k]);
    const phone = await Phone.findByIdAndUpdate(req.params.id, allowed, { returnDocument: 'after' });
    if (!phone) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, phone });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete phone — admin only
app.delete('/api/stock/:id', adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id === 'undefined' || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid phone id' });
    }
    // Retrieve the phone first so we can log its shop before deletion
    const phone = await Phone.findById(id);
    if (phone) {
      await Phone.findByIdAndDelete(id);
      logAction('stock_delete', phone.shop || null, req.authRole, { id, imei: phone.imei, brand: phone.brand, model: phone.model });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DAILY SHEET ────────────────────────────────

app.get('/api/days', adminOnly, async (req, res) => {
  try {
    const { shop, month } = req.query;
    const query = {};
    if (shop) query.shop = shop;
    if (month) query.date = { $regex: `^${month}` };
    const days = await Day.find(query).sort({ date: -1 });
    res.json(days);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/days/:shop/:date', adminOnly, async (req, res) => {
  try {
    const day = await Day.findOne({ shop: req.params.shop, date: req.params.date });
    res.json(day || {});
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/days/:shop/:date', adminOnly, async (req, res) => {
  try {
    const { shop, date } = req.params;
    const update = { ...req.body, shop, date };
    const day = await Day.findOneAndUpdate(
      { shop, date },
      update,
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    res.json({ success: true, day });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/days/:shop/:date', adminOnly, async (req, res) => {
  try {
    const { shop, date } = req.params;
    await Day.deleteOne({ shop, date });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── SHOP EXPENSES ───────────────────────────────

app.get('/api/shopexpenses', adminOnly, async (req, res) => {
  try {
    const { shop, month } = req.query;
    const query = {};
    if (shop) query.shop = shop;
    if (month) query.month = month;
    const expenses = await ShopExpense.find(query).sort({ date: -1 });
    res.json(expenses.map(e => ({ ...e.toObject(), _key: e.id })));
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/shopexpenses', adminOnly, async (req, res) => {
  try {
    const expense = new ShopExpense({ ...req.body, addedAt: new Date().toISOString() });
    await expense.save();
    res.json({ success: true, expense: { ...expense.toObject(), _key: expense.id } });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/shopexpenses/:id', adminOnly, async (req, res) => {
  try {
    await ShopExpense.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── HQ STOCK ────────────────────────────────────

app.get('/api/hqstock', adminOnly, async (req, res) => {
  try {
    const stock = await HQStockModel.findOne({ key: 'hq' });
    res.json(stock || { items: [] });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/hqstock', adminOnly, async (req, res) => {
  try {
    const update = { ...req.body, key: 'hq', updatedAt: new Date().toISOString() };
    const stock = await HQStockModel.findOneAndUpdate(
      { key: 'hq' },
      update,
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    res.json({ success: true, stock });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── SHIPMENTS & DISPATCHES ──────────────────────

app.post('/api/shipments', adminOnly, async (req, res) => {
  try {
    const { date, supplier, ref, items } = req.body || {};
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    // New IMEI flow: receiving phones into warehouse
    const imeiItems = items.filter(it => it && it.imei);
    if (imeiItems.length === items.length) {
      const normalized = imeiItems.map((it) => {
        const imei = String(it.imei || '').replace(/\D/g, '');
        const imei2 = String(it.imei2 || '').replace(/\D/g, '');
        return {
          imei,
          imei2: imei2 || undefined,
          cat: String(it.cat || '').trim() || undefined,
          brand: String(it.brand || '').trim() || undefined,
          model: String(it.model || '').trim() || undefined,
          color: String(it.color || '').trim() || undefined,
          storage: String(it.storage || '').trim() || undefined,
          buyPrice: Number.isFinite(Number(it.buyPrice)) && Number(it.buyPrice) >= 0 ? Number(it.buyPrice) : 0,
          notes: String(it.notes || '').trim() || undefined,
          addedAt: new Date().toISOString(),
        };
      });

      const invalid = normalized.find(it => !/^\d{15}$/.test(it.imei));
      if (invalid) return res.status(400).json({ error: `Invalid IMEI: ${invalid.imei || '(empty)'}` });

      const payloadImeiSet = new Set();
      for (const it of normalized) {
        if (payloadImeiSet.has(it.imei)) return res.status(409).json({ error: `Duplicate IMEI in shipment: ${it.imei}` });
        payloadImeiSet.add(it.imei);
      }

      const existingPhones = await Phone.find({ imei: { $in: [...payloadImeiSet] } }, { imei: 1 });
      if (existingPhones.length) {
        return res.status(409).json({ error: `IMEI already exists in stock: ${existingPhones[0].imei}` });
      }

      const stock = await HQStockModel.findOne({ key: 'hq' });
      const hqItems = Array.isArray(stock?.items) ? stock.items : [];
      const hqImeiSet = new Set(hqItems.map(x => String(x?.imei || '').replace(/\D/g, '')).filter(Boolean));
      const dupHq = normalized.find(it => hqImeiSet.has(it.imei));
      if (dupHq) return res.status(409).json({ error: `IMEI already exists in warehouse: ${dupHq.imei}` });

      const mergedItems = [...hqItems, ...normalized];
      await HQStockModel.findOneAndUpdate(
        { key: 'hq' },
        { key: 'hq', items: mergedItems, updatedAt: new Date().toISOString() },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
      );
    }

    const shipment = new Shipment({ date, supplier, ref, items, addedAt: new Date().toISOString() });
    await shipment.save();
    res.json({ success: true, shipment });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/shipments', adminOnly, async (req, res) => {
  try {
    const shipments = await Shipment.find().sort({ date: -1 });
    res.json(shipments);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/shipments/:id', adminOnly, async (req, res) => {
  try {
    await Shipment.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/dispatches', adminOnly, async (req, res) => {
  try {
    const { date, toShop, note, items } = req.body || {};
    if (!VALID_SHOPS.includes(toShop)) return res.status(400).json({ error: 'Invalid shop' });
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'At least one item is required' });

    const imeiItems = items.filter(it => it && it.imei);
    if (imeiItems.length !== items.length) {
      return res.status(400).json({ error: 'Dispatch must include explicit IMEIs for every phone sent' });
    }
    // New IMEI flow: move phones from warehouse to selected shop stock
    const normalizedImei = imeiItems.map(it => String(it.imei || '').replace(/\D/g, ''));
    const invalid = normalizedImei.find(imei => !/^\d{15}$/.test(imei));
    if (invalid) return res.status(400).json({ error: `Invalid IMEI: ${invalid}` });

    const uniqImeis = [...new Set(normalizedImei)];
    if (uniqImeis.length !== normalizedImei.length) return res.status(409).json({ error: 'Duplicate IMEI in dispatch payload' });

    const existing = await Phone.find({ imei: { $in: uniqImeis } }, { imei: 1 });
    if (existing.length) return res.status(409).json({ error: `IMEI already exists in stock: ${existing[0].imei}` });

    const stock = await HQStockModel.findOne({ key: 'hq' });
    const hqItems = Array.isArray(stock?.items) ? stock.items : [];
    const byImei = new Map(hqItems
      .filter(it => it && it.imei)
      .map(it => [String(it.imei).replace(/\D/g, ''), it]));
    const missing = uniqImeis.find(imei => !byImei.has(imei));
    if (missing) return res.status(400).json({ error: `IMEI not found in warehouse: ${missing}` });

    const now = new Date().toISOString();
    const phonesToCreate = uniqImeis.map((imei) => {
      const src = byImei.get(imei) || {};
      return {
        imei,
        imei2: src.imei2 || undefined,
        brand: src.brand || '',
        model: src.model || '',
        color: src.color || '',
        storage: src.storage || '',
        buyPrice: Number(src.buyPrice) || 0,
        status: 'in_stock',
        shop: toShop,
        cat: src.cat || '',
        notes: src.notes || '',
        addedAt: now,
      };
    });

    await Phone.insertMany(phonesToCreate, { ordered: true });
    const remaining = hqItems.filter(it => {
      const imei = String(it?.imei || '').replace(/\D/g, '');
      return !imei || !uniqImeis.includes(imei);
    });
    await HQStockModel.findOneAndUpdate(
      { key: 'hq' },
      { key: 'hq', items: remaining, updatedAt: now },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );

    const dispatch = new Dispatch({ date, toShop, note, items, addedAt: new Date().toISOString() });
    await dispatch.save();
    res.json({ success: true, dispatch });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/dispatches', adminOnly, async (req, res) => {
  try {
    const dispatches = await Dispatch.find().sort({ date: -1 });
    const allImeis = [...new Set(
      dispatches.flatMap(d => (d.items || [])
        .map(it => String(it?.imei || '').replace(/\D/g, ''))
        .filter(Boolean))
    )];
    let soldSet = new Set();
    if (allImeis.length) {
      const soldPhones = await Phone.find(
        { imei: { $in: allImeis }, status: 'sold' },
        { imei: 1, shop: 1 }
      );
      soldSet = new Set(soldPhones.map(p => `${p.shop}|${p.imei}`));
    }
    const withStats = dispatches.map((d) => {
      const items = d.items || [];
      const imeis = items.map(it => String(it?.imei || '').replace(/\D/g, '')).filter(Boolean);
      const totalPhones = imeis.length || items.reduce((s, it) => s + (Number(it?.qty) || 0), 0);
      const soldPhones = imeis.reduce((s, imei) => s + (soldSet.has(`${d.toShop}|${imei}`) ? 1 : 0), 0);
      return { ...d.toObject(), totalPhones, soldPhones };
    });
    res.json(withStats);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/dispatches/:id', adminOnly, async (req, res) => {
  try {
    await Dispatch.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/hqstock/:imei', adminOnly, async (req, res) => {
  try {
    const imei = String(req.params.imei || '').replace(/\D/g, '');
    if (!/^\d{15}$/.test(imei)) return res.status(400).json({ error: 'Invalid IMEI' });
    const stock = await HQStockModel.findOne({ key: 'hq' });
    if (!stock) return res.json({ success: true });
    stock.items = (stock.items || []).filter(it => String(it?.imei || '').replace(/\D/g, '') !== imei);
    stock.updatedAt = new Date().toISOString();
    await stock.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/hqstock', adminOnly, async (req, res) => {
  try {
    await HQStockModel.findOneAndUpdate(
      { key: 'hq' },
      { key: 'hq', items: [], updatedAt: new Date().toISOString() },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── BULK DELETE SALES ────────────────────────────
app.delete('/api/sales', adminOnly, async (req, res) => {
  try {
    const { shop } = req.query;
    // Filter by soldByShop (the shop that performed the sale); fall back to shop field for older records
    const query = buildSalesByShopQuery(shop);
    const sales = await Sale.find(query);
    if (sales.length === 0) return res.json({ success: true, deleted: 0 });

    // Revert all associated phones to in_stock in one bulk write
    const imeis = [...new Set(sales.map(s => s.imei).filter(Boolean))];
    if (imeis.length) {
      await Phone.updateMany(
        { imei: { $in: imeis } },
        { $set: { status: 'in_stock' }, $unset: { salePrice: '', soldAt: '' } }
      );
    }

    const result = await Sale.deleteMany(query);
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    console.error('Bulk delete sales error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE SALE BY IMEI ──────────────────────────
app.delete('/api/sales/by-imei/:imei', adminOnly, async (req, res) => {
  try {
    const sale = await Sale.findOne({ imei: req.params.imei });
    if (!sale) return res.status(404).json({ error: 'Sale not found' });

    await Phone.findOneAndUpdate(
      { imei: sale.imei },
      { $set: { status: 'in_stock' }, $unset: { salePrice: '', soldAt: '' } }
    );

    await Sale.findByIdAndDelete(sale._id);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete sale by IMEI error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE SALE ─────────────────────────────────
app.delete('/api/sales/:id', adminOnly, async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id);
    if (!sale) return res.status(404).json({ error: 'Sale not found' });

    // Revert the phone to in_stock
    await Phone.findOneAndUpdate(
      { imei: sale.imei },
      { $set: { status: 'in_stock' }, $unset: { salePrice: '', soldAt: '' } }
    );

    await Sale.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete sale error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── CUSTOMERS ───────────────────────────────────

app.get('/api/customers', adminOnly, async (req, res) => {
  try {
    const { q } = req.query;
    const query = q ? { $or: [{ name: { $regex: q, $options: 'i' } }, { phone: { $regex: q } }] } : {};
    const customers = await Customer.find(query).sort({ name: 1 });
    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/customers', adminOnly, async (req, res) => {
  try {
    const { name, phone, email, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const customer = new Customer({ name, phone, email, notes, addedAt: new Date().toISOString() });
    await customer.save();
    res.json({ success: true, customer });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/customers/:id', adminOnly, async (req, res) => {
  try {
    const { name, phone, email, notes } = req.body;
    const customer = await Customer.findByIdAndUpdate(req.params.id, { name, phone, email, notes }, { returnDocument: 'after' });
    if (!customer) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, customer });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/customers/:id', adminOnly, async (req, res) => {
  try {
    await Customer.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── AUDIT LOGS ───────────────────────────────────

app.get('/api/logs', adminOnly, async (req, res) => {
  try {
    const { shop, limit = 300 } = req.query;
    const query = shop ? { shop } : {};
    const logs = await AuditLog.find(query).sort({ ts: -1 }).limit(Number(limit));
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── MODEL ANALYTICS ──────────────────────────────

app.get('/api/analytics/models', adminOnly, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString();
    const staleDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [recentSales, staleStock] = await Promise.all([
      Sale.find({ soldAt: { $gte: since } }),
      Phone.find({ status: 'in_stock', addedAt: { $lte: staleDate } }),
    ]);

    // Top sold models
    const modelMap = {};
    recentSales.forEach(s => {
      const key = `${s.brand || ''} ${s.model || ''}`.trim() || 'Unknown';
      if (!modelMap[key]) modelMap[key] = { model: key, count: 0, revenue: 0, profit: 0 };
      modelMap[key].count++;
      modelMap[key].revenue += s.salePrice || 0;
      modelMap[key].profit += s.profit || 0;
    });
    const topSold = Object.values(modelMap).sort((a, b) => b.count - a.count).slice(0, 15);

    // Stagnating stock
    const staleMap = {};
    staleStock.forEach(p => {
      const key = `${p.brand || ''} ${p.model || ''}`.trim() || 'Unknown';
      const ageDays = Math.floor((Date.now() - new Date(p.addedAt || 0)) / 86400000);
      if (!staleMap[key]) staleMap[key] = { model: key, count: 0, totalCost: 0, oldestDays: 0, shops: {} };
      staleMap[key].count++;
      staleMap[key].totalCost += p.buyPrice || 0;
      if (ageDays > staleMap[key].oldestDays) staleMap[key].oldestDays = ageDays;
      if (p.shop) staleMap[key].shops[p.shop] = (staleMap[key].shops[p.shop] || 0) + 1;
    });
    const stagnating = Object.values(staleMap)
      .sort((a, b) => b.oldestDays - a.oldestDays)
      .slice(0, 15)
      .map(x => ({ ...x, shops: Object.entries(x.shops).map(([s, c]) => `${s}(${c})`).join(', ') }));

    res.json({ topSold, stagnating, days: Number(days) });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── CEO SUMMARY ──────────────────────────────────

app.get('/api/ceo/summary', adminOnly, async (req, res) => {
  try {
    const { month } = req.query;
    const currentMonth = month || new Date().toISOString().slice(0, 7);
    const [y, m] = currentMonth.split('-').map(Number);
    const prevDate = new Date(y, m - 2, 1);
    const prevMonth = prevDate.toISOString().slice(0, 7);

    const [currentSales, prevSales, currentExpenses, stock] = await Promise.all([
      Sale.find({ soldAt: { $regex: `^${currentMonth}` } }),
      Sale.find({ soldAt: { $regex: `^${prevMonth}` } }),
      ShopExpense.find({ month: currentMonth }),
      Phone.find({ status: 'in_stock' }),
    ]);

    // Per-shop breakdown
    const VALID_SHOPS = ['456', '192', 'G15'];
    const shopStats = {};
    VALID_SHOPS.forEach(s => { shopStats[s] = { revenue: 0, cost: 0, profit: 0, units: 0, expenses: 0 }; });

    currentSales.forEach(s => {
      // Revenue and profit attributed to the shop that made the sale (soldByShop), falling back to stock-owning shop
      const sh = s.soldByShop || s.shop;
      if (!sh) return;
      if (!shopStats[sh]) shopStats[sh] = { revenue: 0, cost: 0, profit: 0, units: 0, expenses: 0 };
      shopStats[sh].revenue += s.salePrice || 0;
      shopStats[sh].cost += s.buyPrice || 0;
      shopStats[sh].profit += s.profit || 0;
      shopStats[sh].units++;
    });

    currentExpenses.forEach(e => {
      const sh = e.shop;
      if (!sh) return;
      if (!shopStats[sh]) shopStats[sh] = { revenue: 0, cost: 0, profit: 0, units: 0, expenses: 0 };
      shopStats[sh].expenses += e.amount || 0;
    });

    // Top models
    const modelCounts = {};
    currentSales.forEach(s => {
      const key = `${s.brand || ''} ${s.model || ''}`.trim();
      if (key) modelCounts[key] = (modelCounts[key] || 0) + 1;
    });
    const topModels = Object.entries(modelCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([model, count]) => ({ model, count }));

    const totalRevenue = currentSales.reduce((s, x) => s + (x.salePrice || 0), 0);
    const totalProfit = currentSales.reduce((s, x) => s + (x.profit || 0), 0);
    const totalExpenses = currentExpenses.reduce((s, e) => s + (e.amount || 0), 0);
    const prevRevenue = prevSales.reduce((s, x) => s + (x.salePrice || 0), 0);
    const prevProfit = prevSales.reduce((s, x) => s + (x.profit || 0), 0);

    res.json({
      month: currentMonth,
      prevMonth,
      current: {
        revenue: totalRevenue,
        profit: totalProfit,
        expenses: totalExpenses,
        units: currentSales.length,
        netProfit: totalProfit - totalExpenses,
      },
      prev: { revenue: prevRevenue, profit: prevProfit },
      shopStats,
      topModels,
      inventoryCount: stock.length,
      inventoryValue: stock.reduce((s, p) => s + (p.buyPrice || 0), 0),
    });
  } catch (err) {
    console.error('CEO summary error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── REPORTS / INVOICES ───────────────────────────

app.get('/api/reports', adminOnly, async (req, res) => {
  try {
    const { shop, type } = req.query;
    const query = {};
    if (shop) query.shop = shop;
    if (type) query.type = type;
    const reports = await Report.find(query).sort({ period: -1 }).limit(100);
    res.json(reports);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/reports/generate', adminOnly, async (req, res) => {
  try {
    const { type, shop, period } = req.body;
    if (!type || !shop || !period) return res.status(400).json({ error: 'type, shop, period required' });

    let data = {};

    if (type === 'daily') {
      const shopQ = shop === 'ALL' ? {} : buildSalesByShopQuery(shop);
      const [sales, day] = await Promise.all([
        Sale.find({ ...shopQ, soldAt: { $regex: `^${period}` } }),
        shop === 'ALL' ? Promise.resolve(null) : Day.findOne({ shop, date: period }),
      ]);
      const expenses = (day?.expenses || []).reduce((s, e) => s + (e.amt || 0), 0);
      data = {
        totalSales: sales.reduce((s, x) => s + (x.salePrice || 0), 0),
        totalCost: sales.reduce((s, x) => s + (x.buyPrice || 0), 0),
        grossProfit: sales.reduce((s, x) => s + (x.profit || 0), 0),
        unitsSold: sales.length,
        expenses,
        netProfit: sales.reduce((s, x) => s + (x.profit || 0), 0) - expenses,
        salesList: sales.map(s => ({
          model: `${s.brand || ''} ${s.model || ''}`.trim(),
          imei: s.imei,
          salePrice: s.salePrice,
          buyPrice: s.buyPrice,
          profit: s.profit,
          buyerName: s.buyerName || null,
          shop: s.shop,
        })),
      };
    } else if (type === 'monthly') {
      const shopQ = shop === 'ALL' ? {} : buildSalesByShopQuery(shop);
      const [sales, expenses] = await Promise.all([
        Sale.find({ ...shopQ, soldAt: { $regex: `^${period}` } }),
        ShopExpense.find(shop === 'ALL' ? { month: period } : { shop, month: period }),
      ]);
      const grossProfit = sales.reduce((s, x) => s + (x.profit || 0), 0);
      const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
      data = {
        totalSales: sales.reduce((s, x) => s + (x.salePrice || 0), 0),
        totalCost: sales.reduce((s, x) => s + (x.buyPrice || 0), 0),
        grossProfit,
        unitsSold: sales.length,
        totalExpenses,
        netProfit: grossProfit - totalExpenses,
        expenseBreakdown: expenses.map(e => ({ category: e.category, description: e.description, amount: e.amount, date: e.date })),
      };
    } else {
      return res.status(400).json({ error: 'Invalid type' });
    }

    const report = await Report.findOneAndUpdate(
      { type, shop, period },
      { type, shop, period, data, generatedAt: new Date().toISOString() },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    res.json({ success: true, report });
  } catch (err) {
    console.error('Report generate error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/reports/:id', adminOnly, async (req, res) => {
  try {
    await Report.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── BACKUP & RESTORE ────────────────────────────

app.get('/api/backup', adminOnly, async (req, res) => {
  try {
    const [phones, sales, days, expenses, hqstock, shipments, dispatches] = await Promise.all([
      Phone.find({}),
      Sale.find({}),
      Day.find({}),
      ShopExpense.find({}),
      HQStockModel.findOne({ key: 'hq' }),
      Shipment.find({}),
      Dispatch.find({}),
    ]);
    res.json({
      version: 1,
      exportedAt: new Date().toISOString(),
      phones, sales, days, expenses,
      hqstock: hqstock || { items: [] },
      shipments, dispatches,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/restore', adminOnly, express.json({ limit: '50mb' }), async (req, res) => {
  try {
    const { phones, sales, days, expenses, hqstock, shipments, dispatches } = req.body;
    if (phones?.length) {
      await Phone.bulkWrite(phones.map(p => ({
        updateOne: { filter: { imei: p.imei }, update: { $set: p }, upsert: true }
      })));
    }
    if (sales?.length) {
      // Use _id as the primary key for upsert if present, otherwise fall back to imei+soldAt
      await Sale.bulkWrite(sales.map(s => ({
        updateOne: {
          filter: s._id ? { _id: s._id } : { imei: s.imei, soldAt: s.soldAt },
          update: { $set: s },
          upsert: true
        }
      })));
    }
    if (days?.length) {
      await Day.bulkWrite(days.map(d => ({
        updateOne: { filter: { shop: d.shop, date: d.date }, update: { $set: d }, upsert: true }
      })));
    }
    if (expenses?.length) {
      await ShopExpense.insertMany(expenses, { ordered: false })
        .catch(err => console.error('Restore: some expenses skipped:', err.message));
    }
    if (hqstock) {
      await HQStockModel.findOneAndUpdate(
        { key: 'hq' },
        { ...hqstock, key: 'hq' },
        { upsert: true }
      );
    }
    if (shipments?.length) {
      await Shipment.insertMany(shipments, { ordered: false })
        .catch(err => console.error('Restore: some shipments skipped:', err.message));
    }
    if (dispatches?.length) {
      await Dispatch.insertMany(dispatches, { ordered: false })
        .catch(err => console.error('Restore: some dispatches skipped:', err.message));
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Restore error:', err);
    res.status(500).json({ error: 'Restore failed: ' + err.message });
  }
});

// ── START SERVER ───────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
