const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestDatabase } = require('../helpers/database.cjs');
const { withApp } = require('../helpers/http.cjs');
const { businessDate } = require('../../public/js/business-rules');

let fixture, app, models, adminToken, shopToken, tenant;
let counter = 300000000000000;
before(async () => {
  fixture = await startTestDatabase();
  const db = fixture.db;
  const client = await db.Client.create({ clientId: fixture.namespace, adminPassword: 'admin-test', gatePassword: 'shop-test', shops: [{ id: 'A' }, { id: 'B' }] });
  const createSession = require('../../middleware/auth').createSession;
  adminToken = await createSession({ clientId: client.clientId, role: 'admin', validShops: ['A', 'B'], authVersion: client.authVersion });
  shopToken = await createSession({ clientId: client.clientId, role: 'shop', shop: 'A', validShops: ['A', 'B'], authVersion: client.authVersion });
  tenant = db.getTenantDb(client.clientId);
  models = {};
  for (const name of ['Phone', 'Sale', 'AuditLog', 'StockOperation', 'InventoryIdentity', 'InventoryOperation', 'Day', 'Report', 'ShopExpense', 'AccountingState', 'DayVersion', 'DayOperation']) models[name] = tenant.model(name, db[`${name}Schema`]);
  app = require('../../app').createApp({ config: require('../../config/runtime').readRuntimeConfig() });
});
beforeEach(async () => {
  assert.ok(tenant.name.startsWith('tenant_stockly_test_'));
  for (const model of Object.values(models)) await model.deleteMany({});
});
after(async () => { if (fixture) await fixture.stop(); });

function headers(token = adminToken) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }
async function createSale(request, { price = 200, cost = 100, key, phone } = {}) {
  const item = phone || await models.Phone.create({ imei: String(counter++), shop: 'B', status: 'in_stock', buyPrice: cost, brand: 'Test', model: 'Phone', storage: '128GB' });
  const response = await request('/api/stock/sell', { method: 'POST', headers: { ...headers(shopToken), ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify({ imei: item.imei, salePrice: price }) });
  assert.equal(response.status, 200);
  return { phone: item, sale: (await response.json()).sale };
}

test('reversal retains the sale and clears only its current phone sale state', async () => {
  await withApp(app, async request => {
    const { phone, sale } = await createSale(request);
    assert.equal(sale.storage, '128GB');
    const response = await request(`/api/sales/${sale._id}`, { method: 'DELETE', headers: headers() });
    assert.equal(response.status, 200);
    const retained = await models.Sale.findById(sale._id);
    assert.ok(retained, 'original sale must remain');
    assert.ok(retained.reversedAt);
    assert.equal(retained.salePrice, 200);
    const returned = await models.Phone.findById(phone.id);
    assert.equal(returned.status, 'in_stock');
    for (const field of ['salePrice', 'soldAt', 'soldByShop', 'currentSaleId']) assert.equal(returned[field], undefined, field);
    assert.equal(await models.AuditLog.countDocuments({ action: 'sale_reverse' }), 1);
  });
});

test('retrying an earlier reversal cannot undo a later resale', async () => {
  await withApp(app, async request => {
    const first = await createSale(request);
    assert.equal((await request(`/api/sales/${first.sale._id}`, { method: 'DELETE', headers: headers() })).status, 200);
    const second = await createSale(request, { phone: first.phone, price: 250 });
    assert.equal((await request(`/api/sales/${first.sale._id}`, { method: 'DELETE', headers: headers() })).status, 200);
    const current = await models.Phone.findById(first.phone.id);
    assert.equal(current.status, 'sold');
    assert.equal(String(current.currentSaleId), second.sale._id);
    assert.equal(current.salePrice, 250);
    assert.equal(await models.Sale.countDocuments(), 2);
    assert.equal(await models.AuditLog.countDocuments({ action: 'sale_reverse' }), 1);
  });
});

test('reversal audit failure aborts both financial and physical changes', async () => {
  await withApp(app, async request => {
    const { phone, sale } = await createSale(request);
    const original = models.AuditLog.create;
    models.AuditLog.create = async () => { throw Error('injected reversal audit failure'); };
    try {
      assert.equal((await request(`/api/sales/${sale._id}`, { method: 'DELETE', headers: headers() })).status, 500);
      assert.equal((await models.Phone.findById(phone.id)).status, 'sold');
      assert.equal((await models.Sale.findById(sale._id)).reversedAt, undefined);
    } finally { models.AuditLog.create = original; }
  });
});

test('concurrent reversals have one correction and one durable audit entry', async () => {
  await withApp(app, async request => {
    const { sale } = await createSale(request);
    const replies = await Promise.all([1, 2].map(() => request(`/api/sales/${sale._id}`, { method: 'DELETE', headers: headers() })));
    assert.deepEqual(replies.map(reply => reply.status), [200, 200]);
    assert.deepEqual(await replies[0].json(), await replies[1].json());
    assert.equal(await models.AuditLog.countDocuments({ action: 'sale_reverse' }), 1);
    assert.equal(await models.Sale.countDocuments(), 1);
  });
});

test('blind IMEI and unbounded clear requests cannot reverse unseen sales', async () => {
  await withApp(app, async request => {
    const { phone } = await createSale(request);
    assert.equal((await request(`/api/sales/by-imei/${phone.imei}`, { method: 'DELETE', headers: headers() })).status, 409);
    assert.equal((await request('/api/sales', { method: 'DELETE', headers: headers() })).status, 409);
    assert.equal((await models.Phone.findById(phone.id)).status, 'sold');
  });
});

test('bulk retry targets captured IDs and leaves a new resale untouched', async () => {
  await withApp(app, async request => {
    const first = await createSale(request);
    const second = await createSale(request);
    const options = { method: 'DELETE', headers: headers(), body: JSON.stringify({ saleIds: [first.sale._id, second.sale._id] }) };
    assert.equal((await request('/api/sales', options)).status, 200);
    const resale = await createSale(request, { phone: first.phone, price: 250 });
    assert.equal((await request('/api/sales', options)).status, 200);
    assert.equal(String((await models.Phone.findById(first.phone.id)).currentSaleId), resale.sale._id);
    assert.equal(await models.Sale.countDocuments(), 3);
    assert.equal(await models.AuditLog.countDocuments({ action: 'sale_reverse' }), 2);
  });
});

test('sold stock cannot bypass retained history through phone deletion', async () => {
  await withApp(app, async request => {
    const { phone, sale } = await createSale(request);
    assert.equal((await request(`/api/stock/${phone.id}`, { method: 'DELETE', headers: headers() })).status, 409);
    assert.ok(await models.Sale.findById(sale._id));
    assert.ok(await models.Phone.findById(phone.id));
  });
});

test('legacy reversal refuses an ambiguous current phone snapshot', async () => {
  const phone = await models.Phone.create({ imei: String(counter++), status: 'sold', shop: 'A', salePrice: 300, soldAt: '2026-11-01T10:00:00.000Z', buyPrice: 100 });
  const sale = await models.Sale.create({ imei: phone.imei, shop: 'A', salePrice: 200, buyPrice: 100, profit: 100, soldAt: '2026-10-31T10:00:00.000Z' });
  await withApp(app, async request => assert.equal((await request(`/api/sales/${sale.id}`, { method: 'DELETE', headers: headers() })).status, 409));
  assert.equal((await models.Phone.findById(phone.id)).salePrice, 300);
  assert.ok(await models.Sale.findById(sale.id));
});

test('dated corrections keep prior reports stable and cross-shop net totals exact', async () => {
  await withApp(app, async request => {
    const { phone, sale } = await createSale(request, { price: 0.3, cost: 0.1 });
    const soldAt = '2026-10-31T20:00:00.000Z';
    await models.Sale.updateOne({ _id: sale._id }, { $set: { soldAt, businessDate: '2026-11-01' } });
    await models.Phone.updateOne({ _id: phone.id }, { $set: { soldAt } });
    const report = async (period, shop = 'A') => {
      const response = await request('/api/reports/generate', { method: 'POST', headers: headers(), body: JSON.stringify({ type: 'daily', shop, period }) });
      assert.equal(response.status, 200);
      return (await response.json()).report.data;
    };
    const before = await report('2026-11-01');
    assert.equal(before.totalSales, 0.3);
    const { reverseSales } = require('../../services/sale-reversals');
    const correctionInstant = new Date(), correctionDate = businessDate(correctionInstant);
    await reverseSales({ connection: tenant, models, actor: { role: 'admin' }, saleIds: [sale._id], now: correctionInstant });
    assert.deepEqual(await report('2026-11-01'), before);
    const correction = await report(correctionDate);
    assert.equal(correction.totalSales, -0.3);
    assert.equal(correction.grossProfit, -0.2);
    assert.equal(correction.unitsSold, -1);
    assert.equal((await report(correctionDate, 'B')).totalSales, 0);
    const events = await (await request(`/api/sales?ledger=true&date=${correctionDate}`, { headers: headers() })).json();
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'reversal');
    const stats = await (await request('/api/stats?shop=A', { headers: headers() })).json();
    assert.equal(stats.totalRevenue, 0);
    assert.equal(stats.salesCount, 0);
  });
});

test('all-shop reports include expenses and reject impossible dates', async () => {
  await models.Day.create([{ shop: 'A', date: '2026-11-09', expenses: [{ amt: 0.1 }] }, { shop: 'B', date: '2026-11-09', expenses: [{ amt: 0.2 }] }]);
  await withApp(app, async request => {
    const options = period => ({ method: 'POST', headers: headers(), body: JSON.stringify({ type: 'daily', shop: 'ALL', period }) });
    const report = await (await request('/api/reports/generate', options('2026-11-09'))).json();
    assert.equal(report.report.data.expenses, 0.3);
    assert.equal(report.report.data.netProfit, -0.3);
    assert.equal((await request('/api/reports/generate', options('2026-02-30'))).status, 400);
  });
});

test('CEO monthly comparison uses real Karachi months and net event units', async () => {
  await models.Sale.create({ imei: String(counter++), shop: 'B', soldByShop: 'A', buyPrice: 0.1, salePrice: 0.3, profit: 0.2,
    soldAt: '2026-10-31T20:00:00.000Z', reversedAt: '2026-11-08T20:00:00.000Z', reversalId: 'old-return' });
  await models.Sale.create({ imei: String(counter++), shop: 'A', buyPrice: 0.1, salePrice: 0.2, profit: 0.1, soldAt: '2026-10-15T10:00:00.000Z' });
  await withApp(app, async request => {
    const data = await (await request('/api/ceo/summary?month=2026-11', { headers: headers() })).json();
    assert.equal(data.prevMonth, '2026-10');
    assert.equal(data.prev.revenue, 0.2);
    assert.equal(data.current.revenue, 0);
    assert.equal(data.current.units, 0);
    assert.equal(data.shopStats.A.units, 0);
    const invalid = await request('/api/ceo/summary?month=2026-13', { headers: headers() });
    assert.equal(invalid.status, 400);
  });
});

test('backup exports retained history and legacy merge restore fails closed before writes', async () => {
  await withApp(app, async request => {
    const { sale } = await createSale(request, { key: 'retained-backup-key' });
    const oldBackup = await (await request('/api/backup', { headers: headers() })).json();
    assert.equal((await request(`/api/sales/${sale._id}`, { method: 'DELETE', headers: headers() })).status, 200);
    const retained = await (await request('/api/backup', { headers: headers() })).json();
    assert.ok(retained.sales[0].reversalId);
    assert.equal(retained.stockOperations[0].sale.reversedAt, undefined);
    const restore = await request('/api/restore', { method: 'POST', headers: headers(), body: JSON.stringify(oldBackup) });
    assert.equal(restore.status, 409);
    assert.equal((await models.Phone.findOne({ imei: sale.imei })).status, 'in_stock');
    assert.ok((await models.Sale.findById(sale._id)).reversedAt);
    await models.Phone.deleteMany({});
    await models.Sale.deleteMany({});
    const importing = await request('/api/restore', { method: 'POST', headers: headers(), body: JSON.stringify(retained) });
    assert.equal(importing.status, 409);
    assert.equal(await models.Phone.countDocuments(), 0);
  });
});

test('a later restore write failure rolls back earlier phone and sale writes', async () => {
  const imei = String(counter++);
  const Expense = tenant.model('ShopExpense', fixture.db.ShopExpenseSchema);
  const original = Expense.insertMany;
  Expense.insertMany = async () => { throw Error('injected restore write failure'); };
  try {
    await withApp(app, async request => {
      const response = await request('/api/restore', { method: 'POST', headers: headers(), body: JSON.stringify({
        phones: [{ imei, status: 'in_stock', shop: 'A' }],
        sales: [{ imei, soldAt: '2026-11-09T00:00:00.000Z', salePrice: 2, buyPrice: 1, profit: 1 }],
        expenses: [{ shop: 'A', amount: 1 }],
      }) });
      assert.equal(response.status, 500);
      assert.equal(await models.Phone.countDocuments(), 0);
      assert.equal(await models.Sale.countDocuments(), 0);
    });
  } finally { Expense.insertMany = original; }
});

test('retained sale receipts are read-only and omit purchase cost', async()=>{await withApp(app,async request=>{const {sale}=await createSale(request,{price:0.3,cost:0.1});const count=await models.Sale.countDocuments();const url='/api/sales/'+sale._id+'/receipt';assert.equal((await request(url)).status,401);assert.equal((await request(url,{headers:headers(shopToken)})).status,403);const first=await request(url,{headers:headers()});assert.equal(first.status,200);const receipt=await first.json();assert.equal(receipt.amountMinor,30);assert.equal(receipt.paymentMethod,'not_recorded');assert.equal('buyPrice' in receipt,false);const again=await request(url,{headers:headers()});assert.deepEqual(await again.json(),receipt);assert.equal(await models.Sale.countDocuments(),count);});});

test('capabilities advertise role-scoped reads and keep unimplemented writers disabled', async () => {
  await withApp(app, async request => {
    assert.equal((await request('/api/capabilities')).status, 401);
    for (const [token, owner] of [[adminToken, true], [shopToken, false]]) {
      const response = await request('/api/capabilities', { headers: headers(token) });
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.deepEqual(data.backupVersions, [2, 3]);
      assert.equal(data.features.imeiHistory, owner);
      assert.equal(data.features.saleReceipts, owner);
      for (const feature of ['stocktake', 'fullyPaidTender', 'customerReturns', 'verifiedCashClose']) assert.equal(data.features[feature], false);
    }
    assert.equal(await models.Phone.countDocuments(), 0);
    assert.equal(await models.Sale.countDocuments(), 0);
  });
});

test('IMEI detail history is bounded, read-only and restricted to owner administration',async()=>{await withApp(app,async request=>{const {phone,sale}=await createSale(request,{price:0.3,cost:0.1});const url='/api/stock/'+phone.imei+'/history/sales';assert.equal((await request(url,{headers:headers(shopToken)})).status,403);const response=await request(url,{headers:headers()});assert.equal(response.status,200);const data=await response.json();assert.equal(data.items.length,1);assert.equal(data.items[0].events[0]._id,sale._id);assert.equal(data.items[0].events[0].salePriceMinor,30);assert.equal(await models.Sale.countDocuments(),1);assert.equal((await request('/api/stock/not-an-imei/history/sales',{headers:headers()})).status,400);});});


test('administrative reversal retries refresh occurrence before publishing a correction across a cash boundary', async () => {
  await withApp(app, async request => {
    const { sale } = await createSale(request);
    const create = models.AuditLog.create; let firstAt, injected = false;
    models.AuditLog.create = async function(rows, options) {
      const audit = rows.find(row => row.action === 'sale_reverse');
      if (audit && !injected) {
        injected = true; firstAt = audit.details.reversedAt;
        await new Promise(resolve => setTimeout(resolve, 20));
        throw new fixture.db.mongoose.mongo.MongoServerError({ message: 'simulated correction retry', errorLabels: ['TransientTransactionError'] });
      }
      return create.call(this, rows, options);
    };
    try {
      const result = await require('../../services/sale-reversals').reverseSales({ connection: tenant, models, actor: { role: 'admin' }, saleIds: [String(sale._id)] });
      assert.ok(injected); assert.ok(result.reversals[0].reversedAt > firstAt);
    } finally { models.AuditLog.create = create; }
  });
});
