'use strict';

const express = require('express');
const router = express.Router();
const { adminOnly } = require('../middleware/auth');
const { buildSalesByShopQuery } = require('../utils/helpers');

// ── List reports ───────────────────────────────────────────────────────────
router.get('/reports', adminOnly, async (req, res) => {
  try {
    const { shop, type } = req.query;
    const query = {};
    if (shop) query.shop = shop;
    if (type) query.type = type;
    const reports = await req.models.Report.find(query).sort({ period: -1 }).limit(100);
    res.json(reports);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Generate and persist a report ─────────────────────────────────────────
router.post('/reports/generate', adminOnly, async (req, res) => {
  try {
    const { type, shop, period } = req.body;
    if (!type || !shop || !period) return res.status(400).json({ error: 'type, shop, period required' });

    let data = {};

    if (type === 'daily') {
      const shopQ = shop === 'ALL' ? {} : buildSalesByShopQuery(shop);
      const [sales, day] = await Promise.all([
        req.models.Sale.find({ ...shopQ, soldAt: { $regex: `^${period}` } }),
        shop === 'ALL' ? Promise.resolve(null) : req.models.Day.findOne({ shop, date: period }),
      ]);
      const expenses = (day?.expenses || []).reduce((s, e) => s + (e.amt || 0), 0);
      data = {
        totalSales:  sales.reduce((s, x) => s + (x.salePrice || 0), 0),
        totalCost:   sales.reduce((s, x) => s + (x.buyPrice  || 0), 0),
        grossProfit: sales.reduce((s, x) => s + (x.profit    || 0), 0),
        unitsSold:   sales.length,
        expenses,
        netProfit:   sales.reduce((s, x) => s + (x.profit || 0), 0) - expenses,
        salesList:   sales.map(s => ({
          model:     `${s.brand || ''} ${s.model || ''}`.trim(),
          imei:      s.imei,
          salePrice: s.salePrice,
          buyPrice:  s.buyPrice,
          profit:    s.profit,
          buyerName: s.buyerName || null,
          shop:      s.shop,
        })),
      };
    } else if (type === 'monthly') {
      const shopQ = shop === 'ALL' ? {} : buildSalesByShopQuery(shop);
      const [sales, expenses] = await Promise.all([
        req.models.Sale.find({ ...shopQ, soldAt: { $regex: `^${period}` } }),
        req.models.ShopExpense.find(shop === 'ALL' ? { month: period } : { shop, month: period }),
      ]);
      const grossProfit   = sales.reduce((s, x) => s + (x.profit || 0), 0);
      const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
      data = {
        totalSales:       sales.reduce((s, x) => s + (x.salePrice || 0), 0),
        totalCost:        sales.reduce((s, x) => s + (x.buyPrice  || 0), 0),
        grossProfit,
        unitsSold:        sales.length,
        totalExpenses,
        netProfit:        grossProfit - totalExpenses,
        expenseBreakdown: expenses.map(e => ({
          category:    e.category,
          description: e.description,
          amount:      e.amount,
          date:        e.date,
        })),
      };
    } else {
      return res.status(400).json({ error: 'Invalid type' });
    }

    const report = await req.models.Report.findOneAndUpdate(
      { type, shop, period },
      { type, shop, period, data, generatedAt: new Date().toISOString() },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    res.json({ success: true, report });
  } catch (err) {
    console.error('Report generate error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete report ──────────────────────────────────────────────────────────
router.delete('/reports/:id', adminOnly, async (req, res) => {
  try {
    await req.models.Report.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
