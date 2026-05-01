'use strict';

const express = require('express');
const router = express.Router();
const { adminOnly } = require('../middleware/auth');
const { buildSalesByShopQuery } = require('../utils/helpers');

// ── Model analytics (top sold, stagnating stock) ───────────────────────────
router.get('/analytics/models', adminOnly, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const since     = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString();
    const staleDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [recentSales, staleStock] = await Promise.all([
      req.models.Sale.find({ soldAt: { $gte: since } }),
      req.models.Phone.find({ status: 'in_stock', addedAt: { $lte: staleDate } }),
    ]);

    // Top sold models
    const modelMap = {};
    recentSales.forEach(s => {
      const key = `${s.brand || ''} ${s.model || ''}`.trim() || 'Unknown';
      if (!modelMap[key]) modelMap[key] = { model: key, count: 0, revenue: 0, profit: 0 };
      modelMap[key].count++;
      modelMap[key].revenue += s.salePrice || 0;
      modelMap[key].profit  += s.profit    || 0;
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
router.get('/ceo/summary', adminOnly, async (req, res) => {
  try {
    const { month } = req.query;
    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Invalid month format (YYYY-MM required)' });
    }
    const currentMonth = month || new Date().toISOString().slice(0, 7);
    const [y, m]       = currentMonth.split('-').map(Number);
    const prevDate     = new Date(y, m - 2, 1);
    const prevMonth    = prevDate.toISOString().slice(0, 7);

    const [currentSales, prevSales, currentExpenses, stock] = await Promise.all([
      req.models.Sale.find({ soldAt: { $regex: `^${currentMonth}` } }).lean(),
      req.models.Sale.find({ soldAt: { $regex: `^${prevMonth}` } }).lean(),
      req.models.ShopExpense.find({ month: currentMonth }).lean(),
      req.models.Phone.find({ status: 'in_stock' }).lean(),
    ]);

    // Per-shop breakdown
    const VALID_SHOPS = req.validShops;
    const shopStats = {};
    VALID_SHOPS.forEach(s => { shopStats[s] = { revenue: 0, cost: 0, profit: 0, units: 0, expenses: 0 }; });

    currentSales.forEach(s => {
      // Revenue and profit attributed to the shop that made the sale (soldByShop), falling back to stock-owning shop
      const sh = s.soldByShop || s.shop;
      if (!sh) return;
      if (!shopStats[sh]) shopStats[sh] = { revenue: 0, cost: 0, profit: 0, units: 0, expenses: 0 };
      shopStats[sh].revenue += s.salePrice || 0;
      shopStats[sh].cost    += s.buyPrice  || 0;
      shopStats[sh].profit  += s.profit    || 0;
      shopStats[sh].units++;
    });

    currentExpenses.forEach(e => {
      const sh = e.shop;
      if (!sh) return;
      if (!shopStats[sh]) shopStats[sh] = { revenue: 0, cost: 0, profit: 0, units: 0, expenses: 0 };
      shopStats[sh].expenses += e.amount || 0;
    });

    // Top models this month
    const modelCounts = {};
    currentSales.forEach(s => {
      const key = `${s.brand || ''} ${s.model || ''}`.trim();
      if (key) modelCounts[key] = (modelCounts[key] || 0) + 1;
    });
    const topModels = Object.entries(modelCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([model, count]) => ({ model, count }));

    const totalRevenue   = currentSales.reduce((s, x) => s + (x.salePrice || 0), 0);
    const totalProfit    = currentSales.reduce((s, x) => s + (x.profit    || 0), 0);
    const totalExpenses  = currentExpenses.reduce((s, e) => s + (e.amount || 0), 0);
    const prevRevenue    = prevSales.reduce((s, x) => s + (x.salePrice || 0), 0);
    const prevProfit     = prevSales.reduce((s, x) => s + (x.profit    || 0), 0);

    res.json({
      month: currentMonth,
      prevMonth,
      current: {
        revenue:   totalRevenue,
        profit:    totalProfit,
        expenses:  totalExpenses,
        units:     currentSales.length,
        netProfit: totalProfit - totalExpenses,
      },
      prev: { revenue: prevRevenue, profit: prevProfit },
      shopStats,
      topModels,
      inventoryCount: stock.length,
      inventoryValue: stock.reduce((s, p) => s + (p.buyPrice || 0), 0),
    });
  } catch (err) {
    console.error('CEO summary error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
