'use strict';

const { createHash } = require('node:crypto');
const { HttpError } = require('../utils/http-error');
const { inventoryTransaction } = require('./inventory-identity');
const { getModels, MAX_BYTES } = require('./backup-validation');
const { controls, enterWrite } = require('./recovery-control');
const { businessDate } = require('../public/js/business-rules');

const phoneFields = ['_id', 'imei', 'imei2', 'shop', 'status', 'buyPrice', 'salePrice', 'currentSaleId', 'updatedAt', 'brand', 'model', 'color', 'storage', 'cat', 'notes'];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function phoneFingerprint(phone) {
  return digest(phoneFields.map(field => phone[field] ?? null));
}

async function stocktakeConfiguration(req, session) {
  const { RecoveryState } = controls(req.tenantDb);
  const state = await RecoveryState.findById('tenant').session(session).lean();
  return digest([req.session.clientId, [...req.validShops].sort(), req.session.authVersion, state?.activePlanId || null]);
}

async function stocktakeDifferences(req, models, count, session) {
  const query = { $or: [{ shop: count.shop, status: 'in_stock' },
    { _id: { $in: count.baseline.map(row => new models.Phone.base.Types.ObjectId(row.phoneId)) } },
    { imei: { $in: [...new Set([...count.baseline.map(row => row.imei), ...count.observations.map(row => row.imei)])] } }] };
  const projection = Object.fromEntries(phoneFields.map(field => [field, 1]));
  const size = await models.Phone.aggregate([{ $match: query }, { $limit: 5001 }, { $project: projection },
    { $group: { _id: null, bytes: { $sum: { $bsonSize: '$$ROOT' } }, count: { $sum: 1 } } }]).session(session).option({ maxTimeMS: 10000 });
  if (size[0]?.count > 5000 || size[0]?.bytes > MAX_BYTES / 2) throw new HttpError(413, 'This review exceeds automatic stock-check limits', 'STOCKTAKE_LIMIT');
  const current = await models.Phone.find(query).select(phoneFields.join(' ')).limit(5001).session(session).maxTimeMS(10000).lean();
  return compareStocktake(count, current, await stocktakeConfiguration(req, session));
}

async function readStocktake(req, id) {
  if (req.authRole !== 'admin') throw new HttpError(403, 'Owner access required', 'FORBIDDEN');
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) throw new HttpError(400, 'Invalid stock check', 'INVALID_INPUT');
  const models = getModels(req.tenantDb);
  return inventoryTransaction(req.tenantDb, async session => {
    const count = await models.Stocktake.findById(id).session(session).lean();
    if (!count || !req.validShops.includes(count.shop)) throw new HttpError(404, 'Stock check not found', 'NOT_FOUND');
    const differences = count.status === 'reviewed' ? count.review : count.status === 'cancelled' ? null : await stocktakeDifferences(req, models, count, session);
    return { stocktakeId: id, shop: count.shop, status: count.status, revision: count.revision, startedAt: count.startedAt,
      finishedAt: count.finishedAt, baselineCount: count.baseline.length, observationCount: count.observations.length, differences };
  });
}

async function finishStocktake(req, { stocktakeId, expectedRevision, operationId, status }) {
  if (req.authRole !== 'admin') throw new HttpError(403, 'Owner access required', 'FORBIDDEN');
  if (typeof stocktakeId !== 'string' || !/^[a-f0-9]{24}$/.test(stocktakeId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
      typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(operationId) || !['reviewed', 'cancelled'].includes(status)) throw new HttpError(400, 'Invalid stock-check review', 'INVALID_INPUT');
  const models = getModels(req.tenantDb), fingerprint = digest(['finish', status, expectedRevision]);
  const release = await enterWrite(req.tenantDb);
  try {
    return await inventoryTransaction(req.tenantDb, async session => {
      const count = await models.Stocktake.findById(stocktakeId).session(session).lean();
      if (!count || !req.validShops.includes(count.shop)) throw new HttpError(404, 'Stock check not found', 'NOT_FOUND');
      const replay = count.operations.find(row => row.key === operationId);
      if (replay) {
        if (replay.fingerprint !== fingerprint || replay.result?.success !== true) throw new HttpError(409, 'This request key was used for a different action', 'STOCKTAKE_CONFLICT');
        return replay.result;
      }
      if (count.status !== 'open' || count.revision !== expectedRevision) throw new HttpError(409, 'This stock check changed. Reload it before reviewing.', 'STOCKTAKE_CONFLICT');
      const review = status === 'reviewed' ? await stocktakeDifferences(req, models, count, session) : null;
      if (review?.recheckRequired) throw new HttpError(409, 'Trading or account changes require a fresh stock check. Cancel this count and start again.', 'STOCKTAKE_RECHECK');
      const result = { success: true, stocktakeId, revision: expectedRevision + 1, status, observationCount: count.observations.length };
      const changed = await models.Stocktake.updateOne({ _id: stocktakeId, revision: expectedRevision, status: 'open' }, {
        $set: { status, finishedAt: new Date().toISOString(), review }, $inc: { revision: 1 },
        $push: { operations: { key: operationId, fingerprint, revision: result.revision, result } },
      }, { session });
      if (changed.matchedCount !== 1) throw new HttpError(409, 'This stock check changed. Reload it before reviewing.', 'STOCKTAKE_CONFLICT');
      await models.AuditLog.create([{ action: 'stocktake_' + status, role: 'admin', shop: count.shop,
        details: { operationId, stocktakeId, revision: result.revision } }], { session });
      return result;
    });
  } finally { await release(); }
}

async function createStocktake(req, { shop, operationId }) {
  if (req.authRole !== 'admin') throw new HttpError(403, 'Owner access required', 'FORBIDDEN');
  if (!req.validShops.includes(shop) || typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(operationId)) throw new HttpError(400, 'Choose a configured shop and a valid request key', 'INVALID_INPUT');
  const models = getModels(req.tenantDb);
  const id = digest(['stocktake-start', operationId]).slice(0, 24);
  const fingerprint = digest(['start', shop]);
  const result = { success: true, stocktakeId: id, revision: 0, status: 'open', observationCount: 0 };
  const release = await enterWrite(req.tenantDb);
  try {
    return await inventoryTransaction(req.tenantDb, async session => {
      const replay = await models.Stocktake.findById(id).session(session).lean();
      if (replay) {
        const operation = replay.operations.find(row => row.key === operationId);
        if (operation?.fingerprint !== fingerprint) throw new HttpError(409, 'This request key was used for a different count', 'STOCKTAKE_CONFLICT');
        return result;
      }
      const query = { shop, status: 'in_stock' };
      const projection = Object.fromEntries(phoneFields.map(field => [field, 1]));
      const size = await models.Phone.aggregate([{ $match: query }, { $limit: 5001 }, { $project: projection },
        { $group: { _id: null, bytes: { $sum: { $bsonSize: '$$ROOT' } }, count: { $sum: 1 } } }]).session(session).option({ maxTimeMS: 10000 });
      if (size[0]?.count > 5000 || size[0]?.bytes > MAX_BYTES / 2) throw new HttpError(413, 'This shop exceeds automatic stock-check limits', 'STOCKTAKE_LIMIT');
      const phones = await models.Phone.find(query).select(phoneFields.join(' ')).sort({ _id: 1 }).limit(5001).session(session).maxTimeMS(10000).lean();
      if (phones.some(phone => !/^\d{15}$/.test(phone.imei)) || new Set(phones.map(phone => phone.imei)).size !== phones.length) throw new HttpError(409, 'Phone identities need review before counting', 'STOCKTAKE_CONFLICT');
      const startedAt = new Date().toISOString();
      await models.Stocktake.create([{ _id: id, shop, status: 'open', startedAt, businessDate: businessDate(startedAt),
        configuration: await stocktakeConfiguration(req, session), revision: 0,
        baseline: phones.map(phone => ({ phoneId: String(phone._id), imei: phone.imei, fingerprint: phoneFingerprint(phone) })),
        observations: [], operations: [{ key: operationId, fingerprint, revision: 0, result }] }], { session });
      await models.AuditLog.create([{ action: 'stocktake_start', role: 'admin', shop,
        details: { operationId, stocktakeId: id, baselineCount: phones.length } }], { session });
      return result;
    });
  } finally { await release(); }
}

async function observeStocktake(req, { stocktakeId, imei, expectedRevision, operationId }) {
  if (req.authRole !== 'admin') throw new HttpError(403, 'Owner access required', 'FORBIDDEN');
  if (typeof stocktakeId !== 'string' || !/^[a-f0-9]{24}$/.test(stocktakeId) || typeof imei !== 'string' || !/^\d{15}$/.test(imei) ||
      !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(operationId)) throw new HttpError(400, 'Invalid stock-check scan', 'INVALID_INPUT');
  const models = getModels(req.tenantDb);
  const fingerprint = digest(['scan', imei, expectedRevision]);
  const release = await enterWrite(req.tenantDb);
  try {
    return await inventoryTransaction(req.tenantDb, async session => {
      const count = await models.Stocktake.findById(stocktakeId).session(session).lean();
      if (!count || !req.validShops.includes(count.shop)) throw new HttpError(404, 'Stock check not found', 'NOT_FOUND');
      const replay = count.operations.find(row => row.key === operationId);
      if (replay) {
        if (replay.fingerprint !== fingerprint || replay.result?.success !== true) throw new HttpError(409, 'This request key was used for a different action', 'STOCKTAKE_CONFLICT');
        return replay.result;
      }
      if (count.status !== 'open' || count.revision !== expectedRevision || count.configuration !== await stocktakeConfiguration(req, session)) throw new HttpError(409, 'This stock check changed. Reload it before scanning.', 'STOCKTAKE_CONFLICT');
      if (count.observations.length >= 10000 || count.operations.length >= 10001) throw new HttpError(413, 'This stock check reached its observation limit', 'STOCKTAKE_LIMIT');
      const result = { success: true, stocktakeId, revision: expectedRevision + 1, status: 'open', observationCount: count.observations.length + 1 };
      const changed = await models.Stocktake.updateOne({ _id: stocktakeId, revision: expectedRevision, status: 'open' }, {
        $push: { observations: { imei, observedAt: new Date().toISOString() }, operations: { key: operationId, fingerprint, revision: result.revision, result } },
        $inc: { revision: 1 },
      }, { session });
      if (changed.matchedCount !== 1) throw new HttpError(409, 'This stock check changed. Reload it before scanning.', 'STOCKTAKE_CONFLICT');
      await models.AuditLog.create([{ action: 'stocktake_scan', role: 'admin', shop: count.shop,
        details: { operationId, stocktakeId, imei, revision: result.revision } }], { session });
      return result;
    });
  } finally { await release(); }
}

function compareStocktake(count, current, configuration) {
  const byId = new Map(current.map(phone => [String(phone._id), phone]));
  const byImei = new Map();
  for (const phone of current) {
    const matches = byImei.get(phone.imei) || [];
    matches.push(phone); byImei.set(phone.imei, matches);
  }
  const scans = new Map();
  for (const observation of count.observations) scans.set(observation.imei, (scans.get(observation.imei) || 0) + 1);
  const captured = new Set(count.baseline.map(item => item.phoneId));
  const baselineImeis = new Set(count.baseline.map(item => item.imei));
  const invalidated = configuration !== count.configuration;
  const changed = [], missing = [], matched = [];
  for (const item of count.baseline) {
    const phone = byId.get(item.phoneId);
    if (invalidated || !phone || phoneFingerprint(phone) !== item.fingerprint || byImei.get(item.imei)?.length !== 1) changed.push(item.imei);
    else if (scans.has(item.imei)) matched.push(item.imei);
    else missing.push(item.imei);
  }
  const newArrivals = current.filter(phone => phone.shop === count.shop && phone.status === 'in_stock' && !captured.has(String(phone._id))).map(phone => phone.imei);
  const unexpected = [...scans.keys()].filter(imei => !baselineImeis.has(imei));
  const wrongShop = [...scans.keys()].filter(imei => (byImei.get(imei) || []).some(phone => phone.shop !== count.shop));
  const duplicates = [...scans].filter(([, times]) => times > 1).map(([imei]) => imei);
  return { invalidated, recheckRequired: invalidated || changed.length > 0 || newArrivals.length > 0,
    matched, missing, changed, newArrivals, unexpected, wrongShop, duplicates };
}

module.exports = { phoneFingerprint, compareStocktake, createStocktake, observeStocktake, readStocktake, finishStocktake };
