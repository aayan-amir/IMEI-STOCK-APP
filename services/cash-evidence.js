'use strict';

const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { businessDate, periodBounds, parseMinorUnits } = require('../public/js/business-rules');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function cashEntryFingerprint(row) {
  return digest({ shop: row.shop, kind: row.kind, method: row.method, amountMinor: row.amountMinor,
    description: row.description, toShop: row.toShop ?? null, costMinor: row.costMinor ?? 0,
    category: row.category ?? null, confirmed: row.confirmed });
}
function cashEntryOutcome(row) {
  return { success: true, entryId: String(row._id), shop: row.shop, kind: row.kind, method: row.method,
    amountMinor: row.amountMinor, currency: 'PKR', description: row.description, occurredAt: row.occurredAt,
    postingDate: row.postingDate, confirmed: true,
    ...(row.kind === 'income' ? { costMinor: row.costMinor } : {}),
    ...(row.kind === 'transfer' ? { toShop: row.toShop, receivingPostingDate: row.receivingPostingDate } : {}) };
}
function cashExpense(row) {
  return { _id: String(row._id), shop: row.shop, date: row.postingDate, month: row.postingDate.slice(0, 7),
    category: row.category, description: row.description, amount: row.amountMinor / 100, addedAt: row.occurredAt, __v: 0 };
}
function isCashEntry(row, validShops) {
  try {
    const id = String(row._id);
    const occurred = typeof row.occurredAt === 'string' && new Date(row.occurredAt).toISOString() === row.occurredAt;
    periodBounds(row.postingDate, 'daily');
    if (row.version !== 1 || typeof row.operationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(row.operationId) || id !== digest(['cash-entry', row.operationId]).slice(0, 24) ||
        !validShops.includes(row.shop) || !['income', 'expense', 'purchase', 'transfer'].includes(row.kind) || !['cash', 'bank'].includes(row.method) ||
        row.currency !== 'PKR' || row.confirmed !== true || !Number.isSafeInteger(row.amountMinor) || row.amountMinor <= 0 || parseMinorUnits(row.amountMinor / 100) !== row.amountMinor ||
        typeof row.description !== 'string' || !row.description.trim() || row.description.length > 500 || !occurred || row.postingDate < businessDate(row.occurredAt) ||
        row.fingerprint !== cashEntryFingerprint(row) || !isDeepStrictEqual(row.result, cashEntryOutcome(row))) return false;
    if (row.kind === 'transfer') {
      periodBounds(row.receivingPostingDate, 'daily');
      if (!validShops.includes(row.toShop) || row.toShop === row.shop || row.receivingPostingDate < businessDate(row.occurredAt)) return false;
    } else if (row.toShop !== undefined || row.receivingPostingDate !== undefined) return false;
    if (row.kind === 'income' ? !Number.isSafeInteger(row.costMinor) || row.costMinor < 0 || parseMinorUnits(row.costMinor / 100) !== row.costMinor : row.costMinor !== undefined) return false;
    if (row.kind === 'expense' ? typeof row.category !== 'string' || !row.category || row.category.length > 100 || !isDeepStrictEqual(row.expense, cashExpense(row)) : row.category !== undefined || row.expense !== undefined) return false;
    return true;
  } catch { return false; }
}
module.exports = { cashEntryFingerprint, cashEntryOutcome, cashExpense, isCashEntry };
