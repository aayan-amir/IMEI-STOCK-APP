'use strict';

const { createHash } = require('node:crypto');
const { getModels } = require('./backup-validation');
const { inventoryTransaction } = require('./inventory-identity');
const { enterWrite, controls } = require('./recovery-control');
const { touchPeriod, uniqueDay } = require('./accounting-period');
const { calculateCash } = require('./cash-calculation');
const { readCashSources } = require('./cash-sources');
const { mutateDay } = require('./day-service');
const { parseMinorUnits, businessDate } = require('../public/js/business-rules');
const { HttpError } = require('../utils/http-error');
const { checkpointOutcome, isCashCheckpoint } = require('./cash-checkpoint-evidence');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const conflict = message => new HttpError(409, message, 'CASH_REVIEW_STALE');
const owner = req => { if (req.authRole !== 'admin') throw new HttpError(403, 'Owner access required', 'FORBIDDEN'); };

async function cashContext(req, models, shop, session, now) {
  const control = await controls(req.tenantDb).RecoveryState.findById('tenant').session(session).lean();
  const configuration = digest([req.session.clientId, req.session.authVersion, [...req.validShops].sort(), control?.activePlanId || null]);
  const states = await models.AccountingState.find({ _id: { $in: req.validShops } }).sort({ _id: 1 }).session(session).lean();
  const state = states.find(row => row._id === shop);
  const latest = state?.cashCheckpointId ? await models.CashCheckpoint.findById(state.cashCheckpointId).session(session).lean() : null;
  if (state?.cashCheckpointId && (!latest || latest.shop !== shop || !isCashCheckpoint(latest, req.validShops))) throw conflict('Retained counted cash needs review.');
  const active = latest?.configuration === configuration;
  const at = now.toISOString();
  let baseline, flows = [], calculation;
  if (active) {
    baseline = { at: latest.at, countedMinor: latest.countedMinor,
      historicalUnknownFlows: latest.baseline.historicalUnknownFlows || [],
      includedSourceIds: latest.flows.filter(flow => flow.occurredAt === latest.at && flow.confirmed && !flow.issue).map(flow => flow.id) };
    flows = await readCashSources(models, { shop, validShops: req.validShops, cutoverAt: baseline.at, session });
    calculation = calculateCash({ openingMinor: baseline.countedMinor, cutoverAt: baseline.at, untilAt: at, flows, includedSourceIds: baseline.includedSourceIds, historicalUnknownFlows: baseline.historicalUnknownFlows });
  }
  const date = state?.openDate > businessDate(now) ? state.openDate : businessDate(now);
  const day = await uniqueDay(models, session, shop, date);
  const reviewFingerprint = digest([configuration, shop, states.map(row => [row._id, row.version, row.openDate, row.cashCheckpointId || null]), latest?._id || null, flows, day?.revision || 0]);
  return { needsOpening: !active, shop, at, date, configuration, latest, baseline, flows, calculation, reviewFingerprint, dayRevision: day?.revision || 0 };
}

async function reviewCash(req, shop, { now = new Date() } = {}) {
  owner(req);
  if (!req.validShops.includes(shop)) throw new HttpError(400, 'Invalid shop', 'INVALID_SHOP');
  return inventoryTransaction(req.tenantDb, async session => {
    const result = await cashContext(req, getModels(req.tenantDb), shop, session, now);
    return { needsOpening: result.needsOpening, shop, date: result.date, at: result.at, reviewFingerprint: result.reviewFingerprint,
      ...(result.calculation ? { calculation: result.calculation } : {}) };
  });
}

async function recordCashCheckpoint(req, payload, { now } = {}) {
  owner(req);
  const allowed = ['shop', 'kind', 'amount', 'confirmed', 'reason', 'operationId', 'reviewFingerprint'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(field => !allowed.includes(field)) ||
      !req.validShops.includes(payload.shop) || !['opening', 'close'].includes(payload.kind) || payload.confirmed !== true ||
      typeof payload.operationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(payload.operationId) ||
      typeof payload.reviewFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(payload.reviewFingerprint) ||
      typeof payload.reason !== 'string' || payload.reason.length > 500) throw new HttpError(400, 'Confirm the actual counted cash and reviewed shop', 'INVALID_CASH_COUNT');
  let countedMinor;
  try { countedMinor = parseMinorUnits(payload.amount); } catch { throw new HttpError(400, 'Use a nonnegative cash count with two decimal places', 'INVALID_CASH_COUNT'); }
  const reason = payload.reason.trim(), models = getModels(req.tenantDb);
  const id = digest(['cash-checkpoint', payload.operationId]).slice(0, 24);
  const fingerprint = digest([payload.shop, payload.kind, countedMinor, reason, payload.reviewFingerprint]);
  const release = await enterWrite(req.tenantDb);
  try {
    return await inventoryTransaction(req.tenantDb, async session => {
      const retained = await models.CashCheckpoint.findById(id).session(session).lean();
      if (retained) {
        if (retained.fingerprint !== fingerprint || !isCashCheckpoint(retained, req.validShops)) throw conflict('This request differs from its retained cash count or needs evidence review.');
        return retained.result;
      }
      const clock = now || new Date();
      const context = await cashContext(req, models, payload.shop, session, clock);
      if (context.reviewFingerprint !== payload.reviewFingerprint) throw conflict('Payments or the shop changed. Refresh and count the cash again.');
      // Pending refunds can affect any paying shop. Lock every configured period so
      // a return/refund cannot publish between this review and its committed count.
      for (const shop of [...req.validShops].sort()) await touchPeriod(models, session, shop, clock);
      if (payload.kind === 'close' && context.needsOpening) throw conflict('Count an opening balance for this account first.');
      if (payload.kind === 'opening' && reason.length < 3) throw new HttpError(400, 'Explain this counted opening or new baseline', 'CASH_REASON_REQUIRED');
      let baseline = context.baseline, flows = context.flows, calculation = context.calculation, daySnapshotId;
      if (payload.kind === 'opening') {
        flows = await readCashSources(models, { shop: payload.shop, validShops: req.validShops, cutoverAt: context.at, session });
        const historicalUnknownFlows = flows.filter(flow => !flow.occurredAt && flow.confirmed === false && flow.issue === 'PAYMENT_NOT_RECORDED');
        flows = flows.filter(flow => flow.occurredAt === context.at && flow.confirmed && !flow.issue).concat(historicalUnknownFlows);
        baseline = { at: context.at, countedMinor, includedSourceIds: flows.filter(flow => flow.confirmed).map(flow => flow.id), historicalUnknownFlows };
        calculation = calculateCash({ openingMinor: countedMinor, cutoverAt: context.at, untilAt: context.at, flows, includedSourceIds: baseline.includedSourceIds, historicalUnknownFlows });
      } else {
        if (!calculation.complete) throw new HttpError(409, 'Cash records incomplete. Resolve the listed payment evidence first.', 'CASH_RECORDS_INCOMPLETE');
        const difference = countedMinor - calculation.expectedMinor;
        if (!Number.isSafeInteger(difference)) throw new HttpError(409, 'Cash difference exceeds the exact supported range', 'CASH_AMOUNT_OVERFLOW');
        if (difference !== 0 && reason.length < 3) throw new HttpError(400, 'Explain the difference between expected and counted cash', 'CASH_REASON_REQUIRED');
        const closed = await mutateDay({ connection: req.tenantDb, models, actor: { role: 'admin' }, validShops: req.validShops,
          shop: payload.shop, date: context.date, payload: { expectedRevision: context.dayRevision }, action: 'close',
          operationId: 'cash_' + id, manualVersion: '2', now: clock, session });
        daySnapshotId = closed.day.closedSnapshot.snapshotId;
      }
      const row = { _id: id, version: 1, operationId: payload.operationId, fingerprint, reviewFingerprint: payload.reviewFingerprint,
        configuration: context.configuration, shop: payload.shop, kind: payload.kind, revision: (context.latest?.revision || 0) + 1,
        previousId: context.latest ? String(context.latest._id) : '', at: context.at, businessDate: context.date, countedMinor, reason,
        baseline, flows, calculation, ...(daySnapshotId ? { daySnapshotId } : {}) };
      const result = checkpointOutcome(row);
      row.result = result;
      if (!isCashCheckpoint(row, req.validShops)) throw conflict('Counted cash evidence did not reconcile.');
      await models.CashCheckpoint.create([row], { session });
      await models.AccountingState.updateOne({ _id: row.shop }, { $set: { cashFormatVersion: 1, cashCheckpointId: id } }, { session });
      await models.AuditLog.create([{ action: 'cash_' + row.kind, role: 'admin', shop: row.shop,
        details: { operationId: row.operationId, checkpointId: id, resultChecksum: digest(result) } }], { session });
      return result;
    });
  } finally { await release(); }
}
module.exports = { reviewCash, recordCashCheckpoint };
