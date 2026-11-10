'use strict';

const express = require('express');
const router = express.Router();
const { mongoose } = require('../db');
const { adminOnly, anyAuth } = require('../middleware/auth');
const { readSalesLedger } = require('../services/sales-ledger');
const { sumSaleEvents } = require('../public/js/business-rules');
const { sellPhone } = require('../services/stock-sales');
const { HttpError } = require('../utils/http-error');
const { inventoryTransaction, lockInventory, assertNotInHQ } = require('../services/inventory-identity');
const { stockPage } = require('../services/stock-list');
const { imeiHistory } = require('../services/imei-history');
router.get('/stock/:imei/history/:source', adminOnly, async (req, res) => { res.json(await imeiHistory(req)); });

router.get('/v2/stock/export', anyAuth, async (req, res) => { res.json(await stockPage(req, true)); });
router.get('/v2/stock', anyAuth, async (req, res) => { res.json(await stockPage(req)); });

// ── Lookup phone by IMEI (used by scan/sell flow) ─────────────────────────
router.get('/lookup/:imei', anyAuth, async (req, res) => {
  try {
    const phone = await req.models.Phone.findOne({ imei: req.params.imei });
    if (!phone) return res.json({});
    res.json(phone);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Get stock ─────────────────────────────────────────────────────────────
// Shop users are scoped to their own shop
router.get('/stock', anyAuth, async (req, res) => {
  const shop = req.authShop || (
    typeof req.query.shop === 'string' && req.validShops.includes(req.query.shop)
      ? req.query.shop
      : undefined
  );
  const query = shop ? { shop } : {};
  if (req.query.all !== 'true') query.status = 'in_stock';

  // Support querying phones by the shop that sold them (cross-shop sale tracking)
  if (req.query.soldByShop && typeof req.query.soldByShop === 'string' && req.validShops.includes(req.query.soldByShop)) {
    if (req.authRole !== 'admin' && req.query.soldByShop !== req.authShop) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    delete query.shop; // query across all shops' stock, not just the requesting shop's
    query.soldByShop = req.query.soldByShop;
  }

  const items = await req.models.Phone.find(query).lean();
  res.json(items.map(p => ({ ...p, id: p._id })));
});

router.post('/v2/stock/intake', anyAuth, async (req, res) => {
  res.json(await require('../services/stock-intake').intakeBatch({ connection: req.tenantDb, models: req.models,
    actor: { role: req.authRole, shop: req.authShop }, validShops: req.validShops, payload: req.body }));
});

// ── Add stock ─────────────────────────────────────────────────────────────
router.post('/stock/add', anyAuth, async (req, res) => {
  const { stockItem } = require('../services/inventory-input');
  const item = stockItem(req.body);
  const shop = req.authRole === 'shop' ? req.authShop : req.body?.shop;
  if (!req.validShops.includes(shop)) throw new HttpError(400, 'Choose a configured shop. Use warehouse receiving for HQ stock.', 'INVALID_SHOP');
  const result = await inventoryTransaction(req.tenantDb, async session => {
    await lockInventory(req.models, session, [item.imei]);
    await assertNotInHQ(req.models, session, item.imei);
    if (await req.models.Phone.exists({ imei: item.imei }).session(session)) throw new HttpError(409, 'IMEI already exists in stock', 'INVENTORY_CONFLICT');
    const [phone] = await req.models.Phone.create([{ ...item, shop, status: 'in_stock', addedAt: new Date().toISOString() }], { session });
    await req.models.AuditLog.create([{ action: 'stock_add', shop, role: req.authRole,
      details: { imei: item.imei, phoneId: phone.id, buyPrice: item.buyPrice } }], { session });
    return { success: true, phone };
  });
  res.json(result);
});

// ── Sell phone ────────────────────────────────────────────────────────────
router.post('/stock/sell', anyAuth, async (req, res) => {
  const result = await sellPhone({
    connection: req.tenantDb, models: req.models,
    actor: { role: req.authRole, shop: req.authShop },
    validShops: req.validShops, payload: req.body,
    operationId: req.get('Idempotency-Key'),
    tenderRequired: req.app.locals.fullyPaidSalesEnabled === true,
    clientSaleVersion: req.get('X-Stockly-Sale-Version'),
  });
  res.json({ success: true, sale: result.sale });
});

// ── Stats ─────────────────────────────────────────────────────────────────
// Shop users are scoped to their own shop
router.get('/stats', anyAuth, async (req, res) => {
  const rawShop = req.query.shop;
  const shop = req.authShop || (
    typeof rawShop === 'string' && req.validShops.includes(rawShop) ? rawShop : undefined
  );
  const stockQuery = shop ? { shop } : {};
  const stock = await req.models.Phone.aggregate([{ $match: stockQuery }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
  const counts = new Map(stock.map(row => [row._id, row.count]));
  const totals = sumSaleEvents(await readSalesLedger(req.models, { shop, summaryOnly: true }));

  res.json({
    inStock:      counts.get('in_stock') || 0,
    sold:         counts.get('sold') || 0,
    total:        stock.reduce((sum, row) => sum + row.count, 0),
    totalRevenue: totals.revenue,
    salesCount:   totals.units,
  });
});

// ── Edit stock ─────────────────────────────────────────────────────────────
function edit(req, ids) {
  return require('../services/stock-edits').editStock({ connection: req.tenantDb, models: req.models,
    actor: { role: req.authRole }, ids, payload: req.body || {}, validShops: req.validShops });
}
router.put('/stock/batch', adminOnly, async (req, res) => {
  res.json(await edit(req, req.body?.ids));
});
router.put('/stock/:id', adminOnly, async (req, res) => {
  const result = await edit(req, [req.params.id]);
  res.json({ success: true, phone: result.phones[0] });
});

// ── Delete phone ──────────────────────────────────────────────────────────
router.delete('/stock/:id', adminOnly, async (req, res) => {
  const { id } = req.params;
  if (!id || id === 'undefined' || !mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid phone id' });
  }
  await inventoryTransaction(req.tenantDb, async session => {
    const phone = await req.models.Phone.findById(id).session(session);
    if (phone) {
      await lockInventory(req.models, session, [phone.imei]);
      await assertNotInHQ(req.models, session, phone.imei);
      if (phone.status !== 'in_stock' || phone.currentSaleId || await req.models.Sale.exists({ imei: phone.imei, reversedAt: null }).session(session)) {
        throw new HttpError(409, 'Reverse the current sale before deleting this phone.', 'ACTIVE_SALE');
      }
      await req.models.Phone.deleteOne({ _id: id, status: 'in_stock' }, { session });
      await req.models.AuditLog.create([{ action: 'stock_delete', shop: phone.shop || null, role: req.authRole,
        details: { id, imei: phone.imei, brand: phone.brand, model: phone.model } }], { session });
    }
  }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
  res.json({ success: true });
});

module.exports = router;
