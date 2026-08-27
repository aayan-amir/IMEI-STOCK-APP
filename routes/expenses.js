'use strict';

const express = require('express');
const router = express.Router();
const { adminOnly } = require('../middleware/auth');

// ── List shop expenses ─────────────────────────────────────────────────────
router.get('/shopexpenses', adminOnly, async (req, res) => {
  try {
    const { shop, month } = req.query;
    const query = {};
    if (shop)  query.shop  = String(shop);
    if (month) query.month = String(month);
    const expenses = await req.models.ShopExpense.find(query).sort({ date: -1 }).lean();
    res.json(expenses.map(e => ({ ...e, id: e._id, _key: e._id })));
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Add shop expense ───────────────────────────────────────────────────────
router.post('/shopexpenses', adminOnly, async (req, res) => {
  try {
    const { shop, date, month, category, description, amount } = req.body || {};
    const safeAmount = Number(amount);
    const expense = new req.models.ShopExpense({
      shop: String(shop || '').trim(),
      date: String(date || '').trim(),
      month: String(month || '').trim(),
      category: String(category || '').trim(),
      description: String(description || '').trim(),
      amount: Number.isFinite(safeAmount) ? safeAmount : 0,
      addedAt: new Date().toISOString(),
    });
    await expense.save();
    res.json({ success: true, expense: { ...expense.toObject(), _key: expense.id } });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete shop expense ────────────────────────────────────────────────────
router.delete('/shopexpenses/:id', adminOnly, async (req, res) => {
  try {
    await req.models.ShopExpense.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
