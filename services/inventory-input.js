'use strict';

const { HttpError } = require('../utils/http-error');
const { parseMinorUnits, businessDate, periodBounds } = require('../public/js/business-rules');

function text(value, label, max = 150) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.length > max) throw new HttpError(400, `Invalid ${label}`, 'INVALID_INPUT');
  return value.trim() || undefined;
}
function imei(value) {
  if (typeof value !== 'string' || !/^\d{15}$/.test(value.trim())) throw new HttpError(400, 'IMEI must be exactly 15 digits', 'INVALID_IMEI');
  return value.trim();
}
function cost(value) {
  try {
    const minor = parseMinorUnits(value === undefined ? 0 : value);
    if (parseMinorUnits(minor / 100) !== minor) throw Error('Unsupported precision');
    return minor / 100;
  } catch { throw new HttpError(400, 'Purchase cost must be nonnegative PKR with at most two decimal places', 'INVALID_AMOUNT'); }
}
function stockItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new HttpError(400, 'Each item must be a phone with an IMEI', 'INVALID_INPUT');
  const result = { imei: imei(item.imei), buyPrice: cost(item.buyPrice) };
  if (item.imei2 !== undefined && item.imei2 !== '') result.imei2 = imei(item.imei2);
  for (const [field, max] of Object.entries({ cat: 40, brand: 100, model: 150, color: 80, storage: 80, notes: 2000 })) {
    const value = text(item[field], field, max);
    if (value !== undefined) result[field] = value;
  }
  return result;
}
function date(value) {
  const result = value === undefined || value === '' ? businessDate() : value;
  try { periodBounds(result, 'daily'); }
  catch { throw new HttpError(400, 'Invalid business date', 'INVALID_DATE'); }
  return result;
}

module.exports = { text, imei, cost, stockItem, date };
