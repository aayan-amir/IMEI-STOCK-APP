const { test } = require('node:test');
const assert = require('node:assert/strict');
const recovery = require('../../services/backup-validation');
const { createHash } = require('node:crypto');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function evidence(doc, row) {
  row.operations = [{ key: 'stocktake-start-key', fingerprint: digest(['start', row.shop]), revision: 0,
    result: { success: true, stocktakeId: row._id, revision: 0, status: 'open', observationCount: 0 } }];
  row.observations.forEach((observation, index) => row.operations.push({ key: 'stocktake-scan-key-' + index,
    fingerprint: digest(['scan', observation.imei, index]), revision: index + 1,
    result: { success: true, stocktakeId: row._id, revision: index + 1, status: 'open', observationCount: index + 1 } }));
  row.revision = row.observations.length;
  doc.collections.Stocktake.push(row);
  row.operations.forEach((operation, index) => doc.collections.AuditLog.push({ _id: String(index + 100).padStart(24, '0'),
    action: index === 0 ? 'stocktake_start' : 'stocktake_scan', shop: row.shop, role: 'admin', ts: row.startedAt,
    details: { operationId: operation.key, stocktakeId: row._id, ...(index === 0 ? { baselineCount: row.baseline.length } : { imei: row.observations[index - 1].imei, revision: index }) } }));
  return row;
}

function document(version) {
  const names = recovery.namesForVersion(version);
  const collections = Object.fromEntries(names.map(name => [name, []]));
  return { version, format: 'stockly-tenant', exportedAt: '2026-11-10T00:00:00.000Z',
    source: { clientId: 'fixture', shops: ['A'], currency: 'PKR', timeZone: 'Asia/Karachi' }, collections,
    manifest: { counts: Object.fromEntries(names.map(name => [name, 0])), excluded: recovery.excluded } };
}
function sign(doc) {
  doc.manifest.counts = Object.fromEntries(Object.entries(doc.collections).map(([name, rows]) => [name, rows.length]));
  doc.checksum = recovery.checksum(doc);
  return doc;
}
test('v2 coverage remains explicit and v3 requires stock-check metadata coverage', () => {
  assert.equal(recovery.namesForVersion(2).length, 19);
  assert.equal(recovery.namesForVersion(2).includes('Stocktake'), false);
  const doc = sign(document(3));
  assert.equal(recovery.validateBackup(doc).ready, true);
  delete doc.collections.Stocktake;
  assert.equal(recovery.validateBackup(sign(doc)).ready, false);
  assert.equal(recovery.validateBackup(sign(document(2))).ready, true);
});

test('v3 preserves observation evidence without requiring deleted phones to reappear', () => {
  const doc = document(3);
  evidence(doc, { _id: '123456789012345678901234', shop: 'A', status: 'open',
    startedAt: '2026-11-10T00:00:00.000Z', businessDate: '2026-11-10', configuration: 'a'.repeat(64), revision: 0,
    baseline: [{ phoneId: '223456789012345678901234', imei: '001234567890123', fingerprint: 'b'.repeat(64) }],
    observations: [], operations: [] });
  assert.equal(recovery.validateBackup(sign(doc)).ready, true);
  doc.collections.Stocktake[0].baseline.push({ ...doc.collections.Stocktake[0].baseline[0] });
  assert.equal(recovery.validateBackup(sign(doc)).ready, false);
});

test('v3 rejects stock-check custody, revision, observations and operation tampering', () => {
  const valid = { _id: '123456789012345678901234', shop: 'A', status: 'open', startedAt: '2026-11-10T00:00:00.000Z',
    businessDate: '2026-11-10', configuration: 'a'.repeat(64), revision: 0, baseline: [], observations: [], operations: [] };
  for (const patch of [{ shop: 'unknown' }, { revision: -1 }, { status: 'posted' },
    { observations: [{ imei: 'bad', observedAt: valid.startedAt }] },
    { operations: [{ key: 'request-key', fingerprint: 'x', revision: 0 }] }]) {
    const doc = document(3); doc.collections.Stocktake.push({ ...valid, ...patch });
    assert.equal(recovery.validateBackup(sign(doc)).ready, false);
  }
});

test('finished stock checks cannot contain observations from after completion', () => {
  for (const status of ['reviewed', 'cancelled']) {
    const doc = document(3);
    doc.collections.Stocktake.push({ _id: '123456789012345678901234', shop: 'A', status,
      startedAt: '2026-11-10T00:00:00.000Z', finishedAt: '2026-11-10T00:01:00.000Z', businessDate: '2026-11-10',
      configuration: 'a'.repeat(64), revision: 1, baseline: [], operations: [],
      observations: [{ imei: '001234567890123', observedAt: '2026-11-10T01:00:00.000Z' }] });
    assert.equal(recovery.validateBackup(sign(doc)).ready, false);
  }
});

test('stock-check operation receipts reconcile exact scans, status and retained audit evidence', () => {
  const doc = document(3);
  evidence(doc, { _id: '123456789012345678901234', shop: 'A', status: 'open', startedAt: '2026-11-10T00:00:00.000Z',
    businessDate: '2026-11-10', configuration: 'a'.repeat(64), baseline: [], observations: [{ imei: '001234567890123', observedAt: '2026-11-10T00:01:00.000Z' }] });
  assert.equal(recovery.validateBackup(sign(doc)).ready, true);
  for (const mutate of [
    value => { value.collections.Stocktake[0].operations[1].fingerprint = 'c'.repeat(64); },
    value => { value.collections.Stocktake[0].operations[1].result.observationCount = 0; },
    value => { value.collections.Stocktake[0].operations[1].result.status = 'reviewed'; },
    value => { value.collections.AuditLog = []; },
    value => { value.collections.Stocktake[0].operations = []; },
  ]) {
    const changed = structuredClone(doc); mutate(changed);
    assert.equal(recovery.validateBackup(sign(changed)).ready, false);
  }
});
