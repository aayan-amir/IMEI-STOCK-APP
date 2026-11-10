'use strict';

const router = require('express').Router();
const { adminOnly } = require('../middleware/auth');
const { HttpError } = require('../utils/http-error');
const { reviewCash, recordCashCheckpoint } = require('../services/cash-close');
const { recordCashEntry } = require('../services/cash-entry');
router.use('/cash', adminOnly, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (req.app.locals.verifiedCashEnabled !== true) throw new HttpError(503, 'Counted cash commands are not enabled on this server', 'FEATURE_UNAVAILABLE');
  next();
});
router.get('/cash/:shop/review', async (req, res) => res.json(await reviewCash(req, req.params.shop)));
for (const [path, work, fields] of [
  ['checkpoints', recordCashCheckpoint, ['shop', 'kind', 'amount', 'confirmed', 'reason', 'reviewFingerprint']],
  ['entries', recordCashEntry, ['shop', 'kind', 'method', 'amount', 'cost', 'description', 'category', 'toShop', 'confirmed']],
]) {
  const command = async (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some(field => !fields.includes(field))) throw new HttpError(400, 'Invalid cash command fields', 'INVALID_INPUT');
    res.json(await work(req, { ...req.body, operationId: req.get('Idempotency-Key') }));
  };
  command.recoveryGuarded = true;
  router.post('/cash/' + path, command);
}
module.exports = router;
