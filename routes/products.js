'use strict';

const express = require('express');
const router = express.Router();
const { anyAuth, adminOnly } = require('../middleware/auth');

// ── List all products ─────────────────────────────────────────────────────
router.get('/products', anyAuth, async (req, res) => {
  try {
    const shop = req.authShop || req.query.shop || undefined;
    const query = shop ? { shop } : {};
    const items = await req.models.Product.find(query).sort({ name: 1 }).lean();
    res.json(items.map(p => ({ ...p, id: p._id })));
  } catch (err) {
    console.error('GET /products error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Add a product ─────────────────────────────────────────────────────────
router.post('/products', anyAuth, async (req, res) => {
  try {
    const { name, quantity, buyPrice, notes } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Product name is required' });
    const qty = Math.max(0, parseInt(quantity) || 0);

    const shop = req.authRole === 'shop' ? req.authShop : (req.body.shop || null);

    // Check if a product with same name already exists in this shop — merge quantities
    const existing = await req.models.Product.findOne({
      name: { $regex: `^${String(name).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
      shop: shop || null,
    });
    if (existing) {
      existing.quantity = (existing.quantity || 0) + qty;
      if (buyPrice !== undefined) existing.buyPrice = Number(buyPrice) || existing.buyPrice;
      if (notes) existing.notes = notes;
      await existing.save();
      return res.json({ success: true, product: existing, merged: true });
    }

    const product = new req.models.Product({
      name: String(name).trim(),
      quantity: qty,
      buyPrice: Number(buyPrice) || 0,
      shop,
      notes: (notes || '').trim() || undefined,
      addedAt: new Date().toISOString(),
    });
    await product.save();
    res.json({ success: true, product });
  } catch (err) {
    console.error('POST /products error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Update product quantity ───────────────────────────────────────────────
router.put('/products/:id', anyAuth, async (req, res) => {
  try {
    const { name, quantity, buyPrice, notes } = req.body;
    const update = {};
    if (name !== undefined) update.name = String(name).trim();
    if (quantity !== undefined) update.quantity = Math.max(0, parseInt(quantity) || 0);
    if (buyPrice !== undefined) update.buyPrice = Number(buyPrice) || 0;
    if (notes !== undefined) update.notes = String(notes).trim();
    const product = await req.models.Product.findByIdAndUpdate(req.params.id, { $set: update }, { returnDocument: 'after' });
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json({ success: true, product });
  } catch (err) {
    console.error('PUT /products error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete product ────────────────────────────────────────────────────────
router.delete('/products/:id', anyAuth, async (req, res) => {
  try {
    await req.models.Product.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /products error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
