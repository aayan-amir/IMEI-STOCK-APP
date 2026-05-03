'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 10;


// ── MongoDB Connection ─────────────────────────────────────────────────────
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

// Drop stale indexes left over from old schema versions
mongoose.connection.once('open', async () => {
  try {
    await mongoose.connection.db.collection('clients').dropIndex('slug_1');
    console.log('🧹 Dropped stale slug_1 index from clients');
  } catch (e) {
    // Index doesn't exist — that's fine
  }
});

// ── Schemas ────────────────────────────────────────────────────────────────
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
  soldAt: String,
}, { toJSON: { virtuals: true }, timestamps: true });

PhoneSchema.index({ imei: 1 });
PhoneSchema.index({ shop: 1, status: 1 });
PhoneSchema.index({ createdAt: -1 });

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
  soldAt: String,
});

const DaySchema = new mongoose.Schema({
  shop: String,
  date: String,
  cats: mongoose.Schema.Types.Mixed,
  expenses: Array,
  purchases: Array,
  transfers: Array,
  carryForward: Number,
});

const ShopExpenseSchema = new mongoose.Schema({
  shop: String,
  date: String,
  month: String,
  category: String,
  description: String,
  amount: Number,
  addedAt: String,
});

const HQStockSchema = new mongoose.Schema({
  key: { type: String, default: 'hq' },
  items: { type: Array, default: [] },
  updatedAt: String,
});

const ShipmentSchema = new mongoose.Schema({
  date: String,
  supplier: String,
  ref: String,
  items: Array,
  addedAt: String,
});

const DispatchSchema = new mongoose.Schema({
  date: String,
  toShop: String,
  note: String,
  items: Array,
  addedAt: String,
});

const CustomerSchema = new mongoose.Schema({
  name: String,
  phone: String,
  email: String,
  notes: String,
  addedAt: String,
});

const AuditLogSchema = new mongoose.Schema({
  action: String,
  shop: String,
  role: String,
  details: mongoose.Schema.Types.Mixed,
  ts: { type: String, default: () => new Date().toISOString() },
});

const ReportSchema = new mongoose.Schema({
  type: String,   // 'daily' | 'monthly'
  shop: String,
  period: String, // YYYY-MM-DD or YYYY-MM
  data: mongoose.Schema.Types.Mixed,
  generatedAt: String,
});

const ProductSchema = new mongoose.Schema({
  name: { type: String, required: true },
  quantity: { type: Number, default: 0 },
  buyPrice: Number,
  shop: String,
  notes: String,
  addedAt: String,
});

// ── Master Client Schema ───────────────────────────────────────────────────
const ClientSchema = new mongoose.Schema({
  clientId: { type: String, unique: true, required: true },
  adminPassword: { type: String, required: true },
  gatePassword: { type: String, required: true },
  shops: { type: Array, default: [] },
  status: { type: String, default: 'active', enum: ['active', 'paused'] },
});

ClientSchema.pre('save', async function(next) {
  if (this.isModified('adminPassword')) {
    this.adminPassword = await bcrypt.hash(this.adminPassword, SALT_ROUNDS);
  }
  if (this.isModified('gatePassword')) {
    this.gatePassword = await bcrypt.hash(this.gatePassword, SALT_ROUNDS);
  }
  next();
});

ClientSchema.methods.compareAdminPassword = function(candidate) {
  return bcrypt.compare(candidate, this.adminPassword);
};

ClientSchema.methods.compareGatePassword = function(candidate) {
  return bcrypt.compare(candidate, this.gatePassword);
};

const Client = mongoose.model('Client', ClientSchema);


// ── Session Schema (persisted in MongoDB — survives restarts, shared across instances) ──
const SessionSchema = new mongoose.Schema({
  token:      { type: String, unique: true, required: true, index: true },
  role:       String,
  shop:       String,
  clientId:   String,
  validShops: [String],
  expiresAt:  { type: Date, index: { expires: 0 } }, // TTL index — Mongo auto-deletes
});
SessionSchema.index({ token: 1, clientId: 1 });
const Session = mongoose.model('Session', SessionSchema);

// ── Tenant Connections ─────────────────────────────────────────────────────
const tenantConnections = new Map();

function getTenantDb(clientId) {
  if (!tenantConnections.has(clientId)) {
    const db = mongoose.connection.useDb(`tenant_${clientId}`, { useCache: true });
    tenantConnections.set(clientId, db);
  }
  return tenantConnections.get(clientId);
}

module.exports = {
  mongoose,
  connectMongo,
  // Schemas (needed by tenant middleware to register per-tenant models)
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
  // Shared (non-tenant) models
  Client,
  Session,
  // Tenant helpers
  getTenantDb,
};
