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

    if (phones?.length) {
      await req.models.Phone.bulkWrite(phones.map(p => ({
        updateOne: { filter: { imei: p.imei }, update: { $set: p }, upsert: true },
      })));
    }
    if (sales?.length) {
      await req.models.Sale.bulkWrite(sales.map(s => ({
        updateOne: {
          filter: s._id ? { _id: s._id } : { imei: s.imei, soldAt: s.soldAt },
          update:  { $set: s },
          upsert:  true,
        },
      })));
    }
    if (days?.length) {
      await req.models.Day.bulkWrite(days.map(d => ({
        updateOne: { filter: { shop: d.shop, date: d.date }, update: { $set: d }, upsert: true },
      })));
    }
    if (expenses?.length) {
      await req.models.ShopExpense.insertMany(expenses, { ordered: false })
        .catch(err => console.error('Restore: some expenses skipped:', err.message));
    }
    if (hqstock) {
      const hqUpdate = { key: 'hq', items: Array.isArray(hqstock.items) ? hqstock.items : [] };
      if (hqstock.updatedAt) hqUpdate.updatedAt = hqstock.updatedAt;
      await req.models.HQStockModel.findOneAndUpdate(
        { key: 'hq' },
        { $set: hqUpdate },
        { upsert: true },
      );
    }
    if (shipments?.length) {
      await req.models.Shipment.insertMany(shipments, { ordered: false })
        .catch(err => console.error('Restore: some shipments skipped:', err.message));
    }
    if (dispatches?.length) {
      await req.models.Dispatch.insertMany(dispatches, { ordered: false })
        .catch(err => console.error('Restore: some dispatches skipped:', err.message));
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Restore error:', err);
    res.status(500).json({ error: 'Restore failed: ' + err.message });
  }
});

module.exports = router;
