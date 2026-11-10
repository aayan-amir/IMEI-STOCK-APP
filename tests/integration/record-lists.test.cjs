const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestDatabase } = require('../helpers/database.cjs');
const { withApp } = require('../helpers/http.cjs');
let fixture, app, models, admin, staff;
before(async () => {
  fixture = await startTestDatabase(); const client = await fixture.db.Client.create({ clientId: fixture.namespace, adminPassword: 'test', gatePassword: 'test', shops: [{ id: 'A' }, { id: 'B' }] });
  const create = require('../../middleware/auth').createSession;
  admin = await create({ clientId: client.clientId, role: 'admin', validShops: ['A', 'B'], authVersion: client.authVersion });
  staff = await create({ clientId: client.clientId, role: 'shop', shop: 'A', validShops: ['A', 'B'], authVersion: client.authVersion });
  const connection = fixture.db.getTenantDb(client.clientId); assert.ok(connection.name.startsWith('tenant_stockly_test_'));
  models = Object.fromEntries([['days', 'Day'], ['reports', 'Report'], ['logs', 'AuditLog']].map(([key, name]) => [key, connection.model(name, fixture.db[`${name}Schema`])]));
  app = require('../../app').createApp({ config: require('../../config/runtime').readRuntimeConfig() });
});
beforeEach(async () => { for (const Model of Object.values(models)) await Model.deleteMany({}); });
after(async () => { if (fixture) await fixture.stop(); });
const options = token => ({ headers: { Authorization: `Bearer ${token || admin}` } });
async function get(request, path) { const response = await request(path, options()); assert.equal(response.status, 200, await response.clone().text()); return response.json(); }
const defaults = { days: { shop: 'A', date: '2026-11-09', cats: { EXTRA: { rows: [] } } }, reports: { type: 'daily', shop: 'A', period: '2026-11-09', data: { totalSales: 0.3 }, history: [{ generatedAt: 'earlier', data: { totalSales: 0.2 } }] }, logs: { shop: 'A', action: 'day_save', ts: '2026-11-09T00:00:00.000Z', details: { reason: 'retain' } } };
const seed = (resource, count, extra = {}) => models[resource].insertMany(Array.from({ length: count }, () => ({ ...defaults[resource], ...extra })));
test('history, reports and audit logs have stable bounded pages with unchanged legacy array shapes', async () => {
  await withApp(app, async request => {
    for (const resource of Object.keys(models)) {
      await seed(resource, 7); let cursor = '', ids = [];
      do { const page = await get(request, `/api/v2/${resource}?limit=2${cursor ? '&cursor=' + cursor : ''}`); assert.equal(page.total, 7); assert.ok(page.items.length <= 2); ids.push(...page.items.map(row => row.id)); cursor = page.nextCursor; } while (cursor);
      assert.equal(new Set(ids).size, 7); assert.ok(Array.isArray(await get(request, `/api/${resource}`)));
      assert.equal((await request(`/api/v2/${resource}`, options(staff))).status, 403);
    }
  });
});
test('record filters precede pages and scoped cursors cannot cross resources or filters', async () => {
  await seed('days', 3); await seed('days', 1, { date: '2026-10-09', shop: 'B' });
  await seed('reports', 2); await seed('reports', 1, { type: 'monthly', period: '2026-11', shop: 'ALL' });
  await seed('logs', 2); await seed('logs', 1, { action: 'day_close', ts: '2026-11-10T00:00:00.000Z' });
  await withApp(app, async request => {
    const days = await get(request, '/api/v2/days?month=2026-11&status=open&limit=1'); assert.equal(days.total, 3);
    assert.equal((await get(request, '/api/v2/reports?type=monthly&month=2026-11&shop=ALL')).total, 1);
    assert.equal((await get(request, '/api/v2/logs?action=day_close&from=2026-11-10&to=2026-11-10')).total, 1);
    assert.equal((await request(`/api/v2/days?shop=B&cursor=${days.nextCursor}`, options())).status, 400);
    assert.equal((await request(`/api/v2/reports?cursor=${days.nextCursor}`, options())).status, 400);
  });
});
test('complete record exports retain report history and audit details without mutating stored records', async () => {
  await withApp(app, async request => {
    for (const resource of Object.keys(models)) {
      const original = await seed(resource, 65);
      const exported = await get(request, `/api/v2/${resource}/export`); assert.equal(exported.complete, true); assert.equal(exported.items.length, 65);
      if (resource === 'reports') assert.equal(exported.items[0].history[0].data.totalSales, 0.2);
      if (resource === 'logs') assert.equal(exported.items[0].details.reason, 'retain');
      assert.equal(await models[resource].countDocuments(), original.length);
    }
  });
});
test('history index uses retained closed totals and omits draft financial rows', async () => {
  await seed('days', 1, { cats: { EXTRA: { rows: [{ soldFor: 999 }] } } });
  await withApp(app, async request => {
    const page = await get(request, '/api/v2/days'); assert.equal(page.items[0].status, 'open'); assert.equal('cats' in page.items[0], false);
    const [closed] = await seed('days', 1, { status: 'closed', revision: 2, closedSnapshot: { revision: 2, ruleVersion: 1, financial: { revenue: 0.3, expenses: 0.1, netProfit: 0.2, units: 1 } } });
    const index = await get(request, '/api/v2/days?status=closed'); assert.equal(index.items[0].closedSnapshot.financial.netProfit, 0.2);
    await models.days.updateOne({ _id: closed._id }, { 'closedSnapshot.financial.netProfit': 0.201 });
    assert.equal((await request('/api/v2/days?status=closed', options())).status, 409);
  });
});
test('invalid record filters and oversized automatic exports fail explicitly', async () => {
  await withApp(app, async request => {
    for (const resource of Object.keys(models)) for (const query of ['limit=101', 'shop=missing', 'cursor=bad', 'shop[]=A']) assert.equal((await request(`/api/v2/${resource}?${query}`, options())).status, 400);
    for (const [resource, query] of [['days', 'month=2026-13'], ['days', 'status=bad'], ['reports', 'type=bad'], ['logs', 'from=2026-02-30'], ['logs', 'action[]=day_save']]) assert.equal((await request(`/api/v2/${resource}?${query}`, options())).status, 400);
    await seed('logs', 5001); assert.equal((await request('/api/v2/logs/export', options())).status, 413);
  });
});
test('metadata history pages stay available when omitted saved rows exceed the reply size bound', async () => {
  await seed('days', 5, { cats: { EXTRA: { rows: [{ name: 'x'.repeat(1800000), soldFor: 0 }] } } });
  await withApp(app, async request => {
    const index = await get(request, '/api/v2/days'); assert.equal(index.items.length, 5); assert.equal('cats' in index.items[0], false);
    assert.equal((await request('/api/v2/days/export', options())).status, 413);
  });
});
