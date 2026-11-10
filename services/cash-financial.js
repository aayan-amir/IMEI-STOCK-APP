'use strict';

const { isDeepStrictEqual } = require('node:util');
const { CashEntrySchema } = require('../db');
const { HttpError } = require('../utils/http-error');
const { MAX_RECORDS, MAX_BYTES } = require('./document-list');
const { isCashEntry } = require('./cash-evidence');

async function readCashFinancialEntries(models, { shop, date, validShops, session }) {
  const connection = (models.Day || models.Phone).db;
  const Model = models.CashEntry || connection.model('CashEntry', CashEntrySchema);
  const query = { shop: shop === 'ALL' ? { $in: validShops } : shop, postingDate: date };
  const fields = Object.keys(CashEntrySchema.paths);
  const projection = Object.fromEntries(fields.map(field => [field, 1]));
  const size = await Model.aggregate([{ $match: query }, { $limit: MAX_RECORDS + 1 }, { $project: projection },
    { $group: { _id: null, bytes: { $sum: { $bsonSize: '$$ROOT' } }, count: { $sum: 1 } } }]).session(session).option({ maxTimeMS: 10000 });
  if (size[0]?.count > MAX_RECORDS || size[0]?.bytes > MAX_BYTES) throw new HttpError(413, 'Manual payment sources exceed automatic reporting limits', 'CASH_SOURCE_LIMIT');
  if (!size[0]?.count) return [];
  const entries = await Model.find(query).select(fields.join(' ')).sort({ _id: 1 }).limit(MAX_RECORDS + 1).session(session).maxTimeMS(10000).lean();
  if (entries.some(row => !isCashEntry(row, validShops))) throw new HttpError(409, 'Recorded manual payment evidence needs review', 'CASH_SOURCE_CONFLICT');
  return entries;
}
function cashFinancialManual(manual, entries, shopExpenses) {
  const result = JSON.parse(JSON.stringify(manual));
  for (const row of entries) {
    if (row.kind === 'expense') {
      const expense = shopExpenses.find(expense => String(expense._id) === String(row._id));
      if (!expense || !isDeepStrictEqual(JSON.parse(JSON.stringify(expense)), row.expense)) throw new HttpError(409, 'Payment and linked expense records do not agree', 'CASH_SOURCE_CONFLICT');
    } else if (row.kind === 'income') result.cats.EXTRA.rows.push({ name: row.description, boughtFor: row.costMinor / 100, soldFor: row.amountMinor / 100 });
    else if (row.kind === 'purchase') result.purchases.push({ desc: row.description, amt: row.amountMinor / 100 });
    else if (row.kind === 'transfer') result.transfers.push({ desc: row.description, amt: row.amountMinor / 100 });
  }
  return result;
}
module.exports = { readCashFinancialEntries, cashFinancialManual };
