const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestDatabase } = require('../helpers/database.cjs');
const { withApp } = require('../helpers/http.cjs');
const { getModels } = require('../../services/backup-validation');
const { businessDate } = require('../../public/js/business-rules');
let fixture, app, connection, models, token, sequence = 810000000000000;
const date = () => businessDate(), month = () => date().slice(0, 7);
before(async () => {
  fixture = await startTestDatabase();
  const client = await fixture.db.Client.create({ clientId: fixture.namespace, adminPassword: 'admin-test', gatePassword: 'shop-test', shops: [{ id: 'A' }, { id: 'B' }] });
  token = await require('../../middleware/auth').createSession({ clientId: client.clientId, role: 'admin', validShops: ['A', 'B'], authVersion: client.authVersion });
  connection = fixture.db.getTenantDb(client.clientId); models = getModels(connection);
  app = require('../../app').createApp({ config: require('../../config/runtime').readRuntimeConfig() });
});
beforeEach(async () => { assert.ok(connection.name.startsWith('tenant_stockly_test_')); for (const Model of Object.values(connection.models)) await Model.deleteMany({}); });
after(async () => { if (fixture) await fixture.stop(); });
function options(method = 'GET', body) { return { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }; }
async function json(request, url, args) { const response = await request(url, args || options()); assert.equal(response.status, 200, await response.clone().text()); return response.json(); }
async function seed(request) {
  const sales = [];
  for (const cost of [0.1, 0.2]) {
    const phone = await models.Phone.create({ imei: String(sequence++), shop: 'B', status: 'in_stock', buyPrice: cost, brand: 'Test', model: 'Mixed' });
    sales.push((await json(request, '/api/stock/sell', options('POST', { imei: phone.imei, salePrice: 0.3, soldByShop: 'A' }))).sale);
  }
  for (const shop of ['A', 'B']) await json(request, `/api/days/${shop}/${date()}`, options('PUT', {
    expectedRevision: 0, cats: { EXTRA: { rows: [{ name: 'Manual income', soldFor: shop === 'A' ? 0.25 : 0.2, boughtFor: shop === 'A' ? 0.05 : 0.1 }] } },
    expenses: [{ desc: 'Daily expense', amt: shop === 'A' ? 0.02 : 0.01 }], purchases: shop === 'A' ? [{ desc: 'Purchase cash', amt: 0.04 }] : [],
    transfers: shop === 'A' ? [{ desc: 'Transfer cash', amt: 0.01 }] : [], carryForward: shop === 'A' ? 0.1 : 0,
  }));
  await models.ShopExpense.create({ shop: 'A', date: date(), month: month(), amount: 0.03, description: 'Separate shop expense' });
  return sales;
}
const summary = (request, type = 'monthly', shop = 'ALL') => json(request, `/api/financial-summary?type=${type}&period=${type === 'daily' ? date() : month()}&shop=${shop}`);
const report = async (request, type = 'monthly', shop = 'ALL') => (await json(request, '/api/reports/generate', options('POST', { type, period: type === 'daily' ? date() : month(), shop }))).report;

test('daily, monthly, ALL, CEO and generated reports reconcile extras, expenses and cash exactly', async () => {
  await withApp(app, async request => {
    await seed(request);
    const monthly = await report(request), daily = await report(request, 'daily');
    const ceo = await json(request, `/api/ceo/summary?month=${month()}`);
    for (const data of [monthly.data, daily.data]) {
      assert.equal(data.totalSales, 1.05); assert.equal(data.totalCost, 0.45); assert.equal(data.grossProfit, 0.6);
      assert.equal(data.totalExpenses, 0.06); assert.equal(data.netProfit, 0.54); assert.equal(data.cashMovement, 0.94);
    }
    const data = await summary(request);
    assert.equal(data.financial.revenue, 1.05); assert.equal(data.financial.cashOnHand, null);
    assert.equal((await summary(request, 'daily')).financial.cashOnHand, 1.04);
    assert.equal(ceo.current.revenue, 1.05); assert.equal(ceo.current.netProfit, 0.54);
    assert.equal(ceo.shopStats.A.revenue, 0.85); assert.equal(ceo.shopStats.B.revenue, 0.2);
    assert.equal(ceo.inventoryKind, 'current');
  });
});

test('closed daily values remain frozen in every aggregate after reversal, resale and raw expense drift', async () => {
  await withApp(app, async request => {
    const sales = await seed(request);
    const frozen = (await json(request, `/api/days/A/${date()}/close`, options('POST', { expectedRevision: 1 }))).day.closedSnapshot;
    await json(request, `/api/sales/${sales[0]._id}`, options('DELETE'));
    const resale = (await json(request, '/api/stock/sell', options('POST', { imei: sales[0].imei, salePrice: 0.4, soldByShop: 'A' }))).sale;
    await models.ShopExpense.create({ shop: 'A', date: date(), month: month(), amount: 99 });
    const daily = await summary(request, 'daily', 'A');
    assert.deepEqual(daily.financial, frozen.financial);
    const monthly = await summary(request);
    const sameMonth = resale.businessDate.slice(0, 7) === month();
    assert.equal(monthly.financial.revenue, sameMonth ? 1.15 : 1.05); assert.equal(monthly.financial.netProfit, sameMonth ? 0.64 : 0.54);
    const generated = await report(request);
    assert.equal(generated.data.netProfit, monthly.financial.netProfit);
    assert.equal((await json(request, `/api/ceo/summary?month=${month()}`)).current.netProfit, monthly.financial.netProfit);
  });
});

test('changed aggregate reports retain their previous figures and unchanged regeneration is stable', async () => {
  await withApp(app, async request => {
    await seed(request); const first = await report(request);
    const again = await report(request); assert.equal(again.generatedAt, first.generatedAt);
    await json(request, `/api/days/A/${date()}`, options('PUT', { expectedRevision: 1, expenses: [{ desc: 'Correction', amt: 0.12 }] }));
    const changed = await report(request);
    assert.equal(changed.history.length, 1); assert.deepEqual(changed.history[0].data, first.data);
    assert.notEqual(changed.data.netProfit, first.data.netProfit);
    assert.equal((await json(request, `/api/reports?shop=ALL&type=monthly`)).length, 1);
  });
});

test('a duplicate legacy daily sheet fails reconciliation instead of double counting', async () => {
  await models.Day.create([{ shop: 'A', date: date() }, { shop: 'A', date: date() }]);
  await withApp(app, async request => {
    assert.equal((await request(`/api/financial-summary?type=monthly&period=${month()}&shop=ALL`, options())).status, 409);
    assert.equal((await request('/api/reports/generate', options('POST', { type: 'monthly', shop: 'ALL', period: month() }))).status, 409);
  });
});
