'use strict';

const express = require('express');
const router = express.Router();
const { mongoose } = require('../db');
const { adminOnly, anyAuth, logAction } = require('../middleware/auth');
const { buildSalesByShopQuery } = require('../utils/helpers');

// ── Lookup phone by IMEI (used by scan/sell flow) ─────────────────────────
router.get('/lookup/:imei', anyAuth, async (req, res) => {
  try {
    const phone = await req.models.Phone.findOne({ imei: req.params.imei });
    if (!phone) return res.json({});
    res.json(phone);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Get stock ─────────────────────────────────────────────────────────────
// Shop users are scoped to their own shop
router.get('/stock', anyAuth, async (req, res) => {
  const shop = req.authShop || (
    typeof req.query.shop === 'string' && req.validShops.includes(req.query.shop)
      ? req.query.shop
      : undefined
  );
  const query = shop ? { shop } : {};
  if (req.query.all !== 'true') query.status = 'in_stock';

  // Support querying phones by the shop that sold them (cross-shop sale tracking)
  if (req.query.soldByShop && typeof req.query.soldByShop === 'string' && req.validShops.includes(req.query.soldByShop)) {
    if (req.authRole !== 'admin' && req.query.soldByShop !== req.authShop) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    delete query.shop; // query across all shops' stock, not just the requesting shop's
    query.soldByShop = req.query.soldByShop;
  }

  const items = await req.models.Phone.find(query).lean();
  res.json(items.map(p => ({ ...p, id: p._id })));
});

// ── Add stock ─────────────────────────────────────────────────────────────
// Shop users can only add to their own shop
router.post('/stock/add', anyAuth, async (req, res) => {
  const body = { ...req.body };
  if (req.authRole === 'shop') body.shop = req.authShop;

  const { imei } = body;
  if (!imei) return res.status(400).json({ error: 'IMEI required' });
  if (!/^\d{15}$/.test(imei)) return res.status(400).json({ error: 'IMEI must be exactly 15 digits' });

  const exists = await req.models.Phone.findOne({ imei: String(imei) });
  if (exists) return res.status(409).json({ error: 'IMEI exists' });

  const phone = new req.models.Phone({ ...body, addedAt: new Date().toISOString() });
  await phone.save();
  logAction(req.models, 'stock_add', body.shop || null, req.authRole, {
    imei, brand: body.brand, model: body.model, buyPrice: body.buyPrice,
  });
  res.json({ success: true, phone });
});

// ── Sell phone ────────────────────────────────────────────────────────────
router.post('/stock/sell', anyAuth, async (req, res) => {
  try {
    const { imei, salePrice, buyerName, buyerPhone, notes, soldByShop } = req.body;

    if (!imei) return res.status(400).json({ error: 'IMEI required' });
    if (!/^\d{15}$/.test(imei)) return res.status(400).json({ error: 'IMEI must be exactly 15 digits' });
    if (salePrice === undefined || salePrice === null || salePrice === '') {
      return res.status(400).json({ error: 'salePrice required' });
    }

    const phone = await req.models.Phone.findOne({ imei: String(imei) });
    if (!phone) return res.status(404).json({ error: 'Not found' });
    if (phone.status === 'sold') return res.status(409).json({ error: 'Already sold' });

    const sp = Number(salePrice);
    if (Number.isNaN(sp) || sp <= 0) return res.status(400).json({ error: 'Sale price must be greater than zero' });

    // Determine the selling shop: explicit value from body, or the authenticated shop, or the stock-owning shop
    const effectiveSoldByShop = (soldByShop && req.validShops.includes(soldByShop))
      ? soldByShop
      : (req.authShop || phone.shop);

    const bp = Number(phone.buyPrice) || 0;
    const profit = sp - bp;

    phone.status     = 'sold';
    phone.salePrice  = sp;
    phone.soldAt     = new Date().toISOString();
    phone.soldByShop = effectiveSoldByShop;
    // phone.shop intentionally unchanged — keeps the stock-owning shop for audit

    await phone.save();

    const sale = new req.models.Sale({
      imei:        phone.imei,
      brand:       phone.brand,
      model:       phone.model,
      buyPrice:    bp,
      salePrice:   sp,
      profit,
      shop:        phone.shop,
      soldByShop:  effectiveSoldByShop,
      buyerName:   buyerName  || null,
      buyerPhone:  buyerPhone || null,
      notes:       notes      || null,
      soldAt:      phone.soldAt,
    });

    try {
      await sale.save();
    } catch (saleErr) {
      // Revert phone status if sale record fails to save
      phone.status    = 'in_stock';
      phone.salePrice = undefined;
      phone.soldAt    = undefined;
      await phone.save().catch(revertErr => console.error('Failed to revert phone after sale error:', revertErr));
      throw saleErr;
    }

    // Auto-upsert customer contact if buyer info is provided
    if (buyerName || buyerPhone) {
      try {
        const nameVal  = (buyerName  || '').trim();
        const phoneVal = (buyerPhone || '').trim();
        if (nameVal) {
          const orClauses = [{ name: { $regex: `^${nameVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }];
          if (phoneVal) orClauses.push({ phone: phoneVal });
          const existing = await req.models.Customer.findOne({ $or: orClauses });
          if (existing) {
            if (phoneVal && !existing.phone) { existing.phone = phoneVal; await existing.save(); }
          } else {
            await req.models.Customer.create({ name: nameVal, phone: phoneVal || undefined, addedAt: new Date().toISOString() });
          }
        }
      } catch (contactErr) {
        console.error('Auto-save contact error (non-fatal):', contactErr);
      }
    }

    logAction(req.models, 'stock_sell', effectiveSoldByShop || phone.shop || null, req.authRole, {
      imei: phone.imei, brand: phone.brand, model: phone.model,
      salePrice: sp, profit, buyerName: buyerName || null,
      stockShop: phone.shop || null, soldByShop: effectiveSoldByShop,
    });
    res.json({ success: true, sale });
  } catch (err) {
    console.error('Sell endpoint error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Stats ─────────────────────────────────────────────────────────────────
// Shop users are scoped to their own shop
router.get('/stats', anyAuth, async (req, res) => {
  const rawShop = req.query.shop;
  const shop = req.authShop || (
    typeof rawShop === 'string' && req.validShops.includes(rawShop) ? rawShop : undefined
  );
  const stockQuery = shop ? { shop } : {};
  const salesQuery = buildSalesByShopQuery(shop);
  const stock = await req.models.Phone.find(stockQuery);
  const sales = await req.models.Sale.find(salesQuery);

  res.json({
    inStock:      stock.filter(p => p.status === 'in_stock').length,
    sold:         stock.filter(p => p.status === 'sold').length,
    total:        stock.length,
    totalRevenue: sales.reduce((s, x) => s + (x.salePrice || 0), 0),
    salesCount:   sales.length,
  });
});

// ── Batch edit phones ─────────────────────────────────────────────────────
router.put('/stock/batch', adminOnly, async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids required' });
    }
    const validIds = ids.filter(id => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id));
    if (validIds.length !== ids.length) {
      return res.status(400).json({ error: 'Invalid phone ids' });
    }

    const { brand, model, color, storage, buyPrice, imei2, cat, notes, shop } = req.body || {};
    const allowed = { brand, model, color, storage, buyPrice, imei2, cat, notes, shop };
    Object.keys(allowed).forEach(k => { if (allowed[k] === undefined) delete allowed[k]; });

    if (allowed.buyPrice !== undefined) {
      const bp = Number(allowed.buyPrice);
      if (Number.isNaN(bp) || bp < 0) return res.status(400).json({ error: 'Invalid buy price' });
      allowed.buyPrice = bp;
    }
    if (allowed.imei2 !== undefined) {
      allowed.imei2 = String(allowed.imei2 || '').replace(/\D/g, '');
      if (!allowed.imei2) delete allowed.imei2;
    }
    ['brand', 'model', 'color', 'storage', 'notes', 'cat', 'shop'].forEach(k => {
      if (typeof allowed[k] === 'string') {
        const v = allowed[k].trim();
        if (v) allowed[k] = v; else delete allowed[k];
      }
    });

    if (Object.keys(allowed).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const result  = await req.models.Phone.updateMany({ _id: { $in: validIds } }, { $set: allowed });
    const updated = await req.models.Phone.find({ _id: { $in: validIds } });
    res.json({
      success:  true,
      matched:  result.matchedCount  ?? updated.length,
      modified: result.modifiedCount ?? result.nModified ?? 0,
      phones:   updated,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Edit phone ────────────────────────────────────────────────────────────
router.put('/stock/:id', adminOnly, async (req, res) => {
  try {
    const { brand, model, color, storage, buyPrice, imei2, cat, notes, shop } = req.body;
    const allowed = { brand, model, color, storage, buyPrice, imei2, cat, notes, shop };
    Object.keys(allowed).forEach(k => allowed[k] === undefined && delete allowed[k]);
    const phone = await req.models.Phone.findByIdAndUpdate(req.params.id, { $set: allowed }, { returnDocument: 'after' });
    if (!phone) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, phone });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete phone ──────────────────────────────────────────────────────────
router.delete('/stock/:id', adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id === 'undefined' || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid phone id' });
    }
    // Retrieve the phone first so we can log its details before deletion
    const phone = await req.models.Phone.findById(id);
    if (phone) {
      // If the phone was sold, remove its sale record too
      if (phone.status === 'sold' && phone.imei) {
        await req.models.Sale.deleteMany({ imei: phone.imei });
      }
      await req.models.Phone.findByIdAndDelete(id);
      logAction(req.models, 'stock_delete', phone.shop || null, req.authRole, {
        id, imei: phone.imei, brand: phone.brand, model: phone.model,
      });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
