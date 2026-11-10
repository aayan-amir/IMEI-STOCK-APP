'use strict';

const { createHash } = require('node:crypto');
const { HttpError } = require('../utils/http-error');
const { inventoryTransaction } = require('./inventory-identity');
const { uniqueDay, touchPeriod, followingDate } = require('./accounting-period');
const { readSalesLedger, checkedBounds } = require('./sales-ledger');
const { parseMinorUnits, sumMoney, sumSaleEvents, businessDate } = require('../public/js/business-rules');
const { readCashFinancialEntries, cashFinancialManual } = require('./cash-financial');

const categories = ['GOOGLE', 'IPHONE', 'SAMSUNG', 'BOX', 'OTHER', 'EXTRA'];
const fail = (status, message) => new HttpError(status, message, 'DAY_CONFLICT');
const json = value => JSON.parse(JSON.stringify(value));
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  return value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
}
function dayChecksum(value) { return createHash('sha256').update(JSON.stringify(ordered(json(value)))).digest('hex'); }
function isDayOutcome(result) {
  try {
    const day = result?.day;
    if (result?.success !== true || Object.keys(result).length !== 2 || !day || !/^[a-f0-9]{24}$/.test(String(day._id)) ||
        !Number.isSafeInteger(day.revision) || day.revision < 1 || !['open', 'closed'].includes(day.status)) return false;
    checkedBounds(day.date, 'daily'); manualData(day);
    return typeof day.shop === 'string' && Array.isArray(day.history) && day.history.length <= 30;
  } catch { return false; }
}
function amount(value, signed = false) {
  try { const minor = parseMinorUnits(value ?? 0, { signed }); if (parseMinorUnits(minor / 100, { signed }) !== minor) throw Error(); return minor / 100; }
  catch { throw fail(400, 'Daily amounts must use valid PKR with at most two decimal places.'); }
}
function text(value, max = 500) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > max) throw fail(400, 'Invalid daily description.');
  return value.trim();
}
function manualData(input = {}) {
  const result = { cats: { EXTRA: { rows: [] } }, expenses: [], purchases: [], transfers: [], carryForward: amount(input.carryForward, true) };
  if (input.cats !== undefined && (!input.cats || typeof input.cats !== 'object' || Array.isArray(input.cats) || Object.keys(input.cats).some(key => !categories.includes(key)))) throw fail(400, 'Invalid daily categories.');
  for (const [cat, group] of Object.entries(input.cats || {})) {
    if (!group || !Array.isArray(group.rows) || group.rows.length > 1000) throw fail(400, 'Invalid daily rows.');
    for (const row of group.rows) {
      if (!row || typeof row !== 'object' || ['op', 'inQty', 'out'].some(key => row[key] != null && (!Number.isSafeInteger(row[key]) || row[key] < 0))) throw fail(400, 'Invalid daily quantity.');
      if (cat === 'EXTRA' && !row.saleAdjustmentId) result.cats.EXTRA.rows.push({ name: text(row.name, 200), boughtFor: amount(row.boughtFor, true), soldFor: amount(row.soldFor, true) });
    }
  }
  for (const field of ['expenses', 'purchases', 'transfers']) {
    if (input[field] !== undefined && (!Array.isArray(input[field]) || input[field].length > 500)) throw fail(400, 'Invalid daily entries.');
    result[field] = (input[field] || []).map(row => { if (!row || typeof row !== 'object') throw fail(400, 'Invalid daily entry.'); return { desc: text(row.desc), amt: amount(row.amt) }; });
  }
  return result;
}
function category(event) {
  if (categories.includes(event.cat) && event.cat !== 'EXTRA') return event.cat;
  const name = `${event.brand || ''} ${event.model || ''}`.toLowerCase();
  return /apple|iphone/.test(name) ? 'IPHONE' : /samsung|galaxy/.test(name) ? 'SAMSUNG' : /google|pixel/.test(name) ? 'GOOGLE' : 'OTHER';
}
function calculateDay({ events, manual, shopExpenses = [] }) {
  const totals = sumSaleEvents(events), extra = manual.cats.EXTRA.rows;
  const revenue = sumMoney([totals.revenue, ...extra.map(row => row.soldFor)]);
  const cost = sumMoney([totals.cost, ...extra.map(row => row.boughtFor)]);
  const grossProfit = sumMoney([revenue, -cost]);
  const dailyExpenses = sumMoney(manual.expenses.map(row => row.amt)), otherExpenses = sumMoney(shopExpenses.map(row => row.amount));
  const expenses = sumMoney([dailyExpenses, otherExpenses]);
  const purchases = sumMoney(manual.purchases.map(row => row.amt)), transfers = sumMoney(manual.transfers.map(row => row.amt));
  const cashMovement = sumMoney([revenue, -expenses, -purchases, -transfers]);
  const financial = { revenue, cost, grossProfit, dailyExpenses, shopExpenses: otherExpenses, expenses, purchases, transfers,
    carryForward: manual.carryForward, cashMovement, cashOnHand: sumMoney([cashMovement, manual.carryForward]), netProfit: sumMoney([grossProfit, -expenses]), units: totals.units };
  const cats = Object.fromEntries(categories.map(cat => [cat, { rows: [] }]));
  cats.EXTRA.rows = json(extra);
  const grouped = new Map();
  for (const event of events) {
    const name = `${event.brand || ''} ${event.model || ''} ${event.storage || ''}`.trim() || 'Phone';
    if (event.kind === 'reversal') { cats.EXTRA.rows.push({ name: `Sale reversal: ${name} (${event.imei})`, saleAdjustmentId: event._id, unitsDelta: -1, boughtFor: event.buyPrice, soldFor: event.salePrice }); continue; }
    const cat = category(event), key = JSON.stringify([cat, name]);
    if (!grouped.has(key)) { const row = { name, op: null, inQty: null, out: 0, soldFor: 0, soldCost: 0, costPerUnit: null, boughtFor: 0 }; grouped.set(key, row); cats[cat].rows.push(row); }
    const row = grouped.get(key); row.out++;
    row.soldFor = sumMoney([row.soldFor, event.salePrice]); row.soldCost = sumMoney([row.soldCost, event.buyPrice]);
  }
  return { financial, cats };
}

async function mutateDay({ connection, models, actor, validShops, shop, date, payload = {}, action, operationId, now = new Date(), manualVersion, session: outerSession }) {
  if (!validShops.includes(shop)) throw fail(400, 'Invalid shop.');
  checkedBounds(date, 'daily');
  if ((payload.shop !== undefined && payload.shop !== shop) || (payload.date !== undefined && payload.date !== date)) throw new HttpError(409, 'Day data belongs to a different shop or date', 'DAY_CONTEXT_MISMATCH');
  if (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0) throw fail(409, 'Reload this day and submit its revision before changing it.');
  if (operationId !== undefined && (typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(operationId))) throw fail(400, 'Invalid request key.');
  const reason = text(payload.reason);
  if (action === 'reopen' && reason.length < 3) throw fail(400, 'Explain why this closed day must be reopened.');
  const changes = action === 'save' ? manualData(payload) : undefined;
  const fingerprint = dayChecksum({ shop, date, action, revision: payload.expectedRevision, changes, reason,
    ...(payload.cashFinancialOnly === true ? { cashFinancialOnly: true } : {}) });
  const work = async session => {
    if (operationId) {
      const receipt = await models.DayOperation.findById(operationId).session(session).lean();
      if (receipt) {
        const audit = await models.AuditLog.findOne({ action: `day_${action}`, 'details.operationId': operationId }).session(session).lean();
        if (receipt.fingerprint !== fingerprint || !isDayOutcome(receipt.result) ||
            audit?.details?.resultChecksum !== dayChecksum(receipt.result.day)) throw fail(409, 'This request key differs from its saved daily operation or needs history review.');
        return receipt.result;
      }
    }
    const period = await touchPeriod(models, session, shop, now);
    if (period.cashFormatVersion === 1) {
      if (!operationId) throw new HttpError(400, 'A request key is required for cash-format sheet changes', 'INVALID_REQUEST_KEY');
      if (manualVersion !== '2') throw new HttpError(428, 'Reload the updated app before changing this sheet. Cash payments use the payment form.', 'CLIENT_UPDATE_REQUIRED');
      if (['save', 'reset'].includes(action) && payload.cashFinancialOnly !== true) throw fail(400, 'Sheet corrections must be marked as financial records only. Record actual payments in the payment form.');
    }
    let day = await uniqueDay(models, session, shop, date);
    if ((day?.revision ?? 0) !== payload.expectedRevision) throw fail(409, 'This day changed since it was loaded. Reload before saving.');
    if (!day) day = new models.Day({ shop, date, revision: 0, status: 'open', history: [] });
    if (day.status === 'closed' && action !== 'reopen') throw fail(409, 'This day is closed. Reopen it explicitly before making a correction.');
    if (action === 'reopen' && day.status !== 'closed') throw fail(409, 'This day is already open.');
    const revision = day.revision + 1, at = now.toISOString();
    if (action === 'save') {
      const events = await readSalesLedger(models, { shop, bounds: checkedBounds(date, 'daily'), session });
      const calculated = calculateDay({ events, manual: changes });
      Object.assign(day, changes, { cats: calculated.cats });
    } else if (action === 'close') {
      if (date > businessDate(now)) throw fail(400, 'A future day cannot be closed.');
      const baseManual = manualData(day.toObject());
      const events = await readSalesLedger(models, { shop, bounds: checkedBounds(date, 'daily'), session });
      const shopExpenses = await models.ShopExpense.find({ shop, date }).session(session).lean();
      const cashEntries = await readCashFinancialEntries(models, { shop, date, validShops, session });
      const manual = cashFinancialManual(baseManual, cashEntries, shopExpenses);
      const calculated = calculateDay({ events, manual, shopExpenses });
      const snapshotId = `${day.id}:${revision}`;
      const snapshot = { snapshotId, ruleVersion: 1, shop, date, revision, capturedAt: at, ...calculated, manual,
        ledger: json(events), shopExpenses: json(shopExpenses), ...(cashEntries.length ? { cashSourceVersion: 1, cashEntries: json(cashEntries), manualBase: baseManual } : {}),
        inventory: { available: false, reason: 'Historical opening and movements are not reconstructed.' } };
      if (date === businessDate(now)) {
        const stock = await models.Phone.find({ shop, status: 'in_stock' }).session(session).lean();
        try { snapshot.inventory = { available: true, kind: 'at-close', units: stock.length, value: sumMoney(stock.map(phone => phone.buyPrice)), capturedAt: at }; }
        catch { snapshot.inventory.reason = 'Recorded purchase costs need reconciliation.'; }
      }
      await models.DayVersion.create([{ _id: snapshotId, shop, date, revision, snapshot, createdAt: at }], { session });
      day.status = 'closed'; day.closedAt = at; day.closedSnapshot = snapshot;
      day.cats = cashEntries.length ? calculateDay({ events, manual: baseManual, shopExpenses }).cats : calculated.cats;
      day.history.push({ action, revision, at, snapshotId });
      if (period.openDate <= date) period.openDate = followingDate(date);
      await period.save({ session });
    } else if (action === 'reopen') {
      day.history.push({ action, revision, at, reason, snapshotId: day.closedSnapshot?.snapshotId });
      day.status = 'open'; day.closedAt = undefined; day.closedSnapshot = undefined;
    } else if (action === 'reset') {
      const manual = manualData({});
      const events = await readSalesLedger(models, { shop, bounds: checkedBounds(date, 'daily'), session });
      Object.assign(day, manual, { cats: calculateDay({ events, manual }).cats });
    }
    if (day.history.length > 30 || Buffer.byteLength(JSON.stringify(day.toObject())) > 2 * 1024 * 1024) throw fail(409, 'This day exceeds automatic revision limits and needs managed archival.');
    const cashFinancialOnly = period.cashFormatVersion === 1 && ['save', 'reset'].includes(action);
    if (cashFinancialOnly) day.cashManualChecksum = dayChecksum(manualData(day.toObject()));
    day.revision = revision;
    await day.save({ session });
    const result = { success: true, day: json(day.toObject()) };
    await models.AuditLog.create([{ action: `day_${action}`, role: actor.role, shop,
      details: { dayId: day.id, date, revision, reason, operationId, resultChecksum: dayChecksum(result.day),
        ...(cashFinancialOnly ? { cashFinancialOnly: true, cashManualChecksum: day.cashManualChecksum } : {}) } }], { session });
    if (operationId) await models.DayOperation.create([{ _id: operationId, fingerprint, result }], { session });
    return result;
  };
  return outerSession ? work(outerSession) : inventoryTransaction(connection, work);
}

module.exports = { mutateDay, calculateDay, manualData, dayChecksum, isDayOutcome };
