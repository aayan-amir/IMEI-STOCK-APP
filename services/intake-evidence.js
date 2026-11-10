'use strict';

const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { HttpError } = require('../utils/http-error');
const input = require('./inventory-input');
const itemFields = ['imei', 'imei2', 'buyPrice', 'cat', 'brand', 'model', 'color', 'storage', 'notes'];
const requestKey = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function exactKeys(value, allowed) { return object(value) && Object.keys(value).every(key => allowed.includes(key)); }
function normalizeIntake(item, shop, validShops) {
  if (!validShops.includes(shop)) throw new HttpError(400, 'Choose a configured shop. Use warehouse receiving for HQ stock.', 'INVALID_SHOP');
  if (!exactKeys(item, itemFields)) throw new HttpError(400, 'Unsupported phone intake fields', 'INVALID_INPUT');
  return { type: 'stock_intake', shop, item: input.stockItem(item) };
}
function intakeFingerprint(intent) { return createHash('sha256').update(JSON.stringify(intent)).digest('hex'); }
function batchEnvelope(payload, actor, validShops) {
  if (!['admin', 'shop'].includes(actor.role)) throw new HttpError(403, 'Forbidden', 'FORBIDDEN');
  if (!exactKeys(payload, ['shop', 'items']) || !Array.isArray(payload.items) || !payload.items.length || payload.items.length > 25) throw new HttpError(400, 'Save between 1 and 25 phones per request', 'INVALID_INPUT');
  const shop = actor.role === 'shop' ? actor.shop : payload.shop;
  if (!validShops.includes(shop)) throw new HttpError(400, 'Choose a configured shop', 'INVALID_SHOP');
  const keys = new Set();
  for (const row of payload.items) {
    if (!exactKeys(row, ['operationId', 'item']) || !requestKey(row.operationId) || keys.has(row.operationId) || !Object.hasOwn(row, 'item')) throw new HttpError(400, 'Each phone needs a distinct valid request key', 'INVALID_REQUEST_KEY');
    keys.add(row.operationId);
  }
  return { shop, items: payload.items };
}
function isIntakeOperation(operation, audits, validShops) {
  try {
    const result = operation?.result, phone = result?.phone;
    if (!requestKey(operation?._id) || !/^[a-f0-9]{64}$/.test(operation.fingerprint) ||
        !exactKeys(result, ['success', 'kind', 'phone']) || result.success !== true || result.kind !== 'stock_intake' ||
        !exactKeys(phone, [...itemFields, '_id', 'shop', 'status', 'addedAt']) ||
        typeof phone._id !== 'string' || !/^[a-f0-9]{24}$/.test(phone._id) || phone.status !== 'in_stock' ||
        typeof phone.addedAt !== 'string' || new Date(phone.addedAt).toISOString() !== phone.addedAt) return false;
    const item = Object.fromEntries(itemFields.filter(field => Object.hasOwn(phone, field)).map(field => [field, phone[field]]));
    const intent = normalizeIntake(item, phone.shop, validShops);
    const expected = { _id: phone._id, ...intent.item, shop: phone.shop, status: 'in_stock', addedAt: phone.addedAt };
    if (!isDeepStrictEqual(expected, phone) || intakeFingerprint(intent) !== operation.fingerprint) return false;
    const matching = audits.filter(row => row.details?.intakeVersion !== undefined && row.details.operationId === operation._id);
    if (matching.length !== 1) return false;
    const audit = matching[0], details = audit.details;
    return audit.action === 'stock_add' && details.intakeVersion === 1 && ['admin', 'shop'].includes(audit.role) && audit.shop === phone.shop &&
      details.phoneId === phone._id && details.imei === phone.imei && details.buyPrice === phone.buyPrice &&
      details.fingerprint === operation.fingerprint && isDeepStrictEqual(details.intake, phone);
  } catch { return false; }
}

module.exports = { normalizeIntake, intakeFingerprint, batchEnvelope, isIntakeOperation };
