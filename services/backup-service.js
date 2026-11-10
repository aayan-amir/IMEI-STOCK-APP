'use strict';

const { allCollectionNames, namesForVersion, getModels, checksum, validateBackup, MAX_RECORDS, MAX_BYTES, excluded } = require('./backup-validation');
const { inventoryTransaction } = require('./inventory-identity');
const { HttpError } = require('../utils/http-error');

async function readCollections(connection, session, version = 2) {
  const models = getModels(connection), collections = {};
  const collectionNames = namesForVersion(version);
  if (!collectionNames) throw new HttpError(400, 'Unsupported backup version', 'INVALID_INPUT');
  if (version === 2 && await models.Sale.exists({ $or: ['paymentVersion', 'paymentMethod', 'paidAmountMinor'].map(field => ({ [field]: { $exists: true } })) }).session(session)) {
    throw new HttpError(409, 'This account contains recorded payment evidence. Use the current backup format.', 'BACKUP_VERSION_REQUIRED');
  }
  if (version === 2 && (await models.InventoryOperation.exists({ 'result.kind': 'stock_intake' }).session(session) ||
      await models.AuditLog.exists({ 'details.intakeVersion': { $exists: true } }).session(session))) {
    throw new HttpError(409, 'This account contains retained intake proof. Use the current backup format.', 'BACKUP_VERSION_REQUIRED');
  }
  for (const name of allCollectionNames.filter(name => !collectionNames.includes(name))) {
    if (await models[name].exists({}).session(session)) throw new HttpError(409, 'This account contains newer evidence. Use the current backup format.', 'BACKUP_VERSION_REQUIRED');
  }
  let count = 0;
  for (const name of collectionNames) {
    collections[name] = await models[name].find({}).sort({ _id: 1 }).limit(MAX_RECORDS - count + 1).session(session).lean();
    count += collections[name].length;
    if (count > MAX_RECORDS) throw new HttpError(413, 'This account exceeds automatic recovery limits. A larger recovery needs an administrator-managed procedure.', 'RECOVERY_LIMIT');
  }
  const json = JSON.stringify(collections);
  if (Buffer.byteLength(json) > MAX_BYTES - 16384) throw new HttpError(413, 'This account exceeds automatic recovery limits. A larger recovery needs an administrator-managed procedure.', 'RECOVERY_LIMIT');
  return JSON.parse(json);
}
async function createBackup({ connection, clientId, shops, version = 2 }) {
  return inventoryTransaction(connection, async session => {
    const collections = await readCollections(connection, session, version);
    const collectionNames = namesForVersion(version);
    const backup = { version, format: 'stockly-tenant', exportedAt: new Date().toISOString(),
      source: { clientId, shops: [...shops], currency: 'PKR', timeZone: 'Asia/Karachi' }, collections,
      manifest: { counts: Object.fromEntries(collectionNames.map(name => [name, collections[name].length])), excluded } };
    backup.checksum = checksum(backup);
    backup.validation = validateBackup(backup);
    return backup;
  });
}

module.exports = { createBackup, readCollections };
