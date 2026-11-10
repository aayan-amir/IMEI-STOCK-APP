'use strict';

const { AccountingStateSchema, DaySchema } = require('../db');
const { businessDate, periodBounds } = require('../public/js/business-rules');
const { HttpError } = require('../utils/http-error');

function accountingModels(models) {
  const connection = (models.Day || models.Phone).db;
  return { State: models.AccountingState || connection.model('AccountingState', AccountingStateSchema),
    Day: models.Day || connection.model('Day', DaySchema) };
}
async function uniqueDay(models, session, shop, date) {
  const { Day } = accountingModels(models);
  let query = Day.find({ shop, date }).limit(2);
  if (session) query = query.session(session);
  const rows = await query;
  if (rows.length > 1) throw new HttpError(409, 'Duplicate day records need reconciliation before this period can change.', 'DAY_CONFLICT');
  return rows[0] || null;
}
function followingDate(date) { return businessDate(new Date(periodBounds(date, 'daily').end)); }
async function touchPeriod(models, session, shop, now = new Date()) {
  const { State } = accountingModels(models), today = businessDate(now);
  await State.updateOne({ _id: shop }, { $inc: { version: 1 }, $setOnInsert: { openDate: today } }, { upsert: true, session });
  const state = await State.findById(shop).session(session);
  try { periodBounds(state.openDate, 'daily'); } catch { throw new HttpError(409, 'Accounting period needs review.', 'DAY_CONFLICT'); }
  if (state.openDate < today) state.openDate = today;
  return state;
}
async function postingDate(models, session, shop, now = new Date()) {
  const state = await touchPeriod(models, session, shop, now);
  for (let attempt = 0; attempt < 32; attempt++) {
    const day = await uniqueDay(models, session, shop, state.openDate);
    if (!day || day.status !== 'closed') { await state.save({ session }); return state.openDate; }
    state.openDate = followingDate(state.openDate);
  }
  throw new HttpError(409, 'No supported open posting period was found. Review the day history.', 'DAY_CONFLICT');
}

module.exports = { accountingModels, uniqueDay, touchPeriod, postingDate, followingDate };
