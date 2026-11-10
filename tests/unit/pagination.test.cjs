const { test } = require('node:test');
const assert = require('node:assert/strict');
const { listOptions, encodeCursor, decodeCursor } = require('../../utils/pagination');
const { encodeEventCursor, decodeEventCursor } = require('../../utils/pagination');
test('list bounds accept only whole bounded limits and scalar cursors', () => {
  assert.equal(listOptions({}).limit, 50);
  assert.equal(listOptions({ limit: '100' }).limit, 100);
  for (const query of [{ limit: '0' }, { limit: '101' }, { limit: '1.5' }, { limit: ['2'] }, { cursor: ['x'] }]) {
    assert.throws(() => listOptions(query), error => error.status === 400);
  }
});
test('event cursor dates and tie-breakers are validated independently of stock cursors', () => {
  const last = '2026-11-09:123456789012345678901230:0', anchor = '2026-11-10:123456789012345678901239:1';
  const cursor = encodeEventCursor('sales-a', last, anchor);
  assert.deepEqual(decodeEventCursor(cursor, 'sales-a'), { last, anchor });
  assert.throws(() => decodeEventCursor(cursor, 'sales-b'), error => error.status === 400);
  assert.throws(() => decodeCursor(cursor, 'sales-a'), error => error.status === 400);
  const bad = Buffer.from(JSON.stringify({ v: 2, scope: 'sales-a', last: '2026-02-30:123456789012345678901230:0', anchor })).toString('base64url');
  assert.throws(() => decodeEventCursor(bad, 'sales-a'), error => error.status === 400);
});
test('cursor positions are bound to scope and require ordered valid object IDs', () => {
  const cursor = encodeCursor('scope-a', '123456789012345678901230', '123456789012345678901239');
  assert.deepEqual(decodeCursor(cursor, 'scope-a'), { last: '123456789012345678901230', anchor: '123456789012345678901239' });
  assert.throws(() => decodeCursor(cursor, 'scope-b'), error => error.status === 400);
  for (const value of ['!', 'x'.repeat(1025), Buffer.from(JSON.stringify({ v: 1, scope: 'scope-a', last: 'bad', anchor: 'bad' })).toString('base64url')]) assert.throws(() => decodeCursor(value, 'scope-a'));
});
