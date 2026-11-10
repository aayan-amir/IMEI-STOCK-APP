'use strict';

const express = require('express');
const router = express.Router();
const { adminOnly } = require('../middleware/auth');
const { HttpError } = require('../utils/http-error');
const { inventoryTransaction, lockInventory } = require('../services/inventory-identity');
const { isSaleSnapshot, sameSaleSnapshot } = require('../services/stock-sales');

const paymentFields = ['paymentVersion', 'paymentMethod', 'paidAmountMinor'];
const hasPaymentEvidence = row => row && paymentFields.some(field => row[field] !== undefined);
const reviewedRecoveryRequired = () => new HttpError(409, 'New business evidence requires the current backup format and reviewed recovery into an empty account.', 'REVIEWED_RESTORE_REQUIRED');
async function requireLegacyCoverage(req, session) {
  if (req.app.locals.fullyPaidSalesEnabled || req.app.locals.stocktakesEnabled || req.app.locals.customerReturnsEnabled) throw reviewedRecoveryRequired();
  const models = require('../services/backup-validation').getModels(req.tenantDb);
  const catalogue = require('../services/backup-validation');
  if (await models.InventoryOperation.exists({ 'result.kind': 'stock_intake' }).session(session).maxTimeMS(10000) ||
      await models.AuditLog.exists({ 'details.intakeVersion': { $exists: true } }).session(session).maxTimeMS(10000)) throw reviewedRecoveryRequired();
  for (const name of catalogue.allCollectionNames.filter(name => !catalogue.collectionNames.includes(name))) if (await models[name].exists({}).session(session).maxTimeMS(10000)) throw reviewedRecoveryRequired();
  for (const [name, prefix] of [['Sale', ''], ['StockOperation', 'sale.']]) {
    if (await models[name].exists({ $or: paymentFields.map(field => ({ [prefix + field]: { $exists: true } })) }).session(session).maxTimeMS(10000)) throw reviewedRecoveryRequired();
  }
}

// ── Full data backup ───────────────────────────────────────────────────────
router.get('/backup', adminOnly, async (req, res) => {
  if (req.query.version !== undefined) {
    if (!['2', '3'].includes(req.query.version)) throw new HttpError(400, 'Unsupported backup version', 'INVALID_INPUT');
    return res.json(await require('../services/backup-service').createBackup({ connection: req.tenantDb,
      clientId: req.session.clientId, shops: req.validShops, version: Number(req.query.version) }));
  }
  await requireLegacyCoverage(req);
  try {
    const [phones, sales, days, expenses, hqstock, shipments, dispatches, stockOperations] = await Promise.all([
      req.models.Phone.find({}),
      req.models.Sale.find({}),
      req.models.Day.find({}),
      req.models.ShopExpense.find({}),
      req.models.HQStockModel.findOne({ key: 'hq' }),
      req.models.Shipment.find({}),
      req.models.Dispatch.find({}),
      req.models.StockOperation.find({}),
    ]);
    if (sales.some(hasPaymentEvidence) || stockOperations.some(row => hasPaymentEvidence(row.sale))) throw reviewedRecoveryRequired();
    await requireLegacyCoverage(req);
    res.json({
      version:    1,
      exportedAt: new Date().toISOString(),
      phones,
      sales,
      days,
      expenses,
      hqstock:    hqstock || { items: [] },
      shipments,
      dispatches,
      stockOperations,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Restore from backup ────────────────────────────────────────────────────
// Bounded recovery bodies are parsed before the default JSON parser in app.js.
router.post('/restore', adminOnly, async (req, res) => {
  if (req.body?.format === 'stockly-tenant' || req.body?.collections !== undefined || [2, 3].includes(req.body?.version)) {
    throw new HttpError(409, 'Complete backups require review and restore into an empty account.', 'REVIEWED_RESTORE_REQUIRED');
  }
  if (['inventoryOperations', 'intakeOperations', 'auditLogs', 'auditLog', 'audits', 'InventoryOperation', 'AuditLog'].some(field => req.body?.[field] !== undefined)) throw reviewedRecoveryRequired();
  if ((Array.isArray(req.body?.sales) && req.body.sales.some(hasPaymentEvidence)) ||
      (Array.isArray(req.body?.stockOperations) && req.body.stockOperations.some(row => hasPaymentEvidence(row?.sale))) ||
      ['stocktakes', 'customerReturns', 'cashEntries', 'cashCheckpoints'].some(field => req.body?.[field] !== undefined)) throw reviewedRecoveryRequired();
  try {
    await inventoryTransaction(req.tenantDb, async session => {
      await requireLegacyCoverage(req, session);
      const { phones, sales, days, expenses, hqstock, shipments, dispatches, stockOperations } = req.body;
      // The legacy merge format cannot safely import or rewind retained corrections.
      if ((Array.isArray(sales) && sales.some(sale => sale?.reversedAt)) ||
          await req.models.Sale.exists({ reversedAt: { $ne: null } }).session(session)) {
        throw new HttpError(409, 'Retained sale corrections require the accounting recovery workflow. Merge restore was not applied.', 'RESTORE_CONFLICT');
      }

      if (stockOperations !== undefined && (!Array.isArray(stockOperations) || stockOperations.some(operation =>
        !operation || typeof operation._id !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(operation._id) ||
        typeof operation.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(operation.fingerprint) ||
        (operation.createdAt !== undefined && (typeof operation.createdAt !== 'string' || !Number.isFinite(Date.parse(operation.createdAt)))) ||
        !isSaleSnapshot(operation.sale)))) {
        throw new HttpError(400, 'Invalid sale request history', 'RESTORE_CONFLICT');
      }
      const validatedOperations = new Map();
      for (const operation of stockOperations || []) {
        const repeated = validatedOperations.get(operation._id);
        if (repeated && (repeated.fingerprint !== operation.fingerprint || !sameSaleSnapshot(repeated.sale, operation.sale))) {
          throw new HttpError(409, 'Backup contains conflicting sale request IDs', 'RESTORE_CONFLICT');
        }
        validatedOperations.set(operation._id, operation);
        const incomingMatches = Array.isArray(sales) ? sales.filter(sale => sale?._id && String(sale._id) === String(operation.sale._id)) : [];
        if (incomingMatches.some(sale => !sameSaleSnapshot(sale, operation.sale))) {
          throw new HttpError(409, 'Backup contains conflicting sale records for a request', 'RESTORE_CONFLICT');
        }
        const incomingSale = incomingMatches[0];
        const referencedSale = incomingSale || await req.models.Sale.findById(operation.sale._id).session(session).lean();
        if (!sameSaleSnapshot(operation.sale, referencedSale)) {
          throw new HttpError(409, 'Sale request history does not match its sale record', 'RESTORE_CONFLICT');
        }
        const existing = await req.models.StockOperation.findById(operation._id).session(session);
        if (existing && (existing.fingerprint !== operation.fingerprint || !sameSaleSnapshot(existing.sale, operation.sale))) {
          throw new HttpError(409, 'Sale request history conflicts with an existing request', 'RESTORE_CONFLICT');
        }
      }

      const businessModels = require('../services/backup-validation').getModels(req.tenantDb);
      for (const Model of Object.values(businessModels)) if (await Model.exists({}).session(session)) {
        throw new HttpError(409, 'Restore requires an empty account. Existing business data was not changed.', 'RESTORE_CONFLICT');
      }

      if (phones !== undefined || hqstock !== undefined || sales !== undefined || shipments !== undefined || dispatches !== undefined) {
        if ((phones !== undefined && !Array.isArray(phones)) || (sales !== undefined && !Array.isArray(sales)) ||
            (shipments !== undefined && !Array.isArray(shipments)) || (dispatches !== undefined && !Array.isArray(dispatches)) ||
            (hqstock !== undefined && (!hqstock || !Array.isArray(hqstock.items)))) {
          throw new HttpError(400, 'Invalid legacy inventory backup', 'INVALID_BACKUP');
        }
        if (await req.models.InventoryIdentity.exists({}).session(session) ||
            await req.models.Phone.exists({}).session(session) || await req.models.Sale.exists({}).session(session) ||
            await req.models.HQStockModel.exists({ 'items.0': { $exists: true } }).session(session)) {
          throw new HttpError(409, 'Inventory has active identities or existing records. Use versioned recovery; legacy merge was not applied.', 'RESTORE_CONFLICT');
        }
        const records = [...(phones || []), ...(hqstock?.items || [])];
        const identities = records.map(record => record?.imei);
        if (identities.some(value => typeof value !== 'string' || !/^\d{15}$/.test(value)) || new Set(identities).size !== identities.length) {
          throw new HttpError(409, 'Backup contains invalid or duplicate inventory locations.', 'RESTORE_CONFLICT');
        }
        if (records.some(record => record.entryId) || [...(shipments || []), ...(dispatches || [])].some(record => record.items?.some(item => item.entryId))) {
          throw new HttpError(409, 'Warehouse entry metadata requires complete versioned inventory recovery.', 'RESTORE_CONFLICT');
        }
        await lockInventory(req.models, session, ['@hq', ...identities]);
      }

      const pick = (obj, fields) => {
        const out = {};
        fields.forEach(f => { if (obj[f] !== undefined) out[f] = obj[f]; });
        return out;
      };

      if (phones?.length) {
        const phoneFields = ['imei', 'imei2', 'cat', 'brand', 'model', 'color', 'storage', 'status', 'buyPrice', 'salePrice', 'addedAt', 'soldAt', 'shop', 'soldByShop', 'notes', 'currentSaleId'];
        await req.models.Phone.bulkWrite(phones.map(p => ({
          updateOne: {
            filter: { imei: String(p.imei) },
            update: { $set: pick(p, phoneFields), ...(p._id ? { $setOnInsert: { _id: p._id } } : {}) },
            upsert: true
          },
        })), { session });
      }

      if (sales?.length) {
        const saleFields = ['imei', 'imei2', 'brand', 'model', 'cat', 'color', 'storage', 'buyPrice', 'salePrice', 'profit', 'buyerName', 'buyerPhone', 'soldAt', 'shop', 'soldByShop', 'notes', 'buyPriceMinor', 'salePriceMinor', 'profitMinor', 'phoneId'];
        await req.models.Sale.bulkWrite(sales.map(s => ({
          updateOne: {
            filter: s._id ? { _id: s._id } : { imei: s.imei, soldAt: s.soldAt },
            update: { $set: pick(s, saleFields) },
            upsert: true,
          },
        })), { session });
      }

      if (days?.length) {
        const dayFields = ['shop', 'date', 'cats', 'expenses', 'purchases', 'transfers', 'tSales', 'tCost', 'tExp', 'netPL', 'lastUpdated'];
        await req.models.Day.bulkWrite(days.map(d => ({
          updateOne: {
            filter: { shop: d.shop, date: d.date },
            update: { $set: pick(d, dayFields) },
            upsert: true
          },
        })), { session });
      }

      if (expenses?.length) {
        const expFields = ['shop', 'date', 'category', 'description', 'amount', 'addedAt'];
        const sanitizedExp = expenses.map(e => pick(e, expFields));
        await req.models.ShopExpense.insertMany(sanitizedExp, { session });
      }

      if (hqstock) {
        const hqItemsFields = ['imei', 'imei2', 'cat', 'brand', 'model', 'color', 'storage', 'buyPrice', 'costPerUnit', 'notes', 'addedAt'];
        const hqUpdate = {
          key: 'hq',
          items: Array.isArray(hqstock.items) ? hqstock.items.map(i => pick(i, hqItemsFields)) : []
        };
        if (hqstock.updatedAt) hqUpdate.updatedAt = hqstock.updatedAt;
        await req.models.HQStockModel.findOneAndUpdate(
          { key: 'hq' },
          { $set: hqUpdate },
          { upsert: true, session },
        );
      }

      if (shipments?.length) {
        const shipFields = ['source', 'toShop', 'items', 'date', 'supplier', 'ref', 'note'];
        const sanitizedShip = shipments.map(s => pick(s, shipFields));
        await req.models.Shipment.insertMany(sanitizedShip, { session });
      }

      if (dispatches?.length) {
        const dispatchFields = ['source', 'toShop', 'items', 'date', 'note', 'soldPhones'];
        const sanitizedDisp = dispatches.map(d => pick(d, dispatchFields));
        await req.models.Dispatch.insertMany(sanitizedDisp, { session });
      }

      if (validatedOperations.size) {
        await req.models.StockOperation.bulkWrite([...validatedOperations.values()].map(operation => ({
          updateOne: {
            filter: { _id: operation._id },
            update: { $setOnInsert: pick(operation, ['fingerprint', 'sale', 'createdAt']) },
            upsert: true,
          },
        })), { session });
      }
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    res.json({ success: true });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error('Restore error:', err);
    res.status(500).json({ error: 'Restore failed: ' + err.message });
  }
});


function recoveryIdentity(req) {
  return { clientId: req.session.clientId, authVersion: req.session.authVersion, shops: req.validShops };
}
router.post('/restore/validate', adminOnly, async (req, res) => {
  const report = await require('../services/restore-service').reviewRestore({ connection: req.tenantDb, identity: recoveryIdentity(req),
    backup: req.body?.backup, mode: req.body?.mode });
  res.json({ success: true, ...report });
});
router.post('/restore/apply', adminOnly, async (req, res) => {
  res.json(await require('../services/restore-service').applyRestore({ connection: req.tenantDb, identity: recoveryIdentity(req),
    planId: req.body?.planId, operationId: req.body?.operationId }));
});
router.get('/restore/status', adminOnly, async (req, res) => {
  const { RecoveryState } = require('../services/recovery-control').controls(req.tenantDb);
  const state = await RecoveryState.findById('tenant').lean();
  res.json({ maintenance: state?.maintenance || false, phase: state?.phase || 'idle', activeWrites: state?.leases?.length || 0 });
});

module.exports = router;
