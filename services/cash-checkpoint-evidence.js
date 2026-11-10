'use strict';

const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { calculateCash } = require('./cash-calculation');
const { periodBounds } = require('../public/js/business-rules');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const instant = value => typeof value === 'string' && new Date(value).toISOString() === value;
function checkpointOutcome(row) {
  return { success: true, checkpointId: String(row._id), shop: row.shop, kind: row.kind, at: row.at, countedMinor: row.countedMinor,
    expectedMinor: row.calculation.expectedMinor, differenceMinor: row.countedMinor - row.calculation.expectedMinor,
    ...(row.daySnapshotId ? { daySnapshotId: row.daySnapshotId } : {}) };
}
function isCashCheckpoint(row, validShops) {
  try {
    periodBounds(row.businessDate, 'daily');
    const baseline = row.baseline;
    if (row.version !== 1 || !validShops.includes(row.shop) || !['opening', 'close'].includes(row.kind) ||
        !Number.isSafeInteger(row.revision) || row.revision < 1 || !instant(row.at) ||
        !Number.isSafeInteger(row.countedMinor) || row.countedMinor < 0 || typeof row.reason !== 'string' || row.reason.length > 500 ||
        typeof row.operationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(row.operationId) ||
        String(row._id) !== digest(['cash-checkpoint', row.operationId]).slice(0, 24) ||
        !hash(row.configuration) || !hash(row.reviewFingerprint) ||
        row.fingerprint !== digest([row.shop, row.kind, row.countedMinor, row.reason, row.reviewFingerprint]) ||
        typeof row.previousId !== 'string' || (row.revision === 1 ? row.previousId !== '' : !/^[a-f0-9]{24}$/.test(row.previousId)) ||
        !baseline || Object.keys(baseline).some(key => !['at', 'countedMinor', 'includedSourceIds', 'historicalUnknownFlows'].includes(key)) ||
        !instant(baseline.at) || baseline.at > row.at || !Array.isArray(baseline.includedSourceIds) ||
        new Set(baseline.includedSourceIds).size !== baseline.includedSourceIds.length ||
        !isDeepStrictEqual(calculateCash({ openingMinor: baseline.countedMinor, cutoverAt: baseline.at, untilAt: row.at,
          flows: row.flows, includedSourceIds: baseline.includedSourceIds, historicalUnknownFlows: baseline.historicalUnknownFlows }), row.calculation) || !row.calculation.complete ||
        !Number.isSafeInteger(row.countedMinor - row.calculation.expectedMinor) || !isDeepStrictEqual(checkpointOutcome(row), row.result)) return false;
    return row.kind === 'opening'
      ? row.reason.length >= 3 && row.daySnapshotId === undefined && baseline.at === row.at && baseline.countedMinor === row.countedMinor &&
        row.flows.every(flow => (flow.confirmed && !flow.issue && flow.occurredAt === row.at) ||
          baseline.historicalUnknownFlows?.some(known => isDeepStrictEqual(known, flow))) &&
        isDeepStrictEqual(baseline.includedSourceIds, row.flows.filter(flow => flow.confirmed).map(flow => flow.id))
      : typeof row.daySnapshotId === 'string' && /^[a-f0-9]{24}:[1-9]\d*$/.test(row.daySnapshotId) &&
        (row.countedMinor === row.calculation.expectedMinor || row.reason.length >= 3);
  } catch { return false; }
}
module.exports = { checkpointOutcome, isCashCheckpoint };
