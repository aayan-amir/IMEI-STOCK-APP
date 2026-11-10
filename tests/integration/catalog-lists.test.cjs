const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestDatabase } = require('../helpers/database.cjs');
const { withApp } = require('../helpers/http.cjs');
let fixture, app, models, admin, staff, other;
before(async () => {
  fixture = await startTestDatabase();
  const client = await fixture.db.Client.create({ clientId: fixture.namespace, adminPassword: 'test', gatePassword: 'test', shops: [{ id: 'A' }, { id: 'B' }] });
  const create = require('../../middleware/auth').createSession;
  admin = await create({ clientId: client.clientId, role: 'admin', validShops: ['A', 'B'], authVersion: client.authVersion });
  staff = await create({ clientId: client.clientId, role: 'shop', shop: 'A', validShops: ['A', 'B'], authVersion: client.authVersion });
  const second = await fixture.db.Client.create({ clientId: `${fixture.namespace}_other`, adminPassword: 'test', gatePassword: 'test', shops: [{ id: 'A' }, { id: 'B' }] });
  other = await create({ clientId: second.clientId, role: 'admin', validShops: ['A', 'B'], authVersion: second.authVersion });
  const connection = fixture.db.getTenantDb(client.clientId); assert.ok(connection.name.startsWith('tenant_stockly_test_'));
  models = { customers: connection.model('Customer', fixture.db.CustomerSchema), products: connection.model('Product', fixture.db.ProductSchema) };
  app = require('../../app').createApp({ config: require('../../config/runtime').readRuntimeConfig() });
});
beforeEach(async () => { for (const Model of Object.values(models)) await Model.deleteMany({}); });
after(async () => { if (fixture) await fixture.stop(); });
const options = token => ({ headers: { Authorization: `Bearer ${token || admin}` } });
async function get(request, path, token) { const response = await request(path, options(token)); assert.equal(response.status, 200, await response.clone().text()); return response.json(); }
async function seed(resource, count, extra = {}) { return models[resource].insertMany(Array.from({ length: count }, () => ({ name: 'Same [name]', phone: '123', shop: 'A', quantity: 2, buyPrice: 0.1, ...extra }))); }
test('contacts and products page deterministically without truncating legacy arrays', async () => {
  await withApp(app, async request => {
    for (const resource of ['customers', 'products']) {
      await seed(resource, 7); let cursor = '', ids = [];
      do {
        const page = await get(request, `/api/v2/${resource}?limit=2${cursor ? '&cursor=' + cursor : ''}`);
        assert.equal(page.total, 7); assert.ok(page.items.length <= 2); ids.push(...page.items.map(row => row.id)); cursor = page.nextCursor;
        if (resource === 'products') assert.equal(page.items[0].revision, 0);
      } while (cursor);
      assert.equal(new Set(ids).size, 7); assert.equal((await get(request, `/api/${resource}`)).length, 7);
    }
  });
});
test('server search, product availability and shop ownership precede paging', async () => {
  await seed('customers', 2); await seed('products', 2); await seed('products', 2, { quantity: 0 }); await seed('products', 1, { shop: 'B' });
  await withApp(app, async request => {
    assert.equal((await get(request, '/api/v2/customers?q=Same%20%5Bname%5D&limit=1')).total, 2);
    assert.equal((await get(request, '/api/v2/products?availability=available&limit=1', staff)).total, 2);
    assert.equal((await get(request, '/api/v2/products?availability=empty', staff)).total, 2);
    assert.equal((await request('/api/v2/products?shop=B', options(staff))).status, 403);
    assert.equal((await request('/api/v2/customers', options(staff))).status, 403);
  });
});
test('cursors bind resource, tenant, permission, search and product shop filters', async () => {
  await seed('customers', 3); await seed('products', 3);
  await withApp(app, async request => {
    const contacts = await get(request, '/api/v2/customers?limit=1'), products = await get(request, '/api/v2/products?shop=A&limit=1');
    for (const [path, token] of [
      [`/api/v2/products?cursor=${contacts.nextCursor}`, admin], [`/api/v2/customers?q=Same&cursor=${contacts.nextCursor}`, admin],
      [`/api/v2/customers?cursor=${contacts.nextCursor}`, other], [`/api/v2/products?shop=B&cursor=${products.nextCursor}`, admin],
      [`/api/v2/products?shop=A&cursor=${products.nextCursor}`, staff],
    ]) assert.equal((await request(path, options(token))).status, 400);
  });
});
test('complete exports preserve all matches and omit unknown internal fields', async () => {
  await withApp(app, async request => {
    for (const resource of ['customers', 'products']) {
      const rows = await seed(resource, 65);
      await models[resource].collection.updateOne({ _id: rows[0]._id }, { $set: { internalSecret: 'private' } });
      const exported = await get(request, `/api/v2/${resource}/export`);
      assert.equal(exported.complete, true); assert.equal(exported.items.length, 65); assert.equal(exported.items.some(row => 'internalSecret' in row), false);
      await models[resource].updateOne({ _id: rows[0]._id }, { notes: 'x'.repeat(9 * 1024 * 1024) });
      assert.equal((await request(`/api/v2/${resource}/export`, options())).status, 413);
    }
  });
});
test('invalid limits and filter shapes fail instead of widening reads', async () => {
  await withApp(app, async request => {
    for (const resource of ['customers', 'products']) for (const query of ['limit=0', 'limit=101', 'q[]=bad', 'cursor=bad', 'q=' + 'x'.repeat(81)]) {
      assert.equal((await request(`/api/v2/${resource}?${query}`, options())).status, 400);
    }
    assert.equal((await request('/api/v2/products?availability=bad', options())).status, 400);
  });
});
