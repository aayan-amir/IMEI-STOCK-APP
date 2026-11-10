'use strict';

const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { saleEvents } = require('./sales-ledger');
const { businessDate, periodBounds } = require('../public/js/business-rules');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const instant = value => typeof value === 'string' && new Date(value).toISOString() === value;

function acceptedReturnOutcome(row) {
  const id = String(row._id);
  return { success: true, returnId: id, saleId: id, imei: row.imei,
    receivingShop: row.shop, sellingShop: row.soldByShop, amountMinor: row.amountMinor,
    acceptedAt: row.acceptedAt, businessDate: row.businessDate, reversalId: row.reversalId,
    stockRestored: true, refundStatus: 'not_recorded' };
}
function refundOutcome(row) {
  const id = String(row._id), refund = row.refund;
  return { success: true, returnId: id, saleId: id, refundId: 'refund_' + id,
    amountMinor: row.amountMinor, method: refund.method, paidByShop: refund.shop,
    occurredAt: refund.occurredAt, businessDate: refund.businessDate, confirmed: true };
}
function isRetainedReturn(row, sale) {
  try {
    const id = String(row._id), amount = saleEvents(sale)[0].salePriceMinor;
    periodBounds(row.businessDate, 'daily');
    return /^[a-f0-9]{24}$/.test(id) && id === String(sale._id) && row.version === 1 && /^[a-f0-9]{24}$/.test(String(row.phoneId)) &&
      (!sale.phoneId || String(row.phoneId) === String(sale.phoneId)) && row.imei === sale.imei && row.shop === sale.shop && row.soldByShop === (sale.soldByShop || sale.shop) &&
      amount > 0 && row.amountMinor === amount && instant(row.acceptedAt) && row.acceptedAt === sale.reversedAt && row.acceptedAt >= sale.soldAt &&
      row.businessDate === sale.reversalBusinessDate && row.reversalId === 'reversal_' + id && row.reversalId === sale.reversalId && key(row.operationId) &&
      typeof row.reviewFingerprint === 'string' && /^[a-f0-9]{64}$/.test(row.reviewFingerprint) &&
      row.fingerprint === digest([id, row.shop, row.reviewFingerprint]) && isDeepStrictEqual(row.result, acceptedReturnOutcome(row));
  } catch { return false; }
}
function isRetainedRefund(row, validShops) {
  try {
    if (row.refund === undefined) return true;
    const refund = row.refund, allowed = ['version', 'operationId', 'fingerprint', 'method', 'shop', 'amountMinor', 'occurredAt', 'businessDate', 'result'];
    if (!refund || typeof refund !== 'object' || Array.isArray(refund) || Object.keys(refund).some(field => !allowed.includes(field))) return false;
    periodBounds(refund.businessDate, 'daily');
    return refund.version === 1 && key(refund.operationId) && ['cash', 'bank'].includes(refund.method) && Array.isArray(validShops) && validShops.includes(refund.shop) &&
      refund.amountMinor === row.amountMinor && instant(refund.occurredAt) && refund.occurredAt >= row.acceptedAt && refund.businessDate >= businessDate(refund.occurredAt) &&
      refund.fingerprint === digest([String(row._id), refund.method, refund.shop, true]) && isDeepStrictEqual(refund.result, refundOutcome(row));
  } catch { return false; }
}

module.exports = { acceptedReturnOutcome, refundOutcome, isRetainedReturn, isRetainedRefund };
