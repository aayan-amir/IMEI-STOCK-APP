const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestDatabase } = require('../helpers/database.cjs');
const { withApp } = require('../helpers/http.cjs');
let fixture, app, models, owner, staff;
before(async () => {
  fixture = await startTestDatabase(); const client = await fixture.db.Client.create({ clientId: fixture.namespace, adminPassword: 'test', gatePassword: 'test', shops: [{ id: 'A' }, { id: 'B' }] });
  const auth = require('../../middleware/auth'); owner = await auth.createSession({ clientId: client.clientId, role: 'admin', validShops: ['A', 'B'], authVersion: client.authVersion });
  staff = await auth.createSession({ clientId: client.clientId, role: 'shop', shop: 'A', validShops: ['A', 'B'], authVersion: client.authVersion });
  models = require('../../services/backup-validation').getModels(fixture.db.getTenantDb(client.clientId)); app = require('../../app').createApp();
});
beforeEach(async () => { for (const name of ['Shipment', 'Dispatch', 'Phone']) await models[name].deleteMany({}); });
after(async () => { if (fixture) await fixture.stop(); });
const options = token => ({ headers: { Authorization: 'Bearer ' + (token || owner) } });
async function get(request, url) { const response = await request(url, options()); assert.equal(response.status, 200, await response.clone().text()); return response.json(); }
const item = { imei: '001234567890123', brand: 'Test', model: 'Retained', buyPrice: 0.1 };

test('movement pages retain date order and both source identities when IDs collide across collections', async () => {
  const id = '123456789012345678901234';
  await models.Shipment.create({ _id: id, date: '2026-11-10', supplier: 'Inbound', items: [item] });
  await models.Dispatch.create({ _id: id, date: '2026-11-10', toShop: 'A', items: [item] });
  await models.Shipment.create({ date: '2026-11-09', items: [item] });
  await withApp(app, async request => {
    const keys = []; let cursor;
    do { const page = await get(request, '/api/v2/movements?limit=1' + (cursor ? '&cursor=' + cursor : '')); assert.equal(page.total, 3); assert.ok(page.items.length <= 1); keys.push(page.items[0].source + ':' + page.items[0].id); cursor = page.nextCursor; } while(cursor);
    assert.equal(new Set(keys).size, 3); assert.equal(keys[0], 'dispatch:' + id); assert.equal(keys[1], 'inbound:' + id);
    assert.ok(Array.isArray(await get(request, '/api/shipments'))); assert.ok(Array.isArray(await get(request, '/api/dispatches')));
  });
});

test('movement month and destination filters precede pages and cannot share cursors or staff authority', async () => {
  await models.Shipment.create({ date: '2026-11-10', items: [item] });
  await models.Dispatch.insertMany([{ date: '2026-11-10', toShop: 'A', items: [item] }, { date: '2026-11-10', toShop: 'A', items: [item] }, { date: '2026-11-10', toShop: 'B', items: [item] }, { date: '2026-10-10', toShop: 'A', items: [item] }]);
  await withApp(app, async request => {
    const page = await get(request, '/api/v2/movements?month=2026-11&shop=A&limit=1'); assert.equal(page.total, 2); assert.equal(page.items[0].source, 'dispatch');
    assert.equal((await get(request, '/api/v2/movements?month=2026-11&shop=HQ')).total, 1);
    assert.equal((await request('/api/v2/movements?month=2026-11&shop=B&cursor=' + page.nextCursor, options())).status, 400);
    assert.equal((await request('/api/v2/movements', options(staff))).status, 403);
    for (const query of ['month=bad', 'shop=unknown', 'limit=101', 'other=value']) assert.equal((await request('/api/v2/movements?' + query, options())).status, 400);
  });
});

test('complete movement exports preserve all nested metadata without implying current sales provenance or mutating history', async () => {
  await models.Dispatch.create({ date: '2026-11-10', toShop: 'A', note: 'Retained note', items: [{ ...item, notes: 'Retained item metadata', entryId: 'original-entry' }] });
  const before = JSON.stringify(await models.Dispatch.find({}).lean());
  await withApp(app, async request => {
    const data = await get(request, '/api/v2/movements/export?shop=A'); assert.equal(data.complete, true); assert.equal(data.total, 1);
    assert.equal(data.items[0].items[0].notes, 'Retained item metadata'); assert.equal(data.items[0].items[0].entryId, 'original-entry'); assert.equal(data.items[0].soldPhones, undefined);
  });
  assert.equal(JSON.stringify(await models.Dispatch.find({}).lean()), before);
});

test('automatic movement exports reject oversized matches before fetching an unbounded history', async () => {
  await models.Shipment.insertMany([{ date: '2026-11-10', items: [{ ...item, notes: 'x'.repeat(4500000) }] }, { date: '2026-11-09', items: [{ ...item, notes: 'x'.repeat(4500000) }] }]);
  await withApp(app, async request => {
    assert.equal((await request('/api/v2/movements/export', options())).status, 413);
    assert.equal((await get(request, '/api/v2/movements?limit=1')).items.length, 1);
  });
});


test('movement traversal anchors newer arrivals while allowing live deletions without repeating a source record', async () => {
  await models.Shipment.insertMany(['10', '09', '08', '07'].map(day => ({ date: '2026-11-' + day, items: [item] })));
  await withApp(app, async request => {
    const first = await get(request, '/api/v2/movements?limit=2');
    await models.Shipment.deleteOne({ _id: first.items[1].id }); await models.Shipment.create({ date: '2026-11-11', items: [item] });
    const second = await get(request, '/api/v2/movements?limit=2&cursor=' + first.nextCursor);
    assert.equal(second.total, 3); assert.equal(second.hasMore, false); assert.deepEqual(second.items.map(row => row.date), ['2026-11-08', '2026-11-07']);
    assert.equal(new Set([...first.items, ...second.items].map(row => row.source + ':' + row.id)).size, 4);
  });
});

test('movement automatic exports enforce the combined record ceiling while ordinary pages remain bounded', async () => {
  await models.Shipment.insertMany(Array.from({ length: 5000 }, () => ({ date: '2026-11-10', items: [] })));
  await models.Dispatch.create({ date: '2026-11-10', toShop: 'A', items: [] });
  await withApp(app, async request => {
    assert.equal((await request('/api/v2/movements/export', options())).status, 413);
    const page = await get(request, '/api/v2/movements?limit=1'); assert.equal(page.items.length, 1); assert.equal(page.total, 5001);
  });
});
