'use strict';

const express = require('express');
const router = express.Router();
const { adminOnly } = require('../middleware/auth');

// ── List / search customers ────────────────────────────────────────────────
router.get('/customers', adminOnly, async (req, res) => {
  try {
    const { q } = req.query;
    // Ensure q is a plain string, then escape regex metacharacters to prevent ReDoS
    const rawQ = typeof q === 'string' ? q.slice(0, 200) : '';
    const safeQ = rawQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const query = safeQ
      ? { $or: [{ name: { $regex: safeQ, $options: 'i' } }, { phone: { $regex: safeQ } }] }
      : {};
    const customers = await req.models.Customer.find(query).sort({ name: 1 });
    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Add customer ───────────────────────────────────────────────────────────
router.post('/customers', adminOnly, async (req, res) => {
  try {
    const { name, phone, email, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const customer = new req.models.Customer({ name, phone, email, notes, addedAt: new Date().toISOString() });
    await customer.save();
    res.json({ success: true, customer });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Update customer ────────────────────────────────────────────────────────
router.put('/customers/:id', adminOnly, async (req, res) => {
  try {
    const { name, phone, email, notes } = req.body;
    const customer = await req.models.Customer.findByIdAndUpdate(
      req.params.id,
      { name, phone, email, notes },
      { returnDocument: 'after' },
    );
    if (!customer) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, customer });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete customer ────────────────────────────────────────────────────────
router.delete('/customers/:id', adminOnly, async (req, res) => {
  try {
    await req.models.Customer.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
