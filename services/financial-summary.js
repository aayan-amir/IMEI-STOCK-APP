'use strict';

const { isDeepStrictEqual } = require('node:util');
const { HttpError } = require('../utils/http-error');
const { calculateDay, manualData } = require('./day-service');
const { readSalesLedger, checkedBounds } = require('./sales-ledger');
const { sumMoney, parseMinorUnits } = require('../public/js/business-rules');
const { readCashFinancialEntries, cashFinancialManual } = require('./cash-financial');

const RULE_VERSION = 2;
const conflict = () => new HttpError(409, 'Stored accounting data needs reconciliation before reporting.', 'FINANCIAL_CONFLICT');
const keys = ['revenue', 'cost', 'grossProfit', 'dailyExpenses', 'shopExpenses', 'expenses', 'purchases', 'transfers', 'cashMovement', 'netProfit'];
function aggregate(rows, type) {
  const totals = Object.fromEntries(keys.map(key => [key, sumMoney(rows.map(row => row[key]))]));
  totals.units = rows.reduce((sum, row) => sum + row.units, 0);
  totals.carryForward = type === 'daily' ? sumMoney(rows.map(row => row.carryForward)) : null;
  totals.cashOnHand = type === 'daily' ? sumMoney(rows.map(row => row.cashOnHand)) : null;
  return totals;
}

async function financialSummary(models, { type, period, shop = 'ALL', validShops, session }) {
  const bounds = checkedBounds(period, type);
  if (shop !== 'ALL' && !validShops.includes(shop)) throw new HttpError(400, 'Invalid shop', 'INVALID_SHOP');
  const shops = shop === 'ALL' ? [...validShops].sort() : [shop];
  const dateFilter = type === 'daily' ? period : { $regex: '^' + period + '-' };
  const scope = shop === 'ALL' ? {} : { shop };
  const events = await readSalesLedger(models, { shop, bounds, session });
  const days = await models.Day.find({ ...scope, date: dateFilter }).session(session).lean();
  const expenses = await models.ShopExpense.find({ ...scope, ...(type === 'monthly' ? { $or: [{ date: dateFilter }, { month: period }] } : { date: dateFilter }) }).session(session).lean();
  const cashEntries = await readCashFinancialEntries(models, { shop, date: dateFilter, validShops, session });
  try {
    const groups = new Map();
    function group(shop, date) {
      if (!shops.includes(shop)) throw conflict();
      try { checkedBounds(date, 'daily'); } catch { throw conflict(); }
      const key = JSON.stringify([shop, date]);
      if (!groups.has(key)) groups.set(key, { shop, date, events: [], expenses: [], cashEntries: [] });
      return groups.get(key);
    }
    for (const event of events) group(event.soldByShop || event.shop, event.businessDate).events.push(event);
    for (const day of days) { const row = group(day.shop, day.date); if (row.day) throw conflict(); row.day = day; }
    for (const entry of cashEntries) group(entry.shop, entry.postingDate).cashEntries.push(entry);
    for (const expense of expenses) {
      if (expense.month && expense.month !== expense.date?.slice(0, 7)) throw conflict();
      group(expense.shop, expense.date).expenses.push(expense);
    }
    const sources = [], ledger = [], expenseBreakdown = [], manualEntries = [];
    for (const row of [...groups.values()].sort((a, b) => a.date.localeCompare(b.date) || a.shop.localeCompare(b.shop))) {
      const closed = row.day?.status === 'closed';
      let financial, usedEvents, usedExpenses, manual;
      if (closed) {
        const snapshot = row.day.closedSnapshot;
        if (!snapshot || snapshot.shop !== row.shop || snapshot.date !== row.date || snapshot.revision !== row.day.revision || snapshot.ruleVersion !== 1) throw conflict();
        if (row.cashEntries.length || snapshot.cashSourceVersion !== undefined) {
          if (snapshot.cashSourceVersion !== 1 || !isDeepStrictEqual(JSON.parse(JSON.stringify(row.cashEntries)), snapshot.cashEntries) ||
              !isDeepStrictEqual(cashFinancialManual(manualData(snapshot.manualBase), snapshot.cashEntries, snapshot.shopExpenses), snapshot.manual)) throw conflict();
        }
        manual = manualData(snapshot.manual);
        const calculated = calculateDay({ events: snapshot.ledger, manual, shopExpenses: snapshot.shopExpenses });
        if (!isDeepStrictEqual(calculated.financial, snapshot.financial)) throw conflict();
        financial = snapshot.financial; usedEvents = snapshot.ledger; usedExpenses = snapshot.shopExpenses;
      } else {
        manual = cashFinancialManual(manualData(row.day || {}), row.cashEntries, row.expenses);
        for (const expense of row.expenses) parseMinorUnits(expense.amount);
        financial = calculateDay({ events: row.events, manual, shopExpenses: row.expenses }).financial;
        usedEvents = row.events; usedExpenses = row.expenses;
      }
      sources.push({ shop: row.shop, date: row.date, revision: row.day?.revision ?? 0, status: closed ? 'closed' : 'open',
        snapshotId: closed ? row.day.closedSnapshot.snapshotId : null, financial,
        ...(row.cashEntries.length ? { cashEntryIds: row.cashEntries.map(entry => String(entry._id)) } : {}) });
      ledger.push(...usedEvents);
      manualEntries.push(...manual.cats.EXTRA.rows.map(entry => ({ shop: row.shop, date: row.date, ...entry })));
      expenseBreakdown.push(...manual.expenses.map((expense, index) => ({ source: 'daily', shop: row.shop, date: row.date,
        sourceId: `${row.day?._id || row.shop + ':' + row.date}:${index}`, description: expense.desc, amount: expense.amt })));
      expenseBreakdown.push(...usedExpenses.map(expense => ({ source: 'shop', shop: row.shop, date: row.date, sourceId: String(expense._id), category: expense.category, description: expense.description, amount: expense.amount })));
    }
    ledger.sort((a, b) => a.soldAt.localeCompare(b.soldAt) || String(a._id).localeCompare(String(b._id)));
    const shopStats = Object.fromEntries(shops.map(shop => [shop, aggregate(sources.filter(row => row.shop === shop).map(row => row.financial), type)]));
    return { ruleVersion: RULE_VERSION, type, period, shop, financial: aggregate(sources.map(row => row.financial), type), shopStats, sources, ledger, expenseBreakdown, manualEntries,
      ...(cashEntries.length ? { cashEntries: cashEntries.map(entry => ({ _id: String(entry._id), shop: entry.shop, postingDate: entry.postingDate, kind: entry.kind,
        amountMinor: entry.amountMinor, costMinor: entry.costMinor, description: entry.description, method: entry.method, toShop: entry.toShop })) } : {}) };
  } catch { throw conflict(); }
}

function reportData(summary) {
  const f = summary.financial;
  return { ruleVersion: RULE_VERSION, totalSales: f.revenue, totalCost: f.cost, grossProfit: f.grossProfit, unitsSold: f.units,
    expenses: f.expenses, totalExpenses: f.expenses, dailyExpenses: f.dailyExpenses, shopExpenses: f.shopExpenses, netProfit: f.netProfit,
    purchases: f.purchases, transfers: f.transfers, cashMovement: f.cashMovement, cashOnHand: f.cashOnHand,
    closedRevision: summary.type === 'daily' && summary.shop !== 'ALL' && summary.sources[0]?.status === 'closed' ? summary.sources[0].revision : undefined,
    sourceRevisions: summary.sources.map(({ financial, ...source }) => source), expenseBreakdown: summary.expenseBreakdown, manualEntries: summary.manualEntries,
    salesList: summary.ledger.map(event => ({ model: `${event.brand || ''} ${event.model || ''}`.trim(), imei: event.imei,
      salePrice: event.salePrice, buyPrice: event.buyPrice, profit: event.profit, buyerName: event.buyerName || null,
      shop: event.shop, soldByShop: event.soldByShop, kind: event.kind, saleId: event.saleId || event._id })) };
}

module.exports = { financialSummary, reportData, RULE_VERSION };
