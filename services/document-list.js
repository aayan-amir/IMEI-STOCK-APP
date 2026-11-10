'use strict';

const { mongoose } = require('../db');
const { HttpError } = require('../utils/http-error');
const { listOptions, encodeCursor, decodeCursor } = require('../utils/pagination');
const { inventoryTransaction } = require('./inventory-identity');
const MAX_RECORDS = 5000, MAX_BYTES = 8 * 1024 * 1024;
const oversized = () => new HttpError(413, 'Matching records exceed the automatic 5,000-record or 8-MiB limit. Narrow the filters or request managed export.', 'EXPORT_TOO_LARGE');

async function documentPage(req, { Model, fields, query, scope, exporting = false, adapt = row => row }) {
  const options = exporting ? {} : listOptions(req.query);
  const position = options.cursor ? decodeCursor(options.cursor, scope) : null;
  return inventoryTransaction(req.tenantDb, async session => {
    const window = position ? { $and: [query, { _id: { $lte: new mongoose.Types.ObjectId(position.anchor) } }] } : query;
    const total = await Model.countDocuments(window).session(session).maxTimeMS(10000);
    if (exporting && total > MAX_RECORDS) throw oversized();
    const selected = position ? { $and: [window, { _id: { $lt: new mongoose.Types.ObjectId(position.last) } }] } : window;
    const limit = exporting ? MAX_RECORDS : options.limit + 1;
    const projection = Object.fromEntries(fields.trim().split(/\s+/u).map(field => [field, 1]));
    const sizes = await Model.aggregate([{ $match: selected }, { $sort: { _id: -1 } }, { $limit: limit }, { $project: projection },
      { $group: { _id: null, bytes: { $sum: { $bsonSize: '$$ROOT' } } } }]).session(session).option({ maxTimeMS: 10000 });
    if (sizes[0]?.bytes > MAX_BYTES) throw oversized();
    const rows = await Model.find(selected).select(fields).sort({ _id: -1 }).limit(limit).session(session).maxTimeMS(10000).lean();
    const hasMore = !exporting && rows.length > options.limit;
    const items = (hasMore ? rows.slice(0, options.limit) : rows).map(row => adapt({ ...row, id: String(row._id) }));
    const result = exporting ? { items, total, complete: true } : { items, total, hasMore,
      nextCursor: hasMore ? encodeCursor(scope, items.at(-1).id, position?.anchor || items[0].id) : null };
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_BYTES) throw oversized();
    return result;
  });
}
module.exports = { documentPage, MAX_RECORDS, MAX_BYTES };
