'use strict';

const { createHash } = require('node:crypto');
const { documentPage, MAX_RECORDS: MAX_EXPORT_RECORDS, MAX_BYTES } = require('./document-list');
const { HttpError } = require('../utils/http-error');
const { checkedBounds } = require('./sales-ledger');

const fields = '_id imei imei2 brand model cat color storage buyPrice salePrice status shop soldByShop addedAt soldAt notes currentSaleId createdAt updatedAt';
const bad = message => new HttpError(400, message, 'INVALID_FILTER');
function stockFilter(req, exporting = false) {
  const allowed = ['shop', 'soldByShop', 'status', 'q', 'from', 'to', ...(exporting ? [] : ['cursor', 'limit'])];
  if (Object.entries(req.query).some(([key, value]) => !allowed.includes(key) || typeof value !== 'string')) throw bad('Invalid stock filters.');
  const filters = { shop: req.query.shop === 'ALL' ? undefined : req.query.shop, soldByShop: req.query.soldByShop,
    status: req.query.status || 'in_stock', q: (req.query.q || '').normalize('NFKC').trim().replace(/\s+/gu, ' '), from: req.query.from, to: req.query.to };
  for (const shop of [filters.shop, filters.soldByShop]) if (shop !== undefined && !req.validShops.includes(shop)) throw bad('Invalid shop.');
  if (req.authRole === 'shop' && [filters.shop, filters.soldByShop].some(shop => shop && shop !== req.authShop)) throw new HttpError(403, 'Forbidden', 'FORBIDDEN');
  if (!['all', 'in_stock', 'sold'].includes(filters.status) || filters.q.length > 80 || filters.q.split(' ').length > 8) throw bad('Invalid status or search.');
  const query = {};
  if (filters.soldByShop) query.soldByShop = filters.soldByShop;
  else if (req.authShop || filters.shop) query.shop = req.authShop || filters.shop;
  if (filters.soldByShop && filters.shop) query.shop = filters.shop;
  if (filters.status !== 'all') query.status = filters.status;
  if (filters.from) query.addedAt = { $gte: checkedBounds(filters.from, 'daily').start };
  if (filters.to) query.addedAt = { ...query.addedAt, $lt: checkedBounds(filters.to, 'daily').end };
  if (filters.from && filters.to && filters.from > filters.to) throw bad('The start date must precede the end date.');
  if (filters.q) query.$and = filters.q.split(' ').map(term => ({ $or: ['brand', 'model', 'imei', 'imei2', 'color', 'storage'].map(field => ({ [field]: { $regex: term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } })) }));
  const scope = createHash('sha256').update(JSON.stringify([req.session.clientId, req.authRole, req.authShop, [...req.validShops].sort(), filters])).digest('hex');
  return { query, scope };
}
async function stockPage(req, exporting = false) {
  const { query, scope } = stockFilter(req, exporting);
  return documentPage(req, { Model: req.models.Phone, fields, query, scope, exporting });
}
module.exports = { stockPage, MAX_EXPORT_RECORDS, MAX_BYTES };
