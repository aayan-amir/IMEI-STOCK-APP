'use strict';

const { HttpError } = require('../utils/http-error');
const { inventoryTransaction, lockInventory, assertNotInHQ } = require('./inventory-identity');
const input = require('./inventory-input');

async function editStock({ connection, models, actor, ids, payload, validShops }) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id))) throw new HttpError(400, 'Select between 1 and 100 valid phone IDs', 'INVALID_INPUT');
  const update = {};
  for (const [field, max] of Object.entries({ brand: 100, model: 150, color: 80, storage: 80, cat: 40, notes: 2000 })) {
    if (payload[field] !== undefined) update[field] = input.text(payload[field], field, max) || '';
  }
  if (payload.imei2 !== undefined) update.imei2 = payload.imei2 === '' ? '' : input.imei(payload.imei2);
  if (payload.buyPrice !== undefined) update.buyPrice = input.cost(payload.buyPrice);
  if (payload.shop !== undefined) {
    if (typeof payload.shop !== 'string' || !validShops.includes(payload.shop)) throw new HttpError(400, 'Invalid shop', 'INVALID_SHOP');
    update.shop = payload.shop;
  }
  if (!Object.keys(update).length) throw new HttpError(400, 'No fields to update', 'INVALID_INPUT');
  return inventoryTransaction(connection, async session => {
    const uniqueIds = [...new Set(ids)];
    const phones = await models.Phone.find({ _id: { $in: uniqueIds } }).session(session);
    if (phones.length !== uniqueIds.length) throw new HttpError(404, 'A selected phone was not found', 'NOT_FOUND');
    await lockInventory(models, session, phones.map(phone => phone.imei));
    for (const phone of phones) {
      await assertNotInHQ(models, session, phone.imei);
      if (phone.status === 'sold' && ((update.shop !== undefined && update.shop !== phone.shop) ||
          (update.buyPrice !== undefined && update.buyPrice !== phone.buyPrice))) {
        throw new HttpError(409, 'Reverse the current sale before changing this phone’s ownership or cost.', 'ACTIVE_SALE');
      }
    }
    const changed = await models.Phone.updateMany({ _id: { $in: uniqueIds } }, { $set: update }, { session });
    await models.AuditLog.create([{ action: 'stock_edit', shop: update.shop || null, role: actor.role,
      details: { ids: uniqueIds, fields: Object.keys(update), previous: phones.map(phone => ({ phoneId: phone.id, imei: phone.imei, shop: phone.shop, buyPrice: phone.buyPrice })), changes: update } }], { session });
    const updated = await models.Phone.find({ _id: { $in: uniqueIds } }).session(session);
    return { success: true, matched: changed.matchedCount, modified: changed.modifiedCount, phones: updated };
  });
}

module.exports = { editStock };
