const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestDatabase } = require('../helpers/database.cjs');
const { withApp } = require('../helpers/http.cjs');
const { collectionNames, getModels } = require('../../services/backup-validation');
let fixture, app, source, target, sourceToken, targetToken;
let sequence = 700000000000000;
before(async () => {
  fixture = await startTestDatabase();
  const { createSession } = require('../../middleware/auth');
  for (const suffix of ['source', 'target']) {
    const client = await fixture.db.Client.create({ clientId: `${fixture.namespace}_${suffix}`, adminPassword: 'admin-test', gatePassword: 'shop-test', shops: [{ id: 'A' }, { id: 'B' }] });
    const token = await createSession({ clientId: client.clientId, role: 'admin', validShops: ['A', 'B'], authVersion: client.authVersion });
    const connection = fixture.db.getTenantDb(client.clientId);
    const tenant = { connection, models: getModels(connection), client };
    if (suffix === 'source') { source = tenant; sourceToken = token; } else { target = tenant; targetToken = token; }
  }
  app = require('../../app').createApp({ config: require('../../config/runtime').readRuntimeConfig() });
});
beforeEach(async () => {
  for (const tenant of [source, target]) {
    assert.ok(tenant.connection.name.startsWith('tenant_stockly_test_'));
    for (const Model of Object.values(tenant.connection.models)) await Model.deleteMany({});
  }
});
after(async () => { if (fixture) await fixture.stop(); });
function options(method = 'GET', body, token = sourceToken) {
  return { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) };
}
async function snapshot(request, token = sourceToken) {
  const response = await request('/api/backup?version=2', options('GET', undefined, token));
  assert.equal(response.status, 200); return response.json();
}
async function validate(request, backup) {
  const response = await request('/api/restore/validate', options('POST', { backup, mode: 'empty' }, targetToken));
  assert.equal(response.status, 200); return response.json();
}
async function apply(request, planId, operationId = 'restore-roundtrip-key') {
  return request('/api/restore/apply', options('POST', { planId, operationId }, targetToken));
}
async function seed(request) {
  const imeis = [String(sequence++), String(sequence++)];
  const receive = await request('/api/shipments', { ...options('POST', { date: '2026-11-09', items: imeis.map(imei => ({ imei, buyPrice: 0.1, brand: 'Test', notes: 'preserve' })) }), headers: { ...options().headers, 'Idempotency-Key': 'source-receive' } });
  assert.equal(receive.status, 200);
  const hq = await (await request('/api/hqstock', options())).json();
  assert.equal((await request('/api/dispatches', { ...options('POST', { date: '2026-11-09', toShop: 'B', items: [hq.items[0]] }), headers: { ...options().headers, 'Idempotency-Key': 'source-dispatch' } })).status, 200);
  const saleResponse = await request('/api/stock/sell', { ...options('POST', { imei: imeis[0], salePrice: 0.3, soldByShop: 'A' }), headers: { ...options().headers, 'Idempotency-Key': 'source-sale' } });
  const sale = (await saleResponse.json()).sale;
  assert.equal((await request(`/api/sales/${sale._id}`, options('DELETE'))).status, 200);
  assert.equal((await request('/api/products', { ...options('POST', { name: 'Cable', quantity: 2, buyPrice: 0.2, shop: 'A' }), headers: { ...options().headers, 'Idempotency-Key': 'source-product' } })).status, 200);
  await source.models.Customer.create({ name: 'Synthetic contact', phone: 'test-only', notes: 'retain' });
  await source.models.Day.create({ shop: 'A', date: '2026-11-09', cats: {}, expenses: [{ desc: 'Test', amt: 0.1 }], carryForward: 0.2 });
  await source.models.ShopExpense.create({ shop: 'A', date: '2026-11-09', month: '2026-11', amount: 0.1 });
  await source.models.Report.create({ type: 'daily', shop: 'A', period: '2026-11-09', data: { original: true }, generatedAt: '2026-11-09T00:00:00.000Z' });
}

test('v3 stock-check observations round-trip while v2 refuses to silently omit them', async () => {
  const { createStocktake, observeStocktake } = require('../../services/stocktake-service');
  const req = { tenantDb: source.connection, authRole: 'admin', validShops: ['A', 'B'], session: { clientId: source.client.clientId } };
  await source.models.Phone.create({ imei: '001234567890123', shop: 'A', status: 'in_stock', buyPrice: 0.1 });
  const count = await createStocktake(req, { shop: 'A', operationId: 'v3-evidence-start' });
  await observeStocktake(req, { stocktakeId: count.stocktakeId, imei: '001234567890123', expectedRevision: 0, operationId: 'v3-evidence-scan' });
  await source.models.Phone.deleteMany({});
  await withApp(app, async request => {
    assert.equal((await request('/api/backup?version=2', options())).status, 409);
    const response = await request('/api/backup?version=3', options());
    assert.equal(response.status, 200);
    const backup = await response.json();
    assert.equal(backup.validation.ready, true, JSON.stringify(backup.validation));
    const preview = await validate(request, backup);
    assert.equal(preview.ready, true, JSON.stringify(preview));
    assert.equal((await apply(request, preview.planId)).status, 200);
    const copied = await target.models.Stocktake.find({}).lean();
    assert.deepEqual(JSON.parse(JSON.stringify(copied)), backup.collections.Stocktake);
    assert.equal(await target.models.Phone.countDocuments(), 0);
  });
});

test('v3 retains existing business facts and v2 restore cannot overwrite observation-only accounts', async () => {
  await withApp(app, async request => {
    await seed(request);
    const old = await snapshot(request);
    const response = await request('/api/backup?version=3', options());
    assert.equal(response.status, 200);
    const current = await response.json();
    assert.equal(current.validation.ready, true, JSON.stringify(current.validation));
    for (const name of collectionNames) assert.deepEqual(current.collections[name], old.collections[name]);
    await require('../../services/stocktake-service').createStocktake({ tenantDb: target.connection, authRole: 'admin', validShops: ['A', 'B'],
      session: { clientId: target.client.clientId } }, { shop: 'A', operationId: 'nonempty-count-start' });
    const blocked = await validate(request, old);
    assert.equal(blocked.ready, false);
    assert.ok(blocked.issues.some(issue => issue.code === 'TARGET_NOT_EMPTY'));
    assert.equal(await target.models.Stocktake.countDocuments(), 1);
    assert.equal(await target.models.Phone.countDocuments(), 0);
  });
});

test('legacy import rejects complete envelopes instead of falsely reporting an empty restore', async () => {
  await withApp(app, async request => {
    for (const version of [2, 3]) {
      const response = await request('/api/backup?version=' + version, options());
      const backup = await response.json();
      const legacy = await request('/api/restore', options('POST', backup, targetToken));
      assert.equal(legacy.status, 409);
      assert.equal((await legacy.json()).code, 'REVIEWED_RESTORE_REQUIRED');
    }
    for (const Model of Object.values(target.models)) assert.equal(await Model.countDocuments(), 0);
  });
});

test('stock-check capture is complete, replayable and leaves inventory and money unchanged', async () => {
  const { createStocktake } = require('../../services/stocktake-service');
  const req = { tenantDb: source.connection, models: source.models, authRole: 'admin', validShops: ['A', 'B'],
    session: { clientId: source.client.clientId, authVersion: source.client.authVersion } };
  const rows = await source.models.Phone.create([
    { imei: '001234567890123', shop: 'A', status: 'in_stock', buyPrice: 0.1 },
    { imei: '001234567890124', shop: 'B', status: 'in_stock', buyPrice: 0.2 },
  ]);
  const before = JSON.parse(JSON.stringify(await source.models.Phone.find({}).sort({ _id: 1 }).lean()));
  const first = await createStocktake(req, { shop: 'A', operationId: 'capture-test-key' });
  assert.equal(first.success, true);
  assert.deepEqual(await createStocktake(req, { shop: 'A', operationId: 'capture-test-key' }), first);
  assert.equal(await source.models.Stocktake.countDocuments(), 1);
  const count = await source.models.Stocktake.findById(first.stocktakeId).lean();
  assert.deepEqual(count.baseline.map(row => String(row.phoneId)), [String(rows[0]._id)]);
  assert.equal(count.observations.length, 0);
  await assert.rejects(createStocktake(req, { shop: 'B', operationId: 'capture-test-key' }), error => error.status === 409);
  await assert.rejects(createStocktake({ ...req, authRole: 'shop' }, { shop: 'A', operationId: 'capture-other-key' }), error => error.status === 403);
  assert.deepEqual(JSON.parse(JSON.stringify(await source.models.Phone.find({}).sort({ _id: 1 }).lean())), before);
  assert.equal(await source.models.Sale.countDocuments(), 0);
  await withApp(app, async request => {
    const response = await request('/api/backup?version=3', options());
    const backup = await response.json();
    assert.equal(backup.validation.ready, true, JSON.stringify(backup.validation));
    const preview = await validate(request, backup);
    assert.equal(preview.ready, true, JSON.stringify(preview));
    assert.equal((await apply(request, preview.planId)).status, 200);
  });
  const replayAfterRestore = await createStocktake({ ...req, tenantDb: target.connection,
    session: { clientId: target.client.clientId, authVersion: target.client.authVersion } }, { shop: 'A', operationId: 'capture-test-key' });
  assert.deepEqual(replayAfterRestore, first);
  assert.equal(await target.models.Stocktake.countDocuments(), 1);
});

test('stock-check capture rolls back on audit failure and concurrent retry captures once', async () => {
  const { createStocktake } = require('../../services/stocktake-service');
  const req = { tenantDb: source.connection, authRole: 'admin', validShops: ['A', 'B'],
    session: { clientId: source.client.clientId, authVersion: source.client.authVersion } };
  const createAudit = source.models.AuditLog.create;
  source.models.AuditLog.create = async () => { throw Error('injected capture audit failure'); };
  try {
    await assert.rejects(createStocktake(req, { shop: 'A', operationId: 'capture-rollback-key' }), /injected/);
    assert.equal(await source.models.Stocktake.countDocuments(), 0);
  } finally { source.models.AuditLog.create = createAudit; }
  const results = await Promise.all([1, 2].map(() => createStocktake(req, { shop: 'A', operationId: 'capture-rollback-key' })));
  assert.deepEqual(results[0], results[1]);
  assert.equal(await source.models.Stocktake.countDocuments(), 1);
  assert.equal(await source.models.AuditLog.countDocuments({ action: 'stocktake_start' }), 1);
});

test('stock-check capture rejects ambiguous identity rather than recording a false baseline', async () => {
  const { createStocktake } = require('../../services/stocktake-service');
  const req = { tenantDb: source.connection, authRole: 'admin', validShops: ['A'], session: { clientId: source.client.clientId } };
  await source.models.Phone.create([
    { imei: '001234567890123', shop: 'A', status: 'in_stock', buyPrice: 0.1 },
    { imei: '001234567890123', shop: 'A', status: 'in_stock', buyPrice: 0.2 },
  ]);
  await assert.rejects(createStocktake(req, { shop: 'A', operationId: 'capture-ambiguous-key' }), error => error.status === 409);
  assert.equal(await source.models.Stocktake.countDocuments(), 0);
  assert.equal(await source.models.Phone.countDocuments(), 2);
});

test('stock-check scans retain duplicate attempts and replay their original acknowledgment', async () => {
  const { createStocktake, observeStocktake } = require('../../services/stocktake-service');
  const req = { tenantDb: source.connection, authRole: 'admin', validShops: ['A'], session: { clientId: source.client.clientId } };
  const imei = '001234567890123';
  await source.models.Phone.create({ imei, shop: 'A', status: 'in_stock', buyPrice: 0.1 });
  const before = JSON.stringify(await source.models.Phone.find({}).lean());
  const count = await createStocktake(req, { shop: 'A', operationId: 'scan-count-start' });
  const command = { stocktakeId: count.stocktakeId, imei, expectedRevision: 0, operationId: 'scan-first-key' };
  const first = await observeStocktake(req, command);
  assert.equal(first.observationCount, 1);
  await observeStocktake(req, { ...command, expectedRevision: 1, operationId: 'scan-duplicate-key' });
  assert.deepEqual(await observeStocktake(req, command), first);
  const saved = await source.models.Stocktake.findById(count.stocktakeId).lean();
  assert.equal(saved.observations.length, 2);
  assert.equal(saved.revision, 2);
  await assert.rejects(observeStocktake(req, { ...command, imei: '001234567890124' }), error => error.status === 409);
  await assert.rejects(observeStocktake(req, { ...command, operationId: 'scan-stale-key' }), error => error.status === 409);
  assert.equal(JSON.stringify(await source.models.Phone.find({}).lean()), before);
  await withApp(app, async request => {
    const backup = await (await request('/api/backup?version=3', options())).json();
    assert.equal(backup.validation.ready, true, JSON.stringify(backup.validation));
    const preview = await validate(request, backup);
    assert.equal((await apply(request, preview.planId)).status, 200);
    assert.deepEqual(JSON.parse(JSON.stringify(await target.models.Stocktake.find({}).lean())), backup.collections.Stocktake);
  });
});

test('stock-check review blocks changed trading evidence and cancellation is replayable', async () => {
  const { createStocktake, readStocktake, finishStocktake } = require('../../services/stocktake-service');
  const req = { tenantDb: source.connection, authRole: 'admin', validShops: ['A'], session: { clientId: source.client.clientId } };
  const phone = await source.models.Phone.create({ imei: '001234567890123', shop: 'A', status: 'in_stock', buyPrice: 0.1 });
  const count = await createStocktake(req, { shop: 'A', operationId: 'review-count-start' });
  let review = await readStocktake(req, count.stocktakeId);
  assert.deepEqual(review.differences.missing, [phone.imei]);
  await source.models.Phone.updateOne({ _id: phone._id }, { $set: { buyPrice: 0.2 } });
  review = await readStocktake(req, count.stocktakeId);
  assert.equal(review.differences.recheckRequired, true);
  assert.deepEqual(review.differences.missing, []);
  const command = { stocktakeId: count.stocktakeId, expectedRevision: 0, operationId: 'finish-count-key', status: 'reviewed' };
  await assert.rejects(finishStocktake(req, command), error => error.status === 409);
  const cancelled = await finishStocktake(req, { ...command, status: 'cancelled' });
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(await finishStocktake(req, { ...command, status: 'cancelled' }), cancelled);
  assert.equal((await source.models.Phone.findById(phone._id)).buyPrice, 0.2);
  assert.equal(await source.models.Sale.countDocuments(), 0);
});

test('stock-check review records discrepancies without adjusting stock and round-trips terminal evidence', async () => {
  const { createStocktake, finishStocktake } = require('../../services/stocktake-service');
  const req = { tenantDb: source.connection, authRole: 'admin', validShops: ['A'], session: { clientId: source.client.clientId } };
  await source.models.Phone.create({ imei: '001234567890123', shop: 'A', status: 'in_stock', buyPrice: 0.1 });
  const before = JSON.stringify(await source.models.Phone.find({}).lean());
  const count = await createStocktake(req, { shop: 'A', operationId: 'complete-count-start' });
  const done = await finishStocktake(req, { stocktakeId: count.stocktakeId, expectedRevision: 0, operationId: 'complete-count-key', status: 'reviewed' });
  assert.equal(done.status, 'reviewed');
  const retained = await source.models.Stocktake.findById(count.stocktakeId).lean();
  assert.deepEqual(retained.review.missing, ['001234567890123']);
  assert.equal(JSON.stringify(await source.models.Phone.find({}).lean()), before);
  await withApp(app, async request => {
    const backup = await (await request('/api/backup?version=3', options())).json();
    assert.equal(backup.validation.ready, true, JSON.stringify(backup.validation));
    for (const patch of [{ missing: [] }, { recheckRequired: true }, { wrongShop: ['001234567890126'] }, { unknown: [] }]) {
      const tampered = structuredClone(backup);
      Object.assign(tampered.collections.Stocktake[0].review, patch);
      const rules = require('../../services/backup-validation');
      tampered.checksum = rules.checksum(tampered);
      assert.equal(rules.validateBackup(tampered).ready, false);
    }
    const preview = await validate(request, backup);
    assert.equal((await apply(request, preview.planId)).status, 200);
  });
});

test('stock-check review size checks include captured phones after custody and identity changes', async () => {
  const { createStocktake, readStocktake } = require('../../services/stocktake-service');
  const req = { tenantDb: source.connection, authRole: 'admin', validShops: ['A', 'B'], session: { clientId: source.client.clientId } };
  const phone = await source.models.Phone.create({ imei: '001234567890123', shop: 'A', status: 'in_stock', buyPrice: 0.1 });
  const count = await createStocktake(req, { shop: 'A', operationId: 'review-size-start' });
  await source.models.Phone.updateOne({ _id: phone._id }, { $set: { shop: 'B', imei: '001234567890124', notes: 'x'.repeat(4 * 1024 * 1024) } });
  await assert.rejects(readStocktake(req, count.stocktakeId), error => error.status === 413 && error.code === 'STOCKTAKE_LIMIT');
  assert.equal(await source.models.Stocktake.countDocuments(), 1);
});

test('snapshot covers every business collection and round-trips retained history and IDs', async () => {
  await withApp(app, async request => {
    await seed(request);
    const backup = await snapshot(request);
    assert.equal(backup.version, 2);
    assert.deepEqual(Object.keys(backup.collections).sort(), [...collectionNames].sort());
    assert.equal(backup.validation.ready, true, JSON.stringify(backup.validation));
    const preview = await validate(request, backup);
    assert.equal(preview.ready, true, JSON.stringify(preview));
    assert.equal(await target.models.Phone.countDocuments(), 0);
    const restored = await apply(request, preview.planId);
    assert.equal(restored.status, 200, await restored.clone().text());
    const result = await restored.json();
    const again = await apply(request, preview.planId);
    assert.equal(again.status, 200);
    assert.deepEqual(await again.json(), result);
    for (const name of collectionNames) {
      const rows = JSON.parse(JSON.stringify(await target.models[name].find({}).sort({ _id: 1 }).lean()));
      const imported = name === 'AuditLog' ? rows.filter(row => row.action !== 'restore_apply') : rows;
      assert.deepEqual(imported, backup.collections[name], name);
    }
    const replay = await request('/api/products', { ...options('POST', { name: 'Cable', quantity: 2, buyPrice: 0.2, shop: 'A' }, targetToken), headers: { ...options('GET', undefined, targetToken).headers, 'Idempotency-Key': 'source-product' } });
    assert.equal(replay.status, 200);
    assert.equal((await target.models.Product.findOne()).quantity, 2);
    assert.equal(await target.models.AuditLog.countDocuments({ action: 'restore_apply' }), 1);
  });
});
test('close, reverse and resell round-trips the frozen day and current posting period', async () => {
  const { businessDate, periodBounds } = require('../../public/js/business-rules');
  const date = businessDate(), nextDate = businessDate(new Date(periodBounds(date, 'daily').end));
  await withApp(app, async request => {
    const phone = await source.models.Phone.create({ imei: String(sequence++), shop: 'B', status: 'in_stock', buyPrice: 0.1 });
    const sell = async price => {
      const response = await request('/api/stock/sell', options('POST', { imei: phone.imei, salePrice: price, soldByShop: 'A' }));
      assert.equal(response.status, 200); return (await response.json()).sale;
    };
    const original = await sell(0.3);
    const closedResponse = await request(`/api/days/A/${date}/close`, options('POST', { expectedRevision: 0 }));
    assert.equal(closedResponse.status, 200);
    const frozen = (await closedResponse.json()).day.closedSnapshot;
    assert.equal((await request(`/api/sales/${original._id}`, options('DELETE'))).status, 200);
    const resale = await sell(0.4);
    assert.equal(resale.businessDate, nextDate);
    const backup = await snapshot(request), preview = await validate(request, backup);
    assert.equal(preview.ready, true, JSON.stringify(preview));
    assert.equal((await apply(request, preview.planId)).status, 200);
    const restored = await target.models.Day.findOne({ shop: 'A', date }).lean();
    assert.deepEqual(restored.closedSnapshot, frozen);
    assert.equal((await target.models.AccountingState.findById('A')).openDate, nextDate);
    assert.equal((await target.models.Sale.findById(original._id)).reversalBusinessDate, nextDate);
    const { readSalesLedger, checkedBounds } = require('../../services/sales-ledger');
    const { sumSaleEvents } = require('../../public/js/business-rules');
    const events = await readSalesLedger(target.models, { shop: 'A', bounds: checkedBounds(nextDate, 'daily') });
    assert.equal(sumSaleEvents(events).revenue, 0.1);
    assert.equal(await target.models.DayVersion.countDocuments(), 1);
  });
});

test('a changed target invalidates a reviewed restore plan without overwriting anything', async () => {
  await withApp(app, async request => {
    const preview = await validate(request, await snapshot(request));
    assert.equal(preview.ready, true);
    await request('/api/products', options('POST', { name: 'New target data', shop: 'A', quantity: 1 }, targetToken));
    assert.equal((await apply(request, preview.planId)).status, 409);
    assert.equal(await target.models.Product.countDocuments(), 1);
  });
});
test('restore audit failure aborts every imported collection and permits a safe retry', async () => {
  await withApp(app, async request => {
    await seed(request);
    const preview = await validate(request, await snapshot(request));
    const original = target.models.AuditLog.create;
    target.models.AuditLog.create = async () => { throw Error('injected restore audit failure'); };
    try {
      assert.equal((await apply(request, preview.planId)).status, 500);
      for (const Model of Object.values(target.models)) assert.equal(await Model.countDocuments(), 0);
    } finally { target.models.AuditLog.create = original; }
    assert.equal((await apply(request, preview.planId)).status, 200);
  });
});
test('validation accepts a body larger than the default JSON limit and reports conflicts read-only', async () => {
  await source.models.Customer.create({ name: 'Large note fixture', notes: 'x'.repeat(150000) });
  await withApp(app, async request => {
    const backup = await snapshot(request);
    assert.equal((await validate(request, backup)).ready, true);
    assert.equal(await target.models.Customer.countDocuments(), 0);
    backup.collections.Phone.push({ _id: '123456789012345678901234', imei: 'invalid' });
    assert.equal((await validate(request, backup)).ready, false);
    assert.equal(await target.models.Phone.countDocuments(), 0);
    const oversized = await request('/api/restore/validate', options('POST', { mode: 'empty', backup: { payload: 'x'.repeat(10 * 1024 * 1024) } }, targetToken));
    assert.equal(oversized.status, 413);
  });
});
test('a snapshot racing a sale sees one coherent committed state', async () => {
  const phone = await source.models.Phone.create({ imei: String(sequence++), shop: 'A', status: 'in_stock', buyPrice: 0.1 });
  await withApp(app, async request => {
    const original = source.models.Phone.find;
    let read, release;
    const reached = new Promise(resolve => { read = resolve; }), proceed = new Promise(resolve => { release = resolve; });
    source.models.Phone.find = function(...args) {
      const query = original.apply(this, args), exec = query.exec;
      query.exec = async function() { const rows = await exec.call(this); if (!args[0] || !Object.keys(args[0]).length) { read(); await proceed; } return rows; };
      return query;
    };
    try {
      const exporting = snapshot(request);
      await reached;
      assert.equal((await request('/api/stock/sell', options('POST', { imei: phone.imei, salePrice: 0.3, soldByShop: 'A' }))).status, 200);
      release();
      const backup = await exporting;
      assert.equal(backup.validation.ready, true);
      assert.equal(backup.collections.Phone[0].status, 'in_stock');
      assert.equal(backup.collections.Sale.length, 0);
    } finally { release(); source.models.Phone.find = original; }
  });
});

test('recovery blocks all ordinary writers while readers see only committed data', async () => {
  await withApp(app, async request => {
    await seed(request);
    const preview = await validate(request, await snapshot(request));
    const collection = target.models.Phone.collection, original = collection.insertMany;
    let entered, release;
    const reached = new Promise(resolve => { entered = resolve; }), proceed = new Promise(resolve => { release = resolve; });
    collection.insertMany = async function(...args) { entered(); await proceed; return original.apply(this, args); };
    try {
      const restoring = apply(request, preview.planId);
      await reached;
      for (const [path, body] of [
        ['/api/products', { name: 'Blocked', quantity: 1, shop: 'A' }],
        ['/api/customers', { name: 'Blocked contact' }],
        ['/api/days/A/2026-11-09', { shop: 'A', date: '2026-11-09' }],
      ]) {
        const response = await request(path, options(path.includes('/days/') ? 'PUT' : 'POST', body, targetToken));
        assert.equal(response.status, 503);
      }
      const products = await request('/api/products', options('GET', undefined, targetToken));
      assert.deepEqual(await products.json(), []);
      release();
      assert.equal((await restoring).status, 200);
    } finally { release(); collection.insertMany = original; }
  });
});
test('interrupted maintenance stays fenced and expired or superseded plans cannot apply', async () => {
  await withApp(app, async request => {
    const first = await validate(request, await snapshot(request));
    const second = await validate(request, await snapshot(request));
    assert.equal((await apply(request, first.planId)).status, 409);
    const { RecoveryState, RecoveryPlan } = require('../../services/recovery-control').controls(target.connection);
    await RecoveryPlan.updateOne({ _id: 'current' }, { $set: { expiresAt: new Date(0) } });
    assert.equal((await apply(request, second.planId)).status, 409);
    await RecoveryState.updateOne({ _id: 'tenant' }, { $set: { maintenance: true, operationId: 'interrupted-process', phase: 'applying' } });
    const status = await (await request('/api/restore/status', options('GET', undefined, targetToken))).json();
    assert.equal(status.maintenance, true);
    assert.equal((await request('/api/products', options('POST', { name: 'Blocked', quantity: 1, shop: 'A' }, targetToken))).status, 503);
    assert.equal((await RecoveryState.findById('tenant')).maintenance, true);
    assert.equal(await target.models.Product.countDocuments(), 0);
  });
});

test('supersession between plan read and maintenance acquisition rejects the old apply', async () => {
  await withApp(app, async request => {
    const backup = await snapshot(request), first = await validate(request, backup);
    const { RecoveryPlan } = require('../../services/recovery-control').controls(target.connection);
    const original = RecoveryPlan.findOne;
    let reached, release;
    const read = new Promise(resolve => { reached = resolve; }), proceed = new Promise(resolve => { release = resolve; });
    RecoveryPlan.findOne = function(...args) {
      const query = original.apply(this, args), exec = query.exec;
      if (args[0]?.planId === first.planId) query.exec = async function() { const value = await exec.call(this); reached(); await proceed; return value; };
      return query;
    };
    try {
      const applying = apply(request, first.planId);
      await read;
      const second = await validate(request, backup);
      assert.equal(second.ready, true);
      release();
      assert.equal((await applying).status, 409);
      assert.equal(await target.models.AuditLog.countDocuments(), 0);
    } finally { release(); RecoveryPlan.findOne = original; }
  });
});

for (const action of ['dispatch', 'reversal']) test(`snapshot racing a ${action} preserves coherent original placement and history`, async () => {
  await withApp(app, async request => {
    const imei = String(sequence++);
    let selection, sale;
    if (action === 'dispatch') {
      await request('/api/shipments', options('POST', { date: '2026-11-09', items: [{ imei, buyPrice: 0.1 }] }));
      selection = (await (await request('/api/hqstock', options())).json()).items;
    } else {
      await source.models.Phone.create({ imei, shop: 'A', status: 'in_stock', buyPrice: 0.1 });
      sale = (await (await request('/api/stock/sell', options('POST', { imei, salePrice: 0.3, soldByShop: 'A' }))).json()).sale;
    }
    const original = source.models.Phone.find;
    let reached, release;
    const read = new Promise(resolve => { reached = resolve; }), proceed = new Promise(resolve => { release = resolve; });
    source.models.Phone.find = function(...args) {
      const query = original.apply(this, args), exec = query.exec;
      if (!args[0] || !Object.keys(args[0]).length) query.exec = async function() { const rows = await exec.call(this); reached(); await proceed; return rows; };
      return query;
    };
    try {
      const exporting = snapshot(request); await read;
      const response = action === 'dispatch' ? await request('/api/dispatches', options('POST', { date: '2026-11-09', toShop: 'A', items: selection }))
        : await request(`/api/sales/${sale._id}`, options('DELETE'));
      assert.equal(response.status, 200);
      release(); const backup = await exporting;
      assert.equal(backup.validation.ready, true, JSON.stringify(backup.validation));
      if (action === 'dispatch') { assert.equal(backup.collections.Phone.length, 0); assert.equal(backup.collections.HQStock[0].items.length, 1); assert.equal(backup.collections.Dispatch.length, 0); }
      else { assert.equal(backup.collections.Phone[0].status, 'sold'); assert.equal(backup.collections.Sale[0].reversedAt, undefined); }
    } finally { release(); source.models.Phone.find = original; }
  });
});

test('receipt keys shared across product and warehouse namespaces preserve separate audits', async () => {
  await withApp(app, async request => {
    const headers = { ...options().headers, 'Idempotency-Key': 'same-across-namespaces' };
    assert.equal((await request('/api/products', { ...options('POST', { name: 'Cable', quantity: 1, buyPrice: 0.1, shop: 'A' }), headers })).status, 200);
    assert.equal((await request('/api/shipments', { ...options('POST', { date: '2026-11-09', items: [{ imei: String(sequence++), buyPrice: 0.1 }] }), headers })).status, 200);
    const backup = await snapshot(request);
    assert.equal(backup.validation.ready, true, JSON.stringify(backup.validation));
  });
});

test('actual browser API validates and applies a reviewed snapshot over local HTTP', async () => {
  await source.models.Customer.create({ name: 'HTTP recovery fixture', notes: 'preserve' });
  await withApp(app, async (request, base) => {
    const backup = await snapshot(request), payload = JSON.stringify(backup);
    let reloads = 0;
    const browser = require('../helpers/browser.cjs').browserContext({ fetch: global.fetch, location: { origin: base, search: '', reload() { reloads++; } } });
    for (const file of ['globals', 'utils', 'ceo']) browser.load(`public/js/${file}.js`);
    const state = browser.context;
    state.authRole = 'admin'; state.localStorage.setItem('clientId', target.client.clientId); state.localStorage.setItem('authToken', targetToken);
    state.document.getElementById('restoreFile').files = [{ size: Buffer.byteLength(payload), text: async () => payload }];
    const errors = [];
    state.showToast = (message, type) => { if (type === 'error') errors.push(message); };
    await state.doRestore();
    assert.equal(await target.models.Customer.countDocuments(), 0);
    await state.applyReviewedRestore();
    assert.deepEqual(errors, []);
    assert.equal(reloads, 1);
    assert.equal((await target.models.Customer.findOne()).notes, 'preserve');
  });
});

test('the legacy adapter also refuses populated non-inventory accounts', async () => {
  await target.models.Customer.create({ name: 'Existing target contact' });
  await withApp(app, async request => {
    const response = await request('/api/restore', options('POST', { days: [{ shop: 'A', date: '2026-11-09', cats: {} }] }, targetToken));
    assert.equal(response.status, 409);
    assert.equal(await target.models.Day.countDocuments(), 0);
    assert.equal(await target.models.Customer.countDocuments(), 1);
  });
});
