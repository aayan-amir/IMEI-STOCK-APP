const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const evidence = require('../../services/return-evidence');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id = '123456789012345678901234';
const sale = { _id: id, phoneId: '223456789012345678901234', imei: '001234567890123', shop: 'B', soldByShop: 'A',
  salePrice: 0.3, buyPrice: 0.1, profit: 0.2, soldAt: '2026-11-09T00:00:00.000Z',
  reversedAt: '2026-11-10T00:00:00.000Z', reversalId: 'reversal_' + id, reversalBusinessDate: '2026-11-10' };
function record() {
  const row = { _id: id, version: 1, phoneId: sale.phoneId, imei: sale.imei, shop: 'B', soldByShop: 'A', amountMinor: 30,
    acceptedAt: sale.reversedAt, businessDate: sale.reversalBusinessDate, reversalId: sale.reversalId, operationId: 'return-key', reviewFingerprint: 'a'.repeat(64) };
  row.fingerprint = digest([id, 'B', row.reviewFingerprint]); row.result = evidence.acceptedReturnOutcome(row);
  return row;
}
test('retained return validation uses original sale facts without present-custody assumptions', () => {
  const row = record(), before = JSON.stringify([row, sale]);
  assert.equal(evidence.isRetainedReturn(row, sale), true);
  assert.equal(evidence.isRetainedRefund(row, ['A', 'B']), true);
  assert.equal(JSON.stringify([row, sale]), before);
  for (const patch of [{ amountMinor: 31 }, { shop: 'A' }, { phoneId: 'bad' }, { acceptedAt: 'invalid' }, { result: { success: true } }]) {
    assert.equal(evidence.isRetainedReturn({ ...row, ...patch }, sale), false);
  }
});
test('confirmed refund evidence requires its exact amount, occurrence and configured paying shop', () => {
  const row = record();
  row.refund = { version: 1, operationId: 'refund-key', method: 'bank', shop: 'B', amountMinor: 30,
    occurredAt: '2026-11-11T00:00:00.000Z', businessDate: '2026-11-11', fingerprint: digest([id, 'bank', 'B', true]) };
  row.refund.result = evidence.refundOutcome(row);
  assert.equal(evidence.isRetainedRefund(row, ['B']), true);
  assert.equal(evidence.isRetainedRefund(row, ['A']), false);
  for (const patch of [{ amountMinor: 29 }, { occurredAt: '2026-11-08T00:00:00.000Z' }, { method: 'credit' }, { result: { success: true } }]) {
    assert.equal(evidence.isRetainedRefund({ ...row, refund: { ...row.refund, ...patch } }, ['B']), false);
  }
});
