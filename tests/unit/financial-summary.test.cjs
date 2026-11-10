const { test } = require('node:test');
const assert = require('node:assert/strict');
const { financialSummary } = require('../../services/financial-summary');
function models(data = {}) {
  const result = Object.fromEntries(['Sale', 'Day', 'ShopExpense'].map(name => [name, { find() { return { session() { return this; }, async lean() { return data[name] || []; } }; } }]));
  result.CashEntry = { aggregate: () => ({ session: () => ({ option: async () => [] }) }) };
  return result;
}
const scope = { type: 'monthly', period: '2026-11', validShops: ['A'] };
test('invalid stored daily and shop expense amounts demand reconciliation', async () => {
  for (const data of [
    { Day: [{ shop: 'A', date: '2026-11-09', expenses: [{ amt: 0.001 }] }] },
    { ShopExpense: [{ shop: 'A', date: '2026-11-09', amount: 0.001 }] },
    { ShopExpense: [{ shop: 'A', date: '2026-11-09', amount: -1 }] },
  ]) await assert.rejects(financialSummary(models(data), scope), error => error.status === 409 && error.code === 'FINANCIAL_CONFLICT');
});
test('unknown frozen rule versions fail closed rather than using live arithmetic', async () => {
  await assert.rejects(financialSummary(models({ Day: [{ shop: 'A', date: '2026-11-09', revision: 1, status: 'closed',
    closedSnapshot: { shop: 'A', date: '2026-11-09', revision: 1, ruleVersion: 99 } }] }), scope), error => error.code === 'FINANCIAL_CONFLICT');
});
test('monthly cash movement does not add repeated daily opening balances', async () => {
  const result = await financialSummary(models({ Day: ['08', '09'].map(day => ({ shop: 'A', date: `2026-11-${day}`, carryForward: 100 })) }), scope);
  assert.equal(result.financial.cashMovement, 0); assert.equal(result.financial.cashOnHand, null); assert.equal(result.financial.carryForward, null);
});
