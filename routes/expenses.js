'use strict';

const express = require('express');
const router = express.Router();
const { adminOnly } = require('../middleware/auth');
const { HttpError } = require('../utils/http-error');
const { checkedBounds } = require('../services/sales-ledger');
const { touchPeriod, uniqueDay } = require('../services/accounting-period');
const { inventoryTransaction } = require('../services/inventory-identity');
const input = require('../services/inventory-input');

// ── List shop expenses ─────────────────────────────────────────────────────
router.get('/shopexpenses', adminOnly, async (req, res) => {
  try {
    const { shop, month } = req.query;
    const query = {};
    if (shop)  query.shop  = String(shop);
    if (month) query.month = String(month);
    const expenses = await req.models.ShopExpense.find(query).sort({ date: -1 }).lean();
    res.json(expenses.map(e => ({ ...e, id: e._id, _key: e._id })));
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

function checkExpense(req, shop, date) {
  if (!req.validShops.includes(shop)) throw new HttpError(400, 'Invalid shop', 'INVALID_SHOP');
  checkedBounds(date, 'daily');
}
async function openExpenseDay(req, session, shop, date) {
  const period = await touchPeriod(req.models, session, shop);
  const day = await uniqueDay(req.models, session, shop, date);
  if (day?.status === 'closed') throw new HttpError(409, 'This expense period is closed. Use a current-period correction or explicitly reopen it.', 'DAY_CONFLICT');
  return period;
}
router.post('/shopexpenses', adminOnly, async (req, res) => {
  const { shop, date, month, category, description, amount } = req.body || {};
  checkExpense(req, shop, date);
  if (month !== undefined && month !== date.slice(0, 7)) throw new HttpError(400, 'Expense month must match its date', 'INVALID_INPUT');
  const values = { shop, date, month: date.slice(0, 7), category: input.text(category, 'category'),
    description: input.text(description, 'description', 1000), amount: input.cost(amount), addedAt: new Date().toISOString() };
  const expense = await inventoryTransaction(req.tenantDb, async session => {
    const period = await openExpenseDay(req, session, shop, date);
    if (period.cashFormatVersion === 1) throw new HttpError(428, 'Use the payment form to record this expense and its payment method.', 'CLIENT_UPDATE_REQUIRED');
    const [expense] = await req.models.ShopExpense.create([values], { session });
    await req.models.AuditLog.create([{ action: 'expense_add', shop, role: req.authRole, details: { expenseId: expense.id, date, amount: values.amount } }], { session });
    return expense;
  });
  res.json({ success: true, expense: { ...expense.toObject(), _key: expense.id } });
});
router.delete('/shopexpenses/:id', adminOnly, async (req, res) => {
  if (!/^[a-f0-9]{24}$/i.test(req.params.id)) throw new HttpError(400, 'Invalid expense ID', 'INVALID_INPUT');
  await inventoryTransaction(req.tenantDb, async session => {
    const expense = await req.models.ShopExpense.findById(req.params.id).session(session);
    if (!expense) return;
    if (await req.models.CashEntry.exists({ _id: expense._id }).session(session)) throw new HttpError(409, 'This expense has retained payment evidence. A recorded payment cannot be erased through legacy expense deletion.', 'CASH_ENTRY_IMMUTABLE');
    if (await req.models.CashCheckpoint.exists({ 'flows.id': 'expense:' + expense.id }).session(session)) throw new HttpError(409, 'This expense is retained in counted-cash evidence and cannot be erased.', 'CASH_ENTRY_IMMUTABLE');
    checkExpense(req, expense.shop, expense.date);
    await openExpenseDay(req, session, expense.shop, expense.date);
    await req.models.ShopExpense.deleteOne({ _id: expense._id }, { session });
    await req.models.AuditLog.create([{ action: 'expense_delete', shop: expense.shop, role: req.authRole,
      details: { expenseId: expense.id, date: expense.date, amount: expense.amount } }], { session });
  });
  res.json({ success: true });
});

module.exports = router;
