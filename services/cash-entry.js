'use strict';

const { createHash } = require('node:crypto');
const { getModels } = require('./backup-validation');
const { HttpError } = require('../utils/http-error');
const { inventoryTransaction } = require('./inventory-identity');
const { enterWrite } = require('./recovery-control');
const { postingDate } = require('./accounting-period');
const { parseMinorUnits } = require('../public/js/business-rules');
const { cashEntryFingerprint, cashEntryOutcome, cashExpense, isCashEntry } = require('./cash-evidence');

function normalizeEntry(req, payload) {
  const allowed = ['shop', 'kind', 'method', 'amount', 'cost', 'description', 'category', 'toShop', 'operationId', 'confirmed'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(field => !allowed.includes(field)) ||
      !req.validShops.includes(payload.shop) || !['income', 'expense', 'purchase', 'transfer'].includes(payload.kind) || !['cash', 'bank'].includes(payload.method) ||
      payload.confirmed !== true || typeof payload.operationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(payload.operationId) ||
      typeof payload.description !== 'string' || !payload.description.trim() || payload.description.length > 500) throw new HttpError(400, 'Confirm the completed payment, shop, method, amount and description', 'INVALID_CASH_ENTRY');
  let amountMinor, costMinor;
  try {
    amountMinor = parseMinorUnits(payload.amount);
    if (amountMinor <= 0 || parseMinorUnits(amountMinor / 100) !== amountMinor) throw Error();
    if (payload.kind === 'income') { costMinor = parseMinorUnits(payload.cost ?? 0); if (parseMinorUnits(costMinor / 100) !== costMinor) throw Error(); }
  } catch { throw new HttpError(400, 'Use a positive payment with at most two decimal places', 'INVALID_CASH_ENTRY'); }
  if (payload.kind === 'transfer' ? !req.validShops.includes(payload.toShop) || payload.toShop === payload.shop : payload.toShop !== undefined) throw new HttpError(400, 'Choose a different configured receiving shop for the completed transfer', 'INVALID_CASH_ENTRY');
  if ((payload.kind !== 'income' && payload.cost !== undefined) || (payload.kind !== 'expense' && payload.category !== undefined)) throw new HttpError(400, 'These fields do not belong to this payment type', 'INVALID_CASH_ENTRY');
  const category = payload.kind === 'expense' ? payload.category ?? 'Other' : undefined;
  if (category !== undefined && (typeof category !== 'string' || !category.trim() || category.length > 100)) throw new HttpError(400, 'Invalid expense category', 'INVALID_CASH_ENTRY');
  return { operationId: payload.operationId, shop: payload.shop, kind: payload.kind, method: payload.method, currency: 'PKR',
    amountMinor, description: payload.description.trim(), confirmed: true,
    ...(payload.kind === 'income' ? { costMinor } : {}), ...(category !== undefined ? { category: category.trim() } : {}),
    ...(payload.kind === 'transfer' ? { toShop: payload.toShop } : {}) };
}
async function recordCashEntry(req, payload, { now } = {}) {
  if (req.authRole !== 'admin') throw new HttpError(403, 'Owner access required', 'FORBIDDEN');
  const input = normalizeEntry(req, payload), models = getModels(req.tenantDb);
  const id = createHash('sha256').update(JSON.stringify(['cash-entry', input.operationId])).digest('hex').slice(0, 24);
  const fingerprint = cashEntryFingerprint(input), release = await enterWrite(req.tenantDb);
  try {
    return await inventoryTransaction(req.tenantDb, async session => {
      const existing = await models.CashEntry.findById(id).session(session).lean();
      if (existing) {
        if (existing.fingerprint !== fingerprint || !isCashEntry(existing, req.validShops)) throw new HttpError(409, 'This payment request differs from its retained record or needs review', 'CASH_ENTRY_CONFLICT');
        return existing.result;
      }
      const clock = now || new Date();
      const dates = {};
      for (const shop of [...new Set([input.shop, input.toShop].filter(Boolean))].sort()) dates[shop] = await postingDate(models, session, shop, clock);
      await models.AccountingState.updateMany({ _id: { $in: Object.keys(dates) } }, { $set: { cashFormatVersion: 1 } }, { session });
      const row = { _id: id, version: 1, ...input, fingerprint, occurredAt: clock.toISOString(), postingDate: dates[input.shop],
        ...(input.toShop ? { receivingPostingDate: dates[input.toShop] } : {}) };
      if (input.kind === 'expense') {
        const [expense] = await models.ShopExpense.create([cashExpense(row)], { session });
        row.expense = JSON.parse(JSON.stringify(expense.toObject()));
      }
      row.result = cashEntryOutcome(row);
      if (!isCashEntry(row, req.validShops)) throw new HttpError(409, 'Completed payment evidence did not reconcile', 'CASH_ENTRY_CONFLICT');
      await models.CashEntry.create([row], { session });
      await models.AuditLog.create([{ action: 'cash_entry_record', role: 'admin', shop: input.shop,
        details: { operationId: input.operationId, entryId: id, kind: input.kind, method: input.method,
          amountMinor: input.amountMinor, toShop: input.toShop || null, occurredAt: row.occurredAt } }], { session });
      return row.result;
    });
  } finally { await release(); }
}
module.exports = { recordCashEntry };
