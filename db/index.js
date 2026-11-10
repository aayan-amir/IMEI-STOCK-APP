'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { randomUUID } = require('node:crypto');
const SALT_ROUNDS = 10;
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);

// ── MongoDB Connection ─────────────────────────────────────────────────────
const MONGO_OPTS = {
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 30000,
  heartbeatFrequencyMS: 10000,
};

function connectMongo(uri) {
  if (!uri) throw new Error('MONGO_URI is required');
  if (process.env.NODE_ENV === 'test') require('../config/runtime').assertTestMongoUri(uri);
  return mongoose.connect(uri, MONGO_OPTS);
}

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
  currentSaleId: mongoose.Schema.Types.ObjectId,
}, { toJSON: { virtuals: true }, timestamps: true });

PhoneSchema.index({ imei: 1 });
PhoneSchema.index({ shop: 1, status: 1 });
PhoneSchema.index({ createdAt: -1 });

const StocktakeSchema = new mongoose.Schema({
  shop: String, status: String, startedAt: String, businessDate: String,
  configuration: String, revision: Number, finishedAt: String, review: mongoose.Schema.Types.Mixed,
  baseline: [mongoose.Schema.Types.Mixed], observations: [mongoose.Schema.Types.Mixed], operations: [mongoose.Schema.Types.Mixed],
}, { strict: 'throw' });

const CustomerReturnSchema = new mongoose.Schema({
  version: Number, phoneId: mongoose.Schema.Types.ObjectId, imei: String, shop: String, soldByShop: String,
  amountMinor: Number, acceptedAt: String, businessDate: String, reversalId: String,
  operationId: String, fingerprint: String, reviewFingerprint: String,
  result: mongoose.Schema.Types.Mixed, refund: mongoose.Schema.Types.Mixed,
}, { strict: 'throw' });

const CashEntrySchema = new mongoose.Schema({
  version: Number, operationId: String, fingerprint: String, shop: String, kind: String, method: String,
  currency: String, amountMinor: Number, costMinor: Number, description: String, category: String,
  toShop: String, occurredAt: String, postingDate: String, receivingPostingDate: String, confirmed: Boolean,
  expense: mongoose.Schema.Types.Mixed, result: mongoose.Schema.Types.Mixed,
}, { strict: 'throw' });

const CashCheckpointSchema = new mongoose.Schema({
  version: Number, operationId: String, fingerprint: String, reviewFingerprint: String, configuration: String,
  shop: String, kind: String, revision: Number, previousId: String, at: String, businessDate: String,
  countedMinor: Number, reason: String, baseline: mongoose.Schema.Types.Mixed, flows: [mongoose.Schema.Types.Mixed],
  calculation: mongoose.Schema.Types.Mixed, daySnapshotId: String, result: mongoose.Schema.Types.Mixed,
}, { strict: 'throw' });

const SaleSchema = new mongoose.Schema({
  phoneId: mongoose.Schema.Types.ObjectId,
  imei2: String,
  cat: String,
  color: String,
  storage: String,
  imei: String,
  brand: String,
  model: String,
  buyPrice: Number,
  salePrice: Number,
  profit: Number,
  buyPriceMinor: Number,
  salePriceMinor: Number,
  profitMinor: Number,
  paymentVersion: Number,
  paymentMethod: String,
  paidAmountMinor: Number,
  shop: String,
  soldByShop: String,
  buyerName: String,
  buyerPhone: String,
  notes: String,
  soldAt: String,
  businessDate: String,
  reversedAt: String,
  reversalId: String,
  reversalBusinessDate: String,
  reversedBy: String,
});

const DaySchema = new mongoose.Schema({
  shop: String,
  date: String,
  cats: mongoose.Schema.Types.Mixed,
  expenses: Array,
  purchases: Array,
  transfers: Array,
  carryForward: Number,
  revision: { type: Number, default: 0 },
  status: { type: String, enum: ['open', 'closed'], default: 'open' },
  closedAt: String,
  closedSnapshot: mongoose.Schema.Types.Mixed,
  cashManualChecksum: String,
  history: { type: Array, default: [] },
});

const AccountingStateSchema = new mongoose.Schema({ _id: String, openDate: String, version: { type: Number, default: 0 }, cashFormatVersion: Number, cashCheckpointId: String });
const DayVersionSchema = new mongoose.Schema({ _id: String, shop: String, date: String, revision: Number,
  snapshot: mongoose.Schema.Types.Mixed, createdAt: String });
const DayOperationSchema = new mongoose.Schema({ _id: String, fingerprint: String, result: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now } });

const StockOperationSchema = new mongoose.Schema({
  _id: String,
  fingerprint: { type: String, required: true },
  sale: { type: mongoose.Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now },
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
  revision: { type: Number, default: 0 },
});

const InventoryIdentitySchema = new mongoose.Schema({ _id: String, version: { type: Number, default: 0 } });
const InventoryOperationSchema = new mongoose.Schema({
  _id: String,
  fingerprint: { type: String, required: true },
  result: { type: mongoose.Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now },
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
AuditLogSchema.index({ ts: -1 });
AuditLogSchema.index({ shop: 1, ts: -1 });

const ReportSchema = new mongoose.Schema({
  type: String,   // 'daily' | 'monthly'
  shop: String,
  period: String, // YYYY-MM-DD or YYYY-MM
  data: mongoose.Schema.Types.Mixed,
  generatedAt: String,
  history: { type: Array, default: [] },
});

const ProductSchema = new mongoose.Schema({
  name: { type: String, required: true },
  normalizedName: String,
  revision: { type: Number, default: 0 },
  quantity: { type: Number, default: 0 },
  buyPrice: Number,
  shop: String,
  notes: String,
  addedAt: String,
});

const ProductIdentitySchema = new mongoose.Schema({
  _id: String,
  version: { type: Number, default: 0 },
});

const ProductOperationSchema = new mongoose.Schema({
  _id: String,
  fingerprint: { type: String, required: true },
  result: { type: mongoose.Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now },
});

const RecoveryStateSchema = new mongoose.Schema({
  _id: String, epoch: { type: Number, default: 0 }, maintenance: { type: Boolean, default: false },
  leases: { type: [String], default: [] }, activePlanId: String, operationId: String, phase: String,
  currentPlanId: String, planExpiresAt: Date,
});
const RecoveryPlanSchema = new mongoose.Schema({
  _id: String, planId: String, backup: mongoose.Schema.Types.Mixed, checksum: String,
  targetEpoch: Number, targetConfig: String, expiresAt: Date,
});
const RecoveryReceiptSchema = new mongoose.Schema({
  _id: String, planId: String, checksum: String, result: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now },
});

// ── Master Client Schema ───────────────────────────────────────────────────
const ClientSchema = new mongoose.Schema({
  clientId: { type: String, unique: true, required: true },
  adminPassword: { type: String, required: true },
  gatePassword: { type: String, required: true },
  shops: { type: Array, default: [] },
  status: { type: String, default: 'active', enum: ['active', 'paused'] },
  authVersion: String,
});

ClientSchema.pre('save', async function() {
  if (this.isNew || ['adminPassword', 'gatePassword', 'status', 'shops'].some(field => this.isModified(field))) {
    this.authVersion = randomUUID();
  }
  if (this.isModified('adminPassword')) {
    this.adminPassword = await bcrypt.hash(this.adminPassword, SALT_ROUNDS);
  }
  if (this.isModified('gatePassword')) {
    this.gatePassword = await bcrypt.hash(this.gatePassword, SALT_ROUNDS);
  }
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
  authVersion: String,
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
  CashCheckpointSchema,
  mongoose,
  connectMongo,
  // Schemas (needed by tenant middleware to register per-tenant models)
  PhoneSchema,
  StocktakeSchema,
  CustomerReturnSchema,
  CashEntrySchema,
  SaleSchema,
  StockOperationSchema,
  DaySchema,
  AccountingStateSchema,
  DayVersionSchema,
  DayOperationSchema,
  ShopExpenseSchema,
  HQStockSchema,
  InventoryIdentitySchema,
  InventoryOperationSchema,
  ShipmentSchema,
  DispatchSchema,
  CustomerSchema,
  AuditLogSchema,
  ReportSchema,
  ProductSchema,
  ProductIdentitySchema,
  ProductOperationSchema,
  RecoveryStateSchema,
  RecoveryPlanSchema,
  RecoveryReceiptSchema,
  // Shared (non-tenant) models
  Client,
  Session,
  // Tenant helpers
  getTenantDb,
};
