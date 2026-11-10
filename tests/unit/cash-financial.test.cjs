const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readCashFinancialEntries } = require('../../services/cash-financial');
test('an empty cash-source preflight avoids a redundant document fetch on legacy financial views', async () => {
  let reads = 0;
  const Model = { aggregate: () => ({ session: () => ({ option: async () => [] }) }), find: () => { reads++; throw Error('Unexpected document fetch'); } };
  assert.deepEqual(await readCashFinancialEntries({ Day: { db: {} }, CashEntry: Model }, { shop: 'A', date: '2026-11-10', validShops: ['A'] }), []);
  assert.equal(reads, 0);
});
