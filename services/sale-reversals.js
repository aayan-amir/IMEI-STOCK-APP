'use strict';

const { HttpError } = require('../utils/http-error');
const { postingDate } = require('./accounting-period');
const { inventoryTransaction, lockInventory, assertNotInHQ } = require('./inventory-identity');

function conflict() {
  return new HttpError(409, 'Sale and current stock do not match. Review the records before reversing.', 'SALE_STATE_CONFLICT');
}

async function reverseSales({ connection, models, actor, saleIds, imei, now, session: outerSession }) {
  if (actor.role !== 'admin') throw new HttpError(403, 'Forbidden', 'FORBIDDEN');
  if (!Array.isArray(saleIds) || !saleIds.length) throw new HttpError(409, 'Select the specific sales to reverse and try again.', 'SALE_IDS_REQUIRED');
  if (saleIds.length > 100 || saleIds.some(id => typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id))) throw new HttpError(400, 'Provide up to 100 valid sale IDs', 'INVALID_INPUT');
  const ids = [...new Set(saleIds.map(id => id.toLowerCase()))].sort();
  try {
    const work = async session => {
      const clock = now || new Date(), reversedAt = clock.toISOString();
      const reversals = [];
      for (const id of ids) {
        const sale = await models.Sale.findById(id).session(session);
        if (!sale) throw new HttpError(404, 'Sale not found', 'NOT_FOUND');
        if (imei && sale.imei !== imei) throw conflict();
        if (!sale.reversedAt) {
          await lockInventory(models, session, [sale.imei]);
          await assertNotInHQ(models, session, sale.imei);
          const phones = await models.Phone.find({ imei: sale.imei }).limit(2).session(session);
          if (phones.length !== 1) throw conflict();
          const phone = phones[0];
          if (phone.status !== 'sold' || (sale.phoneId && String(sale.phoneId) !== String(phone._id))) throw conflict();
          if (phone.currentSaleId) {
            if (String(phone.currentSaleId) !== id) throw conflict();
          } else {
            const count = await models.Sale.countDocuments({ imei: sale.imei, reversedAt: null }).session(session);
            if (count !== 1 || phone.soldAt !== sale.soldAt || phone.salePrice !== sale.salePrice || phone.shop !== sale.shop ||
                (phone.soldByShop || phone.shop) !== (sale.soldByShop || sale.shop)) throw conflict();
          }
          const changed = await models.Phone.updateOne({ _id: phone._id, status: 'sold',
            ...(phone.currentSaleId ? { currentSaleId: sale._id } : { currentSaleId: null, soldAt: sale.soldAt, salePrice: sale.salePrice }) }, {
            $set: { status: 'in_stock' }, $unset: { salePrice: '', soldAt: '', soldByShop: '', currentSaleId: '' },
          }, { session });
          if (changed.modifiedCount !== 1) throw conflict();
          sale.reversedAt = reversedAt;
          sale.reversalBusinessDate = await postingDate(models, session, sale.soldByShop || sale.shop, clock);
          sale.reversalId = `reversal_${id}`;
          sale.reversedBy = actor.role;
          await sale.save({ session });
          await models.AuditLog.create([{ action: 'sale_reverse', shop: sale.soldByShop || sale.shop,
            role: actor.role, details: { saleId: id, imei: sale.imei, reversalId: sale.reversalId,
              reversedAt, businessDate: sale.reversalBusinessDate } }], { session });
        }
        reversals.push({ saleId: id, reversalId: sale.reversalId, reversedAt: sale.reversedAt, businessDate: sale.reversalBusinessDate });
      }
      return { success: true, reversed: reversals.length, reversals };
    };
    return await (outerSession ? work(outerSession) : inventoryTransaction(connection, work, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } }));
  } catch (error) {
    if ([20, 303].includes(error.code)) throw new HttpError(503, 'Inventory requires transaction support.', 'TRANSACTIONS_UNAVAILABLE');
    throw error;
  }
}

module.exports = { reverseSales };
