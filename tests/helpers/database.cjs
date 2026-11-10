const path = require('node:path');
const { randomUUID } = require('node:crypto');

const binary = { version: '8.2.6', downloadDir: path.resolve(__dirname, '../../node_modules/.cache/mongodb-binaries') };

async function startTestDatabase() {
  process.env.NODE_ENV = 'test';
  process.env.MONGOMS_RUNTIME_DOWNLOAD = 'false';
  const { MongoMemoryReplSet } = require('mongodb-memory-server');
  const replica = await MongoMemoryReplSet.create({ binary, replSet: { count: 1, ip: '127.0.0.1', storageEngine: 'wiredTiger' } });
  const namespace = `stockly_test_${randomUUID().replaceAll('-', '')}`;
  process.env.MONGO_URI = replica.getUri(namespace);
  const db = require('../../db');
  await db.connectMongo(process.env.MONGO_URI);
  await db.Client.createIndexes();
  await db.Session.createIndexes();
  return { db, namespace, async stop() { await db.mongoose.disconnect(); await replica.stop(); } };
}

module.exports = { binary, startTestDatabase };
