'use strict';

const router = require('express').Router();
const { adminOnly } = require('../middleware/auth');
const { mutateDay } = require('../services/day-service');
const { uniqueDay } = require('../services/accounting-period');
const { checkedBounds } = require('../services/sales-ledger');
const { HttpError } = require('../utils/http-error');
const { recordPage } = require('../services/record-list');
router.get('/v2/days/export', adminOnly, async (req, res) => { res.json(await recordPage(req, 'days', true)); });
router.get('/v2/days', adminOnly, async (req, res) => { res.json(await recordPage(req, 'days')); });

function check(req) {
  if (!req.validShops.includes(req.params.shop)) throw new HttpError(400, 'Invalid shop', 'INVALID_SHOP');
  checkedBounds(req.params.date, 'daily');
}
router.get('/days', adminOnly, async (req, res) => {
  const query = {};
  if (req.query.shop) {
    if (!req.validShops.includes(req.query.shop)) throw new HttpError(400, 'Invalid shop', 'INVALID_SHOP');
    query.shop = req.query.shop;
  }
  if (req.query.month) { checkedBounds(req.query.month, 'monthly'); query.date = { $regex: '^' + req.query.month }; }
  const days = await req.models.Day.find(query).sort({ date: -1 }).lean();
  res.json(days.map(day => ({ ...day, revision: day.revision ?? 0, status: day.status || 'open' })));
});
router.get('/days/:shop/:date/history', adminOnly, async (req, res) => {
  check(req);
  res.json(await req.models.DayVersion.find({ shop: req.params.shop, date: req.params.date }).sort({ revision: 1 }).lean());
});
router.get('/days/:shop/:date', adminOnly, async (req, res) => {
  check(req);
  const day = await uniqueDay(req.models, null, req.params.shop, req.params.date);
  const state = await req.models.AccountingState.findById(req.params.shop).select('cashFormatVersion').lean();
  const result = day ? day.toObject() : { shop: req.params.shop, date: req.params.date, revision: 0, status: 'open' };
  res.json({ ...result, ...(state?.cashFormatVersion === 1 ? { cashFormatVersion: 1 } : {}) });
});
function mutate(req, action) {
  return mutateDay({ connection: req.tenantDb, models: req.models, actor: { role: req.authRole }, validShops: req.validShops,
    shop: req.params.shop, date: req.params.date, payload: req.body || {}, action, operationId: req.get('Idempotency-Key'), manualVersion: req.get('X-Stockly-Manual-Version') });
}
router.put('/days/:shop/:date', adminOnly, async (req, res) => { res.json(await mutate(req, 'save')); });
router.post('/days/:shop/:date/close', adminOnly, async (req, res) => { res.json(await mutate(req, 'close')); });
router.post('/days/:shop/:date/reopen', adminOnly, async (req, res) => { res.json(await mutate(req, 'reopen')); });
router.delete('/days/:shop/:date', adminOnly, async (req, res) => { res.json(await mutate(req, 'reset')); });

module.exports = router;
