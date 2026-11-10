'use strict';

const { HttpError } = require('./http-error');
const { periodBounds } = require('../public/js/business-rules');
const invalid = () => new HttpError(400, 'Invalid page parameters. Refresh the list before continuing.', 'INVALID_PAGE');
const id = value => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value);
function listOptions(query) {
  const limit = query.limit === undefined ? 50 : typeof query.limit === 'string' && /^[1-9]\d*$/.test(query.limit) ? Number(query.limit) : NaN;
  if (!Number.isSafeInteger(limit) || limit > 100 || (query.cursor !== undefined && (typeof query.cursor !== 'string' || !query.cursor || query.cursor.length > 1024))) throw invalid();
  return { limit, cursor: query.cursor };
}
function encodeCursor(scope, last, anchor) {
  if (!id(last) || !id(anchor) || last > anchor) throw invalid();
  return Buffer.from(JSON.stringify({ v: 1, scope, last, anchor })).toString('base64url');
}
function decodeCursor(cursor, scope) {
  try {
    if (typeof cursor !== 'string' || cursor.length > 1024 || !/^[\w-]+$/.test(cursor)) throw invalid();
    const raw = Buffer.from(cursor, 'base64url');
    if (raw.toString('base64url') !== cursor) throw invalid();
    const value = JSON.parse(raw.toString());
    if (value.v !== 1 || value.scope !== scope || Object.keys(value).sort().join() !== 'anchor,last,scope,v' || !id(value.last) || !id(value.anchor) || value.last > value.anchor) throw invalid();
    return { last: value.last, anchor: value.anchor };
  } catch { throw invalid(); }
}
function eventPosition(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}:[a-f0-9]{24}:[01]$/.test(value)) throw invalid();
  periodBounds(value.slice(0, 10), 'daily');
}
function encodeEventCursor(scope, last, anchor) {
  eventPosition(last); eventPosition(anchor); if (last > anchor) throw invalid();
  return Buffer.from(JSON.stringify({ v: 2, scope, last, anchor })).toString('base64url');
}
function decodeEventCursor(cursor, scope) {
  try {
    if (typeof cursor !== 'string' || cursor.length > 1024 || !/^[\w-]+$/.test(cursor)) throw invalid();
    const raw = Buffer.from(cursor, 'base64url');
    if (raw.toString('base64url') !== cursor) throw invalid();
    const value = JSON.parse(raw.toString());
    if (value.v !== 2 || value.scope !== scope || Object.keys(value).sort().join() !== 'anchor,last,scope,v' || value.last > value.anchor) throw invalid();
    eventPosition(value.last); eventPosition(value.anchor);
    return { last: value.last, anchor: value.anchor };
  } catch { throw invalid(); }
}
module.exports = { listOptions, encodeCursor, decodeCursor, encodeEventCursor, decodeEventCursor };
