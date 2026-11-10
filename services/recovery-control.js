'use strict';

const { randomUUID } = require('node:crypto');
const db = require('../db');
const { HttpError } = require('../utils/http-error');

function controls(connection) {
  return Object.fromEntries(['RecoveryState', 'RecoveryPlan', 'RecoveryReceipt'].map(name => [name, connection.model(name, db[`${name}Schema`])]));
}
async function ensureState(Model) {
  for (let attempt = 0; ; attempt++) {
    try { await Model.updateOne({ _id: 'tenant' }, { $setOnInsert: { epoch: 0, maintenance: false, leases: [], phase: 'idle' } }, { upsert: true }); return; }
    catch (error) { if (error.code !== 11000 || attempt >= 3) throw error; }
  }
}
async function enterWrite(connection) {
  const { RecoveryState } = controls(connection);
  await ensureState(RecoveryState);
  const lease = randomUUID();
  const entered = await RecoveryState.findOneAndUpdate({ _id: 'tenant', maintenance: false },
    { $addToSet: { leases: lease }, $inc: { epoch: 1 } }, { returnDocument: 'after' });
  if (!entered) throw new HttpError(503, 'This account is in recovery. Writes are temporarily unavailable.', 'TENANT_RECOVERY_BUSY');
  return () => RecoveryState.updateOne({ _id: 'tenant' }, { $pull: { leases: lease } });
}

function protectRouter(router) {
  for (const layer of router.stack) {
    const route = layer.route;
    if (!route || route.methods.get || ['/restore/validate', '/restore/apply'].includes(route.path)) continue;
    const terminal = route.stack.at(-1), handler = terminal.handle;
    if (handler.recoveryGuarded) continue;
    const wrapped = async (req, res, next) => {
      if (!req.tenantDb) return handler(req, res, next);
      const release = await enterWrite(req.tenantDb);
      try { return await handler(req, res, next); }
      finally { await release(); }
    };
    wrapped.recoveryGuarded = true;
    terminal.handle = wrapped;
  }
  return router;
}

module.exports = { controls, ensureState, enterWrite, protectRouter };
