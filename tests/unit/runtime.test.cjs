const { test } = require('node:test');
const assert = require('node:assert/strict');

test('customer-return writers require explicit valid activation', () => {
  const { readRuntimeConfig } = require('../../config/runtime');
  assert.equal(readRuntimeConfig({}).customerReturnsEnabled, false);
  assert.equal(readRuntimeConfig({ CUSTOMER_RETURNS_ENABLED: 'true' }).customerReturnsEnabled, true);
  assert.throws(() => readRuntimeConfig({ CUSTOMER_RETURNS_ENABLED: 'yes' }), /CUSTOMER_RETURNS_ENABLED/);
});

test('fully paid methods require explicit valid activation', () => {
  const { readRuntimeConfig } = require('../../config/runtime');
  assert.equal(readRuntimeConfig({}).fullyPaidSalesEnabled, false);
  assert.equal(readRuntimeConfig({ FULLY_PAID_SALES_ENABLED: 'true' }).fullyPaidSalesEnabled, true);
  assert.throws(() => readRuntimeConfig({ FULLY_PAID_SALES_ENABLED: 'yes' }), /FULLY_PAID_SALES_ENABLED/);
});

test('stock checks require explicit valid runtime activation', () => {
  const { readRuntimeConfig } = require('../../config/runtime');
  assert.equal(readRuntimeConfig({}).stocktakesEnabled, false);
  assert.equal(readRuntimeConfig({ STOCKTAKES_ENABLED: 'true' }).stocktakesEnabled, true);
  assert.equal(readRuntimeConfig({ STOCKTAKES_ENABLED: 'false' }).stocktakesEnabled, false);
  assert.throws(() => readRuntimeConfig({ STOCKTAKES_ENABLED: 'yes' }), /STOCKTAKES_ENABLED/);
});

test('runtime defaults are local and do not require credentials on import', () => {
  const { readRuntimeConfig } = require('../../config/runtime');
  const config = readRuntimeConfig({});
  assert.equal(config.port, 3000);
  assert.equal(config.nodeEnv, 'development');
  assert.equal(config.mongoUri, undefined);
  assert.equal(config.trustProxy, false);
});

test('runtime rejects malformed ports and proxy configuration', () => {
  const { readRuntimeConfig } = require('../../config/runtime');
  for (const port of ['abc', '0', '65536', '-1', '3000.5']) {
    assert.throws(() => readRuntimeConfig({ PORT: port }), /PORT/);
  }
  assert.throws(() => readRuntimeConfig({ TRUST_PROXY: 'oops' }), /TRUST_PROXY/);
  assert.equal(readRuntimeConfig({ TRUST_PROXY: '2' }).trustProxy, 2);
  assert.equal(readRuntimeConfig({ NODE_ENV: 'production' }).trustProxy, 1);
});

test('test mode permits only explicitly named loopback test databases', () => {
  const { readRuntimeConfig } = require('../../config/runtime');
  const env = { NODE_ENV: 'test' };
  assert.throws(() => readRuntimeConfig(env), /test database/);
  for (const uri of [
    'mongodb://127.0.0.1/business',
    'mongodb://example.com/stockly_test_master',
    'mongodb+srv://example.com/stockly_test_master',
    'mongodb://localhost,example.com/stockly_test_master',
  ]) assert.throws(() => readRuntimeConfig({ ...env, MONGO_URI: uri }), /test database/);
  const uri = 'mongodb://127.0.0.1:27017/stockly_test_master?replicaSet=rs0';
  assert.equal(readRuntimeConfig({ ...env, MONGO_URI: uri }).mongoUri, uri);
});

test('origin allowlist accepts exact origins and rejects paths and wildcards', () => {
  const { readRuntimeConfig } = require('../../config/runtime');
  assert.deepEqual(readRuntimeConfig({ ALLOWED_ORIGINS: 'https://example.com, capacitor://localhost' }).allowedOrigins,
    ['https://example.com', 'capacitor://localhost']);
  for (const origin of ['*', 'https://example.com/path', 'not-an-origin']) {
    assert.throws(() => readRuntimeConfig({ ALLOWED_ORIGINS: origin }), /ALLOWED_ORIGINS/);
  }
});


test('verified cash activation requires explicit Cash/Bank sales and customer-return support', () => {
  const { readRuntimeConfig } = require('../../config/runtime');
  assert.equal(readRuntimeConfig({}).verifiedCashEnabled, false);
  assert.throws(() => readRuntimeConfig({ VERIFIED_CASH_ENABLED: 'yes' }), /VERIFIED_CASH_ENABLED/);
  assert.throws(() => readRuntimeConfig({ VERIFIED_CASH_ENABLED: 'true' }), /requires/);
  assert.equal(readRuntimeConfig({ VERIFIED_CASH_ENABLED: 'true', FULLY_PAID_SALES_ENABLED: 'true', CUSTOMER_RETURNS_ENABLED: 'true' }).verifiedCashEnabled, true);
});
