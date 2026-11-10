const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestDatabase } = require('../helpers/database.cjs');
const { withApp } = require('../helpers/http.cjs');
const { businessDate, periodBounds } = require('../../public/js/business-rules');
let fixture, app, connection, models, token;
let nextImei = 800000000000000;
const date = () => businessDate();
const nextDate = () => businessDate(new Date(periodBounds(date(), 'daily').end));
before(async () => {
  fixture = await startTestDatabase();
  const client = await fixture.db.Client.create({ clientId: fixture.namespace, adminPassword: 'admin-test', gatePassword: 'shop-test', shops: [{ id: 'A' }, { id: 'B' }] });
  token = await require('../../middleware/auth').createSession({ clientId: client.clientId, role: 'admin', validShops: ['A', 'B'], authVersion: client.authVersion });
  connection = fixture.db.getTenantDb(client.clientId);
  models = {};
  for (const name of ['Day', 'Phone', 'Sale', 'AuditLog', 'Report', 'ShopExpense']) models[name] = connection.model(name, fixture.db[`${name}Schema`]);
  app = require('../../app').createApp({ config: require('../../config/runtime').readRuntimeConfig() });
});
beforeEach(async () => {
  assert.ok(connection.name.startsWith('tenant_stockly_test_'));
  for (const Model of Object.values(connection.models)) await Model.deleteMany({});
});
after(async () => { if (fixture) await fixture.stop(); });
function options(method, body, key) {
  return { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) };
}
const draft = (revision = 0, amount = 0.1) => ({ shop: 'A', date: date(), expectedRevision: revision, cats: { EXTRA: { rows: [] } }, expenses: [{ desc: 'Test', amt: amount }], purchases: [], transfers: [], carryForward: 0 });
const save = (request, body, key) => request(`/api/days/A/${date()}`, options('PUT', body, key));
const close = (request, revision, key) => request(`/api/days/A/${date()}/close`, options('POST', { expectedRevision: revision }, key));
async function sell(request, cost = 100, price = 300) {
  const phone = await models.Phone.create({ imei: String(nextImei++), shop: 'B', status: 'in_stock', buyPrice: cost, brand: 'Test', model: 'Phone' });
  const response = await request('/api/stock/sell', options('POST', { imei: phone.imei, salePrice: price, soldByShop: 'A' }));
  assert.equal(response.status, 200);
  return (await response.json()).sale;
}
test('simultaneous first saves accept one revision without duplicate days', async () => {
  await withApp(app, async request => {
    const responses = await Promise.all([save(request, draft(0, 0.1)), save(request, draft(0, 0.2))]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    assert.equal(await models.Day.countDocuments(), 1);
    assert.equal((await models.Day.findOne()).revision, 1);
  });
});
test('stale and unversioned saves do not overwrite accepted values', async () => {
  await withApp(app, async request => {
    assert.equal((await save(request, draft())).status, 200);
    assert.equal((await save(request, draft(0, 99))).status, 409);
    const unversioned = draft(); delete unversioned.expectedRevision;
    assert.equal((await save(request, unversioned)).status, 409);
    assert.equal((await models.Day.findOne()).expenses[0].amt, 0.1);
  });
});
test('save replay returns the original result without another revision or audit', async () => {
  await withApp(app, async request => {
    const first = await save(request, draft(), 'day-save-request');
    const repeated = await save(request, draft(), 'day-save-request');
    assert.equal(repeated.status, 200);
    assert.deepEqual(await repeated.json(), await first.json());
    assert.equal((await models.Day.findOne()).revision, 1);
    assert.equal(await models.AuditLog.countDocuments({ action: 'day_save' }), 1);
  });
});
test('close captures exact sold costs, retains history and rejects blind changes', async () => {
  await withApp(app, async request => {
    await sell(request, 100, 300); await sell(request, 200, 300);
    await save(request, draft(0, 0));
    const response = await close(request, 1, 'day-close-request');
    assert.equal(response.status, 200);
    const day = (await response.json()).day;
    assert.equal(day.status, 'closed');
    assert.equal(day.closedSnapshot.financial.revenue, 600);
    assert.equal(day.closedSnapshot.financial.cost, 300);
    assert.equal(day.closedSnapshot.financial.grossProfit, 300);
    assert.equal(day.history.length, 1);
    assert.equal((await save(request, draft(day.revision, 9))).status, 409);
    assert.equal((await request(`/api/days/A/${date()}`, options('DELETE'))).status, 409);
    const replay = await close(request, 1, 'day-close-request');
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), { success: true, day });
  });
});
test('close then reverse and resell preserves the closed snapshot and posts to the next open day', async () => {
  await withApp(app, async request => {
    const original = await sell(request);
    await save(request, draft(0, 0));
    const closed = (await (await close(request, 1)).json()).day;
    assert.equal((await request(`/api/sales/${original._id}`, options('DELETE'))).status, 200);
    const resale = await request('/api/stock/sell', options('POST', { imei: original.imei, salePrice: 350, soldByShop: 'A' }));
    assert.equal(resale.status, 200);
    const stored = await models.Day.findOne();
    assert.deepEqual(JSON.parse(JSON.stringify(stored.closedSnapshot)), closed.closedSnapshot);
    const retained = await models.Sale.findById(original._id);
    assert.equal(retained.reversalBusinessDate, nextDate());
    assert.equal((await resale.json()).sale.businessDate, nextDate());
    const later = await (await request(`/api/sales?ledger=true&shop=A&date=${nextDate()}`, options('GET'))).json();
    assert.equal(later.length, 2);
    assert.equal(later.reduce((sum, row) => sum + row.salePrice, 0), 50);
    const earlier = await (await request(`/api/sales?ledger=true&shop=A&date=${date()}`, options('GET'))).json();
    assert.equal(earlier.length, 1);
    assert.equal(earlier[0].salePrice, 300);
  });
});
test('close racing a sale either captures it or routes it to the next open day', async () => {
  await withApp(app, async request => {
    await save(request, draft(0, 0));
    const [closing, sale] = await Promise.all([close(request, 1), sell(request)]);
    assert.equal(closing.status, 200);
    const day = (await closing.json()).day;
    assert.equal(day.closedSnapshot.financial.revenue + (sale.businessDate === nextDate() ? 300 : 0), 300);
  });
});
test('reopening is explicit, revision guarded, audited and retains the previous close', async () => {
  await withApp(app, async request => {
    await save(request, draft());
    const day = (await (await close(request, 1)).json()).day;
    const path = `/api/days/A/${date()}/reopen`;
    assert.equal((await request(path, options('POST', { expectedRevision: day.revision }))).status, 400);
    const response = await request(path, options('POST', { expectedRevision: day.revision, reason: 'Correct expense classification' }));
    assert.equal(response.status, 200);
    const reopened = (await response.json()).day;
    assert.equal(reopened.status, 'open');
    const history = await (await request(`/api/days/A/${date()}/history`, options('GET'))).json();
    assert.deepEqual(history[0].snapshot, day.closedSnapshot);
    assert.equal((await save(request, draft(reopened.revision, 0))).status, 200);
    assert.equal(await models.AuditLog.countDocuments({ action: 'day_reopen' }), 1);
  });
});
test('audit failure rolls back a day close and its open-period advancement', async () => {
  await withApp(app, async request => {
    await save(request, draft());
    const original = models.AuditLog.create;
    models.AuditLog.create = async () => { throw Error('injected day audit failure'); };
    try { assert.equal((await close(request, 1)).status, 500); }
    finally { models.AuditLog.create = original; }
    assert.equal((await models.Day.findOne()).status, 'open');
    assert.equal((await close(request, 1)).status, 200);
  });
});
test('invalid dates, ambiguous legacy days, quantities and amounts are rejected', async () => {
  await withApp(app, async request => {
    assert.equal((await request('/api/days/A/2026-02-30', options('PUT', { ...draft(), date: '2026-02-30' }))).status, 400);
    assert.equal((await save(request, draft(0, 0.123))).status, 400);
    assert.equal((await save(request, { ...draft(), carryForward: 'garbage' })).status, 400);
    await models.Day.create([{ shop: 'A', date: date() }, { shop: 'A', date: date() }]);
    assert.equal((await save(request, draft())).status, 409);
    assert.equal(await models.Day.countDocuments(), 2);
  });
});

test('closed day reports stay fixed and closed-period expenses cannot change them', async () => {
  await withApp(app, async request => {
    await sell(request, 100, 300); await save(request, draft(0, 0.1));
    const closed = (await (await close(request, 1)).json()).day;
    const expense = await request('/api/shopexpenses', options('POST', { shop: 'A', date: date(), month: date().slice(0, 7), amount: 1 }));
    assert.equal(expense.status, 409);
    const response = await request('/api/reports/generate', options('POST', { type: 'daily', shop: 'A', period: date() }));
    assert.equal(response.status, 200);
    const data = (await response.json()).report.data;
    assert.equal(data.totalSales, closed.closedSnapshot.financial.revenue);
    assert.equal(data.netProfit, closed.closedSnapshot.financial.netProfit);
    assert.equal(data.closedRevision, closed.revision);
  });
});

test('a full snapshot covers retained daily versions, posting state and operation receipts', async () => {
  await withApp(app, async request => {
    await sell(request, 100, 300); await save(request, draft(0, 0), 'backup-day-save');
    await close(request, 1, 'backup-day-close');
    const response = await request('/api/backup?version=2', options('GET'));
    assert.equal(response.status, 200);
    const backup = await response.json();
    assert.equal(backup.validation.ready, true, JSON.stringify(backup.validation));
    assert.equal(backup.collections.DayVersion.length, 1);
    assert.equal(backup.collections.DayOperation.length, 2);
    assert.equal(backup.collections.AccountingState[0].openDate, nextDate());
    const { validateBackup, checksum } = require('../../services/backup-validation');
    for (const change of [event => { event.salePrice += 1; }, (_event, ledger) => { ledger.push({ ...ledger[0] }); }]) {
      const altered = structuredClone(backup), version = altered.collections.DayVersion[0];
      change(version.snapshot.ledger[0], version.snapshot.ledger);
      const { calculateDay } = require('../../services/day-service');
      Object.assign(version.snapshot, calculateDay({ events: version.snapshot.ledger, manual: version.snapshot.manual, shopExpenses: version.snapshot.shopExpenses }));
      altered.collections.Day[0].closedSnapshot = structuredClone(version.snapshot);
      altered.checksum = checksum(altered);
      assert.ok(validateBackup(altered).issues.some(issue => issue.code === 'DAY_VERSION_EVENT'));
    }
  });
});

test('report generation after reopen retains the previous closed report version', async () => {
  await withApp(app, async request => {
    await sell(request); await save(request, draft(0, 0));
    const closed = (await (await close(request, 1)).json()).day;
    const generate = () => request('/api/reports/generate', options('POST', { type: 'daily', shop: 'A', period: date() }));
    const first = (await (await generate()).json()).report;
    await request(`/api/days/A/${date()}/reopen`, options('POST', { expectedRevision: closed.revision, reason: 'Correct daily expenses' }));
    const regenerated = (await (await generate()).json()).report;
    assert.ok(regenerated.history.some(version => version.data.closedRevision === first.data.closedRevision));
    assert.equal(regenerated.history[0].data.totalSales, 300);
  });
});

test('concurrent report generation preserves one natural key and a consistent closed revision', async () => {
  await withApp(app, async request => {
    await sell(request); await save(request, draft(0, 0));
    const responses = await Promise.all([close(request, 1), ...[1, 2].map(() => request('/api/reports/generate', options('POST', { type: 'daily', shop: 'A', period: date() })))]);
    assert.deepEqual(responses.map(response => response.status), [200, 200, 200]);
    const latest = await request('/api/reports/generate', options('POST', { type: 'daily', shop: 'A', period: date() }));
    assert.equal((await latest.json()).report.data.closedRevision, 2);
    assert.equal(await models.Report.countDocuments({ shop: 'A', type: 'daily', period: date() }), 1);
  });
});

test('daily replay rejects corrupted cached snapshots rather than acknowledging them', async () => {
  await withApp(app, async request => {
    await save(request, draft(), 'corrupt-day-result');
    await connection.model('DayOperation').updateOne({ _id: 'corrupt-day-result' }, { $set: { 'result.day.expenses': [{ desc: 'Corrupt', amt: 999 }] } });
    assert.equal((await save(request, draft(), 'corrupt-day-result')).status, 409);
    assert.equal((await models.Day.findOne()).expenses[0].amt, 0.1);
  });
});

test('manual reset retains the day identity and its authoritative sale rows', async () => {
  await withApp(app, async request => {
    await sell(request); await save(request, draft(0, 1));
    const first = await models.Day.findOne();
    const response = await request(`/api/days/A/${date()}`, options('DELETE', { expectedRevision: first.revision }, 'manual-day-reset'));
    assert.equal(response.status, 200);
    const reset = (await response.json()).day;
    assert.equal(reset._id, first.id);
    assert.equal(reset.expenses.length, 0);
    const rows = Object.values(reset.cats).flatMap(group => group.rows);
    assert.equal(rows.reduce((sum, row) => sum + (row.soldFor || 0), 0), 300);
  });
});

test('a frozen report cannot be erased through the legacy report delete command', async () => {
  await withApp(app, async request => {
    await save(request, draft()); await close(request, 1);
    const report = (await (await request('/api/reports/generate', options('POST', { type: 'daily', shop: 'A', period: date() }))).json()).report;
    assert.equal((await request(`/api/reports/${report._id}`, options('DELETE'))).status, 409);
    assert.ok(await models.Report.findById(report._id));
  });
});
