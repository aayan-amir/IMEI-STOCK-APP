const { test } = require('node:test');
const assert = require('node:assert/strict');
const { imeiHistory } = require('../../services/imei-history');

test('IMEI evidence rejects inherited object properties as source names', async () => {
  for (const source of ['constructor', 'toString', '__proto__']) {
    await assert.rejects(imeiHistory({ params: { imei: '001234567890123', source }, query: {} }),
      error => error.status === 400 && error.code === 'INVALID_INPUT');
  }
});
