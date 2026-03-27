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

// ── MongoDB Connection ─────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error(err));

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
  buyerName: String,
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

// ── PASSWORDS (set via env vars) ───────────────
const GATE_PASSWORD  = process.env.GATE_PASSWORD  || 'mobworld';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'aayan104';

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
    const VALID_SHOPS = ['456', '192', 'G15'];
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
  const shop = req.authShop || req.query.shop;
  const query = shop ? { shop } : {};
  const items = await Phone.find(query);
  res.json(items);
});

// Add stock — shop users can only add to their own shop
app.post('/api/stock/add', anyAuth, async (req, res) => {
  const body = { ...req.body };
  if (req.authRole === 'shop') body.shop = req.authShop;

  const { imei } = body;
  if (!imei) return res.status(400).json({ error: 'IMEI required' });

  const exists = await Phone.findOne({ imei });
  if (exists) return res.status(409).json({ error: 'IMEI exists' });

  const phone = new Phone({ ...body, addedAt: new Date().toISOString() });
  await phone.save();
  res.json({ success: true, phone });
});

// Sell phone — shop users can only sell phones that belong to their shop
app.post('/api/stock/sell', anyAuth, async (req, res) => {
  try {
    const { imei, salePrice, buyerName, notes, shop } = req.body;

    if (!imei) return res.status(400).json({ error: 'IMEI required' });
    if (salePrice === undefined || salePrice === null || salePrice === '') {
      return res.status(400).json({ error: 'salePrice required' });
    }

    const phone = await Phone.findOne({ imei });

    if (!phone) return res.status(404).json({ error: 'Not found' });
    if (phone.status === 'sold') return res.status(409).json({ error: 'Already sold' });

    // Shop users may only sell phones assigned to their shop
    if (req.authRole === 'shop' && phone.shop !== req.authShop) {
      return res.status(403).json({ error: 'Phone not assigned to your shop' });
    }

    const sp = Number(salePrice);
    if (Number.isNaN(sp) || sp <= 0) return res.status(400).json({ error: 'Sale price must be greater than zero' });

    const bp = Number(phone.buyPrice) || 0;
    const profit = sp - bp;

    phone.status = 'sold';
    phone.salePrice = sp;
    phone.soldAt = new Date().toISOString();
    // Shop users cannot reassign the phone's shop
    if (req.authRole === 'admin' && shop !== undefined) phone.shop = shop;

    await phone.save();

    const sale = new Sale({
      imei: phone.imei,
      brand: phone.brand,
      model: phone.model,
      buyPrice: bp,
      salePrice: sp,
      profit: profit,
      shop: phone.shop,
      buyerName: buyerName || null,
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

    res.json({ success: true, sale });
  } catch (err) {
    console.error('Sell endpoint error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get sales — admin only
app.get('/api/sales', adminOnly, async (req, res) => {
  const shop = req.query.shop;
  const query = shop ? { shop } : {};
  const sales = await Sale.find(query);
  res.json(sales);
});

// Stats — shop users are scoped to their own shop
app.get('/api/stats', anyAuth, async (req, res) => {
  const shop = req.authShop || req.query.shop;
  const query = shop ? { shop } : {};
  const stock = await Phone.find(query);
  const sales = await Sale.find(query);

  res.json({
    inStock: stock.filter(p => p.status === 'in_stock').length,
    sold: stock.filter(p => p.status === 'sold').length,
    total: stock.length,
    totalRevenue: sales.reduce((s, x) => s + (x.salePrice || 0), 0),
    salesCount: sales.length
  });
});

// Edit phone — admin only
app.put('/api/stock/:id', adminOnly, async (req, res) => {
  try {
    const { brand, model, color, storage, buyPrice, imei2, cat, notes, shop } = req.body;
    const allowed = { brand, model, color, storage, buyPrice, imei2, cat, notes, shop };
    Object.keys(allowed).forEach(k => allowed[k] === undefined && delete allowed[k]);
    const phone = await Phone.findByIdAndUpdate(req.params.id, allowed, { new: true });
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
    await Phone.findByIdAndDelete(id);
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
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, day });
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
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, stock });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── SHIPMENTS & DISPATCHES ──────────────────────

app.post('/api/shipments', adminOnly, async (req, res) => {
  try {
    const shipment = new Shipment({ ...req.body, addedAt: new Date().toISOString() });
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

app.post('/api/dispatches', adminOnly, async (req, res) => {
  try {
    const dispatch = new Dispatch({ ...req.body, addedAt: new Date().toISOString() });
    await dispatch.save();
    res.json({ success: true, dispatch });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/dispatches', adminOnly, async (req, res) => {
  try {
    const dispatches = await Dispatch.find().sort({ date: -1 });
    res.json(dispatches);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── BULK DELETE SALES ────────────────────────────
app.delete('/api/sales', adminOnly, async (req, res) => {
  try {
    const { shop } = req.query;
    const query = shop ? { shop } : {};
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
