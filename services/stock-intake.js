'use strict';

const { performance } = require('node:perf_hooks');
const { HttpError } = require('../utils/http-error');
const { inventoryTransaction, lockInventory, assertNotInHQ } = require('./inventory-identity');
const { normalizeIntake, intakeFingerprint, batchEnvelope, isIntakeOperation } = require('./intake-evidence');

async function saveIntake({ connection, models, intent, operationId, actor }) {
  const fingerprint = intakeFingerprint(intent);
  return inventoryTransaction(connection, async session => {
    const previous = await models.InventoryOperation.findById(operationId).session(session).lean();
    const audits = await models.AuditLog.find({ 'details.intakeVersion': { $exists: true }, 'details.operationId': operationId }).limit(2).session(session).lean();
    if (!previous && audits.length) throw new HttpError(409, 'Retained intake proof needs review before retry', 'INVALID_REQUEST_HISTORY');
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new HttpError(409, 'This request key was already used for a different operation', 'IDEMPOTENCY_CONFLICT');
      if (!isIntakeOperation(previous, audits, [intent.shop])) throw new HttpError(409, 'Saved intake proof needs review before retry', 'INVALID_REQUEST_HISTORY');
      return { phone: previous.result.phone, replayed: true };
    }
    await lockInventory(models, session, [intent.item.imei]);
    await assertNotInHQ(models, session, intent.item.imei);
    if (await models.Phone.exists({ imei: intent.item.imei }).session(session)) throw new HttpError(409, 'IMEI already exists in stock', 'INVENTORY_CONFLICT');
    const addedAt = new Date().toISOString();
    const [created] = await models.Phone.create([{ ...intent.item, shop: intent.shop, status: 'in_stock', addedAt }], { session });
    const phone = { _id: String(created._id), ...intent.item, shop: intent.shop, status: 'in_stock', addedAt };
    const result = { success: true, kind: 'stock_intake', phone };
    await models.AuditLog.create([{ action: 'stock_add', shop: intent.shop, role: actor.role,
      details: { intakeVersion: 1, operationId, fingerprint, phoneId: phone._id, imei: phone.imei, buyPrice: phone.buyPrice, intake: phone } }], { session });
    await models.InventoryOperation.create([{ _id: operationId, fingerprint, result }], { session });
    return { phone, replayed: false };
  });
}
async function intakeBatch({ connection, models, actor, validShops, payload, budgetMs = 8000, now = () => performance.now() }) {
  const batch = batchEnvelope(payload, actor, validShops), started = now(), outcomes = [];
  let paused = false;
  for (const row of batch.items) {
    if (paused || now() - started >= budgetMs) {
      outcomes.push({ operationId: row.operationId, status: 'pending', error: 'Not attempted. Retry this same request.' }); continue;
    }
    try {
      const intent = normalizeIntake(row.item, batch.shop, validShops);
      const result = await saveIntake({ connection, models, intent, operationId: row.operationId, actor });
      outcomes.push({ operationId: row.operationId, status: 'saved', ...result });
    } catch (error) {
      const reviewRequired = error instanceof HttpError && ['INVALID_REQUEST_HISTORY', 'IDEMPOTENCY_CONFLICT'].includes(error.code);
      const definite = error instanceof HttpError && error.status >= 400 && error.status < 500 && !reviewRequired;
      outcomes.push({ operationId: row.operationId, status: definite ? 'failed' : 'unknown',
        code: definite || reviewRequired ? error.code : 'INTAKE_OUTCOME_UNKNOWN',
        ...(reviewRequired ? { reviewRequired: true } : {}), error: definite || reviewRequired ? error.message : 'Outcome not confirmed. Retry this same request.' });
      if (!definite) paused = true;
    }
  }
  return { success: true, outcomes, counts: Object.fromEntries(['saved', 'failed', 'unknown', 'pending'].map(status => [status, outcomes.filter(row => row.status === status).length])) };
}

module.exports = { intakeBatch };
