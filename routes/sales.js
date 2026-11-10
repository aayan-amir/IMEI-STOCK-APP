'use strict';

const router = require('express').Router();
const { adminOnly, anyAuth } = require('../middleware/auth');
const { buildSalesByShopQuery } = require('../utils/helpers');
const { reverseSales } = require('../services/sale-reversals');
const { HttpError } = require('../utils/http-error');
const { readSalesLedger, checkedBounds } = require('../services/sales-ledger');
const { salesPage } = require('../services/sales-list');
const { saleReceipt } = require('../services/sale-receipt');

router.get('/sales/:id/receipt', adminOnly, async (req, res) => {
  if (!/^[a-f0-9]{24}$/i.test(req.params.id)) throw new HttpError(400, 'Invalid sale ID', 'INVALID_INPUT');
  const sale = await req.models.Sale.findById(req.params.id).lean();
  if (!sale) throw new HttpError(404, 'Sale not found', 'NOT_FOUND');
  res.json(saleReceipt(sale));
});

router.get('/v2/sales/export', anyAuth, async (req, res) => { res.json(await salesPage(req, true)); });
router.get('/v2/sales', anyAuth, async (req, res) => { res.json(await salesPage(req)); });

router.get('/sales', anyAuth, async (req, res) => {
  if (req.query.ledger === 'true') {
    return res.json(await readSalesLedger(req.models, { shop: req.authShop || req.query.shop,
      bounds: req.query.date ? checkedBounds(req.query.date, 'daily') : undefined }));
  }
  if (req.authRole !== 'admin') throw new HttpError(403, 'Forbidden', 'FORBIDDEN');
  res.json(await req.models.Sale.find({ ...buildSalesByShopQuery(req.query.shop), reversedAt: null }));
});

router.get('/sales/current/:imei', adminOnly, async (req, res) => {
  const sales = await req.models.Sale.find({ imei: req.params.imei, reversedAt: null }).limit(2).lean();
  if (sales.length !== 1) throw new HttpError(409, 'Current sale needs review before reversal.', 'SALE_STATE_CONFLICT');
  res.json(sales[0]);
});

function reverse(req, saleIds, imei) {
  return reverseSales({ connection: req.tenantDb, models: req.models, actor: { role: req.authRole }, saleIds, imei });
}
router.delete('/sales', adminOnly, async (req, res) => {
  res.json(await reverse(req, req.body?.saleIds));
});
router.delete('/sales/by-imei/:imei', adminOnly, async (req, res) => {
  res.json(await reverse(req, req.body?.saleId ? [req.body.saleId] : undefined, req.params.imei));
});
router.delete('/sales/:id', adminOnly, async (req, res) => {
  res.json(await reverse(req, [req.params.id]));
});

module.exports = router;
