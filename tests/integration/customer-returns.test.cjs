const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestDatabase } = require('../helpers/database.cjs');
const { withApp } = require('../helpers/http.cjs');
let fixture, app, req, models, shopToken, ownerToken, targetReq, targetModels;
before(async () => {
  fixture = await startTestDatabase();
  const client = await fixture.db.Client.create({ clientId: fixture.namespace, adminPassword: 'owner-test', gatePassword: 'shop-test', shops: [{ id: 'A' }, { id: 'B' }] });
  shopToken = await require('../../middleware/auth').createSession({ clientId: client.clientId, role: 'shop', shop: 'A', validShops: ['A', 'B'], authVersion: client.authVersion });
  ownerToken = await require('../../middleware/auth').createSession({ clientId: client.clientId, role: 'admin', validShops: ['A', 'B'], authVersion: client.authVersion });
  const connection = fixture.db.getTenantDb(client.clientId);
  models = require('../../services/backup-validation').getModels(connection);
  req = { tenantDb: connection, authRole: 'admin', validShops: ['A', 'B'], session: { clientId: client.clientId, authVersion: client.authVersion } };
  const target = await fixture.db.Client.create({ clientId: fixture.namespace + '_target', adminPassword: 'owner-test', gatePassword: 'shop-test', shops: [{ id: 'A' }, { id: 'B' }] });
  targetReq = { tenantDb: fixture.db.getTenantDb(target.clientId), authRole: 'admin', validShops: ['A', 'B'], session: { clientId: target.clientId, authVersion: target.authVersion } };
  targetModels = require('../../services/backup-validation').getModels(targetReq.tenantDb);
  app = require('../../app').createApp({ config: { ...require('../../config/runtime').readRuntimeConfig(), fullyPaidSalesEnabled: true, customerReturnsEnabled: true } });
});
beforeEach(async () => { for (const Model of [...Object.values(models), ...Object.values(targetModels)]) await Model.deleteMany({}); });
after(async () => { if (fixture) await fixture.stop(); });
async function sell(key = 'return-sale-key', price = 0.3) {
  return withApp(app, async request => {
    const response = await request('/api/stock/sell', { method: 'POST', headers: { Authorization: 'Bearer ' + shopToken,
      'Content-Type': 'application/json', 'Idempotency-Key': key, 'X-Stockly-Sale-Version': '2' },
      body: JSON.stringify({ imei: '001234567890123', salePrice: price, paymentMethod: 'cash' }) });
    assert.equal(response.status, 200); return (await response.json()).sale;
  });
}
async function originalSale() {
  await models.Phone.create({ imei: '001234567890123', shop: 'B', status: 'in_stock', buyPrice: 0.1 });
  return sell();
}

test('accepted customer return immediately restores stock to original owner and retains the sale without claiming a refund', async () => {
  const service = require('../../services/return-service');
  const sale = await originalSale();
  const review = await service.reviewCustomerReturn(req, sale._id);
  assert.equal(review.receivingShop, 'B'); assert.equal(review.sellingShop, 'A');
  const result = await service.acceptCustomerReturn(req, { saleId: sale._id, receivingShop: 'B', reviewFingerprint: review.reviewFingerprint, operationId: 'accept-return-key' });
  assert.equal(result.stockRestored, true); assert.equal(result.refundStatus, 'not_recorded');
  const phone = await models.Phone.findOne({});
  assert.equal(phone.status, 'in_stock'); assert.equal(phone.shop, 'B'); assert.equal(phone.buyPrice, 0.1);
  const retained = await models.Sale.findById(sale._id);
  assert.ok(retained.reversedAt); assert.equal(retained.salePrice, 0.3); assert.equal(retained.paymentMethod, 'cash');
  assert.equal(await models.CustomerReturn.countDocuments(), 1);
});

test('return and refund replay target original sale after resale and cannot restore or refund the newer sale twice', async () => {
  const service = require('../../services/return-service');
  const sale = await originalSale(), review = await service.reviewCustomerReturn(req, sale._id);
  const command = { saleId: sale._id, receivingShop: 'B', reviewFingerprint: review.reviewFingerprint, operationId: 'accept-replay-key' };
  const accepted = await service.acceptCustomerReturn(req, command);
  const resale = await sell('resale-return-key', 0.4);
  assert.deepEqual(await service.acceptCustomerReturn(req, command), accepted);
  const refundCommand = { saleId: sale._id, method: 'bank', paidByShop: 'B', confirmed: true, operationId: 'refund-replay-key' };
  const refund = await service.recordCustomerRefund(req, refundCommand);
  assert.equal(refund.amountMinor, 30); assert.equal(refund.method, 'bank');
  assert.deepEqual(await service.recordCustomerRefund(req, refundCommand), refund);
  await assert.rejects(service.recordCustomerRefund(req, { ...refundCommand, method: 'cash' }), error => error.status === 409);
  await assert.rejects(service.recordCustomerRefund(req, { ...refundCommand, operationId: 'second-refund-key' }), error => error.status === 409);
  const current = await models.Phone.findOne({});
  assert.equal(current.status, 'sold'); assert.equal(String(current.currentSaleId), resale._id);
  assert.equal((await models.Sale.findById(resale._id)).reversedAt, undefined);
  assert.equal(await models.CustomerReturn.countDocuments(), 1);
  assert.equal(await models.AuditLog.countDocuments({ action: 'customer_refund' }), 1);
});

test('customer return rejects wrong destination, stale sale target, staff and unconfirmed refund', async () => {
  const service = require('../../services/return-service');
  const sale = await originalSale(), review = await service.reviewCustomerReturn(req, sale._id);
  const command = { saleId: sale._id, receivingShop: 'B', reviewFingerprint: review.reviewFingerprint, operationId: 'invalid-return-key' };
  await assert.rejects(service.acceptCustomerReturn(req, { ...command, receivingShop: 'A' }), error => error.status === 409);
  await assert.rejects(service.acceptCustomerReturn(req, { ...command, reviewFingerprint: 'c'.repeat(64) }), error => error.status === 409);
  await assert.rejects(service.acceptCustomerReturn({ ...req, authRole: 'shop' }, command), error => error.status === 403);
  assert.equal((await models.Phone.findOne({})).status, 'sold');
  await service.acceptCustomerReturn(req, command);
  await assert.rejects(service.recordCustomerRefund(req, { saleId: sale._id, method: 'cash', paidByShop: 'B', confirmed: false, operationId: 'unconfirmed-refund-key' }), error => error.status === 400);
});

test('customer return audit failure rolls back the stock restoration and accounting correction', async () => {
  const service = require('../../services/return-service');
  const sale = await originalSale(), review = await service.reviewCustomerReturn(req, sale._id);
  const original = models.AuditLog.create;
  models.AuditLog.create = async function (rows, ...args) {
    if (rows[0].action === 'customer_return') throw Error('injected return audit failure');
    return original.call(this, rows, ...args);
  };
  try {
    await assert.rejects(service.acceptCustomerReturn(req, { saleId: sale._id, receivingShop: 'B', reviewFingerprint: review.reviewFingerprint, operationId: 'rollback-return-key' }), /injected/);
  } finally { models.AuditLog.create = original; }
  assert.equal((await models.Phone.findOne({})).status, 'sold');
  assert.equal((await models.Sale.findById(sale._id)).reversedAt, undefined);
  assert.equal(await models.CustomerReturn.countDocuments(), 0);
});

test('return and confirmed refund round-trip source links and original replay results, rejecting tampered evidence', async () => {
  const service = require('../../services/return-service');
  const sale = await originalSale(), review = await service.reviewCustomerReturn(req, sale._id);
  const command = { saleId: sale._id, receivingShop: 'B', reviewFingerprint: review.reviewFingerprint, operationId: 'recovery-return-key' };
  const accepted = await service.acceptCustomerReturn(req, command);
  const refundCommand = { saleId: sale._id, method: 'bank', paidByShop: 'B', confirmed: true, operationId: 'recovery-refund-key' };
  const refund = await service.recordCustomerRefund(req, refundCommand);
  const backup = await require('../../services/backup-service').createBackup({ connection: req.tenantDb, clientId: req.session.clientId, shops: req.validShops, version: 3 });
  assert.equal(backup.validation.ready, true, JSON.stringify(backup.validation));
  const rules = require('../../services/backup-validation');
  for (const mutate of [
    value => { value.collections.CustomerReturn[0].amountMinor = 31; },
    value => { value.collections.CustomerReturn[0].result.receivingShop = 'A'; },
    value => { value.collections.CustomerReturn[0].refund.result.method = 'cash'; },
    value => { value.collections.CustomerReturn[0].refund.amountMinor = 29; },
    value => { value.collections.CustomerReturn[0].refund.fingerprint = 'c'.repeat(64); },
    value => { value.collections.AuditLog = value.collections.AuditLog.filter(row => row.action !== 'customer_refund'); },
  ]) {
    const changed = structuredClone(backup); mutate(changed);
    changed.manifest.counts.AuditLog = changed.collections.AuditLog.length;
    changed.checksum = rules.checksum(changed);
    assert.equal(rules.validateBackup(changed).ready, false);
  }
  const identity = { clientId: targetReq.session.clientId, authVersion: targetReq.session.authVersion, shops: targetReq.validShops };
  const recovery = require('../../services/restore-service');
  const plan = await recovery.reviewRestore({ connection: targetReq.tenantDb, identity, backup, mode: 'empty' });
  assert.equal(plan.ready, true, JSON.stringify(plan));
  assert.equal((await recovery.applyRestore({ connection: targetReq.tenantDb, identity, planId: plan.planId, operationId: 'restore-customer-return-key' })).success, true);
  assert.deepEqual(await service.acceptCustomerReturn(targetReq, command), accepted);
  assert.deepEqual(await service.recordCustomerRefund(targetReq, refundCommand), refund);
  assert.equal(await targetModels.CustomerReturn.countDocuments(), 1);
});

test('refund audit failure retains the accepted return but records no payout proof', async () => {
  const service = require('../../services/return-service');
  const sale = await originalSale(), review = await service.reviewCustomerReturn(req, sale._id);
  await service.acceptCustomerReturn(req, { saleId: sale._id, receivingShop: 'B', reviewFingerprint: review.reviewFingerprint, operationId: 'refund-rollback-return' });
  const original = models.AuditLog.create;
  models.AuditLog.create = async () => { throw Error('injected refund audit failure'); };
  const command = { saleId: sale._id, method: 'cash', paidByShop: 'B', confirmed: true, operationId: 'refund-rollback-key' };
  try { await assert.rejects(service.recordCustomerRefund(req, command), /injected/); }
  finally { models.AuditLog.create = original; }
  assert.equal((await models.CustomerReturn.findById(sale._id)).refund, undefined);
  assert.equal((await models.Phone.findOne({})).status, 'in_stock');
  assert.ok((await models.Sale.findById(sale._id)).reversedAt);
  assert.equal((await service.recordCustomerRefund(req, command)).amountMinor, 30);
});

test('return correction and actual refund preserve separate shops and current-open posting dates', async () => {
  const service = require('../../services/return-service');
  const sale = await originalSale(), review = await service.reviewCustomerReturn(req, sale._id);
  const { businessDate, periodBounds } = require('../../public/js/business-rules');
  const tomorrow = businessDate(new Date(periodBounds(businessDate(), 'daily').end));
  const later = businessDate(new Date(periodBounds(tomorrow, 'daily').end));
  await models.AccountingState.updateOne({ _id: 'A' }, { $set: { openDate: tomorrow } });
  await models.AccountingState.create({ _id: 'B', openDate: later, version: 1 });
  const accepted = await service.acceptCustomerReturn(req, { saleId: sale._id, receivingShop: 'B', reviewFingerprint: review.reviewFingerprint, operationId: 'period-return-key' });
  assert.equal(accepted.businessDate, tomorrow);
  const refund = await service.recordCustomerRefund(req, { saleId: sale._id, method: 'bank', paidByShop: 'B', confirmed: true, operationId: 'period-refund-key' });
  assert.equal(refund.businessDate, later); assert.equal(refund.paidByShop, 'B');
  assert.equal((await models.Sale.findById(sale._id)).soldByShop, 'A');
  assert.equal((await models.Sale.findById(sale._id)).reversalBusinessDate, tomorrow);
});

test('owner return API requires reviewed original sale and records actual full refund separately', async () => {
  const sale = await originalSale();
  const owner = { headers: { Authorization: 'Bearer ' + ownerToken } };
  const post = (body, key) => ({ method: 'POST', headers: { ...owner.headers, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) });
  await withApp(app, async request => {
    const url = '/api/customer-returns/review/' + sale._id;
    assert.equal((await request(url, { headers: { Authorization: 'Bearer ' + shopToken } })).status, 403);
    const reviewResponse = await request(url, owner); assert.equal(reviewResponse.status, 200);
    const review = await reviewResponse.json();
    const body = { saleId: sale._id, receivingShop: 'B', reviewFingerprint: review.reviewFingerprint };
    assert.equal((await request('/api/customer-returns', post({ ...body, amountMinor: 999 }, 'bad-return-body'))).status, 400);
    assert.equal((await request('/api/customer-returns', post(body, 'api-return-key'))).status, 200);
    const returned = await (await request(url, owner)).json();
    assert.equal(returned.alreadyReturned, true); assert.equal(returned.refund, null);
    const refund = await request('/api/customer-returns/' + sale._id + '/refund', post({ method: 'bank', paidByShop: 'B', confirmed: true }, 'api-refund-key'));
    assert.equal(refund.status, 200);
    assert.equal((await refund.json()).amountMinor, 30);
    assert.equal((await (await request(url, owner)).json()).refund.method, 'bank');
  });
});

test('customer return activation is enforced before direct commands', async () => {
  const sale = await originalSale();
  const disabled = require('../../app').createApp({ config: { ...require('../../config/runtime').readRuntimeConfig(), customerReturnsEnabled: false } });
  await withApp(disabled, async request => {
    const response = await request('/api/customer-returns', { method: 'POST', headers: { Authorization: 'Bearer ' + ownerToken,
      'Content-Type': 'application/json', 'Idempotency-Key': 'disabled-return-key' }, body: JSON.stringify({ saleId: sale._id }) });
    assert.equal(response.status, 503);
  });
  assert.equal((await models.Phone.findOne({})).status, 'sold');
});

test('review and replay reject corrupted retained return and refund acknowledgments without touching current stock', async () => {
  const service = require('../../services/return-service');
  const sale = await originalSale(), review = await service.reviewCustomerReturn(req, sale._id);
  const command = { saleId: sale._id, receivingShop: 'B', reviewFingerprint: review.reviewFingerprint, operationId: 'corrupt-return-key' };
  const accepted = await service.acceptCustomerReturn(req, command);
  const resale = await sell('corrupt-resale-key', 0.4);
  await models.CustomerReturn.updateOne({ _id: sale._id }, { $set: { 'result.amountMinor': 999 } });
  await assert.rejects(service.acceptCustomerReturn(req, command), error => error.status === 409);
  await assert.rejects(service.reviewCustomerReturn(req, sale._id), error => error.status === 409);
  await models.CustomerReturn.updateOne({ _id: sale._id }, { $set: { result: accepted } });
  const refundCommand = { saleId: sale._id, method: 'bank', paidByShop: 'B', confirmed: true, operationId: 'corrupt-refund-key' };
  await service.recordCustomerRefund(req, refundCommand);
  await models.CustomerReturn.updateOne({ _id: sale._id }, { $set: { 'refund.result.method': 'cash' } });
  await assert.rejects(service.recordCustomerRefund(req, refundCommand), error => error.status === 409);
  await assert.rejects(service.reviewCustomerReturn(req, sale._id), error => error.status === 409);
  assert.equal(String((await models.Phone.findOne({})).currentSaleId), resale._id);
});


for (const action of ['customer_return', 'customer_refund']) test(action + ' transaction retry refreshes its occurrence at the successful publication', async () => {
  const service = require('../../services/return-service'), sale = await originalSale();
  const review = await service.reviewCustomerReturn(req, sale._id);
  const command = { saleId: sale._id, receivingShop: 'B', reviewFingerprint: review.reviewFingerprint, operationId: 'return-time-retry' };
  if (action === 'customer_refund') await service.acceptCustomerReturn(req, command);
  const create = models.AuditLog.create; let firstAt, injected = false;
  models.AuditLog.create = async function(rows, options) {
    if (rows.some(row => row.action === action) && !injected) {
      injected = true;
      const row = await models.CustomerReturn.findById(sale._id).session(options.session).lean();
      firstAt = action === 'customer_return' ? row.acceptedAt : row.refund.occurredAt;
      await new Promise(resolve => setTimeout(resolve, 20));
      throw new fixture.db.mongoose.mongo.MongoServerError({ message: 'simulated return retry', errorLabels: ['TransientTransactionError'] });
    }
    return create.call(this, rows, options);
  };
  try {
    const result = action === 'customer_return' ? await service.acceptCustomerReturn(req, command) :
      await service.recordCustomerRefund(req, { saleId: sale._id, method: 'cash', paidByShop: 'B', confirmed: true, operationId: 'refund-time-retry' });
    const at = action === 'customer_return' ? result.acceptedAt : result.occurredAt;
    assert.ok(injected); assert.ok(at > firstAt, at + ' must follow ' + firstAt);
  } finally { models.AuditLog.create = create; }
});
