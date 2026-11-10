'use strict';

const { createHash } = require('node:crypto');
const { HttpError } = require('../utils/http-error');
const { checkedBounds } = require('./sales-ledger');
const { parseMinorUnits } = require('../public/js/business-rules');
const { documentPage } = require('./document-list');
const descriptors = {
  days: { model: 'Day', filters: ['month', 'status'], fields: '_id shop date revision status closedAt closedSnapshot.revision closedSnapshot.ruleVersion closedSnapshot.financial', full: '_id shop date revision status closedAt closedSnapshot cats expenses purchases transfers carryForward history' },
  reports: { model: 'Report', filters: ['month', 'type'], fields: '_id shop type period generatedAt data history.generatedAt', full: '_id shop type period generatedAt data history' },
  logs: { model: 'AuditLog', filters: ['from', 'to', 'action'], fields: '_id shop action role details ts' },
};
const invalid = () => new HttpError(400, 'Invalid record filters.', 'INVALID_FILTER');
function historyEntry(row) {
  const result = { ...row, status: row.status || 'open', revision: row.revision ?? 0 };
  if (!['open', 'closed'].includes(result.status)) throw new HttpError(409, 'Stored day status needs review.', 'DAY_CONFLICT');
  if (result.status === 'closed') {
    try {
      const snapshot = row.closedSnapshot, f = snapshot.financial;
      if (snapshot.revision !== result.revision || snapshot.ruleVersion !== 1 || !Number.isSafeInteger(f.units)) throw Error();
      for (const key of ['revenue', 'expenses', 'netProfit']) if (typeof f[key] !== 'number') throw Error();
      for (const [key, value] of Object.entries(f)) if (key !== 'units') parseMinorUnits(value, { signed: true });
    } catch { throw new HttpError(409, 'Stored closed-day totals need reconciliation.', 'DAY_CONFLICT'); }
  }
  return result;
}
async function recordPage(req, resource, exporting = false) {
  const descriptor = descriptors[resource]; if (!descriptor) throw invalid();
  const allowed = ['shop', ...descriptor.filters, ...(exporting ? [] : ['limit', 'cursor'])];
  if (Object.entries(req.query).some(([key, value]) => !allowed.includes(key) || typeof value !== 'string')) throw invalid();
  const filters = Object.fromEntries(['shop', ...descriptor.filters].filter(key => req.query[key]).map(key => [key, req.query[key]]));
  const query = {};
  if (filters.shop && filters.shop !== 'ALL' && !req.validShops.includes(filters.shop)) throw invalid();
  if (filters.shop && (filters.shop !== 'ALL' || resource === 'reports')) query.shop = filters.shop;
  if (filters.month) { checkedBounds(filters.month, 'monthly'); query[resource === 'days' ? 'date' : 'period'] = { $regex: '^' + filters.month + '(?:-|$)' }; }
  if (filters.status) { if (!['open', 'closed'].includes(filters.status)) throw invalid(); query.$or = filters.status === 'open' ? [{ status: 'open' }, { status: { $exists: false } }, { status: null }] : [{ status: 'closed' }]; }
  if (filters.type) { if (!['daily', 'monthly'].includes(filters.type)) throw invalid(); query.type = filters.type; }
  if (filters.action) { if (!/^[a-z_]{1,64}$/.test(filters.action)) throw invalid(); query.action = filters.action; }
  if (filters.from) query.ts = { $gte: checkedBounds(filters.from, 'daily').start };
  if (filters.to) query.ts = { ...query.ts, $lt: checkedBounds(filters.to, 'daily').end };
  if (filters.from && filters.to && filters.from > filters.to) throw invalid();
  const scope = createHash('sha256').update(JSON.stringify([resource, req.session.clientId, req.authRole, req.authShop, [...req.validShops].sort(), filters])).digest('hex');
  return documentPage(req, { Model: req.models[descriptor.model], fields: exporting ? descriptor.full || descriptor.fields : descriptor.fields,
    query, scope, exporting, adapt: resource === 'days' ? historyEntry : row => row });
}
module.exports = { recordPage };
