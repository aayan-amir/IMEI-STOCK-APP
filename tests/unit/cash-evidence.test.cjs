const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { cashEntryFingerprint, cashEntryOutcome, cashExpense, isCashEntry } = require('../../services/cash-evidence');
function record(kind = 'income', patch = {}) {
  const operationId = 'cash-evidence-' + kind;
  const row = { _id: createHash('sha256').update(JSON.stringify(['cash-entry', operationId])).digest('hex').slice(0, 24),
    version: 1, operationId, shop: 'A', kind, method: 'bank', currency: 'PKR', amountMinor: 30,
    description: 'Test payment', occurredAt: '2026-11-10T00:00:00.000Z', postingDate: '2026-11-10', confirmed: true,
    ...(kind === 'income' ? { costMinor: 10 } : {}), ...(kind === 'expense' ? { category: 'Other' } : {}),
    ...(kind === 'transfer' ? { toShop: 'B', receivingPostingDate: '2026-11-11' } : {}), ...patch };
  if (kind === 'expense') row.expense = cashExpense(row);
  row.fingerprint = cashEntryFingerprint(row); row.result = cashEntryOutcome(row);
  return row;
}
test('versioned manual payment evidence preserves exact methods, source IDs and paired shop dates', () => {
  for (const kind of ['income', 'expense', 'purchase', 'transfer']) {
    const row = record(kind), before = JSON.stringify(row);
    assert.equal(isCashEntry(row, ['A', 'B']), true);
    assert.equal(JSON.stringify(row), before);
    assert.equal(isCashEntry({ ...row, result: { ...row.result, amountMinor: 31 } }, ['A', 'B']), false);
  }
});
test('safe integer paisa that cannot round-trip through existing PKR source fields is rejected', () => {
  assert.equal(isCashEntry(record('income', { amountMinor: Number.MAX_SAFE_INTEGER }), ['A', 'B']), false);
  assert.equal(isCashEntry(record('income', { costMinor: Number.MAX_SAFE_INTEGER }), ['A', 'B']), false);
});
