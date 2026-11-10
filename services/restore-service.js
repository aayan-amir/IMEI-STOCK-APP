'use strict';

const { randomUUID, createHash } = require('node:crypto');
const db = require('../db');
const { HttpError } = require('../utils/http-error');
const { allCollectionNames, namesForVersion, getModels, checksum, validateBackup, MAX_BYTES } = require('./backup-validation');
const { controls, ensureState } = require('./recovery-control');
const { inventoryTransaction } = require('./inventory-identity');
const { readCollections } = require('./backup-service');
const { isDeepStrictEqual } = require('node:util');

const conflict = message => new HttpError(409, message, 'RESTORE_CONFLICT');
const configHash = identity => createHash('sha256').update(JSON.stringify([identity.clientId, identity.authVersion, [...identity.shops].sort()])).digest('hex');

async function reviewRestore({ connection, identity, backup, mode }) {
  if (mode !== 'empty') throw new HttpError(400, 'Only recovery into an empty account is supported.', 'INVALID_RESTORE_MODE');
  const report = validateBackup(backup);
  if (!report.ready) return report;
  if (backup.source.shops.some(shop => !identity.shops.includes(shop))) return { ...report, ready: false, issues: [{ code: 'TARGET_SHOPS' }] };
  const { RecoveryState, RecoveryPlan } = controls(connection);
  await ensureState(RecoveryState);
  const planId = randomUUID(), expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  const state = await inventoryTransaction(connection, async session => {
    const state = await RecoveryState.findById('tenant').session(session).lean();
    if (state.maintenance || state.leases.length) throw conflict('The target is busy. Validate again after its writes finish.');
    const models = getModels(connection);
    for (const name of allCollectionNames) if (await models[name].exists({}).session(session)) return null;
    const changed = await RecoveryState.updateOne({ _id: 'tenant', maintenance: false, epoch: state.epoch, leases: { $size: 0 } },
      { $set: { currentPlanId: planId, planExpiresAt: expiresAt } }, { session });
    if (changed.matchedCount !== 1) throw conflict('Target changed during validation. Validate again.');
    await RecoveryPlan.updateOne({ _id: 'current' }, { $set: { planId, backup, checksum: backup.checksum,
      targetEpoch: state.epoch, targetConfig: configHash(identity), expiresAt } }, { upsert: true, session });
    return state;
  });
  if (!state) return { ...report, ready: false, issues: [{ code: 'TARGET_NOT_EMPTY' }] };
  return { ...report, planId, mode, checksum: backup.checksum, expiresAt: expiresAt.toISOString() };
}
function storageDocument(name, document) {
  const row = { ...document };
  for (const [field, path] of Object.entries(db[`${name}Schema`].paths)) {
    if (row[field] == null) continue;
    if (path.instance === 'ObjectId') row[field] = new db.mongoose.Types.ObjectId(row[field]);
    if (path.instance === 'Date') row[field] = new Date(row[field]);
  }
  return row;
}
async function applyRestore({ connection, identity, planId, operationId }) {
  if (typeof planId !== 'string' || !/^[a-f0-9-]{36}$/.test(planId) || typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(operationId)) throw new HttpError(400, 'A reviewed plan and request key are required.', 'INVALID_INPUT');
  const { RecoveryState, RecoveryPlan, RecoveryReceipt } = controls(connection);
  const replay = await RecoveryReceipt.findById(operationId).lean();
  if (replay) {
    if (replay.planId !== planId || replay.result?.success !== true) throw conflict('This recovery key was already used for a different plan or needs review.');
    return replay.result;
  }
  const plan = await RecoveryPlan.findOne({ _id: 'current', planId }).lean();
  if (!plan || new Date(plan.expiresAt).getTime() <= Date.now() || plan.targetConfig !== configHash(identity)) throw conflict('This plan expired or its account configuration changed. Validate again.');
  if (!validateBackup(plan.backup).ready || checksum(plan.backup) !== plan.checksum || Buffer.byteLength(JSON.stringify(plan.backup)) > MAX_BYTES) throw conflict('Reviewed backup changed or is invalid.');
  const entered = await RecoveryState.findOneAndUpdate({ _id: 'tenant', maintenance: false, epoch: plan.targetEpoch,
    currentPlanId: planId, planExpiresAt: { $gt: new Date() }, leases: { $size: 0 } },
    { $set: { maintenance: true, activePlanId: planId, operationId, phase: 'applying' } }, { returnDocument: 'after' });
  if (!entered) throw conflict('The target changed, is busy, or requires recovery review. Validate again.');
  try {
    return await inventoryTransaction(connection, async session => {
      const state = await RecoveryState.findById('tenant').session(session).lean();
      if (!state.maintenance || state.operationId !== operationId || state.activePlanId !== planId) throw conflict('Recovery ownership changed.');
      const models = getModels(connection);
      for (const name of allCollectionNames) if (await models[name].exists({}).session(session)) throw conflict('The target is no longer empty.');
      for (const name of namesForVersion(plan.backup.version)) {
        const rows = plan.backup.collections[name];
        if (rows.length) await models[name].collection.insertMany(rows.map(row => storageDocument(name, row)), { session, ordered: true });
      }
      const restored = await readCollections(connection, session, plan.backup.version);
      if (!isDeepStrictEqual(restored, plan.backup.collections)) throw conflict('Restored records did not reconcile exactly.');
      const check = validateBackup({ ...plan.backup, collections: restored });
      if (!check.ready) throw conflict('Restored business links did not reconcile.');
      const [audit] = await models.AuditLog.create([{ action: 'restore_apply', role: 'admin', shop: null,
        details: { planId, operationId, checksum: plan.checksum, sourceClientId: plan.backup.source.clientId } }], { session });
      const result = { success: true, planId, checksum: plan.checksum, counts: check.counts, recoveryAuditId: String(audit._id) };
      await RecoveryReceipt.create([{ _id: operationId, planId, checksum: plan.checksum, result }], { session });
      await RecoveryState.updateOne({ _id: 'tenant', operationId, maintenance: true }, { $set: { maintenance: false, phase: 'complete', leases: [] }, $inc: { epoch: 1 } }, { session });
      return result;
    });
  } catch (error) {
    const committed = await RecoveryReceipt.findById(operationId).lean().catch(() => null);
    if (committed?.planId === planId && committed.result?.success === true) return committed.result;
    const uncertain = error.hasErrorLabel?.('UnknownTransactionCommitResult') || /Network|ServerSelection|Topology/i.test(error.name || '');
    if (!uncertain) await RecoveryState.updateOne({ _id: 'tenant', operationId, maintenance: true }, { $set: { maintenance: false, phase: 'aborted' } });
    throw error;
  }
}

module.exports = { reviewRestore, applyRestore };
