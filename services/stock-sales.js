'use strict';

const { createHash } = require('node:crypto');
const { HttpError } = require('../utils/http-error');
const { parseMinorUnits } = require('../public/js/business-rules');
const { inventoryTransaction, lockInventory, assertNotInHQ } = require('./inventory-identity');
const { postingDate } = require('./accounting-period');
const { periodBounds } = require('../public/js/business-rules');

function optionalText(value, label, limit) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > limit) throw new HttpError(400, `Invalid ${label}`, 'INVALID_INPUT');
  return value.trim() || null;
}

function normalizeSale(payload, actor, validShops) {
  if (['paidAmountMinor', 'amountPaid', 'paymentVersion', 'paymentAmount', 'balance', 'splitPayments'].some(field => payload?.[field] !== undefined)) throw new HttpError(400, 'Payment amount is the full sale price; separate amounts and credit are not supported', 'INVALID_PAYMENT');
  if (payload?.paymentMethod !== undefined && !['cash', 'bank'].includes(payload.paymentMethod)) throw new HttpError(400, 'Choose Cash or Bank', 'INVALID_PAYMENT');
  if (typeof payload?.imei !== 'string' || !/^\d{15}$/.test(payload.imei.trim())) {
    throw new HttpError(400, 'IMEI must be exactly 15 digits', 'INVALID_IMEI');
  }
  let salePriceMinor;
  try {
    salePriceMinor = parseMinorUnits(payload.salePrice);
    if (salePriceMinor <= 0 || parseMinorUnits(salePriceMinor / 100) !== salePriceMinor) throw Error('Invalid amount');
  } catch {
    throw new HttpError(400, 'Sale price must be a positive amount with at most two decimal places', 'INVALID_AMOUNT');
  }
  const soldByShop = actor.role === 'shop' ? actor.shop : optionalText(payload.soldByShop, 'selling shop', 100);
  if (soldByShop && !validShops.includes(soldByShop)) throw new HttpError(400, 'Invalid selling shop', 'INVALID_SHOP');
  return {
    imei: payload.imei.trim(), salePriceMinor, soldByShop,
    ...(payload.paymentMethod !== undefined ? { paymentMethod: payload.paymentMethod } : {}),
    buyerName: optionalText(payload.buyerName, 'buyer name', 150),
    buyerPhone: optionalText(payload.buyerPhone, 'buyer phone', 50),
    notes: optionalText(payload.notes, 'notes', 2000),
  };
}

const saleSnapshotFields = ['_id', 'phoneId', 'imei', 'imei2', 'cat', 'color', 'storage', 'brand', 'model', 'buyPrice', 'salePrice', 'profit',
  'buyPriceMinor', 'salePriceMinor', 'profitMinor', 'shop', 'soldByShop', 'buyerName', 'buyerPhone', 'notes', 'soldAt', 'businessDate', 'paymentVersion', 'paymentMethod', 'paidAmountMinor'];

function isSaleSnapshot(sale) {
  try {
    if (!sale || typeof sale !== 'object' || Array.isArray(sale) ||
        !/^[a-f0-9]{24}$/i.test(String(sale._id)) || typeof sale.imei !== 'string' || !/^\d{15}$/.test(sale.imei) ||
        Object.keys(sale).some(key => key !== '__v' && !saleSnapshotFields.includes(key))) return false;
    for (const field of ['buyPriceMinor', 'salePriceMinor', 'profitMinor']) {
      if (!Number.isSafeInteger(sale[field])) return false;
    }
    if (sale.__v !== undefined && (!Number.isSafeInteger(sale.__v) || sale.__v < 0)) return false;
    if (['paymentVersion', 'paymentMethod', 'paidAmountMinor'].some(field => sale[field] !== undefined) &&
        (sale.paymentVersion !== 1 || !['cash', 'bank'].includes(sale.paymentMethod) || sale.paidAmountMinor !== sale.salePriceMinor)) return false;
    if (sale.phoneId != null && !/^[a-f0-9]{24}$/i.test(String(sale.phoneId))) return false;
    if (sale.businessDate !== undefined) periodBounds(sale.businessDate, 'daily');
    if (sale.buyPriceMinor < 0 || sale.salePriceMinor <= 0 ||
        sale.profitMinor !== sale.salePriceMinor - sale.buyPriceMinor ||
        sale.buyPrice !== sale.buyPriceMinor / 100 || sale.salePrice !== sale.salePriceMinor / 100 || sale.profit !== sale.profitMinor / 100) return false;
    for (const field of ['brand', 'model', 'shop', 'buyerName', 'buyerPhone', 'notes', 'imei2', 'cat', 'color', 'storage']) {
      if (sale[field] != null && typeof sale[field] !== 'string') return false;
    }
    return typeof sale.soldByShop === 'string' && !!sale.soldByShop &&
      typeof sale.soldAt === 'string' && new Date(sale.soldAt).toISOString() === sale.soldAt;
  } catch { return false; }
}

function sameSaleSnapshot(left, right) {
  return isSaleSnapshot(left) && isSaleSnapshot(right) && saleSnapshotFields.every(field =>
    ['_id', 'phoneId'].includes(field) ? String(left[field] ?? '') === String(right[field] ?? '') : (left[field] ?? null) === (right[field] ?? null));
}

function replay(receipt, fingerprint, input) {
  if (receipt.fingerprint !== fingerprint) throw new HttpError(409, 'This request key was already used for a different operation', 'IDEMPOTENCY_CONFLICT');
  if (!isSaleSnapshot(receipt.sale) || receipt.sale.imei !== input.imei ||
      receipt.sale.salePriceMinor !== input.salePriceMinor ||
      (receipt.sale.paymentMethod ?? null) !== (input.paymentMethod ?? null) ||
      ['buyerName', 'buyerPhone', 'notes'].some(field => (receipt.sale[field] ?? null) !== input[field]) ||
      receipt.sale.soldByShop !== (input.soldByShop || receipt.sale.shop)) {
    throw new HttpError(409, 'Saved sale history needs review before this request can be replayed', 'INVALID_REQUEST_HISTORY');
  }
  return { sale: receipt.sale, replayed: true };
}

async function saveContact(models, sale) {
  if (!sale.buyerName) return;
  try {
    const escaped = sale.buyerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const alternatives = [{ name: { $regex: `^${escaped}$`, $options: 'i' } }];
    if (sale.buyerPhone) alternatives.push({ phone: sale.buyerPhone });
    const existing = await models.Customer.findOne({ $or: alternatives });
    if (!existing) {
      await models.Customer.create({ name: sale.buyerName, phone: sale.buyerPhone || undefined, addedAt: new Date().toISOString() });
    } else if (sale.buyerPhone && !existing.phone) {
      existing.phone = sale.buyerPhone;
      await existing.save();
    }
  } catch {
    console.error('Customer contact could not be saved after the sale');
  }
}

async function sellPhone({ connection, models, actor, validShops, payload, operationId, tenderRequired = false, clientSaleVersion }) {
  const input = normalizeSale(payload, actor, validShops);
  if (operationId !== undefined && (typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(operationId))) {
    throw new HttpError(400, 'Invalid request key', 'INVALID_REQUEST_KEY');
  }
  const fingerprint = createHash('sha256').update(JSON.stringify({ type: 'stock_sell', role: actor.role, shop: actor.shop || null, input })).digest('hex');
  let outcome;
  try {
    outcome = await inventoryTransaction(connection, async session => {
      if (operationId) {
        const previous = await models.StockOperation.findById(operationId).session(session).lean();
        if (previous) return replay(previous, fingerprint, input);
      }
      if (tenderRequired && clientSaleVersion !== '2') throw new HttpError(428, 'Update or reload the app before recording a fully paid sale', 'CLIENT_UPDATE_REQUIRED');
      if (tenderRequired && !input.paymentMethod) throw new HttpError(400, 'Choose Cash or Bank', 'PAYMENT_METHOD_REQUIRED');
      if (tenderRequired && !operationId) throw new HttpError(400, 'A sale request key is required', 'INVALID_REQUEST_KEY');
      if (!tenderRequired && input.paymentMethod) throw new HttpError(503, 'Recorded payment methods are not enabled on this server', 'FEATURE_UNAVAILABLE');
      await lockInventory(models, session, [input.imei]);
      await assertNotInHQ(models, session, input.imei);
      const phones = await models.Phone.find({ imei: input.imei }).limit(2).session(session);
      if (!phones.length) throw new HttpError(404, 'Phone not found', 'NOT_FOUND');
      if (phones.length !== 1) throw new HttpError(409, 'Duplicate IMEI records need review before this phone can be sold', 'AMBIGUOUS_IMEI');
      const phone = phones[0];
      if (phone.status !== 'in_stock') throw new HttpError(409, 'Phone is not available for sale', 'STOCK_CONFLICT');
      let buyPriceMinor;
      try { buyPriceMinor = parseMinorUnits(phone.buyPrice ?? 0); }
      catch { throw new HttpError(409, 'Purchase cost needs review before this phone can be sold', 'INVALID_STORED_COST'); }
      const soldByShop = input.soldByShop || phone.shop;
      if (!validShops.includes(soldByShop)) throw new HttpError(400, 'Choose a valid selling shop', 'INVALID_SHOP');
      const soldAt = new Date().toISOString();
      const date = await postingDate(models, session, soldByShop, new Date(soldAt));
      const salePrice = input.salePriceMinor / 100;
      const profitMinor = input.salePriceMinor - buyPriceMinor;
      const sale = new models.Sale({
        phoneId: phone._id,
        imei2: phone.imei2, cat: phone.cat, color: phone.color, storage: phone.storage,
        imei: phone.imei, brand: phone.brand, model: phone.model,
        buyPrice: buyPriceMinor / 100, salePrice, profit: profitMinor / 100,
        buyPriceMinor, salePriceMinor: input.salePriceMinor, profitMinor,
        shop: phone.shop, soldByShop, buyerName: input.buyerName,
        buyerPhone: input.buyerPhone, notes: input.notes, soldAt, businessDate: date,
        ...(input.paymentMethod ? { paymentVersion: 1, paymentMethod: input.paymentMethod, paidAmountMinor: input.salePriceMinor } : {}),
      });
      const changed = await models.Phone.updateOne({ _id: phone._id, status: 'in_stock' }, {
        $set: { status: 'sold', salePrice, soldAt, soldByShop, currentSaleId: sale._id },
      }, { session });
      if (changed.modifiedCount !== 1) throw new HttpError(409, 'Phone is no longer available for sale', 'STOCK_CONFLICT');
      await sale.save({ session });
      await models.AuditLog.create([{
        action: 'stock_sell', shop: soldByShop, role: actor.role,
        details: { imei: phone.imei, brand: phone.brand, model: phone.model, saleId: sale.id,
          salePrice, profit: sale.profit, stockShop: phone.shop || null, soldByShop },
      }], { session });
      const snapshot = sale.toObject();
      if (operationId) await models.StockOperation.create([{ _id: operationId, fingerprint, sale: snapshot }], { session });
      return { sale: snapshot, replayed: false };
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
  } catch (error) {
    if (error.code === 11000 && operationId) {
      const receipt = await models.StockOperation.findById(operationId).lean();
      if (receipt) return replay(receipt, fingerprint, input);
    }
    if (error.code === 20 || error.code === 303) {
      throw new HttpError(503, 'Inventory is temporarily unavailable. Please contact an administrator.', 'TRANSACTIONS_UNAVAILABLE');
    }
    throw error;
  }
  if (!outcome.replayed) await saveContact(models, outcome.sale);
  return outcome;
}

module.exports = { sellPhone, isSaleSnapshot, sameSaleSnapshot };
