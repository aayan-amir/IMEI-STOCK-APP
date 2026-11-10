const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCashSources } = require('../../services/cash-sources');
const { calculateCash } = require('../../services/cash-calculation');
const at = '2026-11-10T03:00:00.000Z';
const sale = { _id: '123456789012345678901234', shop: 'B', soldByShop: 'A', imei: '001234567890123',
  salePrice: 0.3, buyPrice: 0.1, profit: 0.2, soldAt: at, paymentVersion: 1, paymentMethod: 'cash', paidAmountMinor: 30 };
const sources = (rest = {}) => normalizeCashSources({ shop: 'A', validShops: ['A', 'B'], sales: [sale], returns: [], entries: [], expenses: [], ...rest });
const total = flows => calculateCash({ openingMinor: 100, cutoverAt: at, untilAt: at, flows });

test('original receipt belongs to the selling shop once, without owner stock cost or operation duplication', () => {
  assert.equal(total(sources()).expectedMinor, 130);
  assert.equal(total(sources({ shop: 'B' })).expectedMinor, 100);
  assert.equal(total(sources({ sales: [sale, sale] })).expectedMinor, 130);
  assert.equal(total(sources({ sales: [{ ...sale, paymentMethod: 'bank' }] })).expectedMinor, 100);
});

test('legacy unknown tender and corrupt paid amounts require review instead of a cash estimate', () => {
  for (const patch of [{ paymentVersion: undefined }, { paidAmountMinor: 31 }, { paymentMethod: 'credit' }, { salePrice: 'bad' }]) {
    assert.equal(total(sources({ sales: [{ ...sale, ...patch }] })).complete, false);
  }
});

test('accounting reversal without an accepted customer return cannot stand in for a physical refund', () => {
  const flows = sources({ sales: [{ ...sale, reversedAt: at, reversalId: 'reversal_' + sale._id, reversalBusinessDate: '2026-11-10' }] });
  assert.equal(total(flows).expectedMinor, null);
  assert.equal(total(flows).issues[0].code, 'REFUND_UNCLASSIFIED');
});

test('an unlinked legacy expense stays unknown, including a missing actual occurrence', () => {
  const expenses = [{ _id: '223456789012345678901234', shop: 'A', amount: 0.1, addedAt: at }];
  assert.equal(total(sources({ expenses })).expectedMinor, null);
  assert.equal(total(sources({ expenses: [{ ...expenses[0], addedAt: undefined }] })).expectedMinor, null);
});

test('cash source normalization is bounded and does not mutate source evidence', () => {
  const before = JSON.stringify(sale); sources(); assert.equal(JSON.stringify(sale), before);
  assert.throws(() => sources({ sales: Array(5001).fill(sale) }), /limit/i);
  assert.throws(() => sources({ shop: 'unknown' }), /shop/i);
});


function returned(method, paidBy = 'B') {
  const { createHash } = require('node:crypto'), proof = require('../../services/return-evidence');
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const original = { ...sale, phoneId: '323456789012345678901234', reversedAt: at, reversalId: 'reversal_' + sale._id, reversalBusinessDate: '2026-11-10' };
  const row = { _id: sale._id, version: 1, phoneId: original.phoneId, imei: sale.imei, shop: 'B', soldByShop: 'A', amountMinor: 30,
    acceptedAt: at, businessDate: '2026-11-10', reversalId: original.reversalId, operationId: 'return-key', reviewFingerprint: 'a'.repeat(64) };
  row.fingerprint = digest([row._id, 'B', row.reviewFingerprint]); row.result = proof.acceptedReturnOutcome(row);
  if (method) {
    row.refund = { version: 1, operationId: 'refund-key', method, shop: paidBy, amountMinor: 30, occurredAt: at,
      businessDate: '2026-11-10', fingerprint: digest([row._id, method, paidBy, true]) };
    row.refund.result = proof.refundOutcome(row);
  }
  return { sales: [original], returns: [row] };
}

test('full refund follows actual paying shop and method independently of original sale tender', () => {
  assert.equal(total(sources(returned('cash'))).expectedMinor, 130);
  assert.equal(total(sources({ ...returned('cash'), shop: 'B' })).expectedMinor, 70);
  assert.equal(total(sources({ ...returned('bank'), shop: 'B' })).expectedMinor, 100);
  const bankSale = returned('cash'); bankSale.sales[0].paymentMethod = 'bank';
  assert.equal(total(sources({ ...bankSale, shop: 'B' })).expectedMinor, 70);
});

test('pending or corrupt refund proof prevents closing any shop against an assumed payout', () => {
  for (const shop of ['A', 'B']) assert.equal(total(sources({ ...returned(), shop })).expectedMinor, null);
  const bad = returned('cash'); bad.returns[0].refund.amountMinor++;
  assert.equal(total(sources(bad)).expectedMinor, null);
});

test('canonical expenses count once and completed transfers move cash between shops without income cost inference', () => {
  const { createHash } = require('node:crypto'), proof = require('../../services/cash-evidence');
  function entry(kind) {
    const operationId = 'cash-source-' + kind;
    const row = { _id: createHash('sha256').update(JSON.stringify(['cash-entry', operationId])).digest('hex').slice(0, 24),
      operationId, version: 1, shop: 'A', kind, method: 'cash', currency: 'PKR', amountMinor: 10, description: 'Actual payment',
      occurredAt: at, postingDate: '2026-11-10', confirmed: true,
      ...(kind === 'expense' ? { category: 'Other' } : { toShop: 'B', receivingPostingDate: '2026-11-10' }) };
    if (kind === 'expense') row.expense = proof.cashExpense(row);
    row.fingerprint = proof.cashEntryFingerprint(row); row.result = proof.cashEntryOutcome(row); return row;
  }
  const expense = entry('expense'), transfer = entry('transfer');
  const input = { sales: [], entries: [expense, transfer], expenses: [expense.expense] };
  assert.equal(total(sources(input)).expectedMinor, 80);
  assert.equal(total(sources({ ...input, shop: 'B' })).expectedMinor, 110);
  const tampered = { ...expense.expense, amount: 0.2 };
  assert.equal(total(sources({ ...input, expenses: [tampered] })).expectedMinor, null);
});


test('a corrupt refund paid after cutover cannot disappear behind an earlier accepted-return timestamp', () => {
  const input = returned('cash');
  input.sales[0].soldAt = '2026-11-10T01:00:00.000Z';
  input.sales[0].reversedAt = '2026-11-10T02:00:00.000Z';
  input.returns[0].acceptedAt = input.sales[0].reversedAt;
  input.returns[0].result = require('../../services/return-evidence').acceptedReturnOutcome(input.returns[0]);
  input.returns[0].refund.occurredAt = at;
  input.returns[0].refund.result = require('../../services/return-evidence').refundOutcome(input.returns[0]);
  assert.equal(total(sources({ ...input, shop: 'B' })).expectedMinor, 70);
  input.returns[0].refund.amountMinor++;
  assert.equal(total(sources({ ...input, shop: 'B' })).expectedMinor, null);
});


test('conflicting source identities are rejected before shop or time filtering can hide them', () => {
  assert.throws(() => sources({ sales: [sale, { ...sale, soldByShop: 'B' }] }), error => error.code === 'CASH_SOURCE_CONFLICT');
});


test('invalid refund timing cannot hide a new accepted return behind an earlier payout timestamp', () => {
  const input = returned('cash'); input.returns[0].refund.occurredAt = '2026-11-10T02:00:00.000Z';
  assert.equal(total(sources(input)).complete, false);
});
