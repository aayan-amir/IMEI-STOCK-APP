const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestDatabase } = require('../helpers/database.cjs');
const { withApp } = require('../helpers/http.cjs');
let fixture, app, models, admin, staff, other;
let sequence = 820000000000000;
before(async () => {
  fixture = await startTestDatabase();
  const { createSession } = require('../../middleware/auth');
  const client = await fixture.db.Client.create({ clientId: fixture.namespace, adminPassword: 'admin-test', gatePassword: 'shop-test', shops: [{ id: 'A' }, { id: 'B' }] });
  const base = { clientId: client.clientId, validShops: ['A', 'B'], authVersion: client.authVersion };
  admin = await createSession({ ...base, role: 'admin' }); staff = await createSession({ ...base, role: 'shop', shop: 'A' });
  const another = await fixture.db.Client.create({ clientId: `${fixture.namespace}_other`, adminPassword: 'admin-test', gatePassword: 'shop-test', shops: [{ id: 'A' }, { id: 'B' }] });
  other = await createSession({ clientId: another.clientId, validShops: ['A', 'B'], authVersion: another.authVersion, role: 'admin' });
  const connection = fixture.db.getTenantDb(client.clientId);
  assert.ok(connection.name.startsWith('tenant_stockly_test_'));
  models = { Phone: connection.model('Phone', fixture.db.PhoneSchema) };
  app = require('../../app').createApp({ config: require('../../config/runtime').readRuntimeConfig() });
});
beforeEach(async () => { await models.Phone.deleteMany({}); });
after(async () => { if (fixture) await fixture.stop(); });
const options = token => ({ headers: { Authorization: `Bearer ${token || admin}` } });
async function get(request, path, token) { const response = await request(path, options(token)); assert.equal(response.status, 200, await response.clone().text()); return response.json(); }
async function phones(count, extra = {}) { return models.Phone.insertMany(Array.from({ length: count }, () => ({ imei: String(sequence++), shop: 'A', status: 'in_stock', brand: 'Test', model: 'Equal timestamp', addedAt: '2026-11-09T00:00:00.000Z', createdAt: new Date('2026-11-09T00:00:00.000Z'), ...extra }))); }
test('new pages are bounded and stable across timestamp ties while legacy arrays remain complete', async () => {
  await phones(7);
  await withApp(app, async request => {
    let cursor = '', ids = [], pages = 0;
    do {
      const page = await get(request, `/api/v2/stock?status=all&limit=2${cursor ? '&cursor=' + cursor : ''}`);
      assert.ok(page.items.length <= 2); assert.equal(page.total, 7); assert.equal(page.hasMore, !!page.nextCursor);
      ids.push(...page.items.map(row => row.id)); cursor = page.nextCursor; pages++;
    } while (cursor);
    assert.equal(pages, 4); assert.equal(new Set(ids).size, 7);
    const legacy = await get(request, '/api/stock?all=true'); assert.ok(Array.isArray(legacy)); assert.equal(legacy.length, 7);
  });
});
test('server filters apply before paging, escape search literals and preserve seller versus owner scope', async () => {
  await phones(5); await phones(2, { shop: 'B', status: 'sold', soldByShop: 'A', model: 'Pixel [x]' });
  await withApp(app, async request => {
    const page = await get(request, '/api/v2/stock?status=sold&soldByShop=A&q=Pixel%20%5Bx%5D&from=2026-11-09&to=2026-11-09&limit=1', staff);
    assert.equal(page.total, 2); assert.equal(page.items[0].shop, 'B'); assert.equal(page.items[0].soldByShop, 'A');
    assert.equal((await request('/api/v2/stock?shop=B', options(staff))).status, 403);
    assert.equal((await get(request, '/api/v2/stock?status=all', staff)).total, 5);
    assert.equal((await get(request, '/api/v2/stock?q=.*', staff)).total, 0);
  });
});
test('cursors cannot be reused across tenant, permission or filter scopes', async () => {
  await phones(3);
  await withApp(app, async request => {
    const page = await get(request, '/api/v2/stock?shop=A&limit=1');
    for (const [filter, token] of [['shop=B', admin], ['shop=A&q=Test', admin], ['shop=A', staff], ['shop=A', other]]) {
      assert.equal((await request(`/api/v2/stock?${filter}&cursor=${page.nextCursor}`, options(token))).status, 400);
    }
  });
});
test('live traversal excludes newer normal inserts and skips deleted rows without duplicating loaded IDs', async () => {
  await phones(5);
  await withApp(app, async request => {
    const first = await get(request, '/api/v2/stock?limit=2'); const newest = await phones(1);
    const remaining = await models.Phone.find({ _id: { $lt: first.items[1].id } }).sort({ _id: -1 });
    await models.Phone.deleteOne({ _id: remaining[0]._id });
    const next = await get(request, `/api/v2/stock?limit=100&cursor=${first.nextCursor}`);
    assert.equal(next.items.length, 2);
    assert.equal(next.items.some(row => row.id === newest[0].id), false);
    assert.equal(next.items.some(row => first.items.some(old => old.id === row.id)), false);
  });
});
test('complete export uses the same filters and refuses oversized exports without partial success', async () => {
  await phones(57); await phones(2, { shop: 'B' });
  await withApp(app, async request => {
    const page = await get(request, '/api/v2/stock?shop=A&limit=2'); assert.equal(page.items.length, 2);
    const exported = await get(request, '/api/v2/stock/export?shop=A');
    assert.equal(exported.complete, true); assert.equal(exported.items.length, 57); assert.equal(exported.total, 57);
    await models.Phone.updateOne({ _id: exported.items[0]._id }, { notes: 'x'.repeat(9 * 1024 * 1024) });
    const original = models.Phone.find; let fetched = false;
    models.Phone.find = function(...args) { fetched = true; return original.apply(this, args); };
    try {
      assert.equal((await request('/api/v2/stock/export?shop=A', options())).status, 413);
      assert.equal((await request('/api/v2/stock?shop=A', options())).status, 413);
      assert.equal(fetched, false, 'oversized documents must be rejected before fetching them into Node');
    } finally { models.Phone.find = original; }
  });
});
test('invalid page and date filters fail before querying or silently widening scope', async () => {
  await withApp(app, async request => {
    for (const query of ['limit=0', 'limit=101', 'shop=unknown', 'status=broken', 'from=2026-02-30', 'from=2026-11-10&to=2026-11-09', 'q=' + 'x'.repeat(81), 'cursor=bad', 'limit[]=2']) {
      assert.equal((await request('/api/v2/stock?' + query, options())).status, 400, query);
    }
  });
});
test('new projections omit internal fields and the page payload stays bounded as inventory grows', async () => {
  const rows = await phones(600);
  await models.Phone.collection.updateOne({ _id: rows[0]._id }, { $set: { internalSecret: 'never-in-list' } });
  await withApp(app, async request => {
    const bounded = await request('/api/v2/stock?status=all', options());
    const legacy = await request('/api/stock?all=true', options());
    const pageText = await bounded.text(), legacyText = await legacy.text();
    assert.equal(JSON.parse(pageText).items.length, 50);
    assert.ok(Buffer.byteLength(pageText) < Buffer.byteLength(legacyText) / 8);
    const exported = await get(request, '/api/v2/stock/export?status=all');
    assert.equal(exported.items.some(row => 'internalSecret' in row), false);
    assert.equal(exported.items.length, 600);
  });
});
test('export record limits refuse the complete request instead of returning a capped subset', async () => {
  await phones(5001);
  await withApp(app, async request => {
    const response = await request('/api/v2/stock/export', options());
    assert.equal(response.status, 413);
    assert.equal((await response.json()).code, 'EXPORT_TOO_LARGE');
  });
});
