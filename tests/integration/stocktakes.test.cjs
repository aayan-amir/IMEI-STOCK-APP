const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestDatabase } = require('../helpers/database.cjs');
const { withApp } = require('../helpers/http.cjs');
let fixture, app, ownerToken, shopToken, otherToken, models;
before(async () => {
  fixture = await startTestDatabase();
  const { createSession } = require('../../middleware/auth');
  for (const suffix of ['source', 'other']) {
    const client = await fixture.db.Client.create({ clientId: fixture.namespace + '_' + suffix, adminPassword: 'owner-test', gatePassword: 'shop-test', shops: [{ id: 'A' }] });
    const token = await createSession({ clientId: client.clientId, role: 'admin', validShops: ['A'], authVersion: client.authVersion });
    if (suffix === 'source') {
      ownerToken = token;
      shopToken = await createSession({ clientId: client.clientId, role: 'shop', shop: 'A', validShops: ['A'], authVersion: client.authVersion });
      models = require('../../services/backup-validation').getModels(fixture.db.getTenantDb(client.clientId));
    } else otherToken = token;
  }
  app = require('../../app').createApp({ config: { ...require('../../config/runtime').readRuntimeConfig(), stocktakesEnabled: true } });
});
beforeEach(async () => { for (const Model of Object.values(models)) await Model.deleteMany({}); });
after(async () => { if (fixture) await fixture.stop(); });
const options = (method = 'GET', body, key, token = ownerToken) => ({ method, headers: {
  Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}),
}, ...(body ? { body: JSON.stringify(body) } : {}) });

test('disabled stock checks reject direct writes and advertise unavailable capability', async () => {
  const disabled = require('../../app').createApp({ config: { ...require('../../config/runtime').readRuntimeConfig(), stocktakesEnabled: false } });
  await withApp(disabled, async request => {
    const response = await request('/api/stocktakes', options('POST', { shop: 'A' }, 'disabled-count-start'));
    assert.equal(response.status, 503);
    const capabilities = await (await request('/api/capabilities', options())).json();
    assert.equal(capabilities.features.stocktake, false);
  });
  assert.equal(await models.Stocktake.countDocuments(), 0);
});

test('owner stock-check API captures, scans, reviews and lists retained observations without stock adjustments', async () => {
  await models.Phone.create({ imei: '001234567890123', shop: 'A', status: 'in_stock', buyPrice: 0.1 });
  const before = JSON.stringify(await models.Phone.find({}).lean());
  await withApp(app, async request => {
    const start = await request('/api/stocktakes', options('POST', { shop: 'A' }, 'api-count-start'));
    assert.equal(start.status, 200);
    const count = await start.json(), url = '/api/stocktakes/' + count.stocktakeId;
    const scan = await request(url + '/observations', options('POST', { imei: '001234567890123', expectedRevision: 0 }, 'api-count-scan'));
    assert.equal(scan.status, 200);
    const review = await (await request(url, options())).json();
    assert.deepEqual(review.differences.matched, ['001234567890123']);
    const finish = await request(url + '/finish', options('POST', { expectedRevision: 1, status: 'reviewed' }, 'api-count-finish'));
    assert.equal(finish.status, 200);
    const listing = await request('/api/stocktakes?shop=A&limit=1', options());
    assert.equal(listing.status, 200);
    const data = await listing.json();
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].status, 'reviewed');
    assert.equal('baseline' in data.items[0], false);
    assert.equal('operations' in data.items[0], false);
    assert.equal((await request(url, options('GET', undefined, undefined, shopToken))).status, 403);
    assert.equal((await request(url, options('GET', undefined, undefined, otherToken))).status, 404);
  });
  assert.equal(JSON.stringify(await models.Phone.find({}).lean()), before);
  assert.equal(await models.Sale.countDocuments(), 0);
});

test('stock-check API rejects unauthenticated, staff and malformed commands before recording counts', async () => {
  await withApp(app, async request => {
    assert.equal((await request('/api/stocktakes')).status, 401);
    assert.equal((await request('/api/stocktakes', options('POST', { shop: 'A' }, 'shop-count-start', shopToken))).status, 403);
    assert.equal((await request('/api/stocktakes', options('POST', { shop: 'A' }))).status, 400);
    assert.equal((await request('/api/stocktakes', options('POST', { shop: 'A', adjustStock: true }, 'bad-count-start'))).status, 400);
    assert.equal((await request('/api/stocktakes?status=posted', options())).status, 400);
    assert.equal((await request('/api/stocktakes?shop=unknown', options())).status, 400);
    assert.equal((await request('/api/stocktakes?limit=101', options())).status, 400);
  });
  assert.equal(await models.Stocktake.countDocuments(), 0);
});
