'use strict';

const express = require('express');
const router = express.Router();
const { adminOnly } = require('../middleware/auth');

// ── Get audit logs ─────────────────────────────────────────────────────────
router.get('/logs', adminOnly, async (req, res) => {
  try {
    const { shop, limit = 300 } = req.query;
    const query = shop ? { shop } : {};
    const logs = await req.models.AuditLog.find(query).sort({ ts: -1 }).limit(Number(limit));
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
