'use strict';

const express = require('express');
const router = express.Router();
const { adminOnly } = require('../middleware/auth');

// ── Get HQ warehouse stock ─────────────────────────────────────────────────
router.get('/hqstock', adminOnly, async (req, res) => {
  try {
    const stock = await req.models.HQStockModel.findOne({ key: 'hq' });
    res.json(stock || { items: [] });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Replace HQ warehouse stock ─────────────────────────────────────────────
router.put('/hqstock', adminOnly, async (req, res) => {
  try {
    const update = { ...req.body, key: 'hq', updatedAt: new Date().toISOString() };
    const stock = await req.models.HQStockModel.findOneAndUpdate(
      { key: 'hq' },
      update,
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    res.json({ success: true, stock });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete a single IMEI from HQ warehouse ────────────────────────────────
router.delete('/hqstock/:imei', adminOnly, async (req, res) => {
  try {
    const imei = String(req.params.imei || '').replace(/\D/g, '');
    if (!/^\d{15}$/.test(imei)) return res.status(400).json({ error: 'Invalid IMEI' });
    const stock = await req.models.HQStockModel.findOne({ key: 'hq' });
    if (!stock) return res.json({ success: true });
    stock.items    = (stock.items || []).filter(it => String(it?.imei || '').replace(/\D/g, '') !== imei);
    stock.updatedAt = new Date().toISOString();
    await stock.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Receive shipment into warehouse ───────────────────────────────────────
router.post('/shipments', adminOnly, async (req, res) => {
  try {
    const { date, supplier, ref, items } = req.body || {};
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    // IMEI flow: receiving phones directly into warehouse
    const imeiItems = items.filter(it => it && it.imei);
    if (imeiItems.length === items.length) {
      const normalized = imeiItems.map(it => ({
        imei:     String(it.imei  || '').replace(/\D/g, ''),
        imei2:    String(it.imei2 || '').replace(/\D/g, '') || undefined,
        cat:      String(it.cat   || '').trim() || undefined,
        brand:    String(it.brand || '').trim() || undefined,
        model:    String(it.model || '').trim() || undefined,
        color:    String(it.color || '').trim() || undefined,
        storage:  String(it.storage || '').trim() || undefined,
        buyPrice: Number.isFinite(Number(it.buyPrice)) && Number(it.buyPrice) >= 0 ? Number(it.buyPrice) : 0,
        notes:    String(it.notes || '').trim() || undefined,
        addedAt:  new Date().toISOString(),
      }));

      const invalid = normalized.find(it => !/^\d{15}$/.test(it.imei));
      if (invalid) return res.status(400).json({ error: `Invalid IMEI: ${invalid.imei || '(empty)'}` });

      const payloadImeiSet = new Set();
      for (const it of normalized) {
        if (payloadImeiSet.has(it.imei)) {
          return res.status(409).json({ error: `Duplicate IMEI in shipment: ${it.imei}` });
        }
        payloadImeiSet.add(it.imei);
      }

      const existingPhones = await req.models.Phone.find({ imei: { $in: [...payloadImeiSet] } }, { imei: 1 });
      if (existingPhones.length) {
        return res.status(409).json({ error: `IMEI already exists in stock: ${existingPhones[0].imei}` });
      }

      const stock    = await req.models.HQStockModel.findOne({ key: 'hq' });
      const hqItems  = Array.isArray(stock?.items) ? stock.items : [];
      const hqImeiSet = new Set(hqItems.map(x => String(x?.imei || '').replace(/\D/g, '')).filter(Boolean));
      const dupHq    = normalized.find(it => hqImeiSet.has(it.imei));
      if (dupHq) return res.status(409).json({ error: `IMEI already exists in warehouse: ${dupHq.imei}` });

      const mergedItems = [...hqItems, ...normalized];
      await req.models.HQStockModel.findOneAndUpdate(
        { key: 'hq' },
        { key: 'hq', items: mergedItems, updatedAt: new Date().toISOString() },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      );
    }

    const shipment = new req.models.Shipment({ date, supplier, ref, items, addedAt: new Date().toISOString() });
    await shipment.save();
    res.json({ success: true, shipment });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── List shipments ─────────────────────────────────────────────────────────
router.get('/shipments', adminOnly, async (req, res) => {
  try {
    const shipments = await req.models.Shipment.find().sort({ date: -1 });
    res.json(shipments);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete shipment ────────────────────────────────────────────────────────
router.delete('/shipments/:id', adminOnly, async (req, res) => {
  try {
    await req.models.Shipment.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Dispatch phones from warehouse to a shop ──────────────────────────────
router.post('/dispatches', adminOnly, async (req, res) => {
  try {
    const { date, toShop, note, items } = req.body || {};
    if (!req.validShops.includes(toShop)) return res.status(400).json({ error: 'Invalid shop' });
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'At least one item is required' });

    const imeiItems = items.filter(it => it && it.imei);
    // IMEI flow: move phones from warehouse to selected shop's stock
    if (imeiItems.length === items.length) {
      const normalizedImei = imeiItems.map(it => String(it.imei || '').replace(/\D/g, ''));
      const invalid = normalizedImei.find(imei => !/^\d{15}$/.test(imei));
      if (invalid) return res.status(400).json({ error: `Invalid IMEI: ${invalid}` });

      const uniqImeis = [...new Set(normalizedImei)];
      if (uniqImeis.length !== normalizedImei.length) {
        return res.status(409).json({ error: 'Duplicate IMEI in dispatch payload' });
      }

      const existing = await req.models.Phone.find({ imei: { $in: uniqImeis } }, { imei: 1 });
      if (existing.length) return res.status(409).json({ error: `IMEI already exists in stock: ${existing[0].imei}` });

      const stock    = await req.models.HQStockModel.findOne({ key: 'hq' });
      const hqItems  = Array.isArray(stock?.items) ? stock.items : [];
      const byImei   = new Map(
        hqItems.filter(it => it && it.imei).map(it => [String(it.imei).replace(/\D/g, ''), it]),
      );
      const missing = uniqImeis.find(imei => !byImei.has(imei));
      if (missing) return res.status(400).json({ error: `IMEI not found in warehouse: ${missing}` });

      const now = new Date().toISOString();
      const phonesToCreate = uniqImeis.map(imei => {
        const src = byImei.get(imei) || {};
        return {
          imei,
          imei2:    src.imei2   || undefined,
          brand:    src.brand   || '',
          model:    src.model   || '',
          color:    src.color   || '',
          storage:  src.storage || '',
          buyPrice: Number(src.buyPrice) || 0,
          status:   'in_stock',
          shop:     toShop,
          cat:      src.cat   || '',
          notes:    src.notes || '',
          addedAt:  now,
        };
      });

      await req.models.Phone.insertMany(phonesToCreate, { ordered: true });
      const remaining = hqItems.filter(it => {
        const imei = String(it?.imei || '').replace(/\D/g, '');
        return !imei || !uniqImeis.includes(imei);
      });
      await req.models.HQStockModel.findOneAndUpdate(
        { key: 'hq' },
        { key: 'hq', items: remaining, updatedAt: now },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      );
    }

    const dispatch = new req.models.Dispatch({ date, toShop, note, items, addedAt: new Date().toISOString() });
    await dispatch.save();
    res.json({ success: true, dispatch });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── List dispatches (with sold status per phone) ───────────────────────────
router.get('/dispatches', adminOnly, async (req, res) => {
  try {
    const dispatches = await req.models.Dispatch.find().sort({ date: -1 });
    const allImeis = [...new Set(
      dispatches.flatMap(d => (d.items || [])
        .map(it => String(it?.imei || '').replace(/\D/g, ''))
        .filter(Boolean)),
    )];

    let soldSet = new Set();
    if (allImeis.length) {
      const soldPhones = await req.models.Phone.find(
        { imei: { $in: allImeis }, status: 'sold' },
        { imei: 1, shop: 1 },
      );
      soldSet = new Set(soldPhones.map(p => `${p.shop}|${p.imei}`));
    }

    const withStats = dispatches.map(d => {
      const dItems     = d.items || [];
      const imeis      = dItems.map(it => String(it?.imei || '').replace(/\D/g, '')).filter(Boolean);
      const totalPhones = imeis.length || dItems.reduce((s, it) => s + (Number(it?.qty) || 0), 0);
      const soldPhones  = imeis.reduce((s, imei) => s + (soldSet.has(`${d.toShop}|${imei}`) ? 1 : 0), 0);
      return { ...d.toObject(), totalPhones, soldPhones };
    });

    res.json(withStats);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete dispatch ────────────────────────────────────────────────────────
router.delete('/dispatches/:id', adminOnly, async (req, res) => {
  try {
    await req.models.Dispatch.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
