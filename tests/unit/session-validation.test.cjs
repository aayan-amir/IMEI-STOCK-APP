const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const db = require('../../db');
const auth = require('../../middleware/auth');

test('platform administration has no default or empty secret', () => {
  const env = { ...process.env };
  delete env.SUPER_ADMIN_PASSWORD;
  const child = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const auth = require('./middleware/auth');
    assert.equal(auth.safeCompare('superadmin', auth.SUPER_ADMIN_PASSWORD), false);
    assert.equal(auth.safeCompare('', auth.SUPER_ADMIN_PASSWORD), false);
    assert.equal(auth.safeCompare('', ''), false);
    assert.equal(auth.safeCompare('secret', 'secret'), true);
  `], { env, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
});

test('session validation rejects paused, removed, stale-version, and missing clients', async () => {
  const originalSession = db.Session.findOne;
  const originalClient = db.Client.findOne;
  const session = { clientId: 'stockly_test_session', role: 'shop', shop: 'A', validShops: ['A'], authVersion: 'v1' };
  db.Session.findOne = async () => ({ ...session });
  try {
    for (const client of [null, { status: 'paused', authVersion: 'v1', shops: [{ id: 'A' }] },
      { status: 'active', authVersion: 'v2', shops: [{ id: 'A' }] },
      { status: 'active', authVersion: 'v1', shops: [{ id: 'B' }] }]) {
      db.Client.findOne = async () => client;
      assert.equal(await auth.getSession('synthetic'), null);
    }
    db.Client.findOne = async () => ({ status: 'active', authVersion: 'v1', shops: [{ id: 'A' }, { id: 'B' }] });
    assert.deepEqual((await auth.getSession('synthetic')).validShops, ['A', 'B']);
  } finally { db.Session.findOne = originalSession; db.Client.findOne = originalClient; }
});
