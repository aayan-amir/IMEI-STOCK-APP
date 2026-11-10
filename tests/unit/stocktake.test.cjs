const { test } = require('node:test');
const assert = require('node:assert/strict');
const { phoneFingerprint, compareStocktake } = require('../../services/stocktake-service');
const phone = { _id: '123456789012345678901234', imei: '001234567890123', shop: 'A', status: 'in_stock', buyPrice: 0.1, updatedAt: '2026-11-10T00:00:00.000Z' };
function count() { return { shop: 'A', configuration: 'config', baseline: [{ phoneId: phone._id, imei: phone.imei, fingerprint: phoneFingerprint(phone) }], observations: [] }; }

test('unobserved unchanged phones are discrepancies without inventory mutations', () => {
  const session = count(), current = [phone], before = JSON.stringify([session, current]);
  const result = compareStocktake(session, current, 'config');
  assert.deepEqual(result.missing, [phone.imei]);
  assert.equal(result.recheckRequired, false);
  assert.equal(JSON.stringify([session, current]), before);
});

test('trading changes require recheck and cannot become missing-phone conclusions', () => {
  for (const patch of [{ status: 'sold' }, { shop: 'B' }, { buyPrice: 0.2 }, { imei: '001234567890124' }, { updatedAt: '2026-11-10T00:01:00.000Z' }]) {
    const result = compareStocktake(count(), [{ ...phone, ...patch }], 'config');
    assert.equal(result.recheckRequired, true);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.changed, [phone.imei]);
  }
  assert.equal(compareStocktake(count(), [], 'config').recheckRequired, true);
  assert.equal(compareStocktake(count(), [phone], 'restored-config').invalidated, true);
});

test('duplicate scans, arrivals and wrong-shop evidence remain separate', () => {
  const session = count();
  const arriving = { ...phone, _id: '223456789012345678901234', imei: '001234567890124' };
  const elsewhere = { ...phone, _id: '323456789012345678901234', imei: '001234567890125', shop: 'B' };
  session.observations = [phone.imei, phone.imei, arriving.imei, elsewhere.imei, '001234567890126'].map(imei => ({ imei }));
  const result = compareStocktake(session, [phone, arriving, elsewhere], 'config');
  assert.deepEqual(result.duplicates, [phone.imei]);
  assert.deepEqual(result.newArrivals, [arriving.imei]);
  assert.deepEqual(result.wrongShop, [elsewhere.imei]);
  assert.deepEqual(result.unexpected, [arriving.imei, elsewhere.imei, '001234567890126']);
  assert.equal(result.recheckRequired, true);
});
