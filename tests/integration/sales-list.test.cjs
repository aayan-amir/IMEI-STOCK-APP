const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestDatabase } = require('../helpers/database.cjs');
const { withApp } = require('../helpers/http.cjs');
const { readSalesLedger } = require('../../services/sales-ledger');
let fixture, app, models, admin, staff, other;
let sequence = 830000000000000;
before(async () => {
  fixture = await startTestDatabase();
  const { createSession } = require('../../middleware/auth');
  const client = await fixture.db.Client.create({ clientId: fixture.namespace, adminPassword: 'admin-test', gatePassword: 'shop-test', shops: [{ id: 'A' }, { id: 'B' }] });
  const scope = { clientId: client.clientId, validShops: ['A', 'B'], authVersion: client.authVersion };
  admin = await createSession({ ...scope, role: 'admin' }); staff = await createSession({ ...scope, role: 'shop', shop: 'A' });
  const second = await fixture.db.Client.create({ clientId: `${fixture.namespace}_other`, adminPassword: 'admin-test', gatePassword: 'shop-test', shops: [{ id: 'A' }, { id: 'B' }] });
  other = await createSession({ clientId: second.clientId, role: 'admin', validShops: ['A', 'B'], authVersion: second.authVersion });
  const connection = fixture.db.getTenantDb(client.clientId); assert.ok(connection.name.startsWith('tenant_stockly_test_'));
  models = { Sale: connection.model('Sale', fixture.db.SaleSchema) };
  app = require('../../app').createApp({ config: require('../../config/runtime').readRuntimeConfig() });
});
beforeEach(async () => { await models.Sale.deleteMany({}); });
after(async () => { if (fixture) await fixture.stop(); });
const options = token => ({ headers: { Authorization: `Bearer ${token || admin}` } });
async function get(request, path, token) { const response = await request(path, options(token)); assert.equal(response.status, 200, await response.clone().text()); return response.json(); }
async function sales(count, extra = {}) { return models.Sale.insertMany(Array.from({ length: count }, () => ({ imei: String(sequence++), shop: 'B', soldByShop: 'A', brand: 'Test', model: 'Phone',
  soldAt: '2026-11-08T20:00:00.000Z', businessDate: '2026-11-09', salePrice: 0.3, buyPrice: 0.1, profit: 0.2, ...extra }))); }
test('bounded event pages match the canonical ledger including reversals and same-date ties', async () => {
  await sales(5, { reversedAt: '2026-11-09T12:00:00.000Z', reversalBusinessDate: '2026-11-10' });
  await withApp(app, async request => {
    let cursor = '', events = [];
    do {
      const page = await get(request, `/api/v2/sales?limit=3${cursor ? '&cursor=' + cursor : ''}`);
      assert.ok(page.items.length <= 3); assert.equal(page.total, 10); events.push(...page.items); cursor = page.nextCursor;
    } while (cursor);
    assert.equal(new Set(events.map(event => event._id)).size, 10);
    const canonical = await readSalesLedger(models);
    assert.deepEqual(events.map(event => [event._id, event.businessDate, event.salePriceMinor, event.buyPriceMinor, event.kind]).sort(), canonical.map(event => [event._id, event.businessDate, event.salePriceMinor, event.buyPriceMinor, event.kind]).sort());
    assert.equal(events[0].kind, 'reversal'); assert.equal(events.at(-1).kind, 'sale');
    assert.ok(Array.isArray(await get(request, '/api/sales?ledger=true')));
  });
});
test('effective posting dates, legacy Karachi dates, kinds, search and selling shop filter precede paging', async () => {
  await sales(1, { businessDate: '2026-11-11', model: 'Pixel [x]', reversedAt: '2026-11-09T12:00:00.000Z', reversalBusinessDate: '2026-11-12' });
  await sales(1, { businessDate: undefined, soldByShop: undefined, shop: 'A', model: 'Legacy' });
  await sales(1, { soldByShop: 'B' });
  await withApp(app, async request => {
    const page = await get(request, '/api/v2/sales?shop=A&from=2026-11-12&to=2026-11-12&kind=reversal&q=Pixel%20%5Bx%5D&limit=1', staff);
    assert.equal(page.total, 1); assert.equal(page.items[0].salePrice, -0.3); assert.equal(page.items[0].shop, 'B');
    assert.equal((await get(request, '/api/v2/sales?from=2026-11-09&to=2026-11-09', staff)).total, 1);
    assert.equal((await request('/api/v2/sales?shop=B', options(staff))).status, 403);
  });
});
test('event cursors remain tenant, permission and filter bound', async () => {
  await sales(3);
  await withApp(app, async request => {
    const first = await get(request, '/api/v2/sales?shop=A&limit=1');
    for (const [query, token] of [['shop=B', admin], ['shop=A&kind=sale', admin], ['shop=A', staff], ['shop=A', other]]) {
      assert.equal((await request(`/api/v2/sales?${query}&cursor=${first.nextCursor}`, options(token))).status, 400);
    }
  });
});
test('complete sales export retains both events and refuses a capped subset', async () => {
  await sales(30, { reversedAt: '2026-11-09T12:00:00.000Z' });
  await withApp(app, async request => {
    const exported = await get(request, '/api/v2/sales/export'); assert.equal(exported.complete, true); assert.equal(exported.items.length, 60);
    assert.equal(exported.totals.revenue, 0); assert.equal(exported.totals.units, 0);
    await sales(2500, { reversedAt: '2026-11-09T12:00:00.000Z' });
    assert.equal((await request('/api/v2/sales/export', options())).status, 413);
  });
});
test('oversized stored histories are rejected before fetching and invalid money is not silently rounded', async () => {
  const [sale] = await sales(1, { notes: 'x'.repeat(9 * 1024 * 1024) });
  await withApp(app, async request => {
    assert.equal((await request('/api/v2/sales/export', options())).status, 413);
    await models.Sale.updateOne({ _id: sale._id }, { $set: { notes: '', salePrice: 0.301 } });
    assert.equal((await request('/api/v2/sales', options())).status, 409);
  });
});
test('invalid dates, kinds, cursors and limits fail explicitly', async () => {
  await withApp(app, async request => {
    for (const query of ['from=2026-02-30', 'from=2026-11-10&to=2026-11-09', 'kind=unknown', 'limit=101', 'cursor=bad', 'shop=unknown', 'from[]=2026-11-09']) {
      assert.equal((await request('/api/v2/sales?' + query, options())).status, 400, query);
    }
  });
});
test('live event traversal skips deleted rows and defers events above its anchor until refresh', async () => {
  await sales(5);
  await withApp(app, async request => {
    const first = await get(request, '/api/v2/sales?limit=2');
    const remaining = await models.Sale.find({ _id: { $lt: first.items[1]._id } }).sort({ _id: -1 });
    await models.Sale.deleteOne({ _id: remaining[0]._id });
    const [newer] = await sales(1);
    await models.Sale.updateOne({ _id: remaining.at(-1)._id }, { $set: { reversedAt: '2026-11-10T00:00:00.000Z', reversalBusinessDate: '2026-11-10' } });
    const next = await get(request, `/api/v2/sales?limit=100&cursor=${first.nextCursor}`);
    assert.equal(next.items.length, 2); assert.equal(next.items.some(row => row._id === newer.id || row.kind === 'reversal'), false);
    assert.equal(next.items.some(row => first.items.some(old => old._id === row._id)), false);
  });
});
test('bounded event payloads omit unknown fields and stay small as history grows', async () => {
  const rows = await sales(600, { reversedAt: '2026-11-09T12:00:00.000Z' });
  await models.Sale.collection.updateOne({ _id: rows[0]._id }, { $set: { internalSecret: 'private' } });
  await withApp(app, async request => {
    const pageText = await (await request('/api/v2/sales', options())).text();
    const legacyText = await (await request('/api/sales?ledger=true', options())).text();
    assert.equal(JSON.parse(pageText).items.length, 50);
    assert.ok(Buffer.byteLength(pageText) < Buffer.byteLength(legacyText) / 8);
    const exported = await get(request, '/api/v2/sales/export'); assert.equal(exported.items.some(row => 'internalSecret' in row), false);
  });
});
