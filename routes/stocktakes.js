'use strict';

const router = require('express').Router();
const { createHash } = require('node:crypto');
const { adminOnly } = require('../middleware/auth');
const { HttpError } = require('../utils/http-error');
const { getModels } = require('../services/backup-validation');
const { documentPage } = require('../services/document-list');
const { createStocktake, observeStocktake, readStocktake, finishStocktake } = require('../services/stocktake-service');

router.use('/stocktakes', adminOnly, (req, res, next) => {
  if (req.app.locals.stocktakesEnabled !== true) throw new HttpError(503, 'Stock checks are not enabled for this server', 'FEATURE_UNAVAILABLE');
  next();
});

function body(req, allowed) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some(key => !allowed.includes(key))) throw new HttpError(400, 'Invalid stock-check command', 'INVALID_INPUT');
  return req.body;
}
const command = work => Object.assign(async (req, res) => res.json(await work(req)), { recoveryGuarded: true });

router.get('/stocktakes', adminOnly, async (req, res) => {
  const { shop, status } = req.query;
  if (Object.keys(req.query).some(key => !['shop', 'status', 'limit', 'cursor'].includes(key)) ||
      (shop !== undefined && !req.validShops.includes(shop)) || (status !== undefined && !['open', 'reviewed', 'cancelled'].includes(status))) throw new HttpError(400, 'Invalid stock-check filters', 'INVALID_INPUT');
  const query = { shop: shop || { $in: req.validShops }, ...(status ? { status } : {}) };
  const scope = createHash('sha256').update(JSON.stringify(['stocktakes', req.session.clientId, [...req.validShops].sort(), shop, status])).digest('hex');
  const page = await documentPage(req, { Model: getModels(req.tenantDb).Stocktake, query, scope,
    fields: '_id shop status startedAt finishedAt revision businessDate' });
  res.json(page);
});
router.get('/stocktakes/:id', adminOnly, async (req, res) => res.json(await readStocktake(req, req.params.id)));
router.post('/stocktakes', adminOnly, command(req => createStocktake(req, {
  shop: body(req, ['shop']).shop, operationId: req.get('Idempotency-Key'),
})));
router.post('/stocktakes/:id/observations', adminOnly, command(req => observeStocktake(req, {
  ...body(req, ['imei', 'expectedRevision']), stocktakeId: req.params.id, operationId: req.get('Idempotency-Key'),
})));
router.post('/stocktakes/:id/finish', adminOnly, command(req => finishStocktake(req, {
  ...body(req, ['status', 'expectedRevision']), stocktakeId: req.params.id, operationId: req.get('Idempotency-Key'),
})));

module.exports = router;
