const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectionNames, checksum, validateBackup } = require('../../services/backup-validation');

function backup() {
  const collections = Object.fromEntries(collectionNames.map(name => [name, []]));
  const doc = { version: 2, format: 'stockly-tenant', exportedAt: '2026-11-09T00:00:00.000Z',
    source: { clientId: 'fixture', shops: ['A'], currency: 'PKR', timeZone: 'Asia/Karachi' }, collections,
    manifest: { counts: Object.fromEntries(collectionNames.map(name => [name, 0])), excluded: ['masterClients', 'sessions', 'recoveryControl'] } };
  return sign(doc);
}
function sign(doc) {
  for (const name of collectionNames) doc.manifest.counts[name] = doc.collections[name].length;
  doc.checksum = checksum(doc); return doc;
}
const phone = { _id: '123456789012345678901234', imei: '600000000000000', shop: 'A', status: 'in_stock', buyPrice: 0.1 };
test('the backup catalogue covers every exported business schema and excludes recovery controls', () => {
  const schemas = Object.keys(require('../../db')).filter(name => name.endsWith('Schema') && !name.startsWith('Recovery')).map(name => name.slice(0, -6)).sort();
  assert.deepEqual([...require('../../services/backup-validation').allCollectionNames].sort(), schemas);
});
test('complete empty snapshots validate and omitted collections are never invented', () => {
  const doc = backup();
  assert.equal(validateBackup(doc).ready, true);
  delete doc.collections.ProductOperation;
  assert.equal(validateBackup(doc).ready, false);
  assert.ok(validateBackup(doc).issues.some(issue => issue.code === 'COVERAGE'));
});
test('manifest counts and checksum cannot attest changed data', () => {
  const doc = backup(); doc.collections.Phone.push({ ...phone });
  assert.equal(validateBackup(doc).ready, false);
  assert.equal(validateBackup(sign(doc)).ready, true);
  doc.collections.Phone[0].notes = 'Changed';
  assert.ok(validateBackup(doc).issues.some(issue => issue.code === 'CHECKSUM'));
});
test('duplicate locations, unsafe amounts and malformed quantities fail validation', () => {
  for (const mutate of [
    doc => { doc.collections.Phone = [phone, { ...phone, _id: '223456789012345678901234' }]; },
    doc => { doc.collections.Phone = [{ ...phone, buyPrice: 0.123 }]; },
    doc => { doc.collections.Product = [{ _id: phone._id, name: 'Cable', shop: 'A', quantity: -1, buyPrice: 1 }]; },
    doc => { doc.collections.Phone = [{ ...phone, shop: 'UNKNOWN' }]; },
  ]) {
    const doc = backup(); mutate(doc);
    assert.equal(validateBackup(sign(doc)).ready, false);
  }
});
test('active sales must agree with phone state and links', () => {
  const doc = backup();
  doc.collections.Phone = [phone];
  doc.collections.Sale = [{ _id: '323456789012345678901234', phoneId: phone._id, imei: phone.imei, shop: 'A',
    buyPrice: 0.1, salePrice: 0.3, profit: 0.2, soldAt: '2026-11-09T00:00:00.000Z' }];
  assert.equal(validateBackup(sign(doc)).ready, false);
  Object.assign(doc.collections.Phone[0] = { ...phone }, { status: 'sold', salePrice: 0.3, soldAt: doc.collections.Sale[0].soldAt,
    currentSaleId: doc.collections.Sale[0]._id });
  assert.equal(validateBackup(sign(doc)).ready, true);
  doc.collections.Phone[0].buyPrice = 999;
  assert.equal(validateBackup(sign(doc)).ready, false);
});
test('version one files expose missing coverage and unsupported versions fail closed', () => {
  const legacy = validateBackup({ version: 1, phones: [] });
  assert.equal(legacy.ready, false);
  assert.ok(legacy.issues.some(issue => issue.code === 'LEGACY_INCOMPLETE'));
  assert.equal(validateBackup({ version: 999 }).ready, false);
});
test('unknown fields and invalid calendar dates do not disappear through casting', () => {
  const doc = backup();
  doc.collections.Phone = [{ ...phone, unknownField: 'keep-or-reject' }];
  assert.equal(validateBackup(sign(doc)).ready, false);
  doc.collections.Phone = [];
  doc.collections.Day = [{ _id: phone._id, shop: 'A', date: '2026-02-30', expenses: [], cats: {} }];
  assert.equal(validateBackup(sign(doc)).ready, false);
});

test('malformed source metadata returns conflicts rather than throwing', () => {
  for (const shops of [42, true, {}, 'A']) {
    const doc = backup(); doc.source.shops = shops; doc.checksum = checksum(doc);
    assert.equal(validateBackup(doc).ready, false);
  }
  const doc = backup(); doc.masterClients = [{ password: 'must-not-be-imported' }];
  assert.equal(validateBackup(doc).ready, false);
});

test('movement and product receipts must satisfy their original replay contracts', () => {
  const movement = backup(), id = '123456789012345678901234';
  const shipment = { _id: id, date: '2026-11-09', items: [{ imei: phone.imei, entryId: 'broken', buyPrice: 0.1 }] };
  movement.collections.Shipment = [shipment];
  movement.collections.AuditLog = [{ _id: '223456789012345678901234', action: 'warehouse_receive', details: { operationId: 'movement-history' } }];
  movement.collections.InventoryOperation = [{ _id: 'movement-history', fingerprint: 'a'.repeat(64), result: { success: true, shipment } }];
  assert.equal(validateBackup(sign(movement)).ready, false);
  const product = backup(), snapshot = { _id: id, name: 'Cable', normalizedName: 'WRONG', quantity: 2, revision: 0, buyPrice: 0.1, shop: 'A' };
  product.collections.AuditLog = [{ _id: '223456789012345678901234', action: 'product_receive', role: 'admin', details: { operationId: 'product-history', productId: id, quantityAfter: 2, revision: 0 } }];
  product.collections.ProductOperation = [{ _id: 'product-history', fingerprint: 'a'.repeat(64), result: { success: true, product: snapshot, merged: 'wrong' } }];
  assert.equal(validateBackup(sign(product)).ready, false);
});

module.exports = { backup, sign };

function closedFixture(events = []) {
  const { manualData, calculateDay } = require('../../services/day-service');
  const doc = backup(), id = '123456789012345678901234', date = '2026-11-09', snapshotId = `${id}:1`;
  const manual = manualData({}), snapshot = { snapshotId, ruleVersion: 1, shop: 'A', date, revision: 1,
    capturedAt: '2026-11-09T10:00:00.000Z', manual, ledger: events, shopExpenses: [], ...calculateDay({ events, manual }), inventory: { available: false } };
  doc.collections.Day = [{ _id: id, shop: 'A', date, status: 'closed', revision: 1, closedSnapshot: snapshot,
    history: [{ action: 'close', revision: 1, at: snapshot.capturedAt, snapshotId }] }];
  doc.collections.DayVersion = [{ _id: snapshotId, shop: 'A', date, revision: 1, snapshot, createdAt: snapshot.capturedAt }];
  doc.collections.AccountingState = [{ _id: 'A', openDate: '2026-11-10', version: 1 }];
  return doc;
}
test('closed snapshots cannot invent financial events absent from retained sales', () => {
  const doc = closedFixture([{ _id: '223456789012345678901234', kind: 'sale', imei: phone.imei, shop: 'A', businessDate: '2026-11-09',
    salePrice: 1000, buyPrice: 0, profit: 1000, salePriceMinor: 100000, buyPriceMinor: 0, profitMinor: 100000, units: 1 }]);
  const report = validateBackup(sign(doc));
  assert.equal(report.ready, false);
  assert.ok(report.issues.some(issue => issue.code === 'DAY_VERSION_EVENT'));
});
test('reopened history requires retained posting state beyond its previous close', () => {
  const doc = closedFixture();
  doc.collections.Day[0].status = 'open'; doc.collections.Day[0].revision = 2; delete doc.collections.Day[0].closedSnapshot;
  doc.collections.AccountingState = [];
  const report = validateBackup(sign(doc));
  assert.equal(report.ready, false);
  assert.ok(report.issues.some(issue => issue.code === 'ACCOUNTING_PERIOD'));
});
