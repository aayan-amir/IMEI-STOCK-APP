const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestDatabase } = require('../helpers/database.cjs');
const { withApp } = require('../helpers/http.cjs');
let fixture, app, legacyApp, models, targetModels, token, ownerToken, targetToken;
before(async () => {
  fixture = await startTestDatabase();
  const client = await fixture.db.Client.create({ clientId: fixture.namespace, adminPassword: 'owner-test', gatePassword: 'shop-test', shops: [{ id: 'A' }, { id: 'B' }] });
  token = await require('../../middleware/auth').createSession({ clientId: client.clientId, role: 'shop', shop: 'A', validShops: ['A', 'B'], authVersion: client.authVersion });
  models = require('../../services/backup-validation').getModels(fixture.db.getTenantDb(client.clientId));
  ownerToken = await require('../../middleware/auth').createSession({ clientId: client.clientId, role: 'admin', validShops: ['A', 'B'], authVersion: client.authVersion });
  const target = await fixture.db.Client.create({ clientId: fixture.namespace + '_target', adminPassword: 'owner-test', gatePassword: 'shop-test', shops: [{ id: 'A' }, { id: 'B' }] });
  targetToken = await require('../../middleware/auth').createSession({ clientId: target.clientId, role: 'admin', validShops: ['A', 'B'], authVersion: target.authVersion });
  targetModels = require('../../services/backup-validation').getModels(fixture.db.getTenantDb(target.clientId));
  const config = require('../../config/runtime').readRuntimeConfig();
  app = require('../../app').createApp({ config: { ...config, fullyPaidSalesEnabled: true } });
  legacyApp = require('../../app').createApp({ config: { ...config, fullyPaidSalesEnabled: false } });
});
beforeEach(async () => {
  for (const Model of Object.values(models)) await Model.deleteMany({});
  for (const Model of Object.values(targetModels)) await Model.deleteMany({});
  await models.Phone.create({ imei: '001234567890123', shop: 'B', status: 'in_stock', buyPrice: 0.1 });
});
after(async () => { if (fixture) await fixture.stop(); });
const options = (body, key = 'paid-sale-key', modern = true) => ({ method: 'POST', headers: {
  Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Idempotency-Key': key,
  ...(modern ? { 'X-Stockly-Sale-Version': '2' } : {}),
}, body: JSON.stringify({ imei: '001234567890123', salePrice: 0.3, ...body }) });

test('fully paid sale atomically records one exact tender and preserves selling versus owning shop', async () => {
  await withApp(app, async request => {
    const capabilities = await (await request('/api/capabilities', { headers: { Authorization: 'Bearer ' + token } })).json();
    assert.equal(capabilities.features.fullyPaidTender, true);
    const response = await request('/api/stock/sell', options({ paymentMethod: 'cash', soldByShop: 'B' }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.sale.paymentMethod, 'cash');
    assert.equal(result.sale.paymentVersion, 1);
    assert.equal(result.sale.paidAmountMinor, 30);
    assert.equal(result.sale.soldByShop, 'A'); assert.equal(result.sale.shop, 'B');
    const replay = await request('/api/stock/sell', options({ paymentMethod: 'cash', soldByShop: 'B' }));
    assert.deepEqual((await replay.json()).sale, result.sale);
    assert.equal(await models.Sale.countDocuments(), 1);
    assert.equal(await models.StockOperation.countDocuments(), 1);
    assert.equal((await request('/api/stock/sell', options({ paymentMethod: 'bank' }))).status, 409);
  });
});

test('enabled tender contract rejects old writers, omission, invalid method and caller-supplied payment amounts before selling', async () => {
  await withApp(app, async request => {
    for (const [body, modern, status] of [[{}, false, 428], [{}, true, 400], [{ paymentMethod: 'credit' }, true, 400],
      [{ paymentMethod: 'cash', paidAmountMinor: 29 }, true, 400], [{ paymentMethod: 'bank', amountPaid: 0.2 }, true, 400]]) {
      assert.equal((await request('/api/stock/sell', options(body, 'invalid-paid-key', modern))).status, status);
    }
  });
  assert.equal(await models.Sale.countDocuments(), 0);
  assert.equal((await models.Phone.findOne({})).status, 'in_stock');
});

test('disabled tender feature keeps legacy sales unknown and rejects unrecordable tender claims', async () => {
  await withApp(legacyApp, async request => {
    assert.equal((await request('/api/stock/sell', options({ paymentMethod: 'cash' }))).status, 503);
    const response = await request('/api/stock/sell', options({}, 'legacy-paid-key', false));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).sale.paymentMethod, undefined);
  });
  await withApp(app, async request => {
    const replay = await request('/api/stock/sell', options({}, 'legacy-paid-key', false));
    assert.equal(replay.status, 200);
    assert.equal(await models.Sale.countDocuments(), 1);
  });
});

test('fully paid sale recovery preserves its one tender and rejects downgrades or amount tampering', async () => {
  await withApp(app, async request => {
    assert.equal((await request('/api/stock/sell', options({ paymentMethod: 'bank' }))).status, 200);
    const owner = { headers: { Authorization: 'Bearer ' + ownerToken } };
    assert.equal((await request('/api/backup', owner)).status, 409);
    assert.equal((await request('/api/backup?version=2', owner)).status, 409);
    const backup = await (await request('/api/backup?version=3', owner)).json();
    assert.equal(backup.validation.ready, true, JSON.stringify(backup.validation));
    const rules = require('../../services/backup-validation');
    const tampered = structuredClone(backup);
    tampered.collections.Sale[0].paidAmountMinor = 31;
    tampered.collections.StockOperation = []; tampered.manifest.counts.StockOperation = 0;
    tampered.checksum = rules.checksum(tampered);
    assert.equal(rules.validateBackup(tampered).ready, false);
    const downgraded = structuredClone(backup); downgraded.version = 2;
    delete downgraded.collections.Stocktake; delete downgraded.manifest.counts.Stocktake;
    downgraded.checksum = rules.checksum(downgraded);
    assert.equal(rules.validateBackup(downgraded).ready, false);
    const targetOptions = body => ({ method: 'POST', headers: { Authorization: 'Bearer ' + targetToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const review = await (await request('/api/restore/validate', targetOptions({ backup, mode: 'empty' }))).json();
    assert.equal(review.ready, true, JSON.stringify(review));
    const restored = await request('/api/restore/apply', targetOptions({ planId: review.planId, operationId: 'restore-paid-key' }));
    assert.equal(restored.status, 200);
    const retained = await targetModels.Sale.findOne({}).lean();
    assert.equal(retained.paymentMethod, 'bank'); assert.equal(retained.paidAmountMinor, 30);
    assert.equal(await targetModels.Sale.countDocuments(), 1);
  });
});

test('legacy import rejects payment evidence before it can strip new sale facts', async () => {
  await withApp(app, async request => {
    const payload = { version: 1, phones: [], sales: [{ imei: '001234567890123', shop: 'B', soldByShop: 'A',
      soldAt: '2026-11-10T00:00:00.000Z', buyPrice: 0.1, salePrice: 0.3, profit: 0.2,
      paymentVersion: 1, paymentMethod: 'cash', paidAmountMinor: 30 }] };
    const response = await request('/api/restore', { method: 'POST', headers: { Authorization: 'Bearer ' + targetToken, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'REVIEWED_RESTORE_REQUIRED');
    assert.equal(await targetModels.Sale.countDocuments(), 0);
  });
});

test('tender audit failure rolls back sale, payment evidence, stock and operation receipt together', async () => {
  const original = models.AuditLog.create;
  models.AuditLog.create = async () => { throw Error('injected paid-sale audit failure'); };
  try {
    await withApp(app, async request => assert.equal((await request('/api/stock/sell', options({ paymentMethod: 'cash' }))).status, 500));
  } finally { models.AuditLog.create = original; }
  assert.equal(await models.Sale.countDocuments(), 0);
  assert.equal(await models.StockOperation.countDocuments(), 0);
  assert.equal((await models.Phone.findOne({})).status, 'in_stock');
});

test('paid oversell race records one tender and an old replay after reversal and resale cannot change the new sale', async () => {
  await withApp(app, async request => {
    const responses = await Promise.all(['race-paid-a', 'race-paid-b'].map(key => request('/api/stock/sell', options({ paymentMethod: 'cash' }, key))));
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    const winningIndex = responses.findIndex(response => response.status === 200);
    const original = (await responses[winningIndex].json()).sale;
    const originalKey = ['race-paid-a', 'race-paid-b'][winningIndex];
    assert.equal(await models.Sale.countDocuments(), 1);
    assert.equal((await models.Sale.findOne({})).paidAmountMinor, 30);
    assert.equal((await request('/api/sales/' + original._id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + ownerToken } })).status, 200);
    const resale = await request('/api/stock/sell', options({ paymentMethod: 'bank', salePrice: 0.4 }, 'resale-paid-key'));
    assert.equal(resale.status, 200);
    const current = (await resale.json()).sale;
    const replay = await request('/api/stock/sell', options({ paymentMethod: 'cash' }, originalKey));
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).sale._id, original._id);
    assert.equal(String((await models.Phone.findOne({})).currentSaleId), current._id);
    assert.equal(await models.Sale.countDocuments(), 2);
    assert.equal((await models.Sale.findById(current._id)).paidAmountMinor, 40);
  });
});
