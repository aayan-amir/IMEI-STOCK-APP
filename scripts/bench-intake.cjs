'use strict';

const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { startTestDatabase } = require('../tests/helpers/database.cjs');
const { withApp } = require('../tests/helpers/http.cjs');
const { getModels } = require('../services/backup-validation');
function percentile(values, rank) { const sorted = [...values].sort((a,b) => a-b); return sorted[Math.ceil(rank * sorted.length)-1]; }
async function main() {
  if (process.argv.length > 2) throw Error('This benchmark accepts no database target or other arguments');
  const fixture = await startTestDatabase();
  const originalDebug = fixture.db.mongoose.get('debug');
  try {
    const client = await fixture.db.Client.create({ clientId: fixture.namespace, adminPassword: 'synthetic-only', gatePassword: 'synthetic-only', shops: [{ id: 'A' }] });
    const token = await require('../middleware/auth').createSession({ clientId: client.clientId, role: 'admin', authVersion: client.authVersion });
    const models = getModels(fixture.db.getTenantDb(client.clientId));
    const app = require('../app').createApp({ config: require('../config/runtime').readRuntimeConfig() });
    let number = 820000000000000, commands = 0, run = 0;
    fixture.db.mongoose.set('debug', () => commands++);
    const results = { serial: [], bounded: [] };
    await withApp(app, async request => {
      async function measure(mode) {
        for (const model of Object.values(models)) await model.deleteMany({});
        const items = Array.from({ length: 25 }, (_, index) => ({ operationId: 'bench-intake-' + run + '-' + index,
          item: { imei: String(number++), brand: 'Synthetic', model: 'Phone', color: 'Black', storage: '128GB', buyPrice: 1.23 } }));
        run++; commands = 0; const started = performance.now(); let bytes = 0, requests = 0;
        const options = body => ({ method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (mode === 'serial') {
          for (const row of items) {
            const response = await request('/api/stock/add', options({ ...row.item, shop: 'A' })); requests++;
            const text = await response.text(); bytes += Buffer.byteLength(text); assert.equal(response.status, 200); assert.equal(JSON.parse(text).success, true);
          }
        } else {
          const response = await request('/api/v2/stock/intake', options({ shop: 'A', items })); requests++;
          const text = await response.text(); bytes += Buffer.byteLength(text); assert.equal(response.status, 200);
          const result = JSON.parse(text); assert.equal(result.success, true); assert.equal(result.counts.saved, 25); assert.equal(result.outcomes.every(row => row.status === 'saved'), true);
        }
        await app.locals.requestWork.idle();
        const measured = { ms: performance.now() - started, mongooseCalls: commands, requests, responseBytes: bytes };
        assert.equal(await models.Phone.countDocuments(), 25); assert.equal(await models.AuditLog.countDocuments(), 25);
        assert.equal(await models.InventoryOperation.countDocuments(), mode === 'bounded' ? 25 : 0);
        return measured;
      }
      for (let warmup=0; warmup<2; warmup++) { await measure('serial'); await measure('bounded'); }
      for (let trial=0; trial<8; trial++) for (const mode of trial % 2 ? ['bounded','serial'] : ['serial','bounded']) results[mode].push(await measure(mode));
    });
    const summary = {};
    for (const [mode, rows] of Object.entries(results)) summary[mode] = { p50Ms: percentile(rows.map(row => row.ms), .5), p95Ms: percentile(rows.map(row => row.ms), .95),
      requestsPer25: rows[0].requests, medianMongooseCalls: percentile(rows.map(row => row.mongooseCalls), .5), medianResponseBytes: percentile(rows.map(row => row.responseBytes), .5), trials: rows };
    console.log(JSON.stringify({ runtime: process.version, platform: process.platform, quantity: 25, warmupsPerMode: 2, trialsPerMode: 8,
      timing: 'HTTP response and accepted application cleanup; setup and reconciliation excluded', calls: 'Mongoose method callbacks, not wire commands', summary }, null, 2));
  } finally { fixture.db.mongoose.set('debug', originalDebug); await fixture.stop(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
