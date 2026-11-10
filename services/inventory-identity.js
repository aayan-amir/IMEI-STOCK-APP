'use strict';

const { HttpError } = require('../utils/http-error');
const { InventoryIdentitySchema, HQStockSchema } = require('../db');

async function inventoryTransaction(connection, work, options = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await connection.transaction(work, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, ...options });
    } catch (error) {
      if (error.code === 11000 && attempt < 3) continue;
      if ([20, 303].includes(error.code)) throw new HttpError(503, 'Inventory requires transaction support.', 'TRANSACTIONS_UNAVAILABLE');
      throw error;
    }
  }
}

async function lockInventory(models, session, keys) {
  const Identity = models.InventoryIdentity || models.Phone.db.model('InventoryIdentity', InventoryIdentitySchema);
  for (const key of [...new Set(keys)].sort()) {
    await Identity.updateOne({ _id: key }, { $inc: { version: 1 } }, { upsert: true, session });
  }
}

async function readHQ(models, session) {
  const HQ = models.HQStockModel || models.Phone.db.model('HQStock', HQStockSchema);
  let query = HQ.find({ key: 'hq' }).limit(2);
  if (session) query = query.session(session);
  const rows = await query;
  if (rows.length > 1 || (rows[0] && !Array.isArray(rows[0].items))) throw new HttpError(409, 'Warehouse records need reconciliation before stock can change.', 'INVENTORY_CONFLICT');
  return rows[0] || null;
}

function hqMatches(stock, imei) {
  return (stock?.items || []).filter(item => String(item?.imei || '').replace(/\D/g, '') === imei);
}

async function assertNotInHQ(models, session, imei) {
  if (hqMatches(await readHQ(models, session), imei).length) throw new HttpError(409, 'This IMEI also exists in the warehouse. Review its location first.', 'INVENTORY_CONFLICT');
}

module.exports = { inventoryTransaction, lockInventory, readHQ, hqMatches, assertNotInHQ };
