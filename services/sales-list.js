'use strict';

const { createHash } = require('node:crypto');
const { HttpError } = require('../utils/http-error');
const { listOptions, encodeEventCursor, decodeEventCursor } = require('../utils/pagination');
const { buildSalesByShopQuery } = require('../utils/helpers');
const { saleEvents, checkedBounds } = require('./sales-ledger');
const { inventoryTransaction } = require('./inventory-identity');
const { sumSaleEvents } = require('../public/js/business-rules');

const MAX_EVENTS = 5000, MAX_BYTES = 8 * 1024 * 1024;
const fields = '_id phoneId imei imei2 brand model cat color storage buyPrice salePrice profit buyPriceMinor salePriceMinor profitMinor shop soldByShop buyerName buyerPhone notes soldAt businessDate reversedAt reversalId reversalBusinessDate reversedBy'.split(' ');
const invalid = () => new HttpError(400, 'Invalid sales filters.', 'INVALID_FILTER');
const oversized = () => new HttpError(413, 'Sales exceed the automatic 5,000-event or 8-MiB limit. Narrow the filters or request managed export.', 'EXPORT_TOO_LARGE');
const present = field => ({ $and: [{ $ne: [{ $ifNull: [field, null] }, null] }, { $ne: [field, ''] }] });
function postingDate(field, instant) {
  return { $cond: [present(field), field, { $dateToString: { format: '%Y-%m-%d', timezone: 'Asia/Karachi', date: { $convert: { input: instant, to: 'date', onError: null, onNull: null } } } }] };
}
function salesFilter(req, exporting) {
  const allowed = ['shop', 'from', 'to', 'kind', 'q', ...(exporting ? [] : ['limit', 'cursor'])];
  if (Object.entries(req.query).some(([key, value]) => !allowed.includes(key) || typeof value !== 'string')) throw invalid();
  const filter = { shop: req.query.shop || 'ALL', from: req.query.from, to: req.query.to, kind: req.query.kind || 'all', q: (req.query.q || '').normalize('NFKC').trim().replace(/\s+/gu, ' ') };
  if (filter.shop !== 'ALL' && !req.validShops.includes(filter.shop)) throw invalid();
  if (req.authShop && filter.shop !== 'ALL' && filter.shop !== req.authShop) throw new HttpError(403, 'Forbidden', 'FORBIDDEN');
  if (!['all', 'sale', 'reversal'].includes(filter.kind) || filter.q.length > 80 || filter.q.split(' ').length > 8) throw invalid();
  for (const date of [filter.from, filter.to]) if (date !== undefined) checkedBounds(date, 'daily');
  if (filter.from && filter.to && filter.from > filter.to) throw invalid();
  const query = buildSalesByShopQuery(req.authShop || (filter.shop === 'ALL' ? undefined : filter.shop));
  const matches = [query];
  if (filter.q) matches.push(...filter.q.split(' ').map(term => ({ $or: ['brand', 'model', 'imei', 'imei2', 'buyerName', 'buyerPhone'].map(field => ({ [field]: { $regex: term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } })) })));
  const eventMatch = {};
  if (filter.from) eventMatch['event.date'] = { $gte: filter.from };
  if (filter.to) eventMatch['event.date'] = { ...eventMatch['event.date'], $lte: filter.to };
  if (filter.kind !== 'all') eventMatch['event.kind'] = filter.kind;
  const pipeline = [{ $match: { $and: matches } }, { $project: {
    _id: 0, source: Object.fromEntries(fields.map(field => [field, '$' + field])),
    event: { $concatArrays: [[{ date: postingDate('$businessDate', '$soldAt'), kind: 'sale', order: '0' }],
      { $cond: [present('$reversedAt'), [{ date: postingDate('$reversalBusinessDate', '$reversedAt'), kind: 'reversal', order: '1' }], []] }] },
  } }, { $unwind: '$event' }, { $match: eventMatch }, { $set: { cursorKey: { $concat: ['$event.date', ':', { $toString: '$source._id' }, ':', '$event.order'] } } }];
  const scope = createHash('sha256').update(JSON.stringify([req.session.clientId, req.authRole, req.authShop, [...req.validShops].sort(), filter])).digest('hex');
  return { pipeline, scope };
}
async function salesPage(req, exporting = false) {
  const { pipeline, scope } = salesFilter(req, exporting);
  const options = exporting ? {} : listOptions(req.query);
  const position = options.cursor ? decodeEventCursor(options.cursor, scope) : null;
  return inventoryTransaction(req.tenantDb, async session => {
    const run = stages => req.models.Sale.aggregate(stages).session(session).option({ maxTimeMS: 10000, collation: { locale: 'simple' }, allowDiskUse: false });
    const window = [...pipeline, ...(position ? [{ $match: { cursorKey: { $lte: position.anchor } } }] : [])];
    const count = await run([...window, { $count: 'total' }]), total = count[0]?.total || 0;
    if (exporting && total > MAX_EVENTS) throw oversized();
    const selected = [...window, ...(position ? [{ $match: { cursorKey: { $lt: position.last } } }] : []), { $sort: { cursorKey: -1 } }, { $limit: exporting ? MAX_EVENTS : options.limit + 1 }];
    const sizes = await run([...selected, { $group: { _id: null, bytes: { $sum: { $bsonSize: '$$ROOT' } } } }]);
    if (sizes[0]?.bytes > MAX_BYTES) throw oversized();
    const rows = await run(selected), hasMore = !exporting && rows.length > options.limit;
    const visible = hasMore ? rows.slice(0, options.limit) : rows;
    const items = visible.map(row => {
      const event = saleEvents(row.source).find(event => event.kind === row.event.kind);
      if (event.businessDate !== row.event.date) throw new HttpError(409, 'Stored posting dates need review.', 'INVALID_SALE_HISTORY');
      return event;
    });
    const totals = sumSaleEvents(items);
    const result = exporting ? { items, total, complete: true, totals } : { items, total, hasMore, pageTotals: totals,
      nextCursor: hasMore ? encodeEventCursor(scope, visible.at(-1).cursorKey, position?.anchor || rows[0].cursorKey) : null };
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_BYTES) throw oversized();
    return result;
  });
}
module.exports = { salesPage };
