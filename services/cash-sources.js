'use strict';

const { isDeepStrictEqual } = require('node:util');
const { HttpError } = require('../utils/http-error');
const { saleEvents } = require('./sales-ledger');
const { isCashEntry } = require('./cash-evidence');
const { isRetainedReturn, isRetainedRefund } = require('./return-evidence');

function normalizeCashSources({ shop, validShops, sales, returns, entries, expenses }) {
  if (!Array.isArray(validShops) || !validShops.includes(shop)) throw new HttpError(400, 'Invalid cash shop', 'INVALID_SHOP');
  const groups = [sales, returns, entries, expenses];
  if (groups.some(rows => !Array.isArray(rows)) || groups.reduce((sum, rows) => sum + rows.length, 0) > 5000 ||
      Buffer.byteLength(JSON.stringify(groups)) > 8 * 1024 * 1024) throw new HttpError(413, 'Cash source limit exceeded', 'CASH_SOURCE_LIMIT');
  [sales, returns, entries, expenses] = groups.map(rows => {
    const unique = new Map();
    for (const row of rows) {
      const id = String(row._id);
      if (unique.has(id) && !isDeepStrictEqual(unique.get(id), row)) throw new HttpError(409, 'Conflicting retained cash source identities need review', 'CASH_SOURCE_CONFLICT');
      unique.set(id, row);
    }
    return [...unique.values()];
  });
  const flows = [], saleById = new Map(sales.map(row => [String(row._id), row]));
  const returnsById = new Map(returns.map(row => [String(row._id), row]));
  const entriesById = new Map(entries.map(row => [String(row._id), row]));
  const add = (id, amountMinor, direction, method, occurredAt, issue) => flows.push({ id, direction, confirmed: !issue,
    ...(amountMinor === undefined ? {} : { amountMinor }), ...(method === undefined ? {} : { method }),
    ...(occurredAt === undefined ? {} : { occurredAt }), ...(issue ? { issue } : {}) });
  for (const sale of sales) {
    if ((sale.soldByShop || sale.shop) !== shop) continue;
    let amountMinor, issue;
    try {
      amountMinor = saleEvents(sale)[0].salePriceMinor;
      if (sale.paymentVersion !== 1 || !['cash', 'bank'].includes(sale.paymentMethod) || amountMinor <= 0 || sale.paidAmountMinor !== amountMinor) issue = 'PAYMENT_NOT_RECORDED';
    } catch { issue = 'INVALID_SOURCE'; }
    add('sale:' + sale._id, amountMinor, 'in', sale.paymentMethod, sale.soldAt, issue);
    if (sale.reversedAt && !returnsById.has(String(sale._id))) add('correction:' + sale._id, 0, 'out', 'cash', sale.reversedAt, 'REFUND_UNCLASSIFIED');
  }
  for (const row of returns) {
    const sale = saleById.get(String(row._id));
    const valid = sale && isRetainedReturn(row, sale) && isRetainedRefund(row, validShops);
    if (!valid) {
      add('return:' + row._id, 0, 'out', 'cash', undefined, 'RETURN_EVIDENCE_CONFLICT');
    } else if (!row.refund) {
      add('refund:' + row._id, row.amountMinor, 'out', undefined, row.acceptedAt, 'REFUND_NOT_RECORDED');
    } else if (row.refund.shop === shop) {
      add('refund:' + row._id, row.amountMinor, 'out', row.refund.method, row.refund.occurredAt);
    }
  }
  for (const row of entries) {
    if (row.shop !== shop && row.toShop !== shop) continue;
    add('entry:' + row._id, row.amountMinor, row.shop === shop && row.kind !== 'income' ? 'out' : 'in', row.method, row.occurredAt,
      isCashEntry(row, validShops) ? undefined : 'PAYMENT_EVIDENCE_CONFLICT');
  }
  for (const expense of expenses) {
    if (expense.shop !== shop) continue;
    const entry = entriesById.get(String(expense._id));
    if (entry && entry.kind === 'expense' && isCashEntry(entry, validShops) &&
        isDeepStrictEqual(JSON.parse(JSON.stringify(expense)), entry.expense)) continue;
    add('expense:' + expense._id, 0, 'out', undefined, expense.addedAt, entry ? 'PAYMENT_EVIDENCE_CONFLICT' : 'PAYMENT_NOT_RECORDED');
  }
  return flows;
}
async function readCashSources(models, { shop, validShops, cutoverAt, session }) {
  if (!session?.inTransaction() || !validShops.includes(shop) || typeof cutoverAt !== 'string' ||
      !Number.isFinite(Date.parse(cutoverAt)) || new Date(cutoverAt).toISOString() !== cutoverAt) throw new HttpError(400, 'Cash sources require a consistent transaction and valid scope', 'INVALID_CASH_SCOPE');
  let count = 0, bytes = 0;
  const read = async (Model, query) => {
    const fields = Object.keys(Model.schema.paths), projection = Object.fromEntries(fields.map(field => [field, 1]));
    const size = await Model.aggregate([{ $match: query }, { $limit: 5001 }, { $project: projection },
      { $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: { $bsonSize: '$$ROOT' } } } }]).session(session).option({ maxTimeMS: 10000 });
    count += size[0]?.count || 0; bytes += size[0]?.bytes || 0;
    if (count > 5000 || bytes > 8 * 1024 * 1024) throw new HttpError(413, 'Cash source limit exceeded', 'CASH_SOURCE_LIMIT');
    return size[0]?.count ? Model.find(query).select(fields.join(' ')).sort({ _id: 1 }).limit(5001).session(session).maxTimeMS(10000).lean() : [];
  };
  const since = field => ({ $or: [{ [field]: { $gte: cutoverAt } }, { [field]: null }] });
  const returns = await read(models.CustomerReturn, { $or: [since('acceptedAt'), { 'refund.occurredAt': { $gte: cutoverAt } }] });
  const sales = await read(models.Sale, { $or: [
    { $and: [{ $or: [{ soldByShop: shop }, { soldByShop: null, shop }] }, { $or: [since('soldAt'), { reversedAt: { $gte: cutoverAt } }] }] },
    { _id: { $in: returns.map(row => row._id) } },
  ] });
  const expenses = await read(models.ShopExpense, { $and: [{ shop }, since('addedAt')] });
  const entries = await read(models.CashEntry, { $or: [
    { $and: [{ $or: [{ shop }, { toShop: shop }] }, since('occurredAt')] },
    { _id: { $in: expenses.map(row => row._id) } },
  ] });
  return normalizeCashSources({ shop, validShops, sales, returns, entries, expenses });
}
module.exports = { normalizeCashSources, readCashSources };
