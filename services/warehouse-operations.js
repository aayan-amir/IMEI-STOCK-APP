'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { HttpError } = require('../utils/http-error');
const { inventoryTransaction, lockInventory, readHQ, hqMatches } = require('./inventory-identity');
const input = require('./inventory-input');

function conflict(message) { return new HttpError(409, message, 'INVENTORY_CONFLICT'); }
function entryId(item) {
  return typeof item.entryId === 'string' && /^[a-f0-9-]{32,64}$/.test(item.entryId) ? item.entryId
    : createHash('sha256').update(JSON.stringify(item)).digest('hex');
}
function selection(item) {
  const imei = input.imei(item?.imei);
  if (typeof item?.entryId !== 'string' || !/^[a-f0-9-]{32,64}$/.test(item.entryId)) throw conflict('Reload warehouse stock and select the current entry before continuing.');
  return { imei, entryId: item.entryId };
}
function normalize(type, payload, validShops) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new HttpError(400, 'Invalid warehouse operation', 'INVALID_INPUT');
  if (type === 'remove') return { type, items: [selection(payload)] };
  if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > 100) throw new HttpError(400, 'Select between 1 and 100 phones', 'INVALID_INPUT');
  const result = { type, date: input.date(payload.date), items: payload.items.map(type === 'receive' ? input.stockItem : selection).sort((a, b) => a.imei.localeCompare(b.imei)) };
  if (new Set(result.items.map(item => item.imei)).size !== result.items.length) throw conflict('Duplicate IMEI in request');
  if (type === 'receive') {
    result.supplier = input.text(payload.supplier, 'supplier');
    result.ref = input.text(payload.ref, 'reference');
  } else {
    if (typeof payload.toShop !== 'string' || !validShops.includes(payload.toShop)) throw new HttpError(400, 'Invalid destination shop', 'INVALID_SHOP');
    result.toShop = payload.toShop;
    result.note = input.text(payload.note, 'note', 2000);
  }
  return result;
}
function validOutcome(result, intent) {
  try {
    if (!result || result.success !== true) return false;
    if (intent.type === 'remove') return result.removed === 1 && result.imei === intent.items[0].imei && result.entryId === intent.items[0].entryId;
    const record = result[intent.type === 'receive' ? 'shipment' : 'dispatch'];
    if (!record || !/^[a-f0-9]{24}$/i.test(String(record._id)) || record.date !== intent.date || !Array.isArray(record.items) || record.items.length !== intent.items.length) return false;
    if (intent.type === 'dispatch' && record.toShop !== intent.toShop) return false;
    return record.items.every((item, index) => {
      const expected = intent.items[index];
      return item.imei === expected.imei && /^[a-f0-9-]{32,64}$/.test(item.entryId) &&
        (intent.type === 'receive' ? input.cost(item.buyPrice) === expected.buyPrice : item.entryId === expected.entryId);
    });
  } catch { return false; }
}

async function mutateWarehouse({ connection, models, actor, validShops, type, payload, operationId }) {
  if (actor.role !== 'admin') throw new HttpError(403, 'Forbidden', 'FORBIDDEN');
  const intent = normalize(type, payload, validShops);
  if (operationId !== undefined && (typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(operationId))) throw new HttpError(400, 'Invalid request key', 'INVALID_REQUEST_KEY');
  const fingerprint = createHash('sha256').update(JSON.stringify(intent)).digest('hex');
  return inventoryTransaction(connection, async session => {
    if (operationId) {
      const previous = await models.InventoryOperation.findById(operationId).session(session).lean();
      if (previous) {
        if (previous.fingerprint !== fingerprint || !validOutcome(previous.result, intent)) throw conflict('Saved request differs or needs review before replay.');
        if (type !== 'remove') {
          const field = type === 'receive' ? 'shipment' : 'dispatch';
          const Model = type === 'receive' ? models.Shipment : models.Dispatch;
          const retained = await Model.findById(previous.result[field]._id).session(session).lean();
          if (!isDeepStrictEqual(JSON.parse(JSON.stringify(retained)), JSON.parse(JSON.stringify(previous.result[field])))) throw conflict('Saved request does not match its retained movement history.');
        }
        return previous.result;
      }
    }
    const imeis = intent.items.map(item => item.imei);
    await lockInventory(models, session, ['@hq', ...imeis]);
    const stock = await readHQ(models, session);
    const phones = await models.Phone.find({ imei: { $in: imeis } }).session(session);
    if (phones.length) throw conflict('An IMEI already exists in shop stock. Review its location first.');
    const now = new Date().toISOString();
    let items;
    if (type === 'receive') {
      if (imeis.some(imei => hqMatches(stock, imei).length)) throw conflict('An IMEI already exists in warehouse stock.');
      items = intent.items.map(item => ({ ...item, entryId: randomUUID(), addedAt: now }));
      if (stock) await models.HQStockModel.updateOne({ _id: stock._id }, { $push: { items: { $each: items } }, $inc: { revision: 1 }, $set: { updatedAt: now } }, { session });
      else await models.HQStockModel.create([{ key: 'hq', items, updatedAt: now, revision: 1 }], { session });
    } else {
      items = intent.items.map(selected => {
        const matches = hqMatches(stock, selected.imei);
        if (matches.length !== 1 || matches[0].imei !== selected.imei || entryId(matches[0]) !== selected.entryId) throw conflict('A selected warehouse entry changed or is unavailable. Reload before continuing.');
        const original = matches[0];
        let canonical;
        try {
          const buyPrice = original.buyPrice === undefined ? original.costPerUnit : original.buyPrice;
          if (buyPrice === undefined) throw Error('Missing recorded cost');
          canonical = input.stockItem({ ...original, buyPrice });
        }
        catch { throw conflict('Stored phone details need review before movement.'); }
        return { ...original, ...canonical, entryId: selected.entryId };
      });
      if (type === 'dispatch') {
        await models.Phone.insertMany(items.map(item => ({ ...input.stockItem(item), shop: intent.toShop, status: 'in_stock', addedAt: now })), { session, ordered: true });
      }
      await models.HQStockModel.updateOne({ _id: stock._id }, { $pull: { items: { imei: { $in: imeis } } }, $inc: { revision: 1 }, $set: { updatedAt: now } }, { session });
    }
    let result;
    if (type === 'remove') result = { success: true, removed: 1, imei: items[0].imei, entryId: items[0].entryId };
    else {
      const Model = type === 'receive' ? models.Shipment : models.Dispatch;
      const [record] = await Model.create([{ date: intent.date, supplier: intent.supplier, ref: intent.ref,
        toShop: intent.toShop, note: intent.note, items, addedAt: now }], { session });
      result = { success: true, [type === 'receive' ? 'shipment' : 'dispatch']: record.toObject() };
    }
    await models.AuditLog.create([{ action: `warehouse_${type}`, shop: intent.toShop || null, role: actor.role,
      details: { operationId, imeis, entryIds: items.map(item => item.entryId), from: type === 'receive' ? 'supplier' : 'HQ',
        to: type === 'receive' ? 'HQ' : type === 'dispatch' ? intent.toShop : 'removed',
        recordId: String(result.shipment?._id || result.dispatch?._id || '') } }], { session });
    if (operationId) await models.InventoryOperation.create([{ _id: operationId, fingerprint, result }], { session });
    return result;
  });
}

function isWarehouseOutcome(result, shops) {
  try {
    const type = result?.shipment ? 'receive' : result?.dispatch ? 'dispatch' : 'remove';
    const record = result?.shipment || result?.dispatch;
    const expectedKeys = type === 'remove' ? ['entryId', 'imei', 'removed', 'success'] : ['success', type === 'receive' ? 'shipment' : 'dispatch'];
    if (!result || Object.keys(result).length !== expectedKeys.length || Object.keys(result).some(key => !expectedKeys.includes(key))) return false;
    return validOutcome(result, normalize(type, type === 'remove' ? result : record, shops));
  } catch { return false; }
}

module.exports = { mutateWarehouse, entryId, isWarehouseOutcome };
