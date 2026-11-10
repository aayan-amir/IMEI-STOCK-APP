'use strict';

const router = require('express').Router();
const { anyAuth } = require('../middleware/auth');
const { mutateProduct } = require('../services/product-operations');
const { HttpError } = require('../utils/http-error');
const { catalogPage } = require('../services/catalog-list');
router.get('/v2/products/export', anyAuth, async (req, res) => { res.json(await catalogPage(req, 'products', true)); });
router.get('/v2/products', anyAuth, async (req, res) => { res.json(await catalogPage(req, 'products')); });

router.get('/products', anyAuth, async (req, res) => {
  const shop = req.authShop || req.query.shop;
  if (shop !== undefined && (typeof shop !== 'string' || !req.validShops.includes(shop))) {
    throw new HttpError(400, 'Invalid shop', 'INVALID_INPUT');
  }
  const items = await req.models.Product.find(shop ? { shop } : {}).sort({ name: 1 }).lean();
  res.json(items.map(product => ({ ...product, id: product._id, revision: product.revision ?? 0 })));
});

function mutate(req, type) {
  return mutateProduct({ connection: req.tenantDb, models: req.models,
    actor: { role: req.authRole, shop: req.authShop }, validShops: req.validShops,
    type, payload: req.body, id: req.params.id, operationId: req.get('Idempotency-Key') });
}
router.post('/products', anyAuth, async (req, res) => {
  res.json(await mutate(req, 'add'));
});
router.put('/products/:id', anyAuth, async (req, res) => {
  res.json(await mutate(req, 'update'));
});
router.delete('/products/:id', anyAuth, async (req, res) => {
  res.json(await mutate(req, 'delete'));
});

module.exports = router;
