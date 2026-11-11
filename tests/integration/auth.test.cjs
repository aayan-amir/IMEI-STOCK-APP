const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestDatabase } = require('../helpers/database.cjs');
const { withApp } = require('../helpers/http.cjs');

let fixture;
let app;
let client;
let createSession;
before(async () => {
  process.env.SUPER_ADMIN_PASSWORD = 'isolated-platform-secret';
  fixture = await startTestDatabase();
  const { readRuntimeConfig } = require('../../config/runtime');
  app = require('../../app').createApp({ config: readRuntimeConfig() });
  ({ createSession } = require('../../middleware/auth'));
  client = await fixture.db.Client.create({ clientId: fixture.namespace, adminPassword: 'admin-test', gatePassword: 'gate-test', shops: [{ id: 'A' }, { id: 'B' }] });
});
after(async () => { if (fixture) await fixture.stop(); });

function headers(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }
async function shopToken(shop = 'A') {
  return createSession({ clientId: client.clientId, role: 'shop', shop, validShops: ['A', 'B'], authVersion: client.authVersion });
}

test('tenant model registration uses the recovery catalogue and preserves the warehouse alias without exposing access controls', async () => {
  const auth = require('../../middleware/auth'), probe = require('express')();
  probe.use(auth.tenantMiddleware);
  probe.get('/probe', auth.anyAuth, (req, res) => res.json({ names: Object.keys(req.models).sort(), warehouseAlias: req.models.HQStockModel === req.models.HQStock }));
  const token = await createSession({ clientId: client.clientId, role: 'admin', validShops: ['A', 'B'], authVersion: client.authVersion });
  await withApp(probe, async request => {
    const response = await request('/probe', { headers: headers(token) }); assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.names, [...require('../../services/backup-validation').allCollectionNames, 'HQStockModel'].sort());
    assert.equal(data.warehouseAlias, true);
    assert.equal(data.names.some(name => /Session|Client|Recovery/.test(name)), false);
  });
});

test('wrong credentials fail with 401 rather than successful HTTP status', async () => {
  await withApp(app, async request => {
    for (const type of ['gate', 'admin', 'shop']) {
      const response = await request('/api/auth', { method: 'POST', headers: headers(''), body: JSON.stringify({ clientId: client.clientId, type, shop: 'A', password: 'incorrect' }) });
      assert.equal(response.status, 401);
      assert.equal((await response.json()).ok, false);
    }
  });
});

test('shop cannot update or delete a product belonging to another shop', async () => {
  const tenant = fixture.db.getTenantDb(client.clientId);
  const Product = tenant.model('Product', fixture.db.ProductSchema);
  const other = await Product.create({ shop: 'B', name: 'Other shop charger', quantity: 5 });
  const token = await shopToken();
  await withApp(app, async request => {
    const update = await request(`/api/products/${other.id}`, { method: 'PUT', headers: headers(token), body: JSON.stringify({ quantity: 99 }) });
    assert.equal(update.status, 404);
    const remove = await request(`/api/products/${other.id}`, { method: 'DELETE', headers: headers(token) });
    assert.equal(remove.status, 404);
    assert.equal((await Product.findById(other.id)).quantity, 5);
  });
});

test('paused clients and removed shops invalidate already issued sessions', async () => {
  const token = await shopToken();
  const persisted = await fixture.db.Client.findById(client.id);
  persisted.status = 'paused';
  await persisted.save();
  await withApp(app, async request => assert.equal((await request('/api/products', { headers: headers(token) })).status, 401));
  persisted.status = 'active';
  await persisted.save();
  await withApp(app, async request => assert.equal((await request('/api/products', { headers: headers(token) })).status, 401, 'reactivation must not resurrect revoked token'));
  client = persisted;
  const nextToken = await shopToken();
  persisted.shops = [{ id: 'B' }];
  await persisted.save();
  await withApp(app, async request => assert.equal((await request('/api/products', { headers: headers(nextToken) })).status, 401));
  persisted.shops = [{ id: 'A' }, { id: 'B' }];
  await persisted.save();
  client = persisted;
});

test('logout revokes the bearer token on the server', async () => {
  const token = await shopToken();
  await withApp(app, async request => {
    const response = await request('/api/auth/logout', { method: 'POST', headers: headers(token) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).success, true);
    assert.equal((await request('/api/products', { headers: headers(token) })).status, 401);
  });
});

test('editing credentials invalidates a session created from a stale client snapshot', async () => {
  const staleVersion = client.authVersion;
  client.gatePassword = 'new-gate-test';
  await client.save();
  const token = await createSession({ clientId: client.clientId, role: 'shop', shop: 'A', validShops: ['A', 'B'], authVersion: staleVersion });
  await withApp(app, async request => assert.equal((await request('/api/products', { headers: headers(token) })).status, 401));
});

test('shop can sell another shop phone but cannot redirect the sales credit', async () => {
  const tenant = fixture.db.getTenantDb(client.clientId);
  const Phone = tenant.model('Phone', fixture.db.PhoneSchema);
  const phone = await Phone.create({ imei: '123456789012345', shop: 'B', status: 'in_stock', buyPrice: 100, brand: 'Test', model: 'Cross-shop' });
  const token = await shopToken('A');
  await withApp(app, async request => {
    const response = await request('/api/stock/sell', { method: 'POST', headers: headers(token), body: JSON.stringify({ imei: phone.imei, salePrice: 200, soldByShop: 'B' }) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.sale.shop, 'B');
    assert.equal(result.sale.soldByShop, 'A');
    assert.equal(result.sale.profit, 100);
    const updated = await Phone.findById(phone.id);
    assert.equal(updated.shop, 'B');
    assert.equal(updated.soldByShop, 'A');
  });
});

test('successful login still issues usable admin and shop sessions', async () => {
  await withApp(app, async request => {
    for (const [type, password] of [['admin', 'admin-test'], ['shop', 'new-gate-test']]) {
      const login = await request('/api/auth', { method: 'POST', headers: headers(''), body: JSON.stringify({ clientId: client.clientId, type, password, shop: 'A' }) });
      assert.equal(login.status, 200);
      const data = await login.json();
      assert.equal(data.ok, true);
      assert.equal(data.role, type);
      assert.equal((await request('/api/products', { headers: headers(data.token) })).status, 200);
    }
  });
});

test('day API rejects a payload belonging to a different shop or date', async () => {
  const token = await createSession({ clientId: client.clientId, role: 'admin', validShops: ['A', 'B'], authVersion: client.authVersion });
  await withApp(app, async request => {
    const response = await request('/api/days/B/2026-11-09', {
      method: 'PUT', headers: headers(token),
      body: JSON.stringify({ shop: 'A', date: '2026-11-08', expenses: [{ amt: 100 }] }),
    });
    assert.equal(response.status, 409);
    const Day = fixture.db.getTenantDb(client.clientId).model('Day', fixture.db.DaySchema);
    assert.equal(await Day.countDocuments({ shop: 'B', date: '2026-11-09' }), 0);
  });
});

test('platform client management preserves passwords, revokes sessions and rejects stale status changes', async () => {
  const clientId = fixture.namespace + '_platform';
  const bodyHeaders = { 'Content-Type': 'application/json' };
  await withApp(app, async request => {
    const write = (path, body) => request('/api/superadmin' + path, { method: 'POST', headers: bodyHeaders, body: JSON.stringify({ ...body, superAdminPassword: 'isolated-platform-secret' }) });
    assert.equal((await write('/verify', {})).status, 200);
    assert.equal((await write('/clients', { clientId, adminPassword: 'owner-dummy', gatePassword: 'site-dummy', shops: [{ id: 'ORIGINAL_ID', name: 'Original shop', color: '#16a34a' }] })).status, 200);
    const original = await fixture.db.Client.findOne({ clientId });
    const oldVersion = original.authVersion;
    assert.equal((await write('/clients', { clientId, adminPassword: '', gatePassword: '', shops: [{ id: 'ORIGINAL_ID', name: 'Renamed shop', color: '#16a34a' }] })).status, 200);
    const updated = await fixture.db.Client.findOne({ clientId });
    assert.equal(await updated.compareAdminPassword('owner-dummy'), true);
    assert.equal(await updated.compareGatePassword('site-dummy'), true);
    assert.equal(updated.shops[0].id, 'ORIGINAL_ID');
    assert.notEqual(updated.authVersion, oldVersion);
    const token = await createSession({ clientId, role: 'admin', shop: null, authVersion: updated.authVersion });
    const list = await request('/api/superadmin/clients', { headers: { 'X-Super-Admin-Password': 'isolated-platform-secret' } });
    assert.equal(list.headers.get('cache-control'), 'no-store');
    const listed = (await list.json()).find(c => c.clientId === clientId);
    assert.ok(listed); assert.equal(listed.adminPassword, undefined); assert.equal(listed.gatePassword, undefined);
    assert.equal((await write('/clients/' + clientId + '/status', { expectedStatus: 'active', status: 'paused' })).status, 200);
    assert.equal((await request('/api/capabilities', { headers: headers(token) })).status, 401);
    assert.equal((await write('/clients/' + clientId + '/status', { expectedStatus: 'active', status: 'active' })).status, 409);
    assert.equal((await write('/clients/' + clientId + '/status', { expectedStatus: 'paused', status: 'active' })).status, 200);
    assert.equal((await request('/api/capabilities', { headers: headers(token) })).status, 401);
  });
});
