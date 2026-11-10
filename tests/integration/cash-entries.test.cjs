const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestDatabase } = require('../helpers/database.cjs');
let fixture, req, models, targetReq, targetModels;
before(async () => {
  fixture = await startTestDatabase();
  for (const suffix of ['source', 'target']) {
    const client = await fixture.db.Client.create({ clientId: fixture.namespace + '_' + suffix, adminPassword: 'owner-test', gatePassword: 'shop-test', shops: [{ id: 'A' }, { id: 'B' }] });
    const context = { tenantDb: fixture.db.getTenantDb(client.clientId), authRole: 'admin', validShops: ['A', 'B'], session: { clientId: client.clientId, authVersion: client.authVersion } };
    const tenantModels = require('../../services/backup-validation').getModels(context.tenantDb);
    if (suffix === 'source') { req = context; models = tenantModels; } else { targetReq = context; targetModels = tenantModels; }
  }
});
beforeEach(async () => { for (const Model of [...Object.values(models), ...Object.values(targetModels)]) await Model.deleteMany({}); });
after(async () => { if (fixture) await fixture.stop(); });

test('one completed expense records one exact payment and one linked financial expense without changing stock', async () => {
  const { recordCashEntry } = require('../../services/cash-entry');
  const command = { shop: 'A', kind: 'expense', method: 'cash', amount: '10.01', description: 'Test expense', operationId: 'expense-payment-key', confirmed: true };
  const result = await recordCashEntry(req, command);
  assert.equal(result.amountMinor, 1001); assert.equal(result.method, 'cash');
  assert.equal((await models.AccountingState.findById('A')).cashFormatVersion, 1);
  assert.deepEqual(await recordCashEntry(req, command), result);
  assert.equal(await models.CashEntry.countDocuments(), 1);
  const expense = await models.ShopExpense.findById(result.entryId);
  assert.equal(expense.amount, 10.01); assert.equal(expense.shop, 'A');
  assert.equal(await models.Phone.countDocuments(), 0); assert.equal(await models.Sale.countDocuments(), 0);
  await assert.rejects(recordCashEntry(req, { ...command, amount: '10.02' }), error => error.status === 409);
});

test('a completed shop transfer records one identity and both shops posting periods atomically', async () => {
  const { recordCashEntry } = require('../../services/cash-entry');
  const result = await recordCashEntry(req, { shop: 'A', toShop: 'B', kind: 'transfer', method: 'cash', amount: 0.3, description: 'Till transfer', operationId: 'cash-transfer-key', confirmed: true });
  assert.equal(result.toShop, 'B'); assert.equal(result.amountMinor, 30);
  assert.ok((await models.AccountingState.findById('A')).openDate);
  assert.ok((await models.AccountingState.findById('B')).openDate);
  assert.equal(await models.CashEntry.countDocuments(), 1); assert.equal(await models.ShopExpense.countDocuments(), 0);
});

test('unconfirmed, invalid-channel, same-shop transfers and staff payments are rejected before recording money', async () => {
  const { recordCashEntry } = require('../../services/cash-entry');
  const command = { shop: 'A', kind: 'income', method: 'bank', amount: 0.3, description: 'Other income', operationId: 'invalid-cash-entry', confirmed: true };
  await assert.rejects(recordCashEntry({ ...req, authRole: 'shop' }, command), error => error.status === 403);
  for (const patch of [{ confirmed: false }, { method: 'credit' }, { amount: 0.001 }, { kind: 'transfer', toShop: 'A' }, { paidAmountMinor: 999 }]) {
    await assert.rejects(recordCashEntry(req, { ...command, ...patch }), error => error.status === 400);
  }
  assert.equal(await models.CashEntry.countDocuments(), 0);
});

test('cash-entry audit failure rolls back its financial source and payment together', async () => {
  const { recordCashEntry } = require('../../services/cash-entry');
  const original = models.AuditLog.create;
  models.AuditLog.create = async () => { throw Error('injected cash-entry audit failure'); };
  try {
    await assert.rejects(recordCashEntry(req, { shop: 'A', kind: 'expense', method: 'bank', amount: 0.3, description: 'Test', operationId: 'rollback-cash-entry', confirmed: true }), /injected/);
  } finally { models.AuditLog.create = original; }
  assert.equal(await models.CashEntry.countDocuments(), 0); assert.equal(await models.ShopExpense.countDocuments(), 0);
});

test('canonical money entries and linked expenses survive recovery and cannot lose channels or source links', async () => {
  const { recordCashEntry } = require('../../services/cash-entry');
  const command = { shop: 'A', kind: 'expense', method: 'bank', amount: 0.3, description: 'Test expense', operationId: 'recover-cash-entry', confirmed: true };
  const first = await recordCashEntry(req, command);
  const backup = await require('../../services/backup-service').createBackup({ connection: req.tenantDb, clientId: req.session.clientId, shops: req.validShops, version: 3 });
  assert.equal(backup.validation.ready, true, JSON.stringify(backup.validation));
  const rules = require('../../services/backup-validation');
  for (const mutate of [
    value => { value.collections.CashEntry[0].method = 'cash'; },
    value => { value.collections.CashEntry[0].result.amountMinor = 31; },
    value => { value.collections.ShopExpense = []; },
    value => { value.collections.AuditLog = []; },
    value => { value.collections.AccountingState[0].cashFormatVersion = 2; },
  ]) {
    const changed = structuredClone(backup); mutate(changed);
    changed.manifest.counts = Object.fromEntries(Object.entries(changed.collections).map(([name, rows]) => [name, rows.length]));
    changed.checksum = rules.checksum(changed);
    assert.equal(rules.validateBackup(changed).ready, false);
  }
  const recovery = require('../../services/restore-service');
  const identity = { clientId: targetReq.session.clientId, authVersion: targetReq.session.authVersion, shops: targetReq.validShops };
  const review = await recovery.reviewRestore({ connection: targetReq.tenantDb, identity, backup, mode: 'empty' });
  assert.equal(review.ready, true, JSON.stringify(review));
  await recovery.applyRestore({ connection: targetReq.tenantDb, identity, planId: review.planId, operationId: 'restore-manual-money' });
  assert.deepEqual(await recordCashEntry(targetReq, command), first);
  assert.equal(await targetModels.CashEntry.countDocuments(), 1); assert.equal(await targetModels.ShopExpense.countDocuments(), 1);
});

test('manual money has one financial authority, excludes supplier cost inference and preserves frozen closes', async () => {
  const { recordCashEntry } = require('../../services/cash-entry');
  const base = { shop: 'A', method: 'bank', description: 'Test', confirmed: true };
  await recordCashEntry(req, { ...base, kind: 'expense', amount: 0.1, operationId: 'financial-expense' });
  await recordCashEntry(req, { ...base, kind: 'income', amount: 0.3, cost: 0.1, operationId: 'financial-income' });
  await recordCashEntry(req, { ...base, kind: 'purchase', amount: 0.2, operationId: 'financial-purchase' });
  await recordCashEntry(req, { ...base, kind: 'transfer', toShop: 'B', amount: 0.1, operationId: 'financial-transfer' });
  const date = require('../../public/js/business-rules').businessDate();
  const summarize = () => require('../../services/financial-summary').financialSummary(models, { type: 'daily', period: date, shop: 'A', validShops: ['A', 'B'] });
  const live = await summarize();
  assert.equal(live.financial.revenue, 0.3); assert.equal(live.financial.cost, 0.1);
  assert.equal(live.financial.expenses, 0.1); assert.equal(live.financial.netProfit, 0.1);
  assert.equal(live.financial.purchases, 0.2); assert.equal(live.financial.transfers, 0.1);
  const receiving = await require('../../services/financial-summary').financialSummary(models, { type: 'daily', period: date, shop: 'B', validShops: ['A', 'B'] });
  assert.equal(receiving.financial.revenue, 0);
  const closed = await require('../../services/day-service').mutateDay({ connection: req.tenantDb, models, actor: { role: 'admin' }, validShops: ['A', 'B'],
    shop: 'A', date, payload: { expectedRevision: 0 }, action: 'close', operationId: 'close-manual-finance', manualVersion: '2' });
  assert.equal(closed.day.closedSnapshot.financial.netProfit, 0.1);
  await recordCashEntry(req, { ...base, kind: 'income', amount: 0.5, operationId: 'late-manual-income' });
  assert.deepEqual((await summarize()).financial, live.financial);
  const backup = await require('../../services/backup-service').createBackup({ connection: req.tenantDb, clientId: req.session.clientId, shops: req.validShops, version: 3 });
  assert.equal(backup.validation.ready, true, JSON.stringify(backup.validation));
  const changed = structuredClone(backup);
  const receipt = changed.collections.DayOperation.find(row => row._id === 'close-manual-finance');
  assert.ok(receipt);
  {
    for (const snapshot of [changed.collections.DayVersion[0].snapshot, changed.collections.Day[0].closedSnapshot, receipt.result.day.closedSnapshot]) snapshot.cashEntries[0].amountMinor++;
    changed.collections.AuditLog.find(row => row.action === 'day_close').details.resultChecksum = require('../../services/day-service').dayChecksum(receipt.result.day);
    const rules = require('../../services/backup-validation'); changed.checksum = rules.checksum(changed);
    assert.equal(rules.validateBackup(changed).ready, false);
  }
});

test('manual payment cutover rejects old daily writers but keeps prior valid operation replay', async () => {
  const { mutateDay } = require('../../services/day-service'), { recordCashEntry } = require('../../services/cash-entry');
  const date = require('../../public/js/business-rules').businessDate();
  const base = { connection: req.tenantDb, models, actor: { role: 'admin' }, validShops: ['A', 'B'], shop: 'A', date, action: 'save' };
  const old = { ...base, payload: { expectedRevision: 0 }, operationId: 'pre-cash-day-save' };
  const saved = await mutateDay(old);
  await recordCashEntry(req, { shop: 'A', kind: 'income', method: 'cash', amount: 0.3, description: 'Other income', operationId: 'activate-manual-cash', confirmed: true });
  assert.deepEqual(await mutateDay(old), saved);
  await assert.rejects(mutateDay({ ...base, payload: { expectedRevision: 1 }, operationId: 'old-day-writer-key' }), error => error.status === 428);
  await assert.rejects(mutateDay({ ...base, manualVersion: '2', payload: { expectedRevision: 1, cashFinancialOnly: true } }), error => error.status === 400);
  const modern = await mutateDay({ ...base, manualVersion: '2', payload: { expectedRevision: 1, cashFinancialOnly: true }, operationId: 'modern-day-writer-key' });
  assert.match(modern.day.cashManualChecksum, /^[a-f0-9]{64}$/);
  assert.equal((await models.AuditLog.findOne({ 'details.operationId': 'modern-day-writer-key' })).details.cashFinancialOnly, true);
  const backup = await require('../../services/backup-service').createBackup({ connection: req.tenantDb, clientId: req.session.clientId, shops: req.validShops, version: 3 });
  assert.equal(backup.validation.ready, true, JSON.stringify(backup.validation));
  const rules = require('../../services/backup-validation');
  for (const mutate of [
    value => { value.collections.Day[0].cashManualChecksum = 'a'.repeat(64); },
    value => { delete value.collections.Day[0].cashManualChecksum; },
    value => { delete value.collections.Day[0].cashManualChecksum; delete value.collections.AuditLog.find(row => row.details?.operationId === 'modern-day-writer-key').details.cashManualChecksum; },
    value => { value.collections.AuditLog.find(row => row.details?.operationId === 'modern-day-writer-key').details.cashFinancialOnly = false; },
  ]) {
    const changed = structuredClone(backup); mutate(changed); changed.checksum = rules.checksum(changed);
    assert.equal(rules.validateBackup(changed).ready, false);
  }
});

test('legacy expense deletion cannot erase the source of a retained confirmed payment', async () => {
  const result = await require('../../services/cash-entry').recordCashEntry(req, { shop: 'A', kind: 'expense', method: 'cash', amount: 0.3,
    description: 'Typed expense', operationId: 'immutable-expense-key', confirmed: true });
  const token = await require('../../middleware/auth').createSession({ clientId: req.session.clientId, role: 'admin', validShops: ['A', 'B'], authVersion: req.session.authVersion });
  const app = require('../../app').createApp({ config: require('../../config/runtime').readRuntimeConfig() });
  await require('../helpers/http.cjs').withApp(app, async request => {
    const date = require('../../public/js/business-rules').businessDate();
    const sheet = await request('/api/days/A/' + date, { headers: { Authorization: 'Bearer ' + token } });
    assert.equal(sheet.status, 200); assert.equal((await sheet.json()).cashFormatVersion, 1);
    const oldWriter = await request('/api/shopexpenses', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop: 'A', date, amount: 0.4, description: 'Unclassified legacy payment' }) });
    assert.equal(oldWriter.status, 428);
    const response = await request('/api/shopexpenses/' + result.entryId, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
    assert.equal(response.status, 409); assert.equal((await response.json()).code, 'CASH_ENTRY_IMMUTABLE');
  });
  assert.equal(await models.ShopExpense.countDocuments(), 1); assert.equal(await models.CashEntry.countDocuments(), 1);
});


test('bounded cash source reading shares a consistent transaction and reconciles actual transfers without duplicating expense rows', async () => {
  const { recordCashEntry } = require('../../services/cash-entry');
  const { readCashSources } = require('../../services/cash-sources');
  const at = new Date('2026-11-10T03:00:00.000Z');
  await recordCashEntry(req, { shop: 'A', kind: 'expense', method: 'cash', amount: 0.1, description: 'Paid expense', confirmed: true, operationId: 'cash-read-expense' }, { now: at });
  await recordCashEntry(req, { shop: 'A', kind: 'transfer', toShop: 'B', method: 'cash', amount: 0.2, description: 'Completed transfer', confirmed: true, operationId: 'cash-read-transfer' }, { now: at });
  const read = shop => require('../../services/inventory-identity').inventoryTransaction(req.tenantDb, session => readCashSources(models, {
    shop, validShops: req.validShops, cutoverAt: at.toISOString(), session }));
  const flows = await read('A'); assert.equal(flows.length, 2);
  const calculate = rows => require('../../services/cash-calculation').calculateCash({ openingMinor: 100, cutoverAt: at.toISOString(), untilAt: at.toISOString(), flows: rows });
  assert.equal(calculate(flows).expectedMinor, 70);
  assert.equal(calculate(await read('B')).expectedMinor, 120);
});


test('a financial close joins an outer cash transaction and rolls back its posting advancement on failure', async () => {
  const date = require('../../public/js/business-rules').businessDate();
  await assert.rejects(require('../../services/inventory-identity').inventoryTransaction(req.tenantDb, async session => {
    await require('../../services/day-service').mutateDay({ connection: req.tenantDb, models, actor: { role: 'admin' }, validShops: req.validShops,
      shop: 'A', date, payload: { expectedRevision: 0 }, action: 'close', operationId: 'outer-cash-close', session });
    throw Error('cash proof failed');
  }), /cash proof failed/);
  assert.equal(await models.Day.countDocuments(), 0); assert.equal(await models.DayVersion.countDocuments(), 0);
  assert.equal(await models.DayOperation.countDocuments(), 0); assert.equal(await models.AccountingState.countDocuments(), 0);
});


test('retried payment transactions refresh occurrence time so a concurrent counted cutover cannot lose the payment', async () => {
  const create = models.AuditLog.create; let firstAt, injected = false;
  models.AuditLog.create = async function(rows, ...rest) {
    const audit = rows.find(row => row.action === 'cash_entry_record');
    if (audit && !injected) {
      injected = true; firstAt = audit.details.occurredAt;
      await new Promise(resolve => setTimeout(resolve, 20));
      throw new fixture.db.mongoose.mongo.MongoServerError({ message: 'simulated transaction retry', errorLabels: ['TransientTransactionError'] });
    }
    return create.call(this, rows, ...rest);
  };
  try {
    const result = await require('../../services/cash-entry').recordCashEntry(req, { shop: 'A', kind: 'income', method: 'cash', amount: 0.1,
      description: 'Retried actual receipt', confirmed: true, operationId: 'cash-time-retry' });
    assert.ok(injected); assert.ok(result.occurredAt > firstAt, result.occurredAt + ' must follow ' + firstAt);
    assert.equal(await models.CashEntry.countDocuments(), 1);
  } finally { models.AuditLog.create = create; }
});
