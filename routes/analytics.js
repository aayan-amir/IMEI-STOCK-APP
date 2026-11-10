'use strict';

const express = require('express');
const router = express.Router();
const { adminOnly } = require('../middleware/auth');
const { readSalesLedger, checkedBounds } = require('../services/sales-ledger');
const { sumMoney, businessDate } = require('../public/js/business-rules');
const { financialSummary } = require('../services/financial-summary');
const { inventoryTransaction } = require('../services/inventory-identity');

// ── Model analytics (top sold, stagnating stock) ───────────────────────────
router.get('/analytics/models', adminOnly, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const since     = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString();
    const staleDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [recentSales, staleStock] = await Promise.all([
      readSalesLedger(req.models, { bounds: { start: since, end: new Date().toISOString() } }),
      req.models.Phone.find({ status: 'in_stock', addedAt: { $lte: staleDate } }),
    ]);

    // Top sold models
    const modelMap = {};
    recentSales.forEach(s => {
      const key = `${s.brand || ''} ${s.model || ''}`.trim() || 'Unknown';
      if (!modelMap[key]) modelMap[key] = { model: key, count: 0, revenue: 0, profit: 0 };
      modelMap[key].count += s.units;
      modelMap[key].revenue = sumMoney([modelMap[key].revenue, s.salePrice]);
      modelMap[key].profit = sumMoney([modelMap[key].profit, s.profit]);
    });
    const topSold = Object.values(modelMap).sort((a, b) => b.count - a.count).slice(0, 15);

    // Stagnating stock
    const staleMap = {};
    staleStock.forEach(p => {
      const key     = `${p.brand || ''} ${p.model || ''}`.trim() || 'Unknown';
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

// ── CEO summary (monthly overview across all shops) ───────────────────────
router.get('/financial-summary', adminOnly, async (req, res) => {
  const result = await inventoryTransaction(req.tenantDb, session => financialSummary(req.models, {
    type: req.query.type, period: req.query.period, shop: req.query.shop || 'ALL', validShops: req.validShops, session,
  }));
  res.json(result);
});

router.get('/ceo/summary', adminOnly, async (req, res) => {
  const month = req.query.month || businessDate().slice(0, 7);
  checkedBounds(month, 'monthly');
  const [year, number] = month.split('-').map(Number);
  const prevMonth = new Date(Date.UTC(year, number - 2, 1)).toISOString().slice(0, 7);
  const result = await inventoryTransaction(req.tenantDb, async session => {
    const current = await financialSummary(req.models, { type: 'monthly', period: month, validShops: req.validShops, session });
    const previous = await financialSummary(req.models, { type: 'monthly', period: prevMonth, validShops: req.validShops, session });
    const stock = await req.models.Phone.find({ status: 'in_stock' }).session(session).lean();
    const counts = new Map();
    for (const event of current.ledger) {
      const model = `${event.brand || ''} ${event.model || ''}`.trim();
      if (model) counts.set(model, (counts.get(model) || 0) + event.units);
    }
    const view = f => ({ ...f, profit: f.grossProfit });
    return { month, prevMonth, ruleVersion: current.ruleVersion, current: view(current.financial), prev: view(previous.financial),
      shopStats: Object.fromEntries(Object.entries(current.shopStats).map(([shop, f]) => [shop, view(f)])),
      topModels: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([model, count]) => ({ model, count })),
      inventoryKind: 'current', inventoryCount: stock.length, inventoryValue: sumMoney(stock.map(phone => phone.buyPrice || 0)) };
  });
  res.json(result);
});

module.exports = router;
