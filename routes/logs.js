'use strict';

const express = require('express');
const router = express.Router();
const { adminOnly } = require('../middleware/auth');

// ── Get audit logs ─────────────────────────────────────────────────────────
router.get('/logs', adminOnly, async (req, res) => {
  try {
    const rawShop = req.query.shop;
    const rawLimit = req.query.limit;
    const shopVal = rawShop ? String(rawShop) : null;
    const limitVal = Math.min(Math.max(parseInt(rawLimit, 10) || 300, 1), 1000);
    const query = shopVal ? { shop: shopVal } : {};
    const logs = await req.models.AuditLog.find(query).sort({ ts: -1 }).limit(limitVal);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
