'use strict';

const { createHash } = require('node:crypto');
const { HttpError } = require('../utils/http-error');
const { documentPage } = require('./document-list');
const { saleEvents } = require('./sales-ledger');
const sources = {
  sales: { model: 'Sale', match: 'imei', fields: '_id phoneId imei imei2 brand model storage cat buyPrice salePrice profit salePriceMinor buyPriceMinor profitMinor shop soldByShop soldAt businessDate reversedAt reversalId reversalBusinessDate buyerName',
    adapt: row => ({ ...row, events: saleEvents(row) }) },
  receipts: { model: 'Shipment', match: 'items.imei', fields: '_id date supplier ref addedAt' },
  dispatches: { model: 'Dispatch', match: 'items.imei', fields: '_id date toShop note addedAt' },
  activity: { model: 'AuditLog', match: 'details.imei', fields: '_id action shop role ts details' },
};
async function imeiHistory(req) {
  const { imei, source } = req.params, descriptor = Object.hasOwn(sources, source) ? sources[source] : null;
  if (!/^\d{15}$/.test(imei) || !descriptor || Object.keys(req.query).some(key => !['limit', 'cursor'].includes(key))) throw new HttpError(400, 'Invalid IMEI history request', 'INVALID_INPUT');
  const scope = createHash('sha256').update(JSON.stringify(['imei-history', imei, source, req.session.clientId, req.authRole, [...req.validShops].sort()])).digest('hex');
  const page = await documentPage(req, { Model: req.models[descriptor.model], fields: descriptor.fields, query: { [descriptor.match]: imei }, scope, adapt: descriptor.adapt });
  return { ...page, imei, source, provenance: 'retained_imei_match', notice: 'Live retained evidence. Legacy records may have missing links; no unrecorded movement or staff identity is inferred.' };
}
module.exports = { imeiHistory };
