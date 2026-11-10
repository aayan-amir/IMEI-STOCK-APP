'use strict';

const { createHash } = require('node:crypto');
const { HttpError } = require('../utils/http-error');
const { getModels } = require('./backup-validation');
const { inventoryTransaction } = require('./inventory-identity');
const { enterWrite } = require('./recovery-control');
const { reverseSales } = require('./sale-reversals');
const { saleEvents } = require('./sales-ledger');
const { postingDate } = require('./accounting-period');
const { isRetainedReturn, isRetainedRefund } = require('./return-evidence');

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const conflict = message => new HttpError(409, message, 'RETURN_CONFLICT');
function owner(req) { if (req.authRole !== 'admin') throw new HttpError(403, 'Owner access required', 'FORBIDDEN'); }
function command(input, fields) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key)) ||
      typeof input.saleId !== 'string' || !/^[a-f0-9]{24}$/i.test(input.saleId) || typeof input.operationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(input.operationId)) throw new HttpError(400, 'Invalid return or refund command', 'INVALID_INPUT');
  return { ...input, saleId: input.saleId.toLowerCase() };
}
function reviewFingerprint(req, sale) {
  return digest([req.session.clientId, req.session.authVersion, [...req.validShops].sort(), String(sale._id),
    String(sale.phoneId || ''), sale.imei, sale.shop, sale.soldByShop || sale.shop, sale.salePrice, sale.buyPrice, sale.soldAt]);
}
async function sourceSale(req, models, id, session) {
  const sale = await models.Sale.findById(id).session(session).lean();
  if (!sale || !req.validShops.includes(sale.shop) || !req.validShops.includes(sale.soldByShop || sale.shop)) throw new HttpError(404, 'Original sale not found', 'NOT_FOUND');
  const original = saleEvents(sale)[0];
  if (original.salePriceMinor <= 0) throw conflict('The original sale amount needs review.');
  return { sale, original };
}

async function reviewCustomerReturn(req, id) {
  owner(req);
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) throw new HttpError(400, 'Find the original sale first', 'INVALID_INPUT');
  const models = getModels(req.tenantDb);
  return inventoryTransaction(req.tenantDb, async session => {
    const { sale, original } = await sourceSale(req, models, id, session);
    const retained = await models.CustomerReturn.findById(id).session(session).lean();
    if (retained && (!isRetainedReturn(retained, sale) || !isRetainedRefund(retained, req.validShops))) throw conflict('Retained return or refund evidence needs review.');
    if (sale.reversedAt && !retained) throw conflict('This sale was already corrected. No customer return or refund is recorded by that correction.');
    return { saleId: String(sale._id), imei: sale.imei, phone: [sale.brand, sale.model, sale.storage].filter(Boolean).join(' '),
      receivingShop: sale.shop, sellingShop: sale.soldByShop || sale.shop, amountMinor: original.salePriceMinor,
      reviewFingerprint: reviewFingerprint(req, sale), alreadyReturned: !!retained,
      return: retained ? retained.result : null, refund: retained?.refund?.result || null };
  });
}

async function acceptCustomerReturn(req, payload, { now } = {}) {
  owner(req);
  const input = command(payload, ['saleId', 'receivingShop', 'reviewFingerprint', 'operationId']);
  if (typeof input.reviewFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(input.reviewFingerprint) || typeof input.receivingShop !== 'string') throw new HttpError(400, 'Review the original sale and receiving shop first', 'INVALID_INPUT');
  const models = getModels(req.tenantDb), fingerprint = digest([input.saleId, input.receivingShop, input.reviewFingerprint]);
  const release = await enterWrite(req.tenantDb);
  try {
    return await inventoryTransaction(req.tenantDb, async session => {
      const retained = await models.CustomerReturn.findById(input.saleId).session(session).lean();
      if (retained) {
        const { sale } = await sourceSale(req, models, input.saleId, session);
        if (retained.operationId !== input.operationId || retained.fingerprint !== fingerprint || !isRetainedReturn(retained, sale) || !isRetainedRefund(retained, req.validShops)) throw conflict('A customer return is already recorded or its retained evidence needs review.');
        return retained.result;
      }
      const { sale, original } = await sourceSale(req, models, input.saleId, session);
      if (sale.reversedAt || sale.shop !== input.receivingShop || input.reviewFingerprint !== reviewFingerprint(req, sale)) throw conflict('The original sale or receiving destination changed. Review it again.');
      const phones = await models.Phone.find({ imei: sale.imei }).limit(2).session(session).lean();
      if (phones.length !== 1 || phones[0].shop !== sale.shop) throw conflict('Current phone custody does not match the original owning shop.');
      const reversed = await reverseSales({ connection: req.tenantDb, models, actor: { role: 'admin' }, saleIds: [input.saleId], now: now || new Date(), session });
      const correction = reversed.reversals[0];
      const result = { success: true, returnId: input.saleId, saleId: input.saleId, imei: sale.imei,
        receivingShop: sale.shop, sellingShop: sale.soldByShop || sale.shop, amountMinor: original.salePriceMinor,
        acceptedAt: correction.reversedAt, businessDate: correction.businessDate, reversalId: correction.reversalId,
        stockRestored: true, refundStatus: 'not_recorded' };
      await models.CustomerReturn.create([{ _id: input.saleId, version: 1, phoneId: phones[0]._id, imei: sale.imei,
        shop: sale.shop, soldByShop: sale.soldByShop || sale.shop, amountMinor: original.salePriceMinor,
        acceptedAt: result.acceptedAt, businessDate: result.businessDate, reversalId: result.reversalId,
        operationId: input.operationId, fingerprint, reviewFingerprint: input.reviewFingerprint, result }], { session });
      await models.AuditLog.create([{ action: 'customer_return', role: 'admin', shop: sale.shop,
        details: { operationId: input.operationId, saleId: input.saleId, imei: sale.imei, receivingShop: sale.shop,
          sellingShop: sale.soldByShop || sale.shop, amountMinor: result.amountMinor, reversalId: result.reversalId } }], { session });
      return result;
    });
  } finally { await release(); }
}

async function recordCustomerRefund(req, payload, { now } = {}) {
  owner(req);
  const input = command(payload, ['saleId', 'method', 'paidByShop', 'confirmed', 'operationId']);
  if (input.confirmed !== true || !['cash', 'bank'].includes(input.method) || !req.validShops.includes(input.paidByShop)) throw new HttpError(400, 'Confirm the actual full refund, method and paying shop', 'INVALID_INPUT');
  const models = getModels(req.tenantDb), fingerprint = digest([input.saleId, input.method, input.paidByShop, true]);
  const release = await enterWrite(req.tenantDb);
  try {
    return await inventoryTransaction(req.tenantDb, async session => {
      const retained = await models.CustomerReturn.findById(input.saleId).session(session).lean();
      if (!retained || !req.validShops.includes(retained.shop)) throw new HttpError(404, 'Accepted customer return not found', 'NOT_FOUND');
      const { sale, original } = await sourceSale(req, models, input.saleId, session);
      if (!isRetainedReturn(retained, sale) || !isRetainedRefund(retained, req.validShops)) throw conflict('Retained return or refund evidence needs review.');
      if (retained.refund) {
        if (retained.refund.operationId !== input.operationId || retained.refund.fingerprint !== fingerprint || retained.refund.result?.success !== true) throw conflict('A confirmed full refund is already recorded for this return. Open its retained result.');
        return retained.refund.result;
      }
      if (!sale.reversedAt || sale.reversalId !== retained.reversalId || original.salePriceMinor !== retained.amountMinor) throw conflict('Return and original sale evidence do not agree.');
      const clock = now || new Date(), occurredAt = clock.toISOString();
      if (occurredAt < retained.acceptedAt) throw conflict('A refund cannot be recorded before its accepted return.');
      const date = await postingDate(models, session, input.paidByShop, clock);
      const result = { success: true, returnId: input.saleId, saleId: input.saleId, refundId: 'refund_' + input.saleId,
        amountMinor: retained.amountMinor, method: input.method, paidByShop: input.paidByShop, occurredAt, businessDate: date, confirmed: true };
      const refund = { version: 1, operationId: input.operationId, fingerprint, method: input.method, shop: input.paidByShop,
        amountMinor: retained.amountMinor, occurredAt, businessDate: date, result };
      const changed = await models.CustomerReturn.updateOne({ _id: input.saleId, refund: { $exists: false } }, { $set: { refund } }, { session });
      if (changed.modifiedCount !== 1) throw conflict('Refund evidence changed. Reload this return.');
      await models.AuditLog.create([{ action: 'customer_refund', role: 'admin', shop: input.paidByShop,
        details: { operationId: input.operationId, saleId: input.saleId, refundId: result.refundId, amountMinor: retained.amountMinor,
          method: input.method, occurredAt, businessDate: date } }], { session });
      return result;
    });
  } finally { await release(); }
}

module.exports = { reviewCustomerReturn, acceptCustomerReturn, recordCustomerRefund };
