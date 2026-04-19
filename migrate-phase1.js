/**
 * migrate-phase1.js
 * ─────────────────
 * Phase 1 Multi-Tenant Migration
 *
 * What this script does:
 *   1. Connects to your existing MongoDB database.
 *   2. Creates a "default" Client record representing your original single-tenant data.
 *   3. Stamps clientId = "default" on EVERY existing document across all collections
 *      that did not previously have a clientId field.
 *   4. Creates an HQStock document scoped to the "default" client if one doesn't exist.
 *   5. Builds the new compound indexes declared in the updated server.js schemas.
 *
 * Safety guarantees:
 *   - Uses $set only — never deletes or overwrites existing fields.
 *   - Filters with { clientId: { $exists: false } } so re-running is safe (idempotent).
 *   - Prints a dry-run summary if you pass --dry-run.
 *   - Exits non-zero on any error so CI/CD pipelines catch failures.
 *
 * Usage:
 *   MONGO_URI=mongodb+srv://... node migrate-phase1.js
 *   MONGO_URI=mongodb+srv://... node migrate-phase1.js --dry-run
 */

'use strict';

const mongoose = require('mongoose');

const DEFAULT_CLIENT_ID  = process.env.DEFAULT_CLIENT_ID  || 'default';
const DEFAULT_CLIENT_NAME = process.env.DEFAULT_CLIENT_NAME || 'Default Client';
const DEFAULT_CLIENT_SLUG = process.env.DEFAULT_CLIENT_SLUG || 'default';
const VALID_SHOPS = (process.env.VALID_SHOPS || '456,192,G15').split(',').map(s => s.trim()).filter(Boolean);
const DRY_RUN = process.argv.includes('--dry-run');

if (!process.env.MONGO_URI) {
  console.error('❌  MONGO_URI environment variable is required.');
  process.exit(1);
}

// ── Minimal schemas (just enough for the migration) ───────────────
const ClientSchema = new mongoose.Schema({
  clientId:     { type: String, required: true, unique: true },
  name:         String,
  slug:         String,
  status:       { type: String, default: 'active' },
  shops:        { type: [String], default: [] },
  contactEmail: String,
  notes:        String,
  createdAt:    { type: String, default: () => new Date().toISOString() },
  updatedAt:    { type: String, default: () => new Date().toISOString() },
});
const Client = mongoose.model('Client', ClientSchema);

const HQStockSchema = new mongoose.Schema({
  clientId:  { type: String, unique: true },
  key:       { type: String, default: 'hq' },
  items:     { type: Array, default: [] },
  updatedAt: String,
});
const HQStockModel = mongoose.model('HQStock', HQStockSchema);

// Collections to stamp — maps collection name → model (minimal schema)
const stampTargets = [
  ['phones',       'Phone'],
  ['sales',        'Sale'],
  ['days',         'Day'],
  ['shopexpenses', 'ShopExpense'],
  ['shipments',    'Shipment'],
  ['dispatches',   'Dispatch'],
  ['customers',    'Customer'],
  ['auditlogs',    'AuditLog'],
  ['reports',      'Report'],
];

// Build a model for each collection using a bare schema
function makeModel(name, collection) {
  if (mongoose.models[name]) return mongoose.models[name];
  return mongoose.model(name, new mongoose.Schema({}, { strict: false }), collection);
}

// ── Main ──────────────────────────────────────────────────────────
async function run() {
  console.log('\n🔗  Connecting to MongoDB…');
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 45000,
  });
  console.log('✅  Connected.\n');

  if (DRY_RUN) {
    console.log('⚠️   DRY-RUN mode — no writes will be made.\n');
  }

  const results = {};

  // ── Step 1: Ensure the default Client record exists ──────────────
  console.log('── Step 1: Ensure default Client record ─────────────────────');
  const existingClient = await Client.findOne({ clientId: DEFAULT_CLIENT_ID });
  if (existingClient) {
    console.log(`   ✔  Client "${DEFAULT_CLIENT_ID}" already exists — skipping create.`);
  } else if (!DRY_RUN) {
    await Client.create({
      clientId:    DEFAULT_CLIENT_ID,
      name:        DEFAULT_CLIENT_NAME,
      slug:        DEFAULT_CLIENT_SLUG,
      status:      'active',
      shops:       VALID_SHOPS,
      notes:       'Auto-created by Phase 1 migration. Represents all pre-multi-tenant data.',
      createdAt:   new Date().toISOString(),
      updatedAt:   new Date().toISOString(),
    });
    console.log(`   ✔  Created Client "${DEFAULT_CLIENT_ID}" (${DEFAULT_CLIENT_NAME}).`);
  } else {
    console.log(`   [dry-run] Would create Client "${DEFAULT_CLIENT_ID}" with shops: ${VALID_SHOPS.join(', ')}`);
  }

  // ── Step 2: Stamp clientId on all existing collections ───────────
  console.log('\n── Step 2: Stamp clientId on legacy documents ───────────────');
  for (const [collection, modelName] of stampTargets) {
    const Model = makeModel(modelName, collection);
    const filter = { clientId: { $exists: false } };
    const count = await Model.countDocuments(filter);

    if (count === 0) {
      console.log(`   ✔  ${collection.padEnd(16)} — already stamped (0 documents need updating).`);
      results[collection] = 0;
      continue;
    }

    if (DRY_RUN) {
      console.log(`   [dry-run] ${collection.padEnd(16)} — would stamp ${count} document(s).`);
      results[collection] = count;
      continue;
    }

    const res = await Model.updateMany(filter, { $set: { clientId: DEFAULT_CLIENT_ID } });
    const modified = res.modifiedCount ?? res.nModified ?? 0;
    console.log(`   ✔  ${collection.padEnd(16)} — stamped ${modified}/${count} document(s).`);
    results[collection] = modified;
  }

  // ── Step 3: Ensure HQStock for default client ────────────────────
  console.log('\n── Step 3: Ensure HQStock record for default client ─────────');

  // The original code used key='hq'; migrate that document to also have clientId stamped.
  // Step 2 above already stamps it via the generic loop, but we also want to make sure
  // the clientId unique field is properly set to DEFAULT_CLIENT_ID.
  const legacyHQ = await HQStockModel.findOne({ key: 'hq', clientId: { $exists: false } });
  if (legacyHQ && !DRY_RUN) {
    legacyHQ.clientId = DEFAULT_CLIENT_ID;
    await legacyHQ.save();
    console.log('   ✔  Migrated legacy HQStock document → clientId = "default".');
  }

  const existingHQ = await HQStockModel.findOne({ clientId: DEFAULT_CLIENT_ID });
  if (!existingHQ) {
    if (!DRY_RUN) {
      await HQStockModel.create({ clientId: DEFAULT_CLIENT_ID, key: 'hq', items: [], updatedAt: new Date().toISOString() });
      console.log('   ✔  Created HQStock record for default client.');
    } else {
      console.log('   [dry-run] Would create HQStock record for default client.');
    }
  } else {
    console.log('   ✔  HQStock record for default client already exists.');
  }

  // ── Step 4: Build indexes ─────────────────────────────────────────
  // Mongoose will auto-create indexes on server start, but we trigger them
  // explicitly here so the migration confirms they exist before going live.
  console.log('\n── Step 4: Ensure indexes ───────────────────────────────────');
  if (!DRY_RUN) {
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    const colNames = new Set(collections.map(c => c.name));

    // clientId single-field indexes
    const singleIndexCols = ['phones', 'sales', 'days', 'shipments', 'dispatches', 'customers', 'auditlogs', 'reports', 'shopexpenses'];
    for (const col of singleIndexCols) {
      if (!colNames.has(col)) continue;
      await db.collection(col).createIndex({ clientId: 1 }, { background: true });
    }

    // Compound indexes for hot query paths
    const compoundIndexes = [
      ['phones',       { clientId: 1, shop: 1 }],
      ['phones',       { clientId: 1, status: 1 }],
      ['phones',       { clientId: 1, soldByShop: 1 }],
      ['sales',        { clientId: 1, soldByShop: 1 }],
      ['sales',        { clientId: 1, soldAt: 1 }],
      ['shopexpenses', { clientId: 1, shop: 1, month: 1 }],
      ['shipments',    { clientId: 1, date: -1 }],
      ['dispatches',   { clientId: 1, date: -1 }],
      ['customers',    { clientId: 1, name: 1 }],
      ['auditlogs',    { clientId: 1, ts: -1 }],
      ['reports',      { clientId: 1, type: 1, period: -1 }],
    ];

    for (const [col, spec] of compoundIndexes) {
      if (!colNames.has(col)) continue;
      await db.collection(col).createIndex(spec, { background: true });
    }

    // Unique compound index for phones (clientId + imei)
    if (colNames.has('phones')) {
      await db.collection('phones').createIndex({ clientId: 1, imei: 1 }, { unique: true, sparse: true, background: true });
    }

    // Unique compound for days (clientId + shop + date)
    if (colNames.has('days')) {
      await db.collection('days').createIndex({ clientId: 1, shop: 1, date: 1 }, { unique: true, sparse: true, background: true });
    }

    // ClientUser compound unique index
    if (colNames.has('clientusers')) {
      await db.collection('clientusers').createIndex({ clientId: 1, username: 1 }, { unique: true, background: true });
    }

    console.log('   ✔  All indexes created / verified.');
  } else {
    console.log('   [dry-run] Would create compound indexes on all collections.');
  }

  // ── Summary ───────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(DRY_RUN ? '  DRY-RUN SUMMARY (no changes made)' : '  MIGRATION COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  const total = Object.values(results).reduce((a, b) => a + b, 0);
  console.log(`  Default clientId : "${DEFAULT_CLIENT_ID}"`);
  console.log(`  Documents updated: ${total}`);
  for (const [col, n] of Object.entries(results)) {
    if (n > 0) console.log(`    ${col.padEnd(18)}: ${n}`);
  }
  console.log('');
  console.log('  Next steps:');
  console.log('  1. Deploy the updated server.js.');
  console.log('  2. Verify the app works normally — all data should appear unchanged.');
  console.log('  3. Proceed to Phase 2 (Auth overhaul).');
  console.log('═══════════════════════════════════════════════════════════════\n');

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('\n❌  Migration failed:', err);
  mongoose.disconnect().finally(() => process.exit(1));
});
