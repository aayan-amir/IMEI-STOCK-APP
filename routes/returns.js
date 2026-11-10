'use strict';

const router = require('express').Router();
const { adminOnly } = require('../middleware/auth');
const { HttpError } = require('../utils/http-error');
const { reviewCustomerReturn, acceptCustomerReturn, recordCustomerRefund } = require('../services/return-service');
router.use('/customer-returns', adminOnly, (req, res, next) => {
  if (req.method !== 'GET' && req.app.locals.customerReturnsEnabled !== true) throw new HttpError(503, 'Customer-return commands are not enabled on this server', 'FEATURE_UNAVAILABLE');
  next();
});
function body(req, allowed) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some(field => !allowed.includes(field))) throw new HttpError(400, 'Invalid return or refund fields', 'INVALID_INPUT');
  return req.body;
}
const command = work => Object.assign(async (req, res) => res.json(await work(req)), { recoveryGuarded: true });
router.get('/customer-returns/review/:id', async (req, res) => res.json(await reviewCustomerReturn(req, req.params.id)));
router.post('/customer-returns', command(req => acceptCustomerReturn(req, {
  ...body(req, ['saleId', 'receivingShop', 'reviewFingerprint']), operationId: req.get('Idempotency-Key'),
})));
router.post('/customer-returns/:id/refund', command(req => recordCustomerRefund(req, {
  ...body(req, ['method', 'paidByShop', 'confirmed']), saleId: req.params.id, operationId: req.get('Idempotency-Key'),
})));
module.exports = router;
