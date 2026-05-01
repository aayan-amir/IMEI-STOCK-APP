'use strict';

const express = require('express');
const router = express.Router();
const { adminOnly } = require('../middleware/auth');
const { buildSalesByShopQuery } = require('../utils/helpers');

// ── Get sales (admin only) ─────────────────────────────────────────────────
router.get('/sales', adminOnly, async (req, res) => {
  const query = buildSalesByShopQuery(req.query.shop);
  const sales = await req.models.Sale.find(query);
  res.json(sales);
});

// ── Bulk delete sales ──────────────────────────────────────────────────────
// Reverts all affected phones back to in_stock
router.delete('/sales', adminOnly, async (req, res) => {
  try {
    const query = buildSalesByShopQuery(req.query.shop);
    const sales = await req.models.Sale.find(query);
    if (sales.length === 0) return res.json({ success: true, deleted: 0 });

    const imeis = [...new Set(sales.map(s => s.imei).filter(Boolean))];
    if (imeis.length) {
      await req.models.Phone.updateMany(
        { imei: { $in: imeis } },
        { $set: { status: 'in_stock' }, $unset: { salePrice: '', soldAt: '' } },
      );
    }

    const result = await req.models.Sale.deleteMany(query);
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    console.error('Bulk delete sales error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete sale by IMEI ────────────────────────────────────────────────────
router.delete('/sales/by-imei/:imei', adminOnly, async (req, res) => {
  try {
    const sale = await req.models.Sale.findOne({ imei: req.params.imei });
    if (!sale) return res.status(404).json({ error: 'Sale not found' });

    await req.models.Phone.findOneAndUpdate(
      { imei: sale.imei },
      { $set: { status: 'in_stock' }, $unset: { salePrice: '', soldAt: '' } },
    );
    await req.models.Sale.findByIdAndDelete(sale._id);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete sale by IMEI error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete sale by ID ──────────────────────────────────────────────────────
router.delete('/sales/:id', adminOnly, async (req, res) => {
  try {
    const sale = await req.models.Sale.findById(req.params.id);
    if (!sale) return res.status(404).json({ error: 'Sale not found' });

    await req.models.Phone.findOneAndUpdate(
      { imei: sale.imei },
      { $set: { status: 'in_stock' }, $unset: { salePrice: '', soldAt: '' } },
    );
    await req.models.Sale.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete sale error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
