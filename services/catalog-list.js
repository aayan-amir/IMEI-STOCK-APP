'use strict';

const { createHash } = require('node:crypto');
const { HttpError } = require('../utils/http-error');
const { documentPage } = require('./document-list');
const descriptors = {
  customers: { model: 'Customer', fields: '_id name phone email notes addedAt', search: ['name', 'phone', 'email'] },
  products: { model: 'Product', fields: '_id name normalizedName quantity buyPrice shop notes revision addedAt updatedAt', search: ['name'] },
};
const invalid = () => new HttpError(400, 'Invalid list filters.', 'INVALID_FILTER');
async function catalogPage(req, resource, exporting = false) {
  const descriptor = descriptors[resource];
  if (!descriptor) throw invalid();
  const allowed = ['q', ...(resource === 'products' ? ['shop', 'availability'] : []), ...(exporting ? [] : ['limit', 'cursor'])];
  if (Object.entries(req.query).some(([key, value]) => !allowed.includes(key) || typeof value !== 'string')) throw invalid();
  const filter = { q: (req.query.q || '').normalize('NFKC').trim().replace(/\s+/gu, ' '), shop: req.query.shop || 'ALL', availability: req.query.availability || 'all' };
  if (filter.q.length > 80 || filter.q.split(' ').length > 8 || !['all', 'available', 'empty'].includes(filter.availability)) throw invalid();
  const query = {};
  if (resource === 'products') {
    if (filter.shop !== 'ALL' && !req.validShops.includes(filter.shop)) throw invalid();
    if (req.authShop && filter.shop !== 'ALL' && filter.shop !== req.authShop) throw new HttpError(403, 'Forbidden', 'FORBIDDEN');
    const shop = req.authShop || (filter.shop === 'ALL' ? null : filter.shop); if (shop) query.shop = shop;
    if (filter.availability === 'available') query.quantity = { $gt: 0 };
    if (filter.availability === 'empty') query.quantity = 0;
  }
  if (filter.q) query.$and = filter.q.split(' ').map(term => ({ $or: descriptor.search.map(field => ({ [field]: { $regex: term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } })) }));
  const scope = createHash('sha256').update(JSON.stringify([resource, req.session.clientId, req.authRole, req.authShop, [...req.validShops].sort(), filter])).digest('hex');
  return documentPage(req, { Model: req.models[descriptor.model], fields: descriptor.fields, query, scope, exporting,
    adapt: row => resource === 'products' ? { ...row, revision: row.revision ?? 0 } : row });
}
module.exports = { catalogPage };
