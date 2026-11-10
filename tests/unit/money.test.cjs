const { test } = require('node:test');
const assert = require('node:assert/strict');

test('PKR parsing preserves exact two-decimal minor units', () => {
  const { parseMinorUnits } = require('../../public/js/business-rules');
  for (const [input, expected] of [['0', 0], [0.2, 20], ['100.10', 10010], ['0001.01', 101], [' 12.50 ', 1250]]) {
    assert.equal(parseMinorUnits(input), expected);
  }
});

test('money parser rejects coercions, ambiguous precision, infinities and unsafe ranges', () => {
  const { parseMinorUnits } = require('../../public/js/business-rules');
  for (const input of ['', null, undefined, true, {}, [], -1, Infinity, NaN, '1e3', '0.001', '1,000', '9007199254740992']) {
    assert.throws(() => parseMinorUnits(input), /amount/i);
  }
});

test('large amounts retain cents up to the safe minor-unit limit', () => {
  const { parseMinorUnits } = require('../../public/js/business-rules');
  assert.equal(parseMinorUnits('90071992547409.91'), Number.MAX_SAFE_INTEGER);
  assert.throws(() => parseMinorUnits('90071992547409.92'), /amount/i);
});
