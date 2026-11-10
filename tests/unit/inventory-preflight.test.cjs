const { test } = require('node:test');
const assert = require('node:assert/strict');

test('preflight excludes retained reversed sales from active stock checks', () => {
  const { inspectInventory } = require('../../services/inventory-preflight');
  const result = inspectInventory({ phones: [{ imei: '123456789012345', status: 'in_stock' }],
    sales: [{ imei: '123456789012345', reversedAt: '2026-11-09T00:00:00.000Z' }] });
  assert.equal(result.ready, true);
  assert.equal(result.counts.sales, 1);
});

test('preflight reports clean inventory without changing input records', () => {
  const { inspectInventory } = require('../../services/inventory-preflight');
  const input = { phones: [{ _id: 'one', imei: '123456789012345', status: 'in_stock', buyPrice: 0.2, shop: 'A' }], hqItems: [], sales: [] };
  const original = JSON.stringify(input);
  const result = inspectInventory(input);
  assert.equal(result.ready, true);
  assert.deepEqual(result.issues, []);
  assert.equal(JSON.stringify(input), original);
});

test('preflight identifies duplicate and cross-location IMEIs and invalid costs', () => {
  const { inspectInventory } = require('../../services/inventory-preflight');
  const result = inspectInventory({ phones: [
    { _id: 'one', imei: '123456789012345', status: 'in_stock', buyPrice: 100 },
    { _id: 'two', imei: '123456789012345', status: 'in_stock', buyPrice: 0.001 },
    { _id: 'three', imei: 'bad', status: 'in_stock', buyPrice: -1 },
  ], hqItems: [{ imei: '123456789012345', buyPrice: 100 }] });
  assert.equal(result.ready, false);
  for (const type of ['DUPLICATE_IMEI', 'MULTIPLE_LOCATIONS', 'INVALID_IMEI', 'INVALID_COST']) {
    assert.ok(result.issues.some(issue => issue.type === type), type);
  }
});

test('preflight flags ambiguous legacy sale state without leaking buyer data', () => {
  const { inspectInventory } = require('../../services/inventory-preflight');
  const result = inspectInventory({ phones: [{ _id: 'one', imei: '123456789012345', status: 'in_stock', buyPrice: 100 }],
    sales: [{ _id: 'sale', imei: '123456789012345', buyerName: 'PRIVATE CUSTOMER', buyerPhone: 'PRIVATE NUMBER' }] });
  assert.equal(result.ready, false);
  assert.ok(result.issues.some(issue => issue.type === 'SALE_STATE_MISMATCH'));
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});
