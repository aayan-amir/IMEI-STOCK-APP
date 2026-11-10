const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('importing server and application does not load credentials, listen, or connect', () => {
  const child = spawnSync(process.execPath, ['-e', `
    require('dotenv').config = () => { throw Error('credential loading during import'); };
    require('mongoose').connect = () => { throw Error('connection during import'); };
    require('node:net').Server.prototype.listen = () => { throw Error('listener during import'); };
    const assert = require('node:assert/strict');
    assert.equal(typeof require('./server').startServer, 'function');
    assert.equal(typeof require('./app').createApp, 'function');
  `], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
});

test('database bootstrap does not mutate indexes or reconnect on event registration', async () => {
  const db = require('../../db');
  const mongoose = db.mongoose;
  const originalConnect = mongoose.connect;
  let connections = 0;
  mongoose.connect = () => { connections++; throw Error('unexpected connection'); };
  const originalDb = mongoose.connection.db;
  let ddlCalls = 0;
  mongoose.connection.db = { collection: () => ({ dropIndex: () => { ddlCalls++; } }) };
  try {
    mongoose.connection.emit('open');
    mongoose.connection.emit('disconnected');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ddlCalls, 0, 'startup must not drop indexes');
    assert.equal(connections, 0, 'imports must not install reconnect side effects');
    assert.equal(mongoose.get('autoIndex'), false);
    assert.equal(mongoose.get('autoCreate'), false);
  } finally {
    mongoose.connect = originalConnect;
    mongoose.connection.db = originalDb;
  }
});
