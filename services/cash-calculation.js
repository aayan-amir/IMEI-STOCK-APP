'use strict';

const { HttpError } = require('../utils/http-error');
function instant(value) {
  try { return typeof value === 'string' && new Date(value).toISOString() === value; }
  catch { return false; }
}
function calculateCash({ openingMinor, cutoverAt, untilAt, flows, includedSourceIds = [], historicalUnknownFlows = [] }) {
  if (!Number.isSafeInteger(openingMinor) || openingMinor < 0) throw new HttpError(400, 'Counted opening cash must be a nonnegative exact paisa amount', 'INVALID_OPENING_CASH');
  if (!instant(cutoverAt) || !instant(untilAt) || untilAt < cutoverAt || !Array.isArray(flows) || flows.length > 5000 ||
      !Array.isArray(includedSourceIds) || includedSourceIds.length > 5000 || includedSourceIds.some(id => typeof id !== 'string') ||
      !Array.isArray(historicalUnknownFlows) || historicalUnknownFlows.length > 5000 || historicalUnknownFlows.some(flow =>
        instant(flow?.occurredAt) || flow?.confirmed !== false || flow?.issue !== 'PAYMENT_NOT_RECORDED')) throw new HttpError(400, 'Invalid counted-cash scope', 'INVALID_CASH_SCOPE');
  const facts = flow => JSON.stringify([flow?.id, flow?.amountMinor, flow?.direction, flow?.method, flow?.confirmed, flow?.occurredAt, flow?.issue || null]);
  const historical = new Set(historicalUnknownFlows.map(facts));
  const included = new Set(includedSourceIds), seen = new Map(), issues = [], sourceIds = new Set();
  let inflowsMinor = 0, outflowsMinor = 0;
  const issue = (id, code) => issues.push({ id, code });
  const add = (left, right) => {
    const result = left + right;
    if (!Number.isSafeInteger(result)) throw new HttpError(409, 'Recorded cash amounts overflow the supported exact range', 'CASH_AMOUNT_OVERFLOW');
    return result;
  };
  for (const [index, flow] of flows.entries()) {
    const id = typeof flow?.id === 'string' && /^[A-Za-z0-9:_-]{1,200}$/.test(flow.id) ? flow.id : 'unknown:' + index;
    if (historical.has(facts(flow))) continue;
    if (!instant(flow?.occurredAt)) { sourceIds.add(id); issue(id, flow?.issue || 'OCCURRENCE_UNKNOWN'); continue; }
    if (flow.occurredAt < cutoverAt || flow.occurredAt > untilAt) continue;
    sourceIds.add(id);
    const evidence = facts(flow);
    if (seen.has(id)) { if (seen.get(id) !== evidence) issue(id, 'CONFLICTING_SOURCE'); continue; }
    seen.set(id, evidence);
    if (id.startsWith('unknown:') || !Number.isSafeInteger(flow.amountMinor) || flow.amountMinor < 0 || !['in', 'out'].includes(flow.direction)) { issue(id, 'INVALID_SOURCE'); continue; }
    if (flow.issue) { issue(id, flow.issue); continue; }
    if (flow.confirmed !== true || !['cash', 'bank'].includes(flow.method)) { issue(id, 'PAYMENT_NOT_RECORDED'); continue; }
    if (included.has(id) && flow.occurredAt === cutoverAt) continue;
    if (flow.method === 'cash') {
      if (flow.direction === 'in') inflowsMinor = add(inflowsMinor, flow.amountMinor);
      else outflowsMinor = add(outflowsMinor, flow.amountMinor);
    }
  }
  const complete = issues.length === 0;
  return { ruleVersion: 1, complete, openingMinor, inflowsMinor, outflowsMinor,
    expectedMinor: complete ? add(add(openingMinor, inflowsMinor), -outflowsMinor) : null,
    issues, sourceIds: [...sourceIds].sort() };
}
module.exports = { calculateCash };
