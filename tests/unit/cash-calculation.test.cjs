const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateCash } = require('../../services/cash-calculation');
const cutoverAt = '2026-11-10T03:00:00.000Z', untilAt = '2026-11-10T04:00:00.000Z';
const flow = (id, amountMinor, direction = 'in', method = 'cash') => ({ id, amountMinor, direction, method, confirmed: true, occurredAt: '2026-11-10T03:30:00.000Z' });
const calculate = (flows, rest = {}) => calculateCash({ openingMinor: 100, cutoverAt, untilAt, flows, ...rest });
test('physical cash includes actual Cash receipts and refunds, excludes Bank and keeps exact paisa', () => {
  const result = calculate([flow('sale:1', 30), flow('sale:2', 40, 'in', 'bank'), flow('refund:1', 10, 'out')]);
  assert.equal(result.complete, true); assert.equal(result.expectedMinor, 120);
  assert.equal(result.inflowsMinor, 30); assert.equal(result.outflowsMinor, 10);
});
test('pre-cutover unknowns are historical while a post-cutover unknown prevents an expected-cash claim', () => {
  const historical = { ...flow('old:1', 500), method: 'not_recorded', occurredAt: '2026-11-09T03:30:00.000Z' };
  assert.equal(calculate([historical]).expectedMinor, 100);
  const result = calculate([historical, { ...flow('sale:1', 30), method: 'not_recorded' }]);
  assert.equal(result.complete, false); assert.equal(result.expectedMinor, null);
  assert.equal(result.issues[0].id, 'sale:1');
});
test('same retained payment identity is counted once but conflicting duplicates require review', () => {
  assert.equal(calculate([flow('sale:1', 30), flow('sale:1', 30)]).expectedMinor, 130);
  const result = calculate([flow('sale:1', 30), flow('sale:1', 40)]);
  assert.equal(result.complete, false); assert.equal(result.expectedMinor, null);
  assert.equal(result.issues[0].code, 'CONFLICTING_SOURCE');
});
test('opening-boundary source IDs prevent double counting without losing a later same-millisecond receipt', () => {
  const flows = [{ ...flow('included:1', 50), occurredAt: cutoverAt }, { ...flow('new:1', 30), occurredAt: cutoverAt }];
  assert.equal(calculate(flows, { includedSourceIds: ['included:1'] }).expectedMinor, 130);
});
test('unconfirmed or malformed flows do not become zero, and zero counted opening remains valid', () => {
  assert.equal(calculate([], { openingMinor: 0 }).expectedMinor, 0);
  for (const patch of [{ confirmed: false }, { amountMinor: 0.3 }, { amountMinor: -1 }, { direction: 'unknown' }, { occurredAt: 'invalid' }]) {
    assert.equal(calculate([{ ...flow('source:1', 30), ...patch }]).complete, false);
  }
  assert.throws(() => calculate([], { openingMinor: -1 }), /opening/i);
  assert.throws(() => calculate([flow('sale:1', Number.MAX_SAFE_INTEGER)]), /overflow/i);
});


test('boundary exclusions never hide a later refund or a corrupted occurrence for that identity', () => {
  assert.equal(calculate([flow('refund:old', 30, 'out')], { includedSourceIds: ['refund:old'] }).expectedMinor, 70);
  assert.equal(calculate([{ ...flow('refund:old', 30, 'out'), occurredAt: 'invalid' }], { includedSourceIds: ['refund:old'] }).complete, false);
});


test('an owner-counted baseline can retain undated historical unknowns without hiding changed or new evidence', () => {
  const legacy = { ...flow('expense:legacy', 0, 'out'), occurredAt: undefined, method: undefined, confirmed: false, issue: 'PAYMENT_NOT_RECORDED' };
  assert.equal(calculate([legacy], { historicalUnknownFlows: [legacy] }).expectedMinor, 100);
  assert.equal(calculate([{ ...legacy, issue: 'PAYMENT_EVIDENCE_CONFLICT' }], { historicalUnknownFlows: [legacy] }).expectedMinor, null);
  assert.equal(calculate([{ ...legacy, id: 'expense:new' }], { historicalUnknownFlows: [legacy] }).expectedMinor, null);
});


test('a boundary source exclusion cannot certify corrupt or conflicting payment facts', () => {
  const original = { ...flow('included:1', 30), occurredAt: cutoverAt };
  assert.equal(calculate([{ ...original, amountMinor: -1 }], { includedSourceIds: ['included:1'] }).complete, false);
  assert.equal(calculate([original, { ...original, amountMinor: 40 }], { includedSourceIds: ['included:1'] }).complete, false);
});
