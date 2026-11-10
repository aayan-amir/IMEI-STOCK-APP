'use strict';

const { parseMinorUnits, businessDate, periodBounds } = require('../public/js/business-rules');
const { buildSalesByShopQuery } = require('../utils/helpers');
const { HttpError } = require('../utils/http-error');

function saleEvents(sale) {
  try {
    const salePriceMinor = parseMinorUnits(sale.salePrice);
    const buyPriceMinor = parseMinorUnits(sale.buyPrice ?? 0);
    const profitMinor = salePriceMinor - buyPriceMinor;
    if (!Number.isSafeInteger(profitMinor) || (sale.profit != null &&
      Math.abs(sale.profit - profitMinor / 100) > 0.0000001)) throw Error('Invalid profit');
    for (const [field, expected] of Object.entries({ salePriceMinor, buyPriceMinor, profitMinor })) {
      if (sale[field] != null && sale[field] !== expected) throw Error('Invalid minor units');
    }
    const date = sale.businessDate || businessDate(sale.soldAt);
    const effective = (date, at) => date === businessDate(at) ? at : periodBounds(date, 'daily').start;
    periodBounds(date, 'daily');
    const original = { ...sale, _id: String(sale._id), salePriceMinor, buyPriceMinor, profitMinor,
      salePrice: salePriceMinor / 100, buyPrice: buyPriceMinor / 100, profit: profitMinor / 100,
      soldAt: effective(date, sale.soldAt), occurredAt: sale.soldAt, businessDate: date, kind: 'sale', units: 1 };
    if (!sale.reversedAt) return [original];
    return [original, { ...original, _id: sale.reversalId || `reversal_${sale._id}`, saleId: String(sale._id),
      soldAt: effective(sale.reversalBusinessDate || businessDate(sale.reversedAt), sale.reversedAt), occurredAt: sale.reversedAt,
      businessDate: sale.reversalBusinessDate || businessDate(sale.reversedAt), kind: 'reversal', units: -1,
      salePriceMinor: -salePriceMinor, buyPriceMinor: -buyPriceMinor, profitMinor: -profitMinor,
      salePrice: -salePriceMinor / 100, buyPrice: -buyPriceMinor / 100, profit: -profitMinor / 100 }];
  } catch {
    throw new HttpError(409, 'Stored sale amounts or dates need review before reporting.', 'INVALID_SALE_HISTORY');
  }
}

function checkedBounds(period, type) {
  try { return periodBounds(period, type); }
  catch { throw new HttpError(400, 'Invalid report period', 'INVALID_PERIOD'); }
}

async function readSalesLedger(models, { shop, bounds, session, summaryOnly = false } = {}) {
  const clauses = [buildSalesByShopQuery(shop === 'ALL' ? undefined : shop)];
  if (bounds) {
    const dates = { $gte: businessDate(bounds.start), $lte: businessDate(new Date(new Date(bounds.end).getTime() - 1)) };
    clauses.push({ $or: [{ soldAt: { $gte: bounds.start, $lt: bounds.end } }, { reversedAt: { $gte: bounds.start, $lt: bounds.end } },
      { businessDate: dates }, { reversalBusinessDate: dates }] });
  }
  let query = models.Sale.find({ $and: clauses });
  if (summaryOnly) query = query.select('_id shop soldByShop salePrice buyPrice profit salePriceMinor buyPriceMinor profitMinor soldAt businessDate reversedAt reversalBusinessDate reversalId');
  if (session) query = query.session(session);
  const records = await query.lean();
  const events = records.flatMap(saleEvents);
  return bounds ? events.filter(event => event.soldAt >= bounds.start && event.soldAt < bounds.end) : events;
}

module.exports = { saleEvents, readSalesLedger, checkedBounds };
