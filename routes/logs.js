'use strict';

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { adminOnly } = require('../middleware/auth');

// ── Get audit logs ─────────────────────────────────────────────────────────
router.get('/logs', adminOnly, async (req, res) => {
  try {
    const rawShop = req.query.shop;
    const rawLimit = req.query.limit;
    const rawBefore = req.query.before;
    const shopVal = rawShop ? String(rawShop).trim() : '';
    const limitVal = Math.min(Math.max(parseInt(rawLimit, 10) || 200, 1), 500);
    let query = shopVal ? { shop: shopVal } : {};

    if (rawBefore) {
      const beforeRaw = String(rawBefore).trim();
      if (mongoose.Types.ObjectId.isValid(beforeRaw)) {
        const beforeLog = await req.models.AuditLog.findById(beforeRaw, { ts: 1 });
        if (beforeLog?.ts) {
          const olderByTs = { ts: { $lt: beforeLog.ts } };
          const olderById = { ts: beforeLog.ts, _id: { $lt: beforeLog._id } };
          query = shopVal ? { shop: shopVal, $or: [olderByTs, olderById] } : { $or: [olderByTs, olderById] };
        }
      } else {
        const parsedBefore = Date.parse(beforeRaw);
        if (!Number.isFinite(parsedBefore)) {
          return res.status(400).json({ error: 'Invalid before cursor' });
        }
        query.ts = { $lt: new Date(parsedBefore).toISOString() };
      }
    }

    const logs = await req.models.AuditLog.find(query)
      .sort({ ts: -1, _id: -1 })
      .limit(limitVal);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
