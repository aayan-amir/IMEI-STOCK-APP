const { test } = require('node:test');
const assert = require('node:assert/strict');

test('business dates use Karachi midnight rather than the UTC calendar', () => {
  const rules = require('../../public/js/business-rules');
  assert.equal(rules.businessDate('2026-11-08T20:00:00.000Z'), '2026-11-09');
  assert.equal(rules.businessDate('2026-11-08T18:59:59.000Z'), '2026-11-08');
});

test('period bounds validate dates and use an exclusive zoned end', () => {
  const rules = require('../../public/js/business-rules');
  assert.deepEqual(rules.periodBounds('2026-11-09', 'daily'), { start: '2026-11-08T19:00:00.000Z', end: '2026-11-09T19:00:00.000Z' });
  assert.deepEqual(rules.periodBounds('2026-11', 'monthly'), { start: '2026-10-31T19:00:00.000Z', end: '2026-11-30T19:00:00.000Z' });
  for (const [period, type] of [['2026-02-30', 'daily'], ['2026-13', 'monthly'], ['2026-11', 'daily'], ['2026-11-09', 'monthly']]) assert.throws(() => rules.periodBounds(period, type));
});

test('a DST day has the correct length in a different business zone', () => {
  const rules = require('../../public/js/business-rules');
  const bounds = rules.periodBounds('2026-03-08', 'daily', 'America/New_York');
  assert.equal(new Date(bounds.end) - new Date(bounds.start), 23 * 60 * 60 * 1000);
});

test('signed corrections and totals retain exact paisa', () => {
  const rules = require('../../public/js/business-rules');
  assert.equal(rules.sumMoney([0.1, 0.2, -0.1]), 0.2);
  assert.equal(rules.dayRowCost({ costPerUnit: 0.1, out: 3 }, false), 0.3);
  assert.equal(rules.dayRowCost({ soldCost: 300, costPerUnit: 100, out: 2 }, false), 300);
  assert.deepEqual(rules.sumSaleEvents([
    { salePriceMinor: 20000, buyPriceMinor: 10000, profitMinor: 10000, units: 1 },
    { salePriceMinor: -20000, buyPriceMinor: -10000, profitMinor: -10000, units: -1 },
  ]), { revenue: 0, cost: 0, profit: 0, revenueMinor: 0, costMinor: 0, profitMinor: 0, units: 0 });
});

test('saved day row totals include exact correction cost and net units', () => {
  const rules = require('../../public/js/business-rules');
  assert.deepEqual(rules.sumDayRows({
    PHONE: { rows: [{ soldFor: 0.3, soldCost: 0.1, out: 1 }] },
    EXTRA: { rows: [{ soldFor: -0.3, boughtFor: -0.1, unitsDelta: -1 }] },
  }, { EXTRA: { isExtra: true } }), { revenue: 0, cost: 0, profit: 0, units: 0 });
});
