'use strict';

const { createHash } = require('node:crypto');
const { mongoose } = require('../db');
const { HttpError } = require('../utils/http-error');
const { inventoryTransaction } = require('./inventory-identity');
const { checkedBounds } = require('./sales-ledger');
const { listOptions, encodeEventCursor, decodeEventCursor } = require('../utils/pagination');
const { MAX_RECORDS, MAX_BYTES } = require('./document-list');
const oversized = () => new HttpError(413, 'Movement history exceeds automatic record or reply limits. Narrow the filters or use managed export.', 'EXPORT_TOO_LARGE');
const invalid = () => new HttpError(400, 'Invalid movement filters', 'INVALID_FILTER');
function before(position, rank, inclusive) {
  const date = position.slice(0, 10), id = new mongoose.Types.ObjectId(position.slice(11, 35)), boundaryRank = Number(position.at(-1));
  return { $or: [{ date: { $lt: date } }, { date, _id: { $lt: id } },
    ...(rank < boundaryRank || (inclusive && rank === boundaryRank) ? [{ date, _id: id }] : [])] };
}
function position(row) {
  try { checkedBounds(row.date, 'daily'); }
  catch { throw new HttpError(409, 'Stored movement dates need review before paging', 'MOVEMENT_SOURCE_CONFLICT'); }
  return `${row.date}:${row._id}:${row.rank}`;
}
async function movementPage(req, exporting = false) {
  const allowed = ['shop', 'month', ...(exporting ? [] : ['limit', 'cursor'])];
  if (Object.entries(req.query).some(([name, value]) => !allowed.includes(name) || typeof value !== 'string')) throw invalid();
  const filters = { shop: req.query.shop || 'ALL', month: req.query.month || '' };
  if (!['ALL', 'HQ'].includes(filters.shop) && !req.validShops.includes(filters.shop)) throw invalid();
  if (filters.month) checkedBounds(filters.month, 'monthly');
  const options = exporting ? { limit: MAX_RECORDS } : listOptions(req.query);
  const scope = createHash('sha256').update(JSON.stringify(['movements', req.session.clientId, req.authRole, req.authShop, [...req.validShops].sort(), filters])).digest('hex');
  const cursor = options.cursor ? decodeEventCursor(options.cursor, scope) : null;
  const base = filters.month ? { date: { $regex: '^' + filters.month + '-' } } : {};
  const sources = [
    ...(filters.shop === 'ALL' || filters.shop === 'HQ' ? [{ Model: req.models.Shipment, rank: 0, source: 'inbound', fields: '_id date supplier ref items addedAt', query: base }] : []),
    ...(filters.shop !== 'HQ' ? [{ Model: req.models.Dispatch, rank: 1, source: 'dispatch', fields: '_id date toShop note items addedAt', query: { ...base, ...(filters.shop !== 'ALL' ? { toShop: filters.shop } : {}) } }] : []),
  ];
  return inventoryTransaction(req.tenantDb, async session => {
    let total = 0, metadataBytes = 0, detailBytes = 0;
    const read = async (Model, query, fields, limit, sort, metadata) => {
      const projection = Object.fromEntries(fields.split(' ').map(field => [field, 1]));
      const pipeline = [{ $match: query }, { $project: projection }, ...(metadata ? [{ $sort: sort }] : []), { $limit: limit }];
      const size = await Model.aggregate([...pipeline,
        { $group: { _id: null, bytes: { $sum: { $bsonSize: '$$ROOT' } }, count: { $sum: 1 } } }]).session(session).option({ maxTimeMS: 10000 });
      if (metadata) metadataBytes += size[0]?.bytes || 0; else detailBytes += size[0]?.bytes || 0;
      if (metadataBytes > MAX_BYTES || detailBytes > MAX_BYTES) throw oversized();
      return size[0]?.count ? Model.aggregate(pipeline).session(session).option({ maxTimeMS: 10000 }) : [];
    };
    const candidates = [];
    for (const source of sources) {
      const window = cursor ? { $and: [source.query, before(cursor.anchor, source.rank, true)] } : source.query;
      source.window = window;
      total += await source.Model.countDocuments(window).session(session).maxTimeMS(10000);
    }
    if (exporting && total > MAX_RECORDS) throw oversized();
    for (const source of sources) {
      const query = cursor ? { $and: [source.window, before(cursor.last, source.rank, false)] } : source.window;
      const rows = await read(source.Model, query, '_id date', options.limit + 1, { date: -1, _id: -1 }, true);
      candidates.push(...rows.map(row => ({ ...row, rank: source.rank, source: source.source, position: position({ ...row, rank: source.rank }) })));
    }
    candidates.sort((left, right) => left.position > right.position ? -1 : left.position < right.position ? 1 : 0);
    const hasMore = !exporting && candidates.length > options.limit, selected = candidates.slice(0, options.limit), details = new Map();
    for (const source of sources) {
      const ids = selected.filter(row => row.rank === source.rank).map(row => row._id);
      if (!ids.length) continue;
      const rows = await read(source.Model, { _id: { $in: ids } }, source.fields, ids.length, { date: -1, _id: -1 }, false);
      if (rows.length !== ids.length) throw new HttpError(409, 'Movement history changed during the snapshot', 'MOVEMENT_SOURCE_CONFLICT');
      for (const row of rows) details.set(`${source.rank}:${row._id}`, { ...row, id: String(row._id), source: source.source });
    }
    const items = selected.map(row => details.get(`${row.rank}:${row._id}`));
    const result = exporting ? { items, total, complete: true } : { items, total, hasMore,
      nextCursor: hasMore ? encodeEventCursor(scope, selected.at(-1).position, cursor?.anchor || candidates[0].position) : null };
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_BYTES) throw oversized();
    return result;
  });
}
module.exports = { movementPage };
