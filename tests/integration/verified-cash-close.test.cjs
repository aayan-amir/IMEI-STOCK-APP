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


const cash = () => require('../../services/cash-close');
async function opening(amount = '1.00') {
  const review = await cash().reviewCash(req, 'A');
  assert.equal(review.needsOpening, true);
  return cash().recordCashCheckpoint(req, { shop: 'A', kind: 'opening', amount, confirmed: true, reason: 'Counted till now',
    reviewFingerprint: review.reviewFingerprint, operationId: 'opening-cash-key' });
}

test('owner-counted opening is explicit, exact, replayable and does not invent legacy payments', async () => {
  await assert.rejects(cash().recordCashCheckpoint({ ...req, authRole: 'shop' }, {}), error => error.status === 403);
  const result = await opening();
  assert.equal(result.countedMinor, 100); assert.equal(result.kind, 'opening');
  assert.equal(await models.CashCheckpoint.countDocuments(), 1);
  const preview = await cash().reviewCash(req, 'A');
  assert.equal(preview.calculation.expectedMinor, 100); assert.equal(preview.needsOpening, false);
});

test('verified cash close preserves expected, counted, variance, financial close and original retry outcome', async () => {
  await opening();
  await require('../../services/cash-entry').recordCashEntry(req, { shop: 'A', kind: 'income', method: 'cash', amount: 0.3,
    description: 'Actual receipt', operationId: 'income-cash-key', confirmed: true });
  const review = await cash().reviewCash(req, 'A');
  assert.equal(review.calculation.expectedMinor, 130);
  const command = { shop: 'A', kind: 'close', amount: '1.20', reason: 'Ten paisa short', confirmed: true,
    operationId: 'verified-cash-close', reviewFingerprint: review.reviewFingerprint };
  const result = await cash().recordCashCheckpoint(req, command);
  assert.equal(result.expectedMinor, 130); assert.equal(result.countedMinor, 120); assert.equal(result.differenceMinor, -10);
  assert.equal((await models.Day.findOne({ shop: 'A' })).status, 'closed');
  assert.deepEqual(await cash().recordCashCheckpoint(req, command), result);
  assert.equal(await models.CashCheckpoint.countDocuments(), 2);
});

test('a new payment makes an earlier reviewed cash count stale before any close can commit', async () => {
  await opening(); const review = await cash().reviewCash(req, 'A');
  await require('../../services/cash-entry').recordCashEntry(req, { shop: 'A', kind: 'expense', method: 'bank', amount: 0.1,
    description: 'Actual bank expense', operationId: 'bank-cash-key', confirmed: true });
  await assert.rejects(cash().recordCashCheckpoint(req, { shop: 'A', kind: 'close', amount: '1.00', confirmed: true, reason: '',
    operationId: 'stale-cash-close', reviewFingerprint: review.reviewFingerprint }), error => error.code === 'CASH_REVIEW_STALE');
  assert.equal(await models.Day.countDocuments(), 0); assert.equal(await models.CashCheckpoint.countDocuments(), 1);
});


test('counted cash recovery retains the baseline and refuses altered count, calculation, outcome or chain evidence', async () => {
  await opening();
  const backup = await require('../../services/backup-service').createBackup({ connection: req.tenantDb, clientId: req.session.clientId, shops: req.validShops, version: 3 });
  assert.equal(backup.validation.ready, true, JSON.stringify(backup.validation));
  const rules = require('../../services/backup-validation');
  for (const mutate of [
    value => { value.collections.CashCheckpoint[0].countedMinor++; },
    value => { value.collections.CashCheckpoint[0].calculation.expectedMinor++; },
    value => { value.collections.CashCheckpoint[0].result.countedMinor++; },
    value => { value.collections.CashCheckpoint[0].previousId = 'a'.repeat(24); },
    value => { const row = value.collections.CashCheckpoint[0]; const id = 'sale:' + 'f'.repeat(24);
      row.flows.push({ id, amountMinor: 30, direction: 'in', method: 'cash', occurredAt: row.at, confirmed: true });
      row.baseline.includedSourceIds.push(id);
    },
    value => { delete value.collections.AccountingState.find(row => row._id === 'A').cashCheckpointId; },
  ]) {
    const changed = structuredClone(backup); mutate(changed); changed.checksum = rules.checksum(changed);
    assert.equal(rules.validateBackup(changed).ready, false);
  }
});


test('late cash-close audit failure rolls back the count, financial snapshot and posting cursor together', async () => {
  await opening(); const before = JSON.parse(JSON.stringify(await models.AccountingState.find({}).sort({ _id: 1 }).lean()));
  const review = await cash().reviewCash(req, 'A'); const create = models.AuditLog.create;
  models.AuditLog.create = function(rows, ...rest) {
    if (rows.some(row => row.action === 'cash_close')) throw Error('cash audit unavailable');
    return create.call(this, rows, ...rest);
  };
  try {
    await assert.rejects(cash().recordCashCheckpoint(req, { shop: 'A', kind: 'close', amount: 1, confirmed: true, reason: '',
      operationId: 'rollback-cash-close', reviewFingerprint: review.reviewFingerprint }), /cash audit unavailable/);
  } finally { models.AuditLog.create = create; }
  assert.equal(await models.CashCheckpoint.countDocuments(), 1); assert.equal(await models.Day.countDocuments(), 0);
  assert.equal(await models.DayVersion.countDocuments(), 0); assert.equal(await models.DayOperation.countDocuments(), 0);
  assert.deepEqual(JSON.parse(JSON.stringify(await models.AccountingState.find({}).sort({ _id: 1 }).lean())), before);
});

test('a frozen verified close restores exactly but requires a new physical baseline in the restored account', async () => {
  await opening(); const review = await cash().reviewCash(req, 'A');
  const command = { shop: 'A', kind: 'close', amount: 1, confirmed: true, reason: '', operationId: 'restore-cash-close', reviewFingerprint: review.reviewFingerprint };
  const outcome = await cash().recordCashCheckpoint(req, command);
  const backup = await require('../../services/backup-service').createBackup({ connection: req.tenantDb, clientId: req.session.clientId, shops: req.validShops, version: 3 });
  assert.equal(backup.validation.ready, true, JSON.stringify(backup.validation));
  const recovery = require('../../services/restore-service');
  const identity = { clientId: targetReq.session.clientId, authVersion: targetReq.session.authVersion, shops: targetReq.validShops };
  const plan = await recovery.reviewRestore({ connection: targetReq.tenantDb, identity, backup, mode: 'empty' });
  assert.equal(plan.ready, true, JSON.stringify(plan));
  await recovery.applyRestore({ connection: targetReq.tenantDb, identity, planId: plan.planId, operationId: 'restore-cash-evidence' });
  assert.equal((await cash().reviewCash(targetReq, 'A')).needsOpening, true);
  assert.deepEqual(await cash().recordCashCheckpoint(targetReq, command), outcome);
  assert.equal(await targetModels.CashCheckpoint.countDocuments(), 2);
});


test('counted cutover acknowledges existing undated legacy expenses while a new unknown still blocks verified close', async () => {
  await models.ShopExpense.create({ shop: 'A', date: '2026-11-09', month: '2026-11', amount: 5, description: 'Historical undated expense' });
  await opening(); const review = await cash().reviewCash(req, 'A');
  assert.equal(review.calculation.complete, true); assert.equal(review.calculation.expectedMinor, 100);
  const backup = await require('../../services/backup-service').createBackup({ connection: req.tenantDb, clientId: req.session.clientId, shops: req.validShops, version: 3 });
  assert.equal(backup.validation.ready, true, JSON.stringify(backup.validation));
  const recovery = require('../../services/restore-service'), identity = { clientId: targetReq.session.clientId, authVersion: targetReq.session.authVersion, shops: targetReq.validShops };
  const plan = await recovery.reviewRestore({ connection: targetReq.tenantDb, identity, backup, mode: 'empty' }); assert.equal(plan.ready, true, JSON.stringify(plan));
  await recovery.applyRestore({ connection: targetReq.tenantDb, identity, planId: plan.planId, operationId: 'restore-undated-cash' });
  assert.equal((await cash().reviewCash(targetReq, 'A')).needsOpening, true);
  assert.equal(await targetModels.ShopExpense.countDocuments(), 1);
  await models.ShopExpense.create({ shop: 'A', date: '2026-11-10', month: '2026-11', amount: 2, description: 'Unsupported new undated expense' });
  assert.equal((await cash().reviewCash(req, 'A')).calculation.complete, false);
});


test('cash APIs default off, exclude staff and expose only explicit owner-reviewed payment commands', async () => {
  const auth = require('../../middleware/auth'), { withApp } = require('../helpers/http.cjs');
  const ownerToken = await auth.createSession({ clientId: req.session.clientId, role: 'admin', validShops: req.validShops, authVersion: req.session.authVersion });
  const shopToken = await auth.createSession({ clientId: req.session.clientId, role: 'shop', shop: 'A', validShops: req.validShops, authVersion: req.session.authVersion });
  const config = require('../../config/runtime').readRuntimeConfig();
  const make = enabled => require('../../app').createApp({ config: { ...config, fullyPaidSalesEnabled: enabled, customerReturnsEnabled: enabled, verifiedCashEnabled: enabled } });
  const headers = { Authorization: 'Bearer ' + ownerToken, 'Content-Type': 'application/json', 'Idempotency-Key': 'api-cash-opening' };
  await withApp(make(false), async request => {
    assert.equal((await request('/api/cash/checkpoints', { method: 'POST', headers, body: '{}' })).status, 503);
  });
  await withApp(make(true), async request => {
    assert.equal((await request('/api/cash/A/review', { headers: { Authorization: 'Bearer ' + shopToken } })).status, 403);
    const review = await (await request('/api/cash/A/review', { headers })).json();
    const response = await request('/api/cash/checkpoints', { method: 'POST', headers, body: JSON.stringify({ shop: 'A', kind: 'opening', amount: 1, confirmed: true, reason: 'Counted now', reviewFingerprint: review.reviewFingerprint }) });
    assert.equal(response.status, 200); assert.equal((await response.json()).countedMinor, 100);
    const payment = await request('/api/cash/entries', { method: 'POST', headers: { ...headers, 'Idempotency-Key': 'api-cash-expense' }, body: JSON.stringify({ shop: 'A', kind: 'expense', amount: 0.1, method: 'cash', description: 'Paid now', confirmed: true }) });
    assert.equal(payment.status, 200);
    assert.equal((await (await request('/api/cash/A/review', { headers })).json()).calculation.expectedMinor, 90);
  });
});


test('cross-shop sale, counted close, immediate return, separate refund, resale and empty restore preserve one physical stock and frozen figures', async () => {
  await opening();
  const b = await cash().reviewCash(req, 'B');
  await cash().recordCashCheckpoint(req, { shop: 'B', kind: 'opening', amount: 2, confirmed: true, reason: 'Counted shop B', reviewFingerprint: b.reviewFingerprint, operationId: 'journey-opening-B' });
  await models.Phone.create({ imei: '001234567890123', shop: 'B', status: 'in_stock', buyPrice: 0.1 });
  const sell = (operationId, paymentMethod, salePrice) => require('../../services/stock-sales').sellPhone({ connection: req.tenantDb, models,
    actor: { role: 'shop', shop: 'A' }, validShops: req.validShops, payload: { imei: '001234567890123', salePrice, paymentMethod },
    operationId, tenderRequired: true, clientSaleVersion: '2' });
  const first = await sell('journey-first-sale', 'cash', 0.3);
  const review = await cash().reviewCash(req, 'A'); assert.equal(review.calculation.expectedMinor, 130);
  const close = await cash().recordCashCheckpoint(req, { shop: 'A', kind: 'close', amount: '1.30', confirmed: true, reason: '',
    operationId: 'journey-cash-close', reviewFingerprint: review.reviewFingerprint });
  const frozen = JSON.parse(JSON.stringify(await models.DayVersion.findById(close.daySnapshotId).lean()));
  const returns = require('../../services/return-service'), saleId = String(first.sale._id);
  const originalReview = await returns.reviewCustomerReturn(req, saleId);
  const accept = { saleId, receivingShop: 'B', reviewFingerprint: originalReview.reviewFingerprint, operationId: 'journey-accept-return' };
  const accepted = await returns.acceptCustomerReturn(req, accept);
  assert.equal((await models.Phone.findOne({})).status, 'in_stock');
  assert.equal((await cash().reviewCash(req, 'A')).calculation.complete, false);
  const refund = { saleId, method: 'cash', paidByShop: 'B', confirmed: true, operationId: 'journey-refund' };
  const paid = await returns.recordCustomerRefund(req, refund);
  assert.equal((await cash().reviewCash(req, 'A')).calculation.expectedMinor, 130);
  assert.equal((await cash().reviewCash(req, 'B')).calculation.expectedMinor, 170);
  const second = await sell('journey-second-sale', 'bank', 0.4);
  assert.deepEqual(await returns.acceptCustomerReturn(req, accept), accepted);
  assert.deepEqual(await returns.recordCustomerRefund(req, refund), paid);
  assert.equal(String((await models.Phone.findOne({})).currentSaleId), String(second.sale._id));
  assert.equal((await cash().reviewCash(req, 'A')).calculation.expectedMinor, 130);
  assert.deepEqual(JSON.parse(JSON.stringify(await models.DayVersion.findById(close.daySnapshotId).lean())), frozen);
  const backup = await require('../../services/backup-service').createBackup({ connection: req.tenantDb, clientId: req.session.clientId, shops: req.validShops, version: 3 });
  assert.equal(backup.validation.ready, true, JSON.stringify(backup.validation));
  const recovery = require('../../services/restore-service'), identity = { clientId: targetReq.session.clientId, authVersion: targetReq.session.authVersion, shops: targetReq.validShops };
  const plan = await recovery.reviewRestore({ connection: targetReq.tenantDb, identity, backup, mode: 'empty' }); assert.equal(plan.ready, true, JSON.stringify(plan));
  await recovery.applyRestore({ connection: targetReq.tenantDb, identity, planId: plan.planId, operationId: 'journey-full-restore' });
  assert.deepEqual(await returns.acceptCustomerReturn(targetReq, accept), accepted); assert.deepEqual(await returns.recordCustomerRefund(targetReq, refund), paid);
  assert.equal(await targetModels.Phone.countDocuments(), 1); assert.equal((await targetModels.Phone.findOne({})).status, 'sold');
  assert.equal((await cash().reviewCash(targetReq, 'A')).needsOpening, true);
});


test('close racing an actual cash receipt either rejects the stale count or retains the later receipt after the counted boundary', async () => {
  await opening(); const review = await cash().reviewCash(req, 'A');
  const [close, receipt] = await Promise.allSettled([
    cash().recordCashCheckpoint(req, { shop: 'A', kind: 'close', amount: 1, confirmed: true, reason: '', operationId: 'racing-cash-close', reviewFingerprint: review.reviewFingerprint }),
    require('../../services/cash-entry').recordCashEntry(req, { shop: 'A', kind: 'income', method: 'cash', amount: 0.3,
      description: 'Concurrent actual receipt', operationId: 'racing-cash-receipt', confirmed: true }),
  ]);
  assert.equal(receipt.status, 'fulfilled');
  if (close.status === 'rejected') assert.equal(close.reason.code, 'CASH_REVIEW_STALE');
  assert.equal((await cash().reviewCash(req, 'A')).calculation.expectedMinor, 130);
  assert.equal(await models.CashEntry.countDocuments(), 1);
});

test('cash close serializes a concurrent customer return even when the return belongs to another owning shop', async () => {
  await opening(); await models.Phone.create({ imei: '001234567890123', shop: 'B', status: 'in_stock', buyPrice: 0.1 });
  const sold = await require('../../services/stock-sales').sellPhone({ connection: req.tenantDb, models, actor: { role: 'shop', shop: 'A' }, validShops: req.validShops,
    payload: { imei: '001234567890123', salePrice: 0.3, paymentMethod: 'bank' }, operationId: 'return-race-sale', tenderRequired: true, clientSaleVersion: '2' });
  const returns = require('../../services/return-service'), saleId = String(sold.sale._id);
  const original = await returns.reviewCustomerReturn(req, saleId), review = await cash().reviewCash(req, 'A');
  const [close, returned] = await Promise.allSettled([
    cash().recordCashCheckpoint(req, { shop: 'A', kind: 'close', amount: 1, confirmed: true, reason: '', operationId: 'return-race-close', reviewFingerprint: review.reviewFingerprint }),
    returns.acceptCustomerReturn(req, { saleId, receivingShop: 'B', reviewFingerprint: original.reviewFingerprint, operationId: 'return-race-accept' }),
  ]);
  assert.equal(returned.status, 'fulfilled');
  if (close.status === 'rejected') assert.equal(close.reason.code, 'CASH_REVIEW_STALE');
  assert.equal((await cash().reviewCash(req, 'A')).calculation.complete, false);
  assert.equal((await models.Phone.findOne({})).status, 'in_stock');
});


test('legacy expense evidence captured by a counted cutover cannot be erased through old deletion', async () => {
  const expense = await models.ShopExpense.create({ shop: 'A', date: '2026-11-09', month: '2026-11', amount: 5, description: 'Historical undated expense' });
  await opening();
  const token = await require('../../middleware/auth').createSession({ clientId: req.session.clientId, role: 'admin', validShops: req.validShops, authVersion: req.session.authVersion });
  const app = require('../../app').createApp({ config: require('../../config/runtime').readRuntimeConfig() });
  await require('../helpers/http.cjs').withApp(app, async request => {
    assert.equal((await request('/api/shopexpenses/' + expense.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } })).status, 409);
  });
  assert.equal(await models.ShopExpense.countDocuments(), 1);
});


test('an administrative reversal racing counted close stays visible as unclassified refund evidence after publication', async () => {
  await opening(); await models.Phone.create({ imei: '001234567890123', shop: 'B', status: 'in_stock', buyPrice: 0.1 });
  const sold = await require('../../services/stock-sales').sellPhone({ connection: req.tenantDb, models, actor: { role: 'shop', shop: 'A' }, validShops: req.validShops,
    payload: { imei: '001234567890123', salePrice: 0.3, paymentMethod: 'bank' }, operationId: 'admin-race-sale', tenderRequired: true, clientSaleVersion: '2' });
  const review = await cash().reviewCash(req, 'A');
  const [close, reversal] = await Promise.allSettled([
    cash().recordCashCheckpoint(req, { shop: 'A', kind: 'close', amount: 1, confirmed: true, reason: '', operationId: 'admin-race-close', reviewFingerprint: review.reviewFingerprint }),
    require('../../services/sale-reversals').reverseSales({ connection: req.tenantDb, models, actor: { role: 'admin' }, saleIds: [String(sold.sale._id)] }),
  ]);
  assert.equal(reversal.status, 'fulfilled'); if (close.status === 'rejected') assert.equal(close.reason.code, 'CASH_REVIEW_STALE');
  const after = await cash().reviewCash(req, 'A'); assert.equal(after.calculation.complete, false);
  assert.ok(after.calculation.issues.some(issue => issue.code === 'REFUND_UNCLASSIFIED'));
});
