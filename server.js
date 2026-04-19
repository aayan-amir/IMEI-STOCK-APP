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
  app.set('trust proxy', 1);
}

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Rate limiting — 300 requests per minute per IP
app.use('/api/', rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }));

// Return 503 when MongoDB is not ready
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
      console.log('✅ MongoDB connected');
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
  console.warn('⚠️  MongoDB disconnected – reconnecting…');
  connectMongo();
});

mongoose.connection.on('error', err => {
  console.error('❌ MongoDB error:', err.message);
});

connectMongo();

// ── PASSWORDS ─────────────────────────────────
if (!process.env.GATE_PASSWORD || !process.env.ADMIN_PASSWORD) {
  console.error('❌ GATE_PASSWORD and ADMIN_PASSWORD must be set as environment variables. Refusing to start.');
  process.exit(1);
}
const GATE_PASSWORD  = process.env.GATE_PASSWORD;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// ── VALID SHOPS ────────────────────────────────
const VALID_SHOPS = process.env.VALID_SHOPS
  ? process.env.VALID_SHOPS.split(',').map(s => s.trim()).filter(Boolean)
  : ['456', '192', 'G15'];

// ── DEFAULT CLIENT ID ──────────────────────────
// All legacy data (created before multi-tenancy) belongs to this client.
// The migration script sets clientId = DEFAULT_CLIENT_ID on every existing document.
const DEFAULT_CLIENT_ID = process.env.DEFAULT_CLIENT_ID || 'default';

// ══════════════════════════════════════════════════════════════════
// SCHEMAS
// ══════════════════════════════════════════════════════════════════

// ── NEW: Client (tenant) ───────────────────────
// One Client = one business owner who may control multiple shops.
const ClientSchema = new mongoose.Schema({
  clientId:    { type: String, required: true, unique: true, index: true },
  name:        { type: String, required: true, trim: true },
  slug:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  status:      { type: String, enum: ['active', 'suspended'], default: 'active' },
  // Which shop identifiers belong to this client (subset of VALID_SHOPS or custom)
  shops:       { type: [String], default: [] },
  // Optional metadata
  contactEmail: { type: String, default: '' },
  notes:        { type: String, default: '' },
  createdAt:   { type: String, default: () => new Date().toISOString() },
  updatedAt:   { type: String, default: () => new Date().toISOString() },
});
const Client = mongoose.model('Client', ClientSchema);

// ── NEW: ClientUser (per-tenant user accounts) ─
// Replaces the single-password auth model for client and shop users.
// Master admin credentials stay in env vars and are NOT stored here.
const ClientUserSchema = new mongoose.Schema({
  clientId:     { type: String, required: true, index: true },
  username:     { type: String, required: true, trim: true },
  // bcrypt hash stored here — plain passwords NEVER persisted.
  // For Phase 1 we store a placeholder; Phase 2 wires up bcrypt login.
  passwordHash: { type: String, default: '' },
  role:         { type: String, enum: ['client_admin', 'shop_user'], default: 'shop_user' },
  // Empty array = access to all shops in the client; otherwise scoped.
  assignedShops: { type: [String], default: [] },
  status:       { type: String, enum: ['active', 'suspended'], default: 'active' },
  lastLoginAt:  { type: String, default: '' },
  createdAt:    { type: String, default: () => new Date().toISOString() },
  updatedAt:    { type: String, default: () => new Date().toISOString() },
});
// Uniqueness: username must be unique within a client (not globally)
ClientUserSchema.index({ clientId: 1, username: 1 }, { unique: true });
const ClientUser = mongoose.model('ClientUser', ClientUserSchema);

// ── EXISTING: Phone ────────────────────────────
// Added: clientId (indexed), compound indexes for common query patterns
const PhoneSchema = new mongoose.Schema({
  // ── NEW FIELD ──
  clientId: { type: String, default: DEFAULT_CLIENT_ID, index: true },
  // ── existing fields (unchanged) ──
  imei:     String,
  imei2:    String,
  brand:    String,
  model:    String,
  color:    String,
  storage:  String,
  buyPrice: Number,
  salePrice: Number,
  status:   { type: String, default: 'in_stock' },
  shop:     String,
  soldByShop: String,
  cat:      String,
  notes:    String,
  addedAt:  String,
  soldAt:   String,
}, { toJSON: { virtuals: true } });

// Compound indexes: tenant isolation + common filters
PhoneSchema.index({ clientId: 1, shop: 1 });
PhoneSchema.index({ clientId: 1, status: 1 });
PhoneSchema.index({ clientId: 1, imei: 1 }, { unique: true, sparse: true });
PhoneSchema.index({ clientId: 1, soldByShop: 1 });

const Phone = mongoose.model('Phone', PhoneSchema);

// ── EXISTING: Sale ─────────────────────────────
const SaleSchema = new mongoose.Schema({
  // ── NEW FIELD ──
  clientId: { type: String, default: DEFAULT_CLIENT_ID, index: true },
  // ── existing fields ──
  imei:       String,
  brand:      String,
  model:      String,
  buyPrice:   Number,
  salePrice:  Number,
  profit:     Number,
  shop:       String,
  soldByShop: String,
  buyerName:  String,
  buyerPhone: String,
  notes:      String,
  soldAt:     String,
});

SaleSchema.index({ clientId: 1, soldByShop: 1 });
SaleSchema.index({ clientId: 1, soldAt: 1 });

const Sale = mongoose.model('Sale', SaleSchema);

// ── EXISTING: Day ──────────────────────────────
const DaySchema = new mongoose.Schema({
  // ── NEW FIELD ──
  clientId: { type: String, default: DEFAULT_CLIENT_ID, index: true },
  // ── existing fields ──
  shop:         String,
  date:         String,
  cats:         mongoose.Schema.Types.Mixed,
  expenses:     Array,
  purchases:    Array,
  transfers:    Array,
  carryForward: Number,
});

DaySchema.index({ clientId: 1, shop: 1, date: 1 }, { unique: true, sparse: true });

const Day = mongoose.model('Day', DaySchema);

// ── EXISTING: ShopExpense ──────────────────────
const ShopExpenseSchema = new mongoose.Schema({
  // ── NEW FIELD ──
  clientId: { type: String, default: DEFAULT_CLIENT_ID, index: true },
  // ── existing fields ──
  shop:        String,
  date:        String,
  month:       String,
  category:    String,
  description: String,
  amount:      Number,
  addedAt:     String,
});

ShopExpenseSchema.index({ clientId: 1, shop: 1, month: 1 });

const ShopExpense = mongoose.model('ShopExpense', ShopExpenseSchema);

// ── EXISTING: HQStock ──────────────────────────
// One HQ stock document per client (key = clientId instead of 'hq')
const HQStockSchema = new mongoose.Schema({
  // ── CHANGED: key is now clientId (was always 'hq') ──
  // For legacy data the migration sets key = DEFAULT_CLIENT_ID
  clientId:  { type: String, default: DEFAULT_CLIENT_ID, unique: true, index: true },
  key:       { type: String, default: 'hq' },           // kept for backward compat
  items:     { type: Array, default: [] },
  updatedAt: String,
});

const HQStockModel = mongoose.model('HQStock', HQStockSchema);

// ── EXISTING: Shipment ─────────────────────────
const ShipmentSchema = new mongoose.Schema({
  // ── NEW FIELD ──
  clientId: { type: String, default: DEFAULT_CLIENT_ID, index: true },
  // ── existing fields ──
  date:     String,
  supplier: String,
  ref:      String,
  items:    Array,
  addedAt:  String,
});

ShipmentSchema.index({ clientId: 1, date: -1 });

const Shipment = mongoose.model('Shipment', ShipmentSchema);

// ── EXISTING: Dispatch ─────────────────────────
const DispatchSchema = new mongoose.Schema({
  // ── NEW FIELD ──
  clientId: { type: String, default: DEFAULT_CLIENT_ID, index: true },
  // ── existing fields ──
  date:    String,
  toShop:  String,
  note:    String,
  items:   Array,
  addedAt: String,
});

DispatchSchema.index({ clientId: 1, date: -1 });

const Dispatch = mongoose.model('Dispatch', DispatchSchema);

// ── EXISTING: Customer ─────────────────────────
const CustomerSchema = new mongoose.Schema({
  // ── NEW FIELD ──
  clientId: { type: String, default: DEFAULT_CLIENT_ID, index: true },
  // ── existing fields ──
  name:    String,
  phone:   String,
  email:   String,
  notes:   String,
  addedAt: String,
});

CustomerSchema.index({ clientId: 1, name: 1 });

const Customer = mongoose.model('Customer', CustomerSchema);

// ── EXISTING: AuditLog ─────────────────────────
const AuditLogSchema = new mongoose.Schema({
  // ── NEW FIELD ──
  clientId: { type: String, default: DEFAULT_CLIENT_ID, index: true },
  // ── existing fields ──
  action:  String,
  shop:    String,
  role:    String,
  details: mongoose.Schema.Types.Mixed,
  ts:      { type: String, default: () => new Date().toISOString() },
});

AuditLogSchema.index({ clientId: 1, ts: -1 });

const AuditLog = mongoose.model('AuditLog', AuditLogSchema);

// ── EXISTING: Report ───────────────────────────
const ReportSchema = new mongoose.Schema({
  // ── NEW FIELD ──
  clientId: { type: String, default: DEFAULT_CLIENT_ID, index: true },
  // ── existing fields ──
  type:        String,
  shop:        String,
  period:      String,
  data:        mongoose.Schema.Types.Mixed,
  generatedAt: String,
});

ReportSchema.index({ clientId: 1, type: 1, period: -1 });

const Report = mongoose.model('Report', ReportSchema);

// ══════════════════════════════════════════════════════════════════
// AUTH  (unchanged from original — Phase 2 will overhaul this)
// ══════════════════════════════════════════════════════════════════

const tokenStore = new Map();
const TOKEN_TTL = 8 * 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [tok, data] of tokenStore) {
    if (data.expiresAt < now) tokenStore.delete(tok);
  }
}, 60 * 60 * 1000);

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function safeCompare(a, b) {
  try {
    const ba = Buffer.from(String(a || ''), 'utf8');
    const bb = Buffer.from(String(b || ''), 'utf8');
    if (ba.length !== bb.length) {
      crypto.timingSafeEqual(ba, ba);
      return false;
    }
    return crypto.timingSafeEqual(ba, bb);
  } catch { return false; }
}

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
    req.authShop = session.shop;
    // Phase 1: all existing sessions belong to the default client.
    // Phase 2 will set this from the token payload per-user.
    req.clientId = session.clientId || DEFAULT_CLIENT_ID;
    next();
  };
}

const adminOnly = requireAuth(['admin']);
const anyAuth   = requireAuth(['admin', 'shop']);

function logAction(action, shop, role, details, clientId) {
  AuditLog.create({
    action,
    shop:     shop || null,
    role:     role || null,
    details,
    clientId: clientId || DEFAULT_CLIENT_ID,
  }).catch(err => console.error('Audit log error:', err));
}

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many attempts, please try again later.' },
});

// ══════════════════════════════════════════════════════════════════
// MASTER ADMIN MIDDLEWARE (Phase 3 will expand this significantly)
// ══════════════════════════════════════════════════════════════════

const MASTER_ADMIN_PASSWORD = process.env.MASTER_ADMIN_PASSWORD || ADMIN_PASSWORD;

function requireMasterAdmin(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const session = tokenStore.get(token);
  if (!session || session.expiresAt < Date.now() || session.role !== 'master') {
    return res.status(403).json({ error: 'Master admin access required' });
  }
  req.authRole = 'master';
  req.clientId = null; // master has no client scope
  next();
}

// ══════════════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════════════

// ── AUTH ───────────────────────────────────────
app.post('/api/auth', authLimiter, (req, res) => {
  const { type, password, shop } = req.body || {};

  if (type === 'gate') {
    return res.json({ ok: safeCompare(password, GATE_PASSWORD) });
  }

  if (type === 'admin') {
    if (!safeCompare(password, ADMIN_PASSWORD)) return res.json({ ok: false });
    const token = generateToken();
    tokenStore.set(token, {
      role: 'admin',
      shop: null,
      clientId: DEFAULT_CLIENT_ID,
      expiresAt: Date.now() + TOKEN_TTL,
    });
    return res.json({ ok: true, token, role: 'admin' });
  }

  if (type === 'shop') {
    if (!safeCompare(password, GATE_PASSWORD)) return res.json({ ok: false });
    if (!VALID_SHOPS.includes(shop)) return res.status(400).json({ ok: false, error: 'Invalid shop' });
    const token = generateToken();
    tokenStore.set(token, {
      role: 'shop',
      shop,
      clientId: DEFAULT_CLIENT_ID,
      expiresAt: Date.now() + TOKEN_TTL,
    });
    return res.json({ ok: true, token, role: 'shop', shop });
  }

  // ── NEW: master admin login ──
  if (type === 'master') {
    if (!safeCompare(password, MASTER_ADMIN_PASSWORD)) return res.json({ ok: false });
    const token = generateToken();
    tokenStore.set(token, {
      role: 'master',
      shop: null,
      clientId: null,
      expiresAt: Date.now() + TOKEN_TTL,
    });
    return res.json({ ok: true, token, role: 'master' });
  }

  return res.status(400).json({ ok: false });
});

// ── MASTER ADMIN: Client management ───────────
// Placeholder routes — fully implemented in Phase 3.
// Returning stubs now so the schema + indexes can be verified.

app.get('/api/master/clients', requireMasterAdmin, async (req, res) => {
  try {
    const clients = await Client.find().sort({ createdAt: -1 });
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/master/clients', requireMasterAdmin, async (req, res) => {
  try {
    const { name, slug, shops, contactEmail, notes } = req.body || {};
    if (!name || !slug) return res.status(400).json({ error: 'name and slug are required' });

    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return res.status(400).json({ error: 'slug must be lowercase alphanumeric with hyphens only' });
    }

    // Validate shops against VALID_SHOPS — clients can only be assigned known shops
    const assignedShops = (Array.isArray(shops) ? shops : []).filter(s => VALID_SHOPS.includes(s));

    const clientId = `client_${slug}_${crypto.randomBytes(4).toString('hex')}`;
    const client = await Client.create({
      clientId,
      name: name.trim(),
      slug: slug.trim(),
      shops: assignedShops,
      contactEmail: contactEmail || '',
      notes: notes || '',
    });

    // Auto-create the default HQ stock document for this client
    await HQStockModel.create({ clientId, key: 'hq', items: [], updatedAt: new Date().toISOString() });

    res.status(201).json({ success: true, client });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'A client with this slug or clientId already exists' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/master/clients/:clientId', requireMasterAdmin, async (req, res) => {
  try {
    const client = await Client.findOne({ clientId: req.params.clientId });
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json(client);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/master/clients/:clientId', requireMasterAdmin, async (req, res) => {
  try {
    const { name, status, shops, contactEmail, notes } = req.body || {};
    const allowed = {};
    if (name)         allowed.name         = name.trim();
    if (status && ['active', 'suspended'].includes(status)) allowed.status = status;
    if (Array.isArray(shops)) allowed.shops = shops.filter(s => VALID_SHOPS.includes(s));
    if (contactEmail !== undefined) allowed.contactEmail = contactEmail;
    if (notes !== undefined)        allowed.notes        = notes;
    allowed.updatedAt = new Date().toISOString();

    const client = await Client.findOneAndUpdate(
      { clientId: req.params.clientId },
      { $set: allowed },
      { returnDocument: 'after' }
    );
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json({ success: true, client });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/master/clients/:clientId', requireMasterAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    // Soft delete only — suspend the client, never hard-delete tenant data
    const client = await Client.findOneAndUpdate(
      { clientId },
      { $set: { status: 'suspended', updatedAt: new Date().toISOString() } },
      { returnDocument: 'after' }
    );
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json({ success: true, message: 'Client suspended. Data retained.', client });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── MASTER ADMIN: ClientUser stubs ────────────
app.get('/api/master/clients/:clientId/users', requireMasterAdmin, async (req, res) => {
  try {
    const users = await ClientUser
      .find({ clientId: req.params.clientId }, { passwordHash: 0 })
      .sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/master/clients/:clientId/users', requireMasterAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { username, role, assignedShops } = req.body || {};
    if (!username) return res.status(400).json({ error: 'username is required' });

    const client = await Client.findOne({ clientId });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Validate assignedShops are within this client's shops
    const validShops = (Array.isArray(assignedShops) ? assignedShops : [])
      .filter(s => client.shops.includes(s));

    // passwordHash is empty here — Phase 2 will add bcrypt password setting
    const user = await ClientUser.create({
      clientId,
      username: username.trim(),
      role: ['client_admin', 'shop_user'].includes(role) ? role : 'shop_user',
      assignedShops: validShops,
    });

    const { passwordHash: _, ...safeUser } = user.toObject();
    res.status(201).json({ success: true, user: safeUser });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Username already exists for this client' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/master/clients/:clientId/users/:userId', requireMasterAdmin, async (req, res) => {
  try {
    const { clientId, userId } = req.params;
    const { role, assignedShops, status } = req.body || {};

    const client = await Client.findOne({ clientId });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const allowed = { updatedAt: new Date().toISOString() };
    if (role && ['client_admin', 'shop_user'].includes(role)) allowed.role = role;
    if (status && ['active', 'suspended'].includes(status)) allowed.status = status;
    if (Array.isArray(assignedShops)) {
      allowed.assignedShops = assignedShops.filter(s => client.shops.includes(s));
    }

    const user = await ClientUser.findOneAndUpdate(
      { _id: userId, clientId },
      { $set: allowed },
      { returnDocument: 'after', projection: { passwordHash: 0 } }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/master/clients/:clientId/users/:userId', requireMasterAdmin, async (req, res) => {
  try {
    await ClientUser.findOneAndDelete({ _id: req.params.userId, clientId: req.params.clientId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── MASTER: aggregate stats ────────────────────
app.get('/api/master/stats', requireMasterAdmin, async (req, res) => {
  try {
    const [clients, phones, sales] = await Promise.all([
      Client.countDocuments(),
      Phone.aggregate([
        { $group: { _id: '$clientId', total: { $sum: 1 }, inStock: { $sum: { $cond: [{ $eq: ['$status', 'in_stock'] }, 1, 0] } } } }
      ]),
      Sale.aggregate([
        { $group: { _id: '$clientId', revenue: { $sum: '$salePrice' }, count: { $sum: 1 } } }
      ]),
    ]);

    const phoneMap  = Object.fromEntries(phones.map(p => [p._id, p]));
    const saleMap   = Object.fromEntries(sales.map(s => [s._id, s]));
    const allClients = await Client.find();

    const summary = allClients.map(c => ({
      clientId:  c.clientId,
      name:      c.name,
      status:    c.status,
      shops:     c.shops,
      inStock:   phoneMap[c.clientId]?.inStock  || 0,
      totalPhones: phoneMap[c.clientId]?.total  || 0,
      revenue:   saleMap[c.clientId]?.revenue   || 0,
      salesCount: saleMap[c.clientId]?.count    || 0,
    }));

    res.json({ totalClients: clients, summary });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ══════════════════════════════════════════════════════════════════
// ALL EXISTING ROUTES — clientId injected from req.clientId
// (set by requireAuth middleware; defaults to DEFAULT_CLIENT_ID)
// ══════════════════════════════════════════════════════════════════

// Helper: build a sales-by-shop query scoped to the current tenant
function buildSalesByShopQuery(shop, clientId) {
  const base = { clientId: clientId || DEFAULT_CLIENT_ID };
  if (!shop || typeof shop !== 'string') return base;
  return {
    ...base,
    $or: [
      { soldByShop: shop },
      { soldByShop: { $exists: false }, shop },
      { soldByShop: null, shop },
    ],
  };
}

// ── Lookup ─────────────────────────────────────
app.get('/api/lookup/:imei', anyAuth, async (req, res) => {
  try {
    const phone = await Phone.findOne({ imei: req.params.imei, clientId: req.clientId });
    if (!phone) return res.json({});
    res.json(phone);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Stock ──────────────────────────────────────
app.get('/api/stock', anyAuth, async (req, res) => {
  const shop = req.authShop || (typeof req.query.shop === 'string' && VALID_SHOPS.includes(req.query.shop) ? req.query.shop : undefined);
  const query = { clientId: req.clientId };
  if (shop) query.shop = shop;
  if (req.query.all !== 'true') query.status = 'in_stock';
  if (req.query.soldByShop && typeof req.query.soldByShop === 'string' && VALID_SHOPS.includes(req.query.soldByShop)) {
    if (req.authRole !== 'admin' && req.query.soldByShop !== req.authShop) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    delete query.shop;
    query.soldByShop = req.query.soldByShop;
  }
  const items = await Phone.find(query);
  res.json(items);
});

// ── Add stock ──────────────────────────────────
app.post('/api/stock/add', anyAuth, async (req, res) => {
  const body = { ...req.body };
  if (req.authRole === 'shop') body.shop = req.authShop;

  const { imei } = body;
  if (!imei) return res.status(400).json({ error: 'IMEI required' });
  if (!/^\d{15}$/.test(imei)) return res.status(400).json({ error: 'IMEI must be exactly 15 digits' });

  // Uniqueness check is scoped to the tenant
  const exists = await Phone.findOne({ imei, clientId: req.clientId });
  if (exists) return res.status(409).json({ error: 'IMEI exists' });

  const phone = new Phone({ ...body, clientId: req.clientId, addedAt: new Date().toISOString() });
  await phone.save();
  logAction('stock_add', body.shop || null, req.authRole, { imei, brand: body.brand, model: body.model, buyPrice: body.buyPrice }, req.clientId);
  res.json({ success: true, phone });
});

// ── Sell ───────────────────────────────────────
app.post('/api/stock/sell', anyAuth, async (req, res) => {
  try {
    const { imei, salePrice, buyerName, buyerPhone, notes, soldByShop } = req.body;

    if (!imei) return res.status(400).json({ error: 'IMEI required' });
    if (!/^\d{15}$/.test(imei)) return res.status(400).json({ error: 'IMEI must be exactly 15 digits' });
    if (salePrice === undefined || salePrice === null || salePrice === '') {
      return res.status(400).json({ error: 'salePrice required' });
    }

    const phone = await Phone.findOne({ imei, clientId: req.clientId });
    if (!phone) return res.status(404).json({ error: 'Not found' });
    if (phone.status === 'sold') return res.status(409).json({ error: 'Already sold' });

    const sp = Number(salePrice);
    if (Number.isNaN(sp) || sp <= 0) return res.status(400).json({ error: 'Sale price must be greater than zero' });

    const effectiveSoldByShop = (soldByShop && VALID_SHOPS.includes(soldByShop))
      ? soldByShop
      : (req.authShop || phone.shop);

    const bp = Number(phone.buyPrice) || 0;
    const profit = sp - bp;

    phone.status = 'sold';
    phone.salePrice = sp;
    phone.soldAt = new Date().toISOString();
    phone.soldByShop = effectiveSoldByShop;
    await phone.save();

    const sale = new Sale({
      clientId: req.clientId,
      imei: phone.imei,
      brand: phone.brand,
      model: phone.model,
      buyPrice: bp,
      salePrice: sp,
      profit,
      shop: phone.shop,
      soldByShop: effectiveSoldByShop,
      buyerName: buyerName || null,
      buyerPhone: buyerPhone || null,
      notes: notes || null,
      soldAt: phone.soldAt,
    });

    try {
      await sale.save();
    } catch (saleErr) {
      phone.status = 'in_stock';
      phone.salePrice = undefined;
      phone.soldAt = undefined;
      await phone.save().catch(e => console.error('Revert failed:', e));
      throw saleErr;
    }

    // Auto-upsert customer contact
    if (buyerName || buyerPhone) {
      try {
        const nameVal = (buyerName || '').trim();
        const phoneVal = (buyerPhone || '').trim();
        if (nameVal) {
          const orClauses = [{ name: { $regex: `^${nameVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }, clientId: req.clientId }];
          if (phoneVal) orClauses.push({ phone: phoneVal, clientId: req.clientId });
          const existing = await Customer.findOne({ $or: orClauses });
          if (existing) {
            if (phoneVal && !existing.phone) { existing.phone = phoneVal; await existing.save(); }
          } else {
            await Customer.create({ clientId: req.clientId, name: nameVal, phone: phoneVal || undefined, addedAt: new Date().toISOString() });
          }
        }
      } catch (contactErr) {
        console.error('Auto-save contact error (non-fatal):', contactErr);
      }
    }

    logAction('stock_sell', effectiveSoldByShop || phone.shop || null, req.authRole, {
      imei: phone.imei, brand: phone.brand, model: phone.model,
      salePrice: sp, profit, buyerName: buyerName || null,
      stockShop: phone.shop || null, soldByShop: effectiveSoldByShop,
    }, req.clientId);
    res.json({ success: true, sale });
  } catch (err) {
    console.error('Sell endpoint error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Sales ──────────────────────────────────────
app.get('/api/sales', adminOnly, async (req, res) => {
  const shop = req.query.shop;
  const query = buildSalesByShopQuery(shop, req.clientId);
  const sales = await Sale.find(query);
  res.json(sales);
});

// ── Stats ──────────────────────────────────────
app.get('/api/stats', anyAuth, async (req, res) => {
  const rawShop = req.query.shop;
  const shop = req.authShop || (typeof rawShop === 'string' && VALID_SHOPS.includes(rawShop) ? rawShop : undefined);
  const stockQuery = { clientId: req.clientId, ...(shop ? { shop } : {}) };
  const salesQuery = buildSalesByShopQuery(shop, req.clientId);
  const [stock, sales] = await Promise.all([Phone.find(stockQuery), Sale.find(salesQuery)]);
  res.json({
    inStock:      stock.filter(p => p.status === 'in_stock').length,
    sold:         stock.filter(p => p.status === 'sold').length,
    total:        stock.length,
    totalRevenue: sales.reduce((s, x) => s + (x.salePrice || 0), 0),
    salesCount:   sales.length,
  });
});

// ── Batch edit ─────────────────────────────────
app.put('/api/stock/batch', adminOnly, async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids required' });
    const validIds = ids.filter(id => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id));
    if (validIds.length !== ids.length) return res.status(400).json({ error: 'Invalid phone ids' });

    const { brand, model, color, storage, buyPrice, imei2, cat, notes, shop } = req.body || {};
    const allowed = { brand, model, color, storage, buyPrice, imei2, cat, notes, shop };
    Object.keys(allowed).forEach(k => { if (allowed[k] === undefined) delete allowed[k]; });
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
    if (Object.keys(allowed).length === 0) return res.status(400).json({ error: 'No fields to update' });

    // clientId scoping prevents editing another tenant's phones
    const result = await Phone.updateMany({ _id: { $in: validIds }, clientId: req.clientId }, { $set: allowed });
    const updated = await Phone.find({ _id: { $in: validIds }, clientId: req.clientId });
    res.json({ success: true, matched: result.matchedCount, modified: result.modifiedCount, phones: updated });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Edit phone ─────────────────────────────────
app.put('/api/stock/:id', adminOnly, async (req, res) => {
  try {
    const { brand, model, color, storage, buyPrice, imei2, cat, notes, shop } = req.body;
    const allowed = { brand, model, color, storage, buyPrice, imei2, cat, notes, shop };
    Object.keys(allowed).forEach(k => allowed[k] === undefined && delete allowed[k]);
    const phone = await Phone.findOneAndUpdate(
      { _id: req.params.id, clientId: req.clientId },
      allowed,
      { returnDocument: 'after' }
    );
    if (!phone) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, phone });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete phone ───────────────────────────────
app.delete('/api/stock/:id', adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id === 'undefined' || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid phone id' });
    }
    const phone = await Phone.findOne({ _id: id, clientId: req.clientId });
    if (phone) {
      await Phone.findByIdAndDelete(id);
      logAction('stock_delete', phone.shop || null, req.authRole, { id, imei: phone.imei, brand: phone.brand, model: phone.model }, req.clientId);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Daily sheets ───────────────────────────────
app.get('/api/days', adminOnly, async (req, res) => {
  try {
    const { shop, month } = req.query;
    const query = { clientId: req.clientId };
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
    const day = await Day.findOne({ shop: req.params.shop, date: req.params.date, clientId: req.clientId });
    res.json(day || {});
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/days/:shop/:date', adminOnly, async (req, res) => {
  try {
    const { shop, date } = req.params;
    const update = { ...req.body, shop, date, clientId: req.clientId };
    const day = await Day.findOneAndUpdate(
      { shop, date, clientId: req.clientId },
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
    await Day.deleteOne({ shop: req.params.shop, date: req.params.date, clientId: req.clientId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Shop expenses ──────────────────────────────
app.get('/api/shopexpenses', adminOnly, async (req, res) => {
  try {
    const { shop, month } = req.query;
    const query = { clientId: req.clientId };
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
    const expense = new ShopExpense({ ...req.body, clientId: req.clientId, addedAt: new Date().toISOString() });
    await expense.save();
    res.json({ success: true, expense: { ...expense.toObject(), _key: expense.id } });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/shopexpenses/:id', adminOnly, async (req, res) => {
  try {
    await ShopExpense.findOneAndDelete({ _id: req.params.id, clientId: req.clientId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── HQ Stock ───────────────────────────────────
app.get('/api/hqstock', adminOnly, async (req, res) => {
  try {
    const stock = await HQStockModel.findOne({ clientId: req.clientId });
    res.json(stock || { items: [] });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/hqstock', adminOnly, async (req, res) => {
  try {
    const update = { ...req.body, clientId: req.clientId, key: 'hq', updatedAt: new Date().toISOString() };
    const stock = await HQStockModel.findOneAndUpdate(
      { clientId: req.clientId },
      update,
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    res.json({ success: true, stock });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Shipments ──────────────────────────────────
app.post('/api/shipments', adminOnly, async (req, res) => {
  try {
    const { date, supplier, ref, items } = req.body || {};
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'At least one item is required' });

    const imeiItems = items.filter(it => it && it.imei);
    if (imeiItems.length === items.length) {
      const normalized = imeiItems.map(it => ({
        imei:     String(it.imei || '').replace(/\D/g, ''),
        imei2:    String(it.imei2 || '').replace(/\D/g, '') || undefined,
        cat:      String(it.cat || '').trim() || undefined,
        brand:    String(it.brand || '').trim() || undefined,
        model:    String(it.model || '').trim() || undefined,
        color:    String(it.color || '').trim() || undefined,
        storage:  String(it.storage || '').trim() || undefined,
        buyPrice: Number.isFinite(Number(it.buyPrice)) && Number(it.buyPrice) >= 0 ? Number(it.buyPrice) : 0,
        notes:    String(it.notes || '').trim() || undefined,
        addedAt:  new Date().toISOString(),
      }));

      const invalid = normalized.find(it => !/^\d{15}$/.test(it.imei));
      if (invalid) return res.status(400).json({ error: `Invalid IMEI: ${invalid.imei || '(empty)'}` });

      const payloadImeiSet = new Set();
      for (const it of normalized) {
        if (payloadImeiSet.has(it.imei)) return res.status(409).json({ error: `Duplicate IMEI in shipment: ${it.imei}` });
        payloadImeiSet.add(it.imei);
      }

      const existingPhones = await Phone.find({ imei: { $in: [...payloadImeiSet] }, clientId: req.clientId }, { imei: 1 });
      if (existingPhones.length) return res.status(409).json({ error: `IMEI already exists in stock: ${existingPhones[0].imei}` });

      const stock = await HQStockModel.findOne({ clientId: req.clientId });
      const hqItems = Array.isArray(stock?.items) ? stock.items : [];
      const hqImeiSet = new Set(hqItems.map(x => String(x?.imei || '').replace(/\D/g, '')).filter(Boolean));
      const dupHq = normalized.find(it => hqImeiSet.has(it.imei));
      if (dupHq) return res.status(409).json({ error: `IMEI already exists in warehouse: ${dupHq.imei}` });

      const mergedItems = [...hqItems, ...normalized];
      await HQStockModel.findOneAndUpdate(
        { clientId: req.clientId },
        { clientId: req.clientId, key: 'hq', items: mergedItems, updatedAt: new Date().toISOString() },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
      );
    }

    const shipment = new Shipment({ clientId: req.clientId, date, supplier, ref, items, addedAt: new Date().toISOString() });
    await shipment.save();
    res.json({ success: true, shipment });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/shipments', adminOnly, async (req, res) => {
  try {
    const shipments = await Shipment.find({ clientId: req.clientId }).sort({ date: -1 });
    res.json(shipments);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/shipments/:id', adminOnly, async (req, res) => {
  try {
    await Shipment.findOneAndDelete({ _id: req.params.id, clientId: req.clientId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Dispatches ─────────────────────────────────
app.post('/api/dispatches', adminOnly, async (req, res) => {
  try {
    const { date, toShop, note, items } = req.body || {};
    if (!VALID_SHOPS.includes(toShop)) return res.status(400).json({ error: 'Invalid shop' });
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'At least one item is required' });

    const imeiItems = items.filter(it => it && it.imei);
    if (imeiItems.length === items.length) {
      const normalizedImei = imeiItems.map(it => String(it.imei || '').replace(/\D/g, ''));
      const invalid = normalizedImei.find(imei => !/^\d{15}$/.test(imei));
      if (invalid) return res.status(400).json({ error: `Invalid IMEI: ${invalid}` });

      const uniqImeis = [...new Set(normalizedImei)];
      if (uniqImeis.length !== normalizedImei.length) return res.status(409).json({ error: 'Duplicate IMEI in dispatch payload' });

      const existing = await Phone.find({ imei: { $in: uniqImeis }, clientId: req.clientId }, { imei: 1 });
      if (existing.length) return res.status(409).json({ error: `IMEI already exists in stock: ${existing[0].imei}` });

      const stock = await HQStockModel.findOne({ clientId: req.clientId });
      const hqItems = Array.isArray(stock?.items) ? stock.items : [];
      const byImei = new Map(hqItems.filter(it => it && it.imei).map(it => [String(it.imei).replace(/\D/g, ''), it]));
      const missing = uniqImeis.find(imei => !byImei.has(imei));
      if (missing) return res.status(400).json({ error: `IMEI not found in warehouse: ${missing}` });

      const now = new Date().toISOString();
      const phonesToCreate = uniqImeis.map(imei => {
        const src = byImei.get(imei) || {};
        return {
          clientId: req.clientId,
          imei,
          imei2:    src.imei2 || undefined,
          brand:    src.brand || '',
          model:    src.model || '',
          color:    src.color || '',
          storage:  src.storage || '',
          buyPrice: Number(src.buyPrice) || 0,
          status:   'in_stock',
          shop:     toShop,
          cat:      src.cat || '',
          notes:    src.notes || '',
          addedAt:  now,
        };
      });

      await Phone.insertMany(phonesToCreate, { ordered: true });
      const remaining = hqItems.filter(it => {
        const imei = String(it?.imei || '').replace(/\D/g, '');
        return !imei || !uniqImeis.includes(imei);
      });
      await HQStockModel.findOneAndUpdate(
        { clientId: req.clientId },
        { clientId: req.clientId, key: 'hq', items: remaining, updatedAt: now },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
      );
    }

    const dispatch = new Dispatch({ clientId: req.clientId, date, toShop, note, items, addedAt: new Date().toISOString() });
    await dispatch.save();
    res.json({ success: true, dispatch });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/dispatches', adminOnly, async (req, res) => {
  try {
    const dispatches = await Dispatch.find({ clientId: req.clientId }).sort({ date: -1 });
    const allImeis = [...new Set(dispatches.flatMap(d => (d.items || []).map(it => String(it?.imei || '').replace(/\D/g, '')).filter(Boolean)))];
    let soldSet = new Set();
    if (allImeis.length) {
      const soldPhones = await Phone.find({ imei: { $in: allImeis }, status: 'sold', clientId: req.clientId }, { imei: 1, shop: 1 });
      soldSet = new Set(soldPhones.map(p => `${p.shop}|${p.imei}`));
    }
    const withStats = dispatches.map(d => {
      const imeis = (d.items || []).map(it => String(it?.imei || '').replace(/\D/g, '')).filter(Boolean);
      const totalPhones = imeis.length || (d.items || []).reduce((s, it) => s + (Number(it?.qty) || 0), 0);
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
    await Dispatch.findOneAndDelete({ _id: req.params.id, clientId: req.clientId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/hqstock/:imei', adminOnly, async (req, res) => {
  try {
    const imei = String(req.params.imei || '').replace(/\D/g, '');
    if (!/^\d{15}$/.test(imei)) return res.status(400).json({ error: 'Invalid IMEI' });
    const stock = await HQStockModel.findOne({ clientId: req.clientId });
    if (!stock) return res.json({ success: true });
    stock.items = (stock.items || []).filter(it => String(it?.imei || '').replace(/\D/g, '') !== imei);
    stock.updatedAt = new Date().toISOString();
    await stock.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Sales bulk delete ──────────────────────────
app.delete('/api/sales', adminOnly, async (req, res) => {
  try {
    const { shop } = req.query;
    const query = buildSalesByShopQuery(shop, req.clientId);
    const sales = await Sale.find(query);
    if (!sales.length) return res.json({ success: true, deleted: 0 });
    const imeis = [...new Set(sales.map(s => s.imei).filter(Boolean))];
    if (imeis.length) {
      await Phone.updateMany(
        { imei: { $in: imeis }, clientId: req.clientId },
        { $set: { status: 'in_stock' }, $unset: { salePrice: '', soldAt: '' } }
      );
    }
    const result = await Sale.deleteMany(query);
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete sale by IMEI ────────────────────────
app.delete('/api/sales/by-imei/:imei', adminOnly, async (req, res) => {
  try {
    const sale = await Sale.findOne({ imei: req.params.imei, clientId: req.clientId });
    if (!sale) return res.status(404).json({ error: 'Sale not found' });
    await Phone.findOneAndUpdate(
      { imei: sale.imei, clientId: req.clientId },
      { $set: { status: 'in_stock' }, $unset: { salePrice: '', soldAt: '' } }
    );
    await Sale.findByIdAndDelete(sale._id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete sale by id ──────────────────────────
app.delete('/api/sales/:id', adminOnly, async (req, res) => {
  try {
    const sale = await Sale.findOne({ _id: req.params.id, clientId: req.clientId });
    if (!sale) return res.status(404).json({ error: 'Sale not found' });
    await Phone.findOneAndUpdate(
      { imei: sale.imei, clientId: req.clientId },
      { $set: { status: 'in_stock' }, $unset: { salePrice: '', soldAt: '' } }
    );
    await Sale.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Customers ──────────────────────────────────
app.get('/api/customers', adminOnly, async (req, res) => {
  try {
    const { q } = req.query;
    const query = { clientId: req.clientId };
    if (q) query.$or = [{ name: { $regex: q, $options: 'i' } }, { phone: { $regex: q } }];
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
    const customer = new Customer({ clientId: req.clientId, name, phone, email, notes, addedAt: new Date().toISOString() });
    await customer.save();
    res.json({ success: true, customer });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/customers/:id', adminOnly, async (req, res) => {
  try {
    const { name, phone, email, notes } = req.body;
    const customer = await Customer.findOneAndUpdate(
      { _id: req.params.id, clientId: req.clientId },
      { name, phone, email, notes },
      { returnDocument: 'after' }
    );
    if (!customer) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, customer });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/customers/:id', adminOnly, async (req, res) => {
  try {
    await Customer.findOneAndDelete({ _id: req.params.id, clientId: req.clientId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Audit logs ─────────────────────────────────
app.get('/api/logs', adminOnly, async (req, res) => {
  try {
    const { shop, limit = 300 } = req.query;
    const query = { clientId: req.clientId };
    if (shop) query.shop = shop;
    const logs = await AuditLog.find(query).sort({ ts: -1 }).limit(Number(limit));
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Analytics ──────────────────────────────────
app.get('/api/analytics/models', adminOnly, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const since     = new Date(Date.now() - Number(days) * 86400000).toISOString();
    const staleDate = new Date(Date.now() - 30 * 86400000).toISOString();

    const [recentSales, staleStock] = await Promise.all([
      Sale.find({ soldAt: { $gte: since }, clientId: req.clientId }),
      Phone.find({ status: 'in_stock', addedAt: { $lte: staleDate }, clientId: req.clientId }),
    ]);

    const modelMap = {};
    recentSales.forEach(s => {
      const key = `${s.brand || ''} ${s.model || ''}`.trim() || 'Unknown';
      if (!modelMap[key]) modelMap[key] = { model: key, count: 0, revenue: 0, profit: 0 };
      modelMap[key].count++;
      modelMap[key].revenue += s.salePrice || 0;
      modelMap[key].profit  += s.profit    || 0;
    });
    const topSold = Object.values(modelMap).sort((a, b) => b.count - a.count).slice(0, 15);

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

// ── CEO summary ────────────────────────────────
app.get('/api/ceo/summary', adminOnly, async (req, res) => {
  try {
    const { month } = req.query;
    const currentMonth = month || new Date().toISOString().slice(0, 7);
    const [y, m] = currentMonth.split('-').map(Number);
    const prevDate  = new Date(y, m - 2, 1);
    const prevMonth = prevDate.toISOString().slice(0, 7);

    const [currentSales, prevSales, currentExpenses, stock] = await Promise.all([
      Sale.find({ soldAt: { $regex: `^${currentMonth}` }, clientId: req.clientId }),
      Sale.find({ soldAt: { $regex: `^${prevMonth}`    }, clientId: req.clientId }),
      ShopExpense.find({ month: currentMonth, clientId: req.clientId }),
      Phone.find({ status: 'in_stock', clientId: req.clientId }),
    ]);

    const shopStats = {};
    VALID_SHOPS.forEach(s => { shopStats[s] = { revenue: 0, cost: 0, profit: 0, units: 0, expenses: 0 }; });

    currentSales.forEach(s => {
      const sh = s.soldByShop || s.shop;
      if (!sh) return;
      if (!shopStats[sh]) shopStats[sh] = { revenue: 0, cost: 0, profit: 0, units: 0, expenses: 0 };
      shopStats[sh].revenue += s.salePrice || 0;
      shopStats[sh].cost    += s.buyPrice  || 0;
      shopStats[sh].profit  += s.profit    || 0;
      shopStats[sh].units++;
    });

    currentExpenses.forEach(e => {
      const sh = e.shop;
      if (!sh) return;
      if (!shopStats[sh]) shopStats[sh] = { revenue: 0, cost: 0, profit: 0, units: 0, expenses: 0 };
      shopStats[sh].expenses += e.amount || 0;
    });

    const modelCounts = {};
    currentSales.forEach(s => {
      const key = `${s.brand || ''} ${s.model || ''}`.trim();
      if (key) modelCounts[key] = (modelCounts[key] || 0) + 1;
    });
    const topModels = Object.entries(modelCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([model, count]) => ({ model, count }));

    const totalRevenue  = currentSales.reduce((s, x) => s + (x.salePrice || 0), 0);
    const totalProfit   = currentSales.reduce((s, x) => s + (x.profit    || 0), 0);
    const totalExpenses = currentExpenses.reduce((s, e) => s + (e.amount  || 0), 0);
    const prevRevenue   = prevSales.reduce((s, x) => s + (x.salePrice || 0), 0);
    const prevProfit    = prevSales.reduce((s, x) => s + (x.profit    || 0), 0);

    res.json({
      month: currentMonth, prevMonth,
      current: { revenue: totalRevenue, profit: totalProfit, expenses: totalExpenses, units: currentSales.length, netProfit: totalProfit - totalExpenses },
      prev: { revenue: prevRevenue, profit: prevProfit },
      shopStats, topModels,
      inventoryCount: stock.length,
      inventoryValue: stock.reduce((s, p) => s + (p.buyPrice || 0), 0),
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Reports ────────────────────────────────────
app.get('/api/reports', adminOnly, async (req, res) => {
  try {
    const { shop, type } = req.query;
    const query = { clientId: req.clientId };
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
      const shopQ = shop === 'ALL' ? { clientId: req.clientId } : buildSalesByShopQuery(shop, req.clientId);
      const [sales, day] = await Promise.all([
        Sale.find({ ...shopQ, soldAt: { $regex: `^${period}` } }),
        shop === 'ALL' ? Promise.resolve(null) : Day.findOne({ shop, date: period, clientId: req.clientId }),
      ]);
      const expenses = (day?.expenses || []).reduce((s, e) => s + (e.amt || 0), 0);
      data = {
        totalSales:  sales.reduce((s, x) => s + (x.salePrice || 0), 0),
        totalCost:   sales.reduce((s, x) => s + (x.buyPrice  || 0), 0),
        grossProfit: sales.reduce((s, x) => s + (x.profit    || 0), 0),
        unitsSold:   sales.length,
        expenses,
        netProfit:   sales.reduce((s, x) => s + (x.profit || 0), 0) - expenses,
        salesList:   sales.map(s => ({ model: `${s.brand || ''} ${s.model || ''}`.trim(), imei: s.imei, salePrice: s.salePrice, buyPrice: s.buyPrice, profit: s.profit, buyerName: s.buyerName || null, shop: s.shop })),
      };
    } else if (type === 'monthly') {
      const shopQ = shop === 'ALL' ? { clientId: req.clientId } : buildSalesByShopQuery(shop, req.clientId);
      const [sales, expenses] = await Promise.all([
        Sale.find({ ...shopQ, soldAt: { $regex: `^${period}` } }),
        ShopExpense.find(shop === 'ALL' ? { month: period, clientId: req.clientId } : { shop, month: period, clientId: req.clientId }),
      ]);
      const grossProfit   = sales.reduce((s, x) => s + (x.profit || 0), 0);
      const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
      data = {
        totalSales:        sales.reduce((s, x) => s + (x.salePrice || 0), 0),
        totalCost:         sales.reduce((s, x) => s + (x.buyPrice  || 0), 0),
        grossProfit,
        unitsSold:         sales.length,
        totalExpenses,
        netProfit:         grossProfit - totalExpenses,
        expenseBreakdown:  expenses.map(e => ({ category: e.category, description: e.description, amount: e.amount, date: e.date })),
      };
    } else {
      return res.status(400).json({ error: 'Invalid type' });
    }

    const report = await Report.findOneAndUpdate(
      { type, shop, period, clientId: req.clientId },
      { type, shop, period, data, clientId: req.clientId, generatedAt: new Date().toISOString() },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/reports/:id', adminOnly, async (req, res) => {
  try {
    await Report.findOneAndDelete({ _id: req.params.id, clientId: req.clientId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Backup & Restore ───────────────────────────
app.get('/api/backup', adminOnly, async (req, res) => {
  try {
    const cid = req.clientId;
    const [phones, sales, days, expenses, hqstock, shipments, dispatches] = await Promise.all([
      Phone.find({ clientId: cid }),
      Sale.find({ clientId: cid }),
      Day.find({ clientId: cid }),
      ShopExpense.find({ clientId: cid }),
      HQStockModel.findOne({ clientId: cid }),
      Shipment.find({ clientId: cid }),
      Dispatch.find({ clientId: cid }),
    ]);
    res.json({ version: 2, clientId: cid, exportedAt: new Date().toISOString(), phones, sales, days, expenses, hqstock: hqstock || { items: [] }, shipments, dispatches });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/restore', adminOnly, express.json({ limit: '50mb' }), async (req, res) => {
  try {
    const { phones, sales, days, expenses, hqstock, shipments, dispatches } = req.body;
    const cid = req.clientId;

    if (phones?.length) {
      await Phone.bulkWrite(phones.map(p => ({
        updateOne: { filter: { imei: p.imei, clientId: cid }, update: { $set: { ...p, clientId: cid } }, upsert: true }
      })));
    }
    if (sales?.length) {
      await Sale.bulkWrite(sales.map(s => ({
        updateOne: { filter: s._id ? { _id: s._id, clientId: cid } : { imei: s.imei, soldAt: s.soldAt, clientId: cid }, update: { $set: { ...s, clientId: cid } }, upsert: true }
      })));
    }
    if (days?.length) {
      await Day.bulkWrite(days.map(d => ({
        updateOne: { filter: { shop: d.shop, date: d.date, clientId: cid }, update: { $set: { ...d, clientId: cid } }, upsert: true }
      })));
    }
    if (expenses?.length) {
      await ShopExpense.insertMany(expenses.map(e => ({ ...e, clientId: cid })), { ordered: false }).catch(() => {});
    }
    if (hqstock) {
      await HQStockModel.findOneAndUpdate({ clientId: cid }, { ...hqstock, clientId: cid, key: 'hq' }, { upsert: true });
    }
    if (shipments?.length) {
      await Shipment.insertMany(shipments.map(s => ({ ...s, clientId: cid })), { ordered: false }).catch(() => {});
    }
    if (dispatches?.length) {
      await Dispatch.insertMany(dispatches.map(d => ({ ...d, clientId: cid })), { ordered: false }).catch(() => {});
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Restore failed: ' + err.message });
  }
});

// ── START ──────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});