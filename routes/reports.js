'use strict';

const express = require('express');
const router = express.Router();
const { adminOnly } = require('../middleware/auth');
const { inventoryTransaction } = require('../services/inventory-identity');
const { touchPeriod } = require('../services/accounting-period');
const { HttpError } = require('../utils/http-error');
const { checkedBounds } = require('../services/sales-ledger');
const { financialSummary, reportData } = require('../services/financial-summary');
const { dayChecksum } = require('../services/day-service');
const { recordPage } = require('../services/record-list');
router.get('/v2/reports/export', adminOnly, async (req, res) => { res.json(await recordPage(req, 'reports', true)); });
router.get('/v2/reports', adminOnly, async (req, res) => { res.json(await recordPage(req, 'reports')); });

// ── List reports ───────────────────────────────────────────────────────────
router.get('/reports', adminOnly, async (req, res) => {
  try {
    const { shop, type } = req.query;
    const query = {};
    if (shop) query.shop = String(shop);
    if (type) query.type = String(type);
    const reports = await req.models.Report.find(query).sort({ period: -1 }).limit(100);
    res.json(reports);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Generate and persist a report ─────────────────────────────────────────
router.post('/reports/generate', adminOnly, async (req, res) => {
    const { type: rawType, shop: rawShop, period: rawPeriod } = req.body || {};
    const type   = String(rawType   || '');
    const shop   = String(rawShop   || '');
    const period = String(rawPeriod || '');
    if (!type || !shop || !period) throw new HttpError(400, 'type, shop, period required', 'INVALID_INPUT');
    if (shop !== 'ALL' && !req.validShops.includes(shop)) throw new HttpError(400, 'Invalid shop', 'INVALID_SHOP');
    checkedBounds(period, type);
    const result = await inventoryTransaction(req.tenantDb, async session => {
      for (const id of (shop === 'ALL' ? [...req.validShops].sort() : [shop])) await touchPeriod(req.models, session, id);
      const summary = await financialSummary(req.models, { shop, type, period, validShops: req.validShops, session });
      const data = JSON.parse(JSON.stringify(reportData(summary)));
      const previous = await req.models.Report.findOne({ type, shop, period }).session(session).lean();
      if (previous && dayChecksum(previous.data) === dayChecksum(data)) return { success: true, report: previous };
      const history = previous?.history || [];
      if (previous) {
        if (history.length >= 30) throw new HttpError(409, 'Report history needs managed archival before another version.', 'REPORT_CONFLICT');
        history.push({ generatedAt: previous.generatedAt, data: previous.data });
      }
      const report = await req.models.Report.findOneAndUpdate(
        { type, shop, period },
        { type, shop, period, data, history, generatedAt: new Date().toISOString() },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, session },
      );
      return { success: true, report };
    });
    res.json(result);
});

// ── Delete report ──────────────────────────────────────────────────────────
router.delete('/reports/:id', adminOnly, async (req, res) => {
  if (!/^[a-f0-9]{24}$/i.test(req.params.id)) throw new HttpError(400, 'Invalid report ID', 'INVALID_INPUT');
  await inventoryTransaction(req.tenantDb, async session => {
    const report = await req.models.Report.findById(req.params.id).session(session);
    if (!report) return;
    for (const shop of (report.shop === 'ALL' ? [...req.validShops].sort() : [report.shop])) await touchPeriod(req.models, session, shop);
    if (report.data?.closedRevision || report.data?.sourceRevisions?.some(source => source.status === 'closed') || report.history?.length) throw new HttpError(409, 'This report retains closed history and cannot be deleted.', 'REPORT_RETAINED');
    await req.models.Report.deleteOne({ _id: report._id }, { session });
    await req.models.AuditLog.create([{ action: 'report_delete', role: req.authRole, shop: report.shop,
      details: { reportId: report.id, type: report.type, period: report.period } }], { session });
  });
  res.json({ success: true });
});

module.exports = router;
