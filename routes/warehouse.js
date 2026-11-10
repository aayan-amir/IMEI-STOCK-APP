'use strict';

const router = require('express').Router();
const { adminOnly } = require('../middleware/auth');
const { HttpError } = require('../utils/http-error');
const { readHQ } = require('../services/inventory-identity');
const { mutateWarehouse, entryId } = require('../services/warehouse-operations');
const { movementPage } = require('../services/movement-list');
router.get('/v2/movements/export', adminOnly, async (req, res) => res.json(await movementPage(req, true)));
router.get('/v2/movements', adminOnly, async (req, res) => res.json(await movementPage(req)));

router.get('/hqstock', adminOnly, async (req, res) => {
  const stock = await readHQ(req.models);
  res.json(stock ? { ...stock.toObject(), items: stock.items.map(item => ({ ...item, entryId: entryId(item) })) } : { items: [], revision: 0 });
});
function mutate(req, type, payload = req.body) {
  return mutateWarehouse({ connection: req.tenantDb, models: req.models, actor: { role: req.authRole },
    validShops: req.validShops, type, payload, operationId: req.get('Idempotency-Key') });
}
function retained() { throw new HttpError(409, 'Inventory and movement history cannot be replaced or deleted blindly. Use a captured-entry movement.', 'CAPTURED_MOVEMENT_REQUIRED'); }
router.put('/hqstock', adminOnly, retained);
router.delete('/hqstock/at/:index', adminOnly, retained);
router.delete('/hqstock/:imei', adminOnly, async (req, res) => {
  res.json(await mutate(req, 'remove', { imei: req.params.imei, entryId: req.body?.entryId }));
});
router.post('/shipments', adminOnly, async (req, res) => { res.json(await mutate(req, 'receive')); });
router.post('/dispatches', adminOnly, async (req, res) => { res.json(await mutate(req, 'dispatch')); });
router.get('/shipments', adminOnly, async (req, res) => {
  res.json(await req.models.Shipment.find().sort({ date: -1 }));
});
router.get('/dispatches', adminOnly, async (req, res) => {
  const dispatches = await req.models.Dispatch.find().sort({ date: -1 }).lean();
  const imeis = [...new Set(dispatches.flatMap(record => (record.items || []).map(item => item?.imei).filter(Boolean)))];
  const sold = imeis.length ? await req.models.Phone.find({ imei: { $in: imeis }, status: 'sold' }, 'imei shop').lean() : [];
  const soldSet = new Set(sold.map(phone => JSON.stringify([phone.shop, phone.imei])));
  res.json(dispatches.map(record => ({ ...record,
    totalPhones: (record.items || []).reduce((count, item) => count + (item?.imei ? 1 : Number(item?.qty) || 0), 0),
    soldPhones: (record.items || []).filter(item => soldSet.has(JSON.stringify([record.toShop, item?.imei]))).length,
  })));
});
router.delete('/shipments/:id', adminOnly, retained);
router.delete('/dispatches/:id', adminOnly, retained);

module.exports = router;
