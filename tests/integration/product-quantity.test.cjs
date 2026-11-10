const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestDatabase } = require('../helpers/database.cjs');
const { withApp } = require('../helpers/http.cjs');

let fixture, app, tenant, Product, AuditLog, token, admin;
before(async () => {
  fixture = await startTestDatabase();
  const client = await fixture.db.Client.create({ clientId: fixture.namespace, adminPassword: 'test-admin', gatePassword: 'test-shop', shops: [{ id: 'A' }, { id: 'B' }] });
  const { createSession } = require('../../middleware/auth');
  token = await createSession({ clientId: client.clientId, role: 'shop', shop: 'A', validShops: ['A', 'B'], authVersion: client.authVersion });
  admin = await createSession({ clientId: client.clientId, role: 'admin', validShops: ['A', 'B'], authVersion: client.authVersion });
  tenant = fixture.db.getTenantDb(client.clientId);
  Product = tenant.model('Product', fixture.db.ProductSchema);
  AuditLog = tenant.model('AuditLog', fixture.db.AuditLogSchema);
  app = require('../../app').createApp({ config: require('../../config/runtime').readRuntimeConfig() });
});
beforeEach(async () => {
  assert.ok(tenant.name.startsWith('tenant_stockly_test_'));
  for (const name of ['Product', 'AuditLog', 'ProductIdentity', 'ProductOperation']) {
    if (tenant.models[name]) await tenant.models[name].deleteMany({});
  }
});
after(async () => { if (fixture) await fixture.stop(); });
function options(method, body, key, auth = token) {
  return { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}`, ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) };
}
const add = (request, quantity, key, more = {}) => request('/api/products', options('POST', { name: 'Charger', quantity, buyPrice: 0.1, ...more }, key));

test('simultaneous additions preserve both effects on a legacy product', async () => {
  const item = await Product.create({ name: 'Charger', quantity: 5, shop: 'A', buyPrice: 0.1 });
  await withApp(app, async request => {
    const replies = await Promise.all([add(request, 4, 'concurrent-add-one'), add(request, 4, 'concurrent-add-two')]);
    assert.deepEqual(replies.map(r => r.status), [200, 200]);
    assert.equal((await Product.findById(item.id)).quantity, 13);
    assert.equal(await AuditLog.countDocuments({ action: 'product_receive' }), 2);
  });
});
for (const initial of [5, 8]) test(`concurrent withdrawals conserve ${initial} units and never go negative`, async () => {
  const item = await Product.create({ name: 'Charger', quantity: initial, shop: 'A', buyPrice: 0.1 });
  await withApp(app, async request => {
    const replies = await Promise.all([1, 2].map(i => request(`/api/products/${item.id}`, options('PUT', { adjustment: -4 }, `withdrawal-${initial}-${i}`))));
    assert.deepEqual(replies.map(r => r.status).sort(), initial === 5 ? [200, 409] : [200, 200]);
    assert.equal((await Product.findById(item.id)).quantity, initial === 5 ? 1 : 0);
    assert.equal(await AuditLog.countDocuments({ action: 'product_adjust' }), initial === 5 ? 1 : 2);
  });
});
test('canonical concurrent first additions create one product and keep both receipts', async () => {
  await withApp(app, async request => {
    const replies = await Promise.all([add(request, 4, 'canonical-first-one', { name: ' USB   Charger ' }), add(request, 4, 'canonical-first-two', { name: 'usb charger' })]);
    assert.deepEqual(replies.map(r => r.status), [200, 200]);
    assert.equal(await Product.countDocuments(), 1);
    assert.equal((await Product.findOne()).quantity, 8);
  });
});
test('request retries replay once and conflicting intent cannot reuse a key', async () => {
  await withApp(app, async request => {
    const responses = await Promise.all([add(request, 2, 'product-repeat-key'), add(request, 2, 'product-repeat-key')]);
    assert.deepEqual(responses.map(r => r.status), [200, 200]);
    assert.deepEqual(await responses[0].json(), await responses[1].json());
    assert.equal((await Product.findOne()).quantity, 2);
    assert.equal((await add(request, 3, 'product-repeat-key')).status, 409);
    assert.equal(await AuditLog.countDocuments(), 1);
  });
});
test('stale absolute edits and unversioned edits cannot erase a newer addition', async () => {
  const item = await Product.create({ name: 'Charger', quantity: 5, shop: 'A', buyPrice: 0.1 });
  await withApp(app, async request => {
    assert.equal((await add(request, 3, 'after-editor-open')).status, 200);
    for (const body of [{ quantity: 1 }, { quantity: 1, expectedRevision: 0 }]) {
      assert.equal((await request(`/api/products/${item.id}`, options('PUT', body))).status, 409);
    }
    assert.equal((await Product.findById(item.id)).quantity, 8);
    const current = await Product.findById(item.id);
    const accepted = await request(`/api/products/${item.id}`, options('PUT', { quantity: 7, expectedRevision: current.revision }, 'fresh-absolute-edit'));
    assert.equal(accepted.status, 200);
    assert.equal((await Product.findById(item.id)).quantity, 7);
  });
});
test('invalid quantities and imprecise prices fail before writes', async () => {
  await withApp(app, async request => {
    for (const quantity of [-1, 1.5, '1.5', '3garbage', true, null, 9007199254740992]) assert.equal((await add(request, quantity)).status, 400, String(quantity));
    assert.equal((await add(request, 1, undefined, { buyPrice: 0.123 })).status, 400);
    assert.equal(await Product.countDocuments(), 0);
  });
});
test('differing unit costs do not silently replace existing purchase costs', async () => {
  await withApp(app, async request => {
    assert.equal((await add(request, 2, 'cost-first')).status, 200);
    assert.equal((await add(request, 3, 'cost-conflict', { buyPrice: 0.2 })).status, 409);
    assert.equal((await Product.findOne()).buyPrice, 0.1);
    assert.equal((await Product.findOne()).quantity, 2);
    const item = await Product.findOne();
    assert.equal((await request(`/api/products/${item.id}`, options('PUT', { buyPrice: 0.2, expectedRevision: item.revision }))).status, 409);
  });
});
test('ambiguous legacy identities fail closed without merging or deleting either row', async () => {
  await Product.create([{ name: ' USB Charger', quantity: 2, shop: 'A' }, { name: 'usb   charger ', quantity: 3, shop: 'A' }]);
  await withApp(app, async request => {
    assert.equal((await add(request, 4, 'ambiguous-product', { name: 'USB Charger' })).status, 409);
    assert.equal(await Product.countDocuments(), 2);
    assert.equal((await Product.find()).reduce((s, p) => s + p.quantity, 0), 5);
  });
});
test('audit failure rolls back product, quantity and request receipt', async () => {
  const original = AuditLog.create;
  AuditLog.create = async () => { throw Error('injected product audit failure'); };
  try {
    await withApp(app, async request => {
      assert.equal((await add(request, 2, 'failed-product-audit')).status, 500);
      assert.equal(await Product.countDocuments(), 0);
      if (tenant.models.ProductOperation) assert.equal(await tenant.models.ProductOperation.countDocuments(), 0);
    });
  } finally { AuditLog.create = original; }
});
test('shop credit and ownership remain fixed by authentication', async () => {
  const other = await Product.create({ name: 'Charger', quantity: 5, shop: 'B', buyPrice: 0.1 });
  await withApp(app, async request => {
    assert.equal((await add(request, 1, 'shop-owner-fixed', { shop: 'B' })).status, 200);
    for (const method of ['PUT', 'DELETE']) assert.equal((await request(`/api/products/${other.id}`, options(method, { quantity: 0, expectedRevision: 0 }))).status, 404);
    assert.equal((await Product.findById(other.id)).quantity, 5);
    assert.equal((await Product.findOne({ shop: 'A' })).quantity, 1);
    assert.equal((await request('/api/products', options('POST', { name: 'Wrong shop', quantity: 1, shop: 'INVALID' }, undefined, admin))).status, 400);
  });
});
test('deletion requires a captured revision and remains retryable after re-adding the name', async () => {
  await withApp(app, async request => {
    const created = await (await add(request, 2, 'delete-create')).json();
    const id = created.product._id;
    await add(request, 1, 'delete-later-add');
    assert.equal((await request(`/api/products/${id}`, options('DELETE', { expectedRevision: 0 }))).status, 409);
    const revision = (await Product.findById(id)).revision;
    const deletion = options('DELETE', { expectedRevision: revision }, 'captured-delete');
    const first = await request(`/api/products/${id}`, deletion);
    assert.equal(first.status, 200);
    await add(request, 4, 'new-product-after-delete');
    const retry = await request(`/api/products/${id}`, deletion);
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), await first.json());
    assert.equal((await Product.findOne()).quantity, 4);
  });
});

test('an absolute edit racing an addition either conflicts or preserves the later increment', async () => {
  const item = await Product.create({ name: 'Charger', quantity: 5, shop: 'A', buyPrice: 0.1 });
  await withApp(app, async request => {
    const [edit, addition] = await Promise.all([
      request(`/api/products/${item.id}`, options('PUT', { quantity: 7, expectedRevision: 0 }, 'racing-editor')),
      add(request, 3, 'racing-addition'),
    ]);
    assert.equal(addition.status, 200);
    assert.ok([200, 409].includes(edit.status));
    assert.equal((await Product.findById(item.id)).quantity, edit.status === 200 ? 10 : 8);
  });
});

test('product audit records the exact accepted movement before and after', async () => {
  await withApp(app, async request => {
    await add(request, 2, 'audit-inbound-one');
    await add(request, 3, 'audit-inbound-two');
    const audit = await AuditLog.findOne({ 'details.operationId': 'audit-inbound-two' });
    assert.equal(audit.details.quantityBefore, 2);
    assert.equal(audit.details.quantityAfter, 5);
    assert.equal(audit.details.adjustment, 3);
  });
});

test('invalid stored replay outcomes fail closed instead of acknowledging arbitrary data', async () => {
  await withApp(app, async request => {
    await add(request, 2, 'corrupt-product-receipt');
    await tenant.model('ProductOperation').updateOne({ _id: 'corrupt-product-receipt' }, { $set: { result: {} } });
    const reply = await add(request, 2, 'corrupt-product-receipt');
    assert.equal(reply.status, 409);
    assert.equal((await Product.findOne()).quantity, 2);
  });
});
