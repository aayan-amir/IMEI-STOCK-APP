const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../db');
const auth = require('../../middleware/auth');

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('a supplied tenant header without authentication cannot allocate a database', async () => {
  const res = response();
  let next = false;
  await auth.tenantMiddleware({ path: '/stock', headers: { 'x-client-id': 'untrusted' }, query: {} }, res, () => { next = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(next, false);
});

test('tenant selection and role guards resolve a valid session only once', async () => {
  const original = db.Session.findOne;
  const originalClient = db.Client.findOne;
  let reads = 0;
  db.Session.findOne = async () => { reads++; return { clientId: 'stockly_test_A', role: 'shop', shop: 'A', validShops: ['A'] }; };
  db.Client.findOne = async () => ({ status: 'active', shops: [{ id: 'A' }] });
  try {
    const req = { path: '/stock', headers: { authorization: 'Bearer synthetic', 'x-client-id': 'other' }, query: {} };
    const res = response();
    await auth.tenantMiddleware(req, res, () => {});
    await auth.anyAuth(req, res, () => {});
    assert.equal(reads, 1);
    assert.equal(req.tenantDb.name, 'tenant_stockly_test_A');
    assert.equal(req.authShop, 'A');
  } finally { db.Session.findOne = original; db.Client.findOne = originalClient; }
});
