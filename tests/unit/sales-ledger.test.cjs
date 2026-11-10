const { test } = require('node:test');
const assert = require('node:assert/strict');
const { saleEvents } = require('../../services/sales-ledger');
const { sumSaleEvents } = require('../../public/js/business-rules');

test('original sale and reversal keep separate Karachi business dates', () => {
  const events = saleEvents({ _id: '123', salePrice: 0.3, buyPrice: 0.1, profit: 0.19999999999999998,
    soldAt: '2026-10-31T20:00:00.000Z', reversedAt: '2026-11-08T20:00:00.000Z', reversalId: 'return_123' });
  assert.deepEqual(events.map(e => [e.businessDate, e.units, e.salePriceMinor, e.profitMinor]), [
    ['2026-11-01', 1, 30, 20], ['2026-11-09', -1, -30, -20] ]);
  assert.equal(sumSaleEvents(events).revenue, 0);
  assert.equal(events[0].reversedAt, '2026-11-08T20:00:00.000Z');
  assert.equal(events[1].kind, 'reversal');
});
test('financial ledger refuses inconsistent or overprecision stored money', () => {
  for (const values of [{ salePrice: 1.234, buyPrice: 0, profit: 1.234 },
    { salePrice: 2, buyPrice: 1, profit: 2 },
    { salePrice: 2, buyPrice: 1, profit: 1, salePriceMinor: 201, buyPriceMinor: 100, profitMinor: 101 }]) {
    assert.throws(() => saleEvents({ ...values, soldAt: '2026-11-09T00:00:00.000Z' }), /review/i);
  }
});
