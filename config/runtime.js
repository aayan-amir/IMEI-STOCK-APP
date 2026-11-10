'use strict';

function assertTestMongoUri(uri) {
  let parsed;
  try { parsed = new URL(uri); } catch { /* rejected below */ }
  if (!parsed || parsed.protocol !== 'mongodb:' ||
      !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
      !/^\/stockly_test_[a-zA-Z0-9_-]+$/.test(parsed.pathname) || parsed.username || parsed.password) {
    throw new Error('Tests require a loopback stockly_test_ test database');
  }
}

function readRuntimeConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const port = env.PORT === undefined ? 3000 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  let trustProxy = nodeEnv === 'production' ? 1 : false;
  if (env.TRUST_PROXY !== undefined) {
    const raw = env.TRUST_PROXY;
    if (raw === 'true' || raw === 'false') trustProxy = raw === 'true';
    else if (/^\d+$/.test(raw) && Number.isSafeInteger(Number(raw))) trustProxy = Number(raw);
    else throw new Error('Invalid TRUST_PROXY');
  }
  const allowedOrigins = env.ALLOWED_ORIGINS === undefined
    ? ['capacitor://localhost', 'http://localhost', 'https://localhost']
    : env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
  for (const origin of allowedOrigins) {
    if (!/^(https?|capacitor):\/\/[^/?#\s]+$/.test(origin)) throw new Error('Invalid ALLOWED_ORIGINS');
    const url = new URL(origin);
    if (!url.hostname || url.username || url.password) throw new Error('Invalid ALLOWED_ORIGINS');
  }
  if (nodeEnv === 'test') assertTestMongoUri(env.MONGO_URI);
  if (env.STOCKTAKES_ENABLED !== undefined && !['true', 'false'].includes(env.STOCKTAKES_ENABLED)) throw new Error('Invalid STOCKTAKES_ENABLED');
  if (env.FULLY_PAID_SALES_ENABLED !== undefined && !['true', 'false'].includes(env.FULLY_PAID_SALES_ENABLED)) throw new Error('Invalid FULLY_PAID_SALES_ENABLED');
  if (env.CUSTOMER_RETURNS_ENABLED !== undefined && !['true', 'false'].includes(env.CUSTOMER_RETURNS_ENABLED)) throw new Error('Invalid CUSTOMER_RETURNS_ENABLED');
  if (env.VERIFIED_CASH_ENABLED !== undefined && !['true', 'false'].includes(env.VERIFIED_CASH_ENABLED)) throw new Error('Invalid VERIFIED_CASH_ENABLED');
  if (env.VERIFIED_CASH_ENABLED === 'true' && (env.FULLY_PAID_SALES_ENABLED !== 'true' || env.CUSTOMER_RETURNS_ENABLED !== 'true')) throw new Error('Verified cash requires fully paid sales and customer returns');
  return { nodeEnv, port, trustProxy, allowedOrigins, mongoUri: env.MONGO_URI,
    stocktakesEnabled: env.STOCKTAKES_ENABLED === 'true', fullyPaidSalesEnabled: env.FULLY_PAID_SALES_ENABLED === 'true', customerReturnsEnabled: env.CUSTOMER_RETURNS_ENABLED === 'true', verifiedCashEnabled: env.VERIFIED_CASH_ENABLED === 'true' };
}

module.exports = { readRuntimeConfig, assertTestMongoUri };
