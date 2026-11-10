const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestDatabase } = require('../helpers/database.cjs');
const { withApp } = require('../helpers/http.cjs');

let fixture, app, tenant, models, token, shopToken;
let nextImei = 600000000000000;
before(async () => {
  fixture = await startTestDatabase();
  const client = await fixture.db.Client.create({ clientId: fixture.namespace, adminPassword: 'admin-test', gatePassword: 'shop-test', shops: [{ id: 'A' }, { id: 'B' }] });
  const { createSession } = require('../../middleware/auth');
  token = await createSession({ clientId: client.clientId, role: 'admin', validShops: ['A', 'B'], authVersion: client.authVersion });
  shopToken = await createSession({ clientId: client.clientId, role: 'shop', shop: 'A', validShops: ['A', 'B'], authVersion: client.authVersion });
  tenant = fixture.db.getTenantDb(client.clientId);
  models = {};
  for (const name of ['Phone', 'Sale', 'AuditLog', 'HQStock', 'Shipment', 'Dispatch']) models[name] = tenant.model(name, fixture.db[`${name}Schema`]);
  app = require('../../app').createApp({ config: require('../../config/runtime').readRuntimeConfig() });
});
beforeEach(async () => {
  assert.ok(tenant.name.startsWith('tenant_stockly_test_'));
  for (const name of ['Phone', 'Sale', 'AuditLog', 'HQStock', 'Shipment', 'Dispatch', 'InventoryIdentity', 'InventoryOperation']) if (tenant.models[name]) await tenant.models[name].deleteMany({});
});
after(async () => { if (fixture) await fixture.stop(); });
function options(method, body, key, auth = token) {
  return { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}`, ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) };
}
const item = (fields = {}) => ({ imei: String(nextImei++), brand: 'Test', model: 'Phone', buyPrice: 0.1, notes: 'retain', ...fields });
const receive = (request, items, key) => request('/api/shipments', options('POST', { date: '2026-11-09', supplier: 'Synthetic', items }, key));
async function selected(request) {
  const stock = await (await request('/api/hqstock', options('GET'))).json();
  return stock.items.map(p => ({ imei: p.imei, entryId: p.entryId || 'legacy-no-entry-id' }));
}
const dispatch = (request, items, key, toShop = 'A') => request('/api/dispatches', options('POST', { date: '2026-11-09', toShop, items }, key));

test('concurrent new HQ receipts retain both entries in one warehouse document', async () => {
  await withApp(app, async request => {
    const a = item(), b = item();
    const replies = await Promise.all([receive(request, [a], 'receive-a'), receive(request, [b], 'receive-b')]);
    assert.deepEqual(replies.map(r => r.status), [200, 200]);
    assert.equal(await models.HQStock.countDocuments(), 1);
    assert.equal((await models.HQStock.findOne()).items.length, 2);
    assert.equal(await models.AuditLog.countDocuments({ action: 'warehouse_receive' }), 2);
  });
});
test('overlapping dispatches move each IMEI once and preserve history', async () => {
  await withApp(app, async request => {
    const phone = item(); await receive(request, [phone]);
    const items = await selected(request);
    const replies = await Promise.all([dispatch(request, items, 'dispatch-one', 'A'), dispatch(request, items, 'dispatch-two', 'B')]);
    assert.deepEqual(replies.map(r => r.status).sort(), [200, 409]);
    assert.equal(await models.Phone.countDocuments({ imei: phone.imei }), 1);
    assert.equal((await models.HQStock.findOne()).items.length, 0);
    assert.equal(await models.Dispatch.countDocuments(), 1);
    assert.equal(await models.AuditLog.countDocuments({ action: 'warehouse_dispatch' }), 1);
  });
});
test('disjoint dispatches and a concurrent receipt do not resurrect or drop warehouse entries', async () => {
  await withApp(app, async request => {
    const a = item(), b = item(), c = item();
    await receive(request, [a, b]);
    const items = await selected(request);
    const replies = await Promise.all([dispatch(request, [items[0]], 'disjoint-one'), dispatch(request, [items[1]], 'disjoint-two'), receive(request, [c], 'disjoint-three')]);
    assert.deepEqual(replies.map(r => r.status), [200, 200, 200]);
    assert.deepEqual((await models.HQStock.findOne()).items.map(p => p.imei), [c.imei]);
    assert.equal(await models.Phone.countDocuments(), 2);
  });
});
test('same-key receipt and dispatch replays preserve original outcomes without duplicate history', async () => {
  await withApp(app, async request => {
    const phone = item();
    const [first, repeated] = await Promise.all([receive(request, [phone], 'same-receive'), receive(request, [phone], 'same-receive')]);
    assert.deepEqual([first.status, repeated.status], [200, 200]);
    assert.deepEqual(await first.json(), await repeated.json());
    assert.equal(await models.Shipment.countDocuments(), 1);
    const items = await selected(request);
    const sent = await dispatch(request, items, 'same-dispatch');
    const retry = await dispatch(request, items, 'same-dispatch');
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), await sent.json());
    assert.equal(await models.Phone.countDocuments(), 1);
    assert.equal((await dispatch(request, items, 'same-dispatch', 'B')).status, 409);
  });
});
test('receipt versus shop intake shares one primary IMEI authority', async () => {
  await withApp(app, async request => {
    const phone = item();
    const responses = await Promise.all([receive(request, [phone], 'race-hq-receive'), request('/api/stock/add', options('POST', { ...phone, shop: 'A' }, 'race-shop-intake'))]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    const locations = await models.Phone.countDocuments({ imei: phone.imei }) + ((await models.HQStock.findOne())?.items || []).filter(p => p.imei === phone.imei).length;
    assert.equal(locations, 1);
  });
});
test('duplicate payloads, malformed IMEIs, mixed quantity items, costs and dates fail before mutation', async () => {
  await withApp(app, async request => {
    const phone = item();
    assert.equal((await receive(request, [phone, phone])).status, 409);
    for (const items of [[item({ imei: 'letters600000000000000' })], [item({ imei2: 0 })], [item({ buyPrice: 0.123 })], [item(), { model: 'Missing identity', qty: 2 }]]) assert.equal((await receive(request, items)).status, 400);
    assert.equal((await request('/api/shipments', options('POST', { date: '2026-02-30', items: [phone] }))).status, 400);
    assert.equal(await models.Shipment.countDocuments(), 0);
    assert.equal(await models.HQStock.countDocuments(), 0);
  });
});
test('receipt audit failure rolls back warehouse, shipment and receipt', async () => {
  const original = models.AuditLog.create;
  models.AuditLog.create = async () => { throw Error('injected warehouse audit failure'); };
  try {
    await withApp(app, async request => {
      assert.equal((await receive(request, [item()], 'failed-receipt')).status, 500);
      assert.equal(await models.HQStock.countDocuments(), 0);
      assert.equal(await models.Shipment.countDocuments(), 0);
    });
  } finally { models.AuditLog.create = original; }
});
test('a partial dispatch insert failure aborts all phone, HQ and movement writes', async () => {
  await withApp(app, async request => {
    await receive(request, [item(), item()]);
    const items = await selected(request), original = models.Phone.insertMany;
    models.Phone.insertMany = async function(documents, opts) { await original.call(this, documents.slice(0, 1), opts); throw Error('injected partial insert failure'); };
    try {
      assert.equal((await dispatch(request, items, 'failed-dispatch')).status, 500);
      assert.equal(await models.Phone.countDocuments(), 0);
      assert.equal((await models.HQStock.findOne()).items.length, 2);
      assert.equal(await models.Dispatch.countDocuments(), 0);
    } finally { models.Phone.insertMany = original; }
  });
});
test('dispatch uses stored costs and metadata rather than client replacements', async () => {
  await withApp(app, async request => {
    const phone = item(); await receive(request, [phone]);
    const items = await selected(request);
    const sent = await dispatch(request, [{ ...items[0], buyPrice: 999, notes: 'replace', brand: 'Forged' }]);
    assert.equal(sent.status, 200);
    const result = (await sent.json()).dispatch;
    assert.equal(result.items[0].buyPrice, 0.1);
    const stored = await models.Phone.findOne();
    assert.equal(stored.buyPrice, 0.1);
    assert.equal(stored.notes, 'retain');
  });
});
test('captured entry deletion cannot remove a later re-receipt of the same IMEI', async () => {
  await withApp(app, async request => {
    const phone = item(); await receive(request, [phone]);
    const old = (await selected(request))[0];
    const removal = options('DELETE', { entryId: old.entryId }, 'captured-removal');
    assert.equal((await request(`/api/hqstock/${phone.imei}`, removal)).status, 200);
    await receive(request, [phone], 'receive-again');
    assert.equal((await request(`/api/hqstock/${phone.imei}`, removal)).status, 200);
    assert.equal((await models.HQStock.findOne()).items.length, 1);
    assert.equal((await dispatch(request, [old], 'old-entry-dispatch')).status, 409);
  });
});
test('blind array replacements, index deletes and movement-history deletes fail closed', async () => {
  await withApp(app, async request => {
    const received = await receive(request, [item()]);
    const shipment = (await received.json()).shipment;
    for (const [url, method, body] of [['/api/hqstock', 'PUT', { items: [] }], ['/api/hqstock/at/0', 'DELETE'], [`/api/shipments/${shipment._id}`, 'DELETE']]) assert.equal((await request(url, options(method, body))).status, 409);
    assert.equal((await models.HQStock.findOne()).items.length, 1);
    assert.ok(await models.Shipment.findById(shipment._id));
  });
});
test('warehouse writes require admin even when a shop knows valid entry IDs', async () => {
  await withApp(app, async request => {
    assert.equal((await request('/api/shipments', options('POST', { date: '2026-11-09', items: [item()] }, undefined, shopToken))).status, 403);
    assert.equal(await models.HQStock.countDocuments(), 0);
  });
});

test('sales and reversals reject legacy phones simultaneously present in HQ', async () => {
  await withApp(app, async request => {
    const value = item();
    const phone = await models.Phone.create({ ...value, shop: 'A', status: 'in_stock' });
    await models.HQStock.create({ key: 'hq', items: [value] });
    assert.equal((await request('/api/stock/sell', options('POST', { imei: value.imei, salePrice: 1 }))).status, 409);
    await models.Phone.updateOne({ _id: phone.id }, { $set: { status: 'sold', soldAt: '2026-11-09T00:00:00.000Z', salePrice: 1 } });
    const sale = await models.Sale.create({ ...value, shop: 'A', soldAt: '2026-11-09T00:00:00.000Z', salePrice: 1, profit: 0.9 });
    assert.equal((await request(`/api/sales/${sale.id}`, options('DELETE'))).status, 409);
    assert.equal((await models.Phone.findById(phone.id)).status, 'sold');
  });
});

test('stock edits validate locations and preserve sold ownership and cost snapshots', async () => {
  const phone = await models.Phone.create({ ...item(), shop: 'A', status: 'sold', salePrice: 1 });
  await withApp(app, async request => {
    for (const path of [`/api/stock/${phone.id}`, '/api/stock/batch']) {
      const ids = path.endsWith('batch') ? { ids: [phone.id] } : {};
      assert.equal((await request(path, options('PUT', { ...ids, shop: 'INVALID' }))).status, 400);
      assert.equal((await request(path, options('PUT', { ...ids, shop: 'B' }))).status, 409);
      assert.equal((await request(path, options('PUT', { ...ids, buyPrice: 0.123 }))).status, 400);
      assert.equal((await request(path, options('PUT', { ...ids, buyPrice: 0.2 }))).status, 409);
    }
    assert.equal((await models.Phone.findById(phone.id)).shop, 'A');
    assert.equal((await models.Phone.findById(phone.id)).buyPrice, 0.1);
  });
});

test('cached warehouse outcomes must match their retained movement record', async () => {
  await withApp(app, async request => {
    const phone = item(); await receive(request, [phone], 'corrupted-receipt');
    await tenant.model('InventoryOperation').updateOne({ _id: 'corrupted-receipt' }, { $set: { 'result.shipment.items.0.notes': 'Changed cached note' } });
    assert.equal((await receive(request, [phone], 'corrupted-receipt')).status, 409);
    assert.equal((await models.HQStock.findOne()).items.length, 1);
  });
});

test('legacy restore cannot bypass active inventory identity authority', async () => {
  await withApp(app, async request => {
    await receive(request, [item()], 'before-legacy-restore');
    const response = await request('/api/restore', options('POST', { hqstock: { items: [] } }));
    assert.equal(response.status, 409);
    assert.equal((await models.HQStock.findOne()).items.length, 1);
  });
});

test('empty-target legacy imports reject cross-location duplicate IMEIs before writing', async () => {
  await withApp(app, async request => {
    const phone = item();
    const response = await request('/api/restore', options('POST', { phones: [{ ...phone, shop: 'A', status: 'in_stock' }], hqstock: { items: [phone] } }));
    assert.equal(response.status, 409);
    assert.equal(await models.Phone.countDocuments(), 0);
    assert.equal(await models.HQStock.countDocuments(), 0);
  });
});

test('read-only preflight treats a retained reversed sale as inactive history', async () => {
  const phone = item();
  await models.Phone.create({ ...phone, shop: 'A', status: 'in_stock' });
  await models.Sale.create({ ...phone, shop: 'A', soldAt: '2026-11-01T00:00:00.000Z', reversedAt: '2026-11-09T00:00:00.000Z' });
  const execFile = require('node:util').promisify(require('node:child_process').execFile);
  const child = await execFile(process.execPath, ['scripts/inventory-preflight.cjs', '--client-id', fixture.namespace], { env: process.env, encoding: 'utf8', timeout: 20000 });
  assert.equal(JSON.parse(child.stdout).ready, true);
  assert.equal(await models.Phone.countDocuments(), 1);
  assert.equal(await models.Sale.countDocuments(), 1);
});

test('legacy per-unit cost is preserved and an unknown legacy cost is never invented', async () => {
  const priced = item(), unpriced = item();
  delete priced.buyPrice; delete unpriced.buyPrice;
  await models.HQStock.create({ key: 'hq', items: [{ ...priced, costPerUnit: 0.2 }, unpriced] });
  await withApp(app, async request => {
    const items = await selected(request);
    assert.equal((await dispatch(request, [items.find(row => row.imei === unpriced.imei)])).status, 409);
    const response = await dispatch(request, [items.find(row => row.imei === priced.imei)]);
    assert.equal(response.status, 200);
    assert.equal((await models.Phone.findOne({ imei: priced.imei })).buyPrice, 0.2);
    assert.equal((await response.json()).dispatch.items[0].buyPrice, 0.2);
  });
});

test('history-only legacy restores cannot bypass active inventory fencing', async () => {
  await withApp(app, async request => {
    await receive(request, [item()], 'before-history-import');
    const response = await request('/api/restore', options('POST', { shipments: [{ date: '2026-11-09', items: [item()] }] }));
    assert.equal(response.status, 409);
    assert.equal(await models.Shipment.countDocuments(), 1);
  });
});
