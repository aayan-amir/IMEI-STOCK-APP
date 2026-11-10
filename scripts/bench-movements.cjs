'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { startTestDatabase } = require('../tests/helpers/database.cjs');

(async () => {
  const fixture = await startTestDatabase(), servers = [];
  const stop = async () => { for (const server of servers) await new Promise(resolve => server.close(resolve)); await fixture.stop(); };
  let operations = 0, tracking = false, observedHeap = 0;
  try {
    const clientId = fixture.namespace + '_movements';
    const client = await fixture.db.Client.create({ clientId, adminPassword: 'owner-test', gatePassword: 'shop-test', shops: [{ id: 'A' }, { id: 'B' }] });
    const models = require('../services/backup-validation').getModels(fixture.db.getTenantDb(clientId));
    const rows = source => Array.from({ length: 1000 }, (_, index) => ({ date: '2026-11-' + String(1 + index % 9).padStart(2, '0'),
      ...(source === 'inbound' ? { supplier: 'Synthetic supplier', ref: 'Benchmark ' + index } : { toShop: 'A', note: 'Benchmark ' + index }),
      items: Array.from({ length: 10 }, (_, item) => ({ imei: String(100000000000000 + index * 10 + item), brand: 'Fixture', model: 'Retained movement ' + index,
        storage: '128GB', buyPrice: 100, notes: 'Synthetic retained metadata ' + 'x'.repeat(64) })) }));
    await models.Shipment.insertMany(rows('inbound')); await models.Dispatch.insertMany(rows('dispatch'));
    const ownerToken = await require('../middleware/auth').createSession({ clientId, role: 'admin', validShops: ['A', 'B'], authVersion: client.authVersion });
    const express = require('express');
    const wrap = app => { const outer = express(); outer.use((req, res, next) => { res.on('finish', () => { if (tracking) observedHeap = Math.max(observedHeap, process.memoryUsage().heapUsed); }); next(); }); outer.use(app); return outer; };
    const listen = app => new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port)); servers.push(server); });
    const origin = await listen(wrap(require('../app').createApp()));
    fixture.db.mongoose.set('debug', () => { if (tracking) operations++; });
    const read = async url => { const response = await fetch(origin + url, { headers: { Authorization: 'Bearer ' + ownerToken } }); assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer()); return { bytes: bytes.length, value: JSON.parse(bytes.toString()) }; };
    const sample = async mode => {
      if (global.gc) global.gc(); operations = 0; observedHeap = process.memoryUsage().heapUsed; const heapBefore = observedHeap, start = performance.now(); tracking = true;
      let bytes, loaded;
      try {
        if (mode === 'legacy') { const data = await Promise.all([read('/api/shipments'), read('/api/dispatches')]); bytes = data.reduce((sum, row) => sum + row.bytes, 0);
          loaded = data[1].value.filter(row => row.toShop === 'A' && row.date.startsWith('2026-11')).length; assert.equal(loaded, 1000);
        } else { const data = await read('/api/v2/movements?shop=A&month=2026-11&limit=50'); bytes = data.bytes; loaded = data.value.items.length; assert.equal(loaded, 50); assert.equal(data.value.total, 1000); }
        return { ms: performance.now() - start, responseBytes: bytes, loadedRecords: loaded, mongooseOperations: operations, observedProcessHeapDelta: Math.max(0, observedHeap - heapBefore) };
      } finally { tracking = false; }
    };
    for (let n = 0; n < 2; n++) { await sample('legacy'); await sample('bounded'); }
    const trials = { legacy: [], bounded: [] };
    for (let n = 0; n < 12; n++) for (const mode of n % 2 ? ['bounded', 'legacy'] : ['legacy', 'bounded']) trials[mode].push(await sample(mode));
    const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
    const results = Object.fromEntries(Object.entries(trials).map(([mode, rows]) => [mode, { trials: rows.length,
      p50ms: percentile(rows.map(row => row.ms), .5), p95ms: percentile(rows.map(row => row.ms), .95), responseBytes: rows[0].responseBytes,
      loadedRecords: rows[0].loadedRecords, mongooseOperations: rows[0].mongooseOperations,
      medianObservedProcessHeapDelta: percentile(rows.map(row => row.observedProcessHeapDelta), .5) }]));
    assert.equal(await models.Shipment.countDocuments(), 1000); assert.equal(await models.Dispatch.countDocuments(), 1000);
    console.log(JSON.stringify({ fixture: 'disposable loopback replica set', node: process.version, platform: process.platform,
      movementRecords: 2000, nestedItems: 20000, destination: 'A', month: '2026-11', gcBeforeTrial: !!global.gc, results }, null, 2));
    if (process.argv.includes('--preview')) {
      let baseline;
      const option = process.argv.find(value => value.startsWith('--baseline-public='));
      if (option) { const app = express(); app.use(express.static(path.resolve(option.slice('--baseline-public='.length)))); app.use(require('../app').createApp()); baseline = await listen(app); }
      console.log(JSON.stringify({ preview: origin, baseline, clientId, gatePassword: 'shop-test', ownerPassword: 'owner-test', scope: 'synthetic disposable account only' }));
      process.once('SIGINT', async () => { await stop(); process.exit(0); });
    } else await stop();
  } catch (error) { await stop(); throw error; }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
