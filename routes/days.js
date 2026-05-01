'use strict';

const express = require('express');
const router = express.Router();
const { adminOnly } = require('../middleware/auth');

// ── List days (with optional shop/month filter) ────────────────────────────
router.get('/days', adminOnly, async (req, res) => {
  try {
    const { shop, month } = req.query;
    const query = {};
    if (shop)  query.shop = shop;
    if (month) query.date = { $regex: `^${month}` };
    const days = await req.models.Day.find(query).sort({ date: -1 }).lean();
    res.json(days);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Get single day ─────────────────────────────────────────────────────────
router.get('/days/:shop/:date', adminOnly, async (req, res) => {
  try {
    const day = await req.models.Day.findOne({ shop: req.params.shop, date: req.params.date });
    res.json(day || {});
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Upsert day ─────────────────────────────────────────────────────────────
router.put('/days/:shop/:date', adminOnly, async (req, res) => {
  try {
    const { shop, date } = req.params;
    const update = { ...req.body, shop, date };
    const day = await req.models.Day.findOneAndUpdate(
      { shop, date },
      update,
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    res.json({ success: true, day });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete day ─────────────────────────────────────────────────────────────
router.delete('/days/:shop/:date', adminOnly, async (req, res) => {
  try {
    const { shop, date } = req.params;
    await req.models.Day.deleteOne({ shop, date });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
