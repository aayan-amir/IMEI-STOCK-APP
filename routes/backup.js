'use strict';

const express = require('express');
const router = express.Router();
const { adminOnly } = require('../middleware/auth');

// ── Full data backup ───────────────────────────────────────────────────────
router.get('/backup', adminOnly, async (req, res) => {
  try {
    const [phones, sales, days, expenses, hqstock, shipments, dispatches] = await Promise.all([
      req.models.Phone.find({}),
      req.models.Sale.find({}),
      req.models.Day.find({}),
      req.models.ShopExpense.find({}),
      req.models.HQStockModel.findOne({ key: 'hq' }),
      req.models.Shipment.find({}),
      req.models.Dispatch.find({}),
    ]);
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
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Restore from backup ────────────────────────────────────────────────────
// Uses a 50 MB body limit to accommodate large backups
router.post('/restore', adminOnly, express.json({ limit: '50mb' }), async (req, res) => {
  try {
    const { phones, sales, days, expenses, hqstock, shipments, dispatches } = req.body;

    const pick = (obj, fields) => {
      const out = {};
      fields.forEach(f => { if (obj[f] !== undefined) out[f] = obj[f]; });
      return out;
    };

    if (phones?.length) {
      const phoneFields = ['imei', 'imei2', 'cat', 'brand', 'model', 'color', 'storage', 'status', 'buyPrice', 'salePrice', 'addedAt', 'soldAt', 'shop'];
      await req.models.Phone.bulkWrite(phones.map(p => ({
        updateOne: { 
          filter: { imei: String(p.imei) }, 
          update: { $set: pick(p, phoneFields) }, 
          upsert: true 
        },
      })));
    }

    if (sales?.length) {
      const saleFields = ['imei', 'imei2', 'brand', 'model', 'cat', 'color', 'storage', 'buyPrice', 'salePrice', 'profit', 'buyerName', 'buyerPhone', 'soldAt', 'shop'];
      await req.models.Sale.bulkWrite(sales.map(s => ({
        updateOne: {
          filter: s._id ? { _id: s._id } : { imei: s.imei, soldAt: s.soldAt },
          update: { $set: pick(s, saleFields) },
          upsert: true,
        },
      })));
    }

    if (days?.length) {
      const dayFields = ['shop', 'date', 'cats', 'expenses', 'purchases', 'transfers', 'tSales', 'tCost', 'tExp', 'netPL', 'lastUpdated'];
      await req.models.Day.bulkWrite(days.map(d => ({
        updateOne: { 
          filter: { shop: d.shop, date: d.date }, 
          update: { $set: pick(d, dayFields) }, 
          upsert: true 
        },
      })));
    }

    if (expenses?.length) {
      const expFields = ['shop', 'date', 'category', 'description', 'amount', 'addedAt'];
      const sanitizedExp = expenses.map(e => pick(e, expFields));
      await req.models.ShopExpense.insertMany(sanitizedExp, { ordered: false })
        .catch(err => console.error('Restore: some expenses skipped:', err.message));
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
        { upsert: true },
      );
    }

    if (shipments?.length) {
      const shipFields = ['source', 'toShop', 'items', 'date', 'supplier', 'ref', 'note'];
      const sanitizedShip = shipments.map(s => pick(s, shipFields));
      await req.models.Shipment.insertMany(sanitizedShip, { ordered: false })
        .catch(err => console.error('Restore: some shipments skipped:', err.message));
    }

    if (dispatches?.length) {
      const dispatchFields = ['source', 'toShop', 'items', 'date', 'note', 'soldPhones'];
      const sanitizedDisp = dispatches.map(d => pick(d, dispatchFields));
      await req.models.Dispatch.insertMany(sanitizedDisp, { ordered: false })
        .catch(err => console.error('Restore: some dispatches skipped:', err.message));
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Restore error:', err);
    res.status(500).json({ error: 'Restore failed: ' + err.message });
  }
});


module.exports = router;
