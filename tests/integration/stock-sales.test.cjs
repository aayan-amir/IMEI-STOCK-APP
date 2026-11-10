const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestDatabase } = require('../helpers/database.cjs');
const { withApp } = require('../helpers/http.cjs');

let fixture, app, Phone, Sale, AuditLog, token, adminToken;
let sequence = 100000000000000;
before(async () => {
  fixture = await startTestDatabase();
  const db = fixture.db;
  const client = await db.Client.create({ clientId: fixture.namespace, adminPassword: 'test-admin', gatePassword: 'test-gate', shops: [{ id: 'A' }, { id: 'B' }] });
  token = await require('../../middleware/auth').createSession({ clientId: client.clientId, role: 'shop', shop: 'A', validShops: ['A', 'B'], authVersion: client.authVersion });
  adminToken = await require('../../middleware/auth').createSession({ clientId: client.clientId, role: 'admin', validShops: ['A', 'B'], authVersion: client.authVersion });
  const tenant = db.getTenantDb(client.clientId);
  Phone = tenant.model('Phone', db.PhoneSchema);
  Sale = tenant.model('Sale', db.SaleSchema);
  AuditLog = tenant.model('AuditLog', db.AuditLogSchema);
  app = require('../../app').createApp({ config: require('../../config/runtime').readRuntimeConfig() });
});
after(async () => { if (fixture) await fixture.stop(); });

async function phone(fields = {}) {
  return Phone.create({ imei: String(sequence++), shop: 'B', status: 'in_stock', buyPrice: 100, brand: 'Test', model: 'Phone', ...fields });
}
function sell(request, item, { key, price = 200, authToken = token, ...extra } = {}) {
  return request('/api/stock/sell', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}`, ...(key ? { 'Idempotency-Key': key } : {}) },
    body: JSON.stringify({ imei: item.imei, salePrice: price, ...extra }),
  });
}

test('two simultaneous sales of one phone acknowledge exactly one sale', async () => {
  const item = await phone();
  const Identity = Phone.db.model('InventoryIdentity', fixture.db.InventoryIdentitySchema);
  const original = Identity.updateOne;
  let reads = 0, release;
  const bothRead = new Promise(resolve => { release = resolve; });
  const initialStates = [];
  Identity.updateOne = function (...args) {
    const query = original.apply(this, args);
    if (args[0]?._id === item.imei) {
      const exec = query.exec;
      query.exec = async function () {
        if (reads < 2) {
          const observed = await Phone.findById(item.id).session(args[2].session);
          initialStates.push(observed.status);
          if (++reads === 2) release();
          await bothRead;
        }
        return exec.call(this);
      };
    }
    return query;
  };
  try {
    await withApp(app, async request => {
      const responses = await Promise.all([sell(request, item), sell(request, item)]);
      assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
      assert.equal(await Sale.countDocuments({ imei: item.imei }), 1);
      assert.equal((await Phone.findById(item.id)).status, 'sold');
      assert.equal(reads, 2, 'both transactions must reach the barrier before the identity lock write');
      assert.deepEqual(initialStates, ['in_stock', 'in_stock']);
    });
  } finally { Identity.updateOne = original; }
});

test('audit failure rolls back the phone, sale, and request receipt together', async () => {
  const item = await phone();
  const original = AuditLog.create;
  AuditLog.create = async () => { throw Error('injected audit failure'); };
  try {
    await withApp(app, async request => {
      const response = await sell(request, item, { key: 'audit-failure-request' });
      assert.equal(response.status, 500);
      const unchanged = await Phone.findById(item.id);
      assert.equal(unchanged.status, 'in_stock');
      assert.equal(unchanged.salePrice, undefined);
      assert.equal(unchanged.soldByShop, undefined);
      assert.equal(await Sale.countDocuments({ imei: item.imei }), 0);
    });
  } finally { AuditLog.create = original; }
  await withApp(app, async request => assert.equal((await sell(request, item, { key: 'audit-failure-request' })).status, 200));
});

test('retrying an acknowledged request returns the original sale without another write', async () => {
  const item = await phone();
  await withApp(app, async request => {
    const first = await sell(request, item, { key: 'replay-sale-request' });
    const original = await first.json();
    assert.equal(first.status, 200);
    const second = await sell(request, item, { key: 'replay-sale-request' });
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), original);
    assert.equal(await Sale.countDocuments({ imei: item.imei }), 1);
    assert.equal(await AuditLog.countDocuments({ action: 'stock_sell', 'details.imei': item.imei }), 1);
  });
});

test('reusing a request key for a different phone is a conflict and does not sell it', async () => {
  const first = await phone();
  const second = await phone();
  await withApp(app, async request => {
    assert.equal((await sell(request, first, { key: 'conflicting-request-key' })).status, 200);
    assert.equal((await sell(request, second, { key: 'conflicting-request-key' })).status, 409);
    assert.equal((await Phone.findById(second.id)).status, 'in_stock');
    assert.equal(await Sale.countDocuments({ imei: second.imei }), 0);
  });
});

test('duplicate legacy IMEIs are refused rather than choosing an arbitrary phone', async () => {
  const item = await phone();
  await phone({ imei: item.imei });
  await withApp(app, async request => {
    assert.equal((await sell(request, item)).status, 409);
    assert.equal(await Phone.countDocuments({ imei: item.imei, status: 'sold' }), 0);
    assert.equal(await Sale.countDocuments({ imei: item.imei }), 0);
  });
});

test('invalid or over-precision sale prices never change stock', async () => {
  const item = await phone();
  await withApp(app, async request => {
    for (const price of ['Infinity', '-10', '0.001', '1e3', '', null]) {
      assert.equal((await sell(request, item, { price })).status, 400, `price: ${price}`);
      assert.equal((await Phone.findById(item.id)).status, 'in_stock');
    }
  });
});

test('profit uses exact cents while retaining the existing rupee response fields', async () => {
  const item = await phone({ buyPrice: 0.2 });
  await withApp(app, async request => {
    const response = await sell(request, item, { price: '100.10' });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.sale.salePrice, 100.1);
    assert.equal(result.sale.buyPrice, 0.2);
    assert.equal(result.sale.profit, 99.9);
    assert.equal(result.sale.salePriceMinor, 10010);
    assert.equal(result.sale.profitMinor, 9990);
  });
});

test('sale-write failure leaves no partial status, selling shop, price or audit entry', async () => {
  const item = await phone();
  const original = Sale.prototype.save;
  Sale.prototype.save = async () => { throw Error('injected sale write failure'); };
  try {
    await withApp(app, async request => {
      assert.equal((await sell(request, item)).status, 500);
      const unchanged = await Phone.findById(item.id);
      for (const field of ['salePrice', 'soldAt', 'soldByShop']) assert.equal(unchanged[field], undefined, field);
      assert.equal(unchanged.status, 'in_stock');
      assert.equal(await AuditLog.countDocuments({ action: 'stock_sell', 'details.imei': item.imei }), 0);
    });
  } finally { Sale.prototype.save = original; }
});

test('simultaneous replay of one key produces one sale and identical acknowledgments', async () => {
  const item = await phone();
  await withApp(app, async request => {
    const replies = await Promise.all([sell(request, item, { key: 'simultaneous-replay-key' }), sell(request, item, { key: 'simultaneous-replay-key' })]);
    assert.deepEqual(replies.map(reply => reply.status), [200, 200]);
    assert.deepEqual(await replies[0].json(), await replies[1].json());
    assert.equal(await Sale.countDocuments({ imei: item.imei }), 1);
  });
});

test('concurrent key reuse for different phones commits only one operation', async () => {
  const items = [await phone(), await phone()];
  await withApp(app, async request => {
    const replies = await Promise.all(items.map(item => sell(request, item, { key: 'concurrent-key-conflict' })));
    assert.deepEqual(replies.map(reply => reply.status).sort(), [200, 409]);
    assert.equal(await Sale.countDocuments({ imei: { $in: items.map(item => item.imei) } }), 1);
    assert.equal(await Phone.countDocuments({ _id: { $in: items.map(item => item._id) }, status: 'in_stock' }), 1);
  });
});

test('inventory preflight command is read-only and reports the fixture conflicts', async () => {
  const execFile = require('node:util').promisify(require('node:child_process').execFile);
  const path = require('node:path');
  const tenant = fixture.db.getTenantDb(fixture.namespace);
  const beforeCount = await Phone.countDocuments();
  const collections = async () => (await tenant.db.listCollections({}, { nameOnly: true }).toArray()).map(item => item.name).sort();
  const beforeCollections = await collections();
  const child = await execFile(process.execPath, ['scripts/inventory-preflight.cjs', '--client-id', fixture.namespace], { cwd: path.resolve(__dirname, '../..'), env: process.env, encoding: 'utf8', timeout: 20000 }).then(result => ({ ...result, status: 0 }), error => { if (error.code !== 2) throw error; return { status: 2, stdout: error.stdout, stderr: error.stderr }; });
  assert.equal(child.status, 2, child.stderr);
  const report = JSON.parse(child.stdout);
  assert.equal(report.ready, false);
  assert.ok(report.issues.some(issue => issue.type === 'DUPLICATE_IMEI'));
  assert.equal(await Phone.countDocuments(), beforeCount);
  assert.deepEqual(await collections(), beforeCollections);
});

test('backup retains exact amount fields and replay receipts through restore', async () => {
  const item = await phone({ buyPrice: 0.2, notes: 'Synthetic stock note' });
  await withApp(app, async request => {
    const first = await sell(request, item, { key: 'backup-replay-request', price: '100.10', notes: 'Synthetic sale note' });
    const original = await first.json();
    assert.equal(first.status, 200);
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };
    const exported = await request('/api/backup', { headers });
    const backup = await exported.json();
    assert.ok(backup.stockOperations?.some(operation => operation._id === 'backup-replay-request'));
    const target = await fixture.db.Client.create({ clientId: `${fixture.namespace}_target`, adminPassword: 'target-admin', gatePassword: 'target-gate', shops: [{ id: 'A' }, { id: 'B' }] });
    const createSession = require('../../middleware/auth').createSession;
    const targetAdmin = await createSession({ clientId: target.clientId, role: 'admin', validShops: ['A', 'B'], authVersion: target.authVersion });
    const targetShop = await createSession({ clientId: target.clientId, role: 'shop', shop: 'A', validShops: ['A', 'B'], authVersion: target.authVersion });
    const isolatedBackup = { ...backup, phones: backup.phones.filter(p => p.imei === item.imei), sales: [original.sale],
      stockOperations: backup.stockOperations.filter(operation => operation._id === 'backup-replay-request'),
      days: [], expenses: [], shipments: [], dispatches: [], hqstock: { items: [] } };
    const restored = await request('/api/restore', { method: 'POST', headers: { ...headers, Authorization: `Bearer ${targetAdmin}` }, body: JSON.stringify(isolatedBackup) });
    assert.equal(restored.status, 200);
    const tenant = fixture.db.getTenantDb(target.clientId);
    const restoredSale = await tenant.model('Sale', fixture.db.SaleSchema).findById(original.sale._id);
    const restoredPhone = await tenant.model('Phone', fixture.db.PhoneSchema).findOne({ imei: item.imei });
    assert.equal(restoredSale.profitMinor, 9990);
    assert.equal(restoredSale.notes, 'Synthetic sale note');
    assert.equal(restoredPhone.soldByShop, 'A');
    assert.equal(restoredPhone.notes, 'Synthetic stock note');
    assert.equal(String(restoredSale.phoneId), String(restoredPhone._id));
    assert.equal(String(restoredPhone.currentSaleId), String(restoredSale._id));
    const retry = await sell(request, item, { key: 'backup-replay-request', price: '100.10', authToken: targetShop, notes: 'Synthetic sale note' });
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), original);
    const reversal = await request(`/api/sales/${restoredSale._id}`, {
      method: 'DELETE', headers: { ...headers, Authorization: `Bearer ${targetAdmin}` },
    });
    assert.equal(reversal.status, 200);
    const historicalRetry = await sell(request, item, { key: 'backup-replay-request', price: '100.10', authToken: targetShop, notes: 'Synthetic sale note' });
    assert.deepEqual(await historicalRetry.json(), original);
    assert.equal((await tenant.model('Phone').findById(restoredPhone._id)).status, 'in_stock');
  });
});

test('sale form retries a lost acknowledgment with the same durable request key', async () => {
  const { browserContext } = require('../helpers/browser.cjs');
  const item = await phone();
  await withApp(app, async request => {
    let drop = true;
    const browser = browserContext({ fetch: async (url, options) => {
      assert.ok(url.startsWith('http://localhost:3000/'));
      const response = await request(url.slice('http://localhost:3000'.length), options);
      if (drop) {
        drop = false;
        assert.equal(response.status, 200);
        await response.text();
        return { status: 200, ok: true, json: async () => { throw Error('lost acknowledgment'); } };
      }
      return response;
    } });
    for (const name of ['globals', 'utils', 'imei']) browser.load(`public/js/${name}.js`);
    const state = browser.context;
    state.authRole = 'shop'; state.authShop = 'A'; state.activeShop = 'A'; state.pendingIMEI = item.imei;
    browser.storage.set('authToken', token); browser.storage.set('clientId', fixture.namespace);
    state.document.getElementById('fSalePrice').value = '200';
    state.loadSidebarStats = async () => {};
    const notices = [];
    state.showToast = (message, type) => notices.push({ message, type });
    assert.equal(await state.submitSell(), false);
    assert.equal((await Phone.findById(item.id)).status, 'sold');
    await state.submitSell();
    assert.equal(await Sale.countDocuments({ imei: item.imei }), 1);
    assert.equal(await AuditLog.countDocuments({ action: 'stock_sell', 'details.imei': item.imei }), 1);
    assert.equal(notices.filter(notice => notice.type === 'success').length, 1);
  });
});

test('unsupported transaction topology fails closed without changing inventory', async () => {
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const { binary } = require('../helpers/database.cjs');
  const standalone = await MongoMemoryServer.create({ binary, instance: { ip: '127.0.0.1' } });
  let connection;
  try {
    connection = await fixture.db.mongoose.createConnection(standalone.getUri('stockly_test_standalone')).asPromise();
    const models = {};
    for (const name of ['Phone', 'Sale', 'AuditLog', 'Customer', 'StockOperation']) models[name] = connection.model(name, fixture.db[`${name}Schema`]);
    const item = await models.Phone.create({ imei: '999999999999999', status: 'in_stock', shop: 'A', buyPrice: 100 });
    await assert.rejects(require('../../services/stock-sales').sellPhone({ connection, models, actor: { role: 'shop', shop: 'A' }, validShops: ['A'], payload: { imei: item.imei, salePrice: 200 }, operationId: 'standalone-request' }), error => error.status === 503 && error.code === 'TRANSACTIONS_UNAVAILABLE');
    assert.equal((await models.Phone.findById(item.id)).status, 'in_stock');
    assert.equal(await models.Sale.countDocuments(), 0);
    assert.equal(await models.StockOperation.countDocuments(), 0);
  } finally {
    if (connection) await connection.close();
    await standalone.stop();
  }
});

test('invalid restore request history is rejected before any phone writes', async () => {
  await withApp(app, async request => {
    const beforeCount = await Phone.countDocuments();
    const response = await request('/api/restore', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ phones: [{ imei: '777777777777777', status: 'in_stock' }], stockOperations: [{ _id: 'bad', fingerprint: 'bad', sale: {} }] }),
    });
    assert.equal(response.status, 400);
    assert.equal(await Phone.countDocuments(), beforeCount);
  });
});

test('restore rejects empty receipt snapshots and conflicting duplicate request IDs before writes', async () => {
  await withApp(app, async request => {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };
    const beforeCount = await Phone.countDocuments();
    const response = await request('/api/restore', { method: 'POST', headers, body: JSON.stringify({
      phones: [{ imei: '666666666666666', status: 'in_stock' }],
      stockOperations: [{ _id: 'empty-outcome-request', fingerprint: 'a'.repeat(64), sale: {} }],
    }) });
    assert.equal(response.status, 400);
    assert.equal(await Phone.countDocuments(), beforeCount);
    const item = await phone();
    const sold = await sell(request, item, { key: 'duplicate-receipt-source' });
    const { sale } = await sold.json();
    const beforeInvalidDate = await Phone.countDocuments();
    const invalidDate = await request('/api/restore', { method: 'POST', headers, body: JSON.stringify({
      phones: [{ imei: '555555555555555', status: 'in_stock' }],
      stockOperations: [{ _id: 'invalid-receipt-date', fingerprint: 'f'.repeat(64), sale, createdAt: 'not-a-date' }],
    }) });
    assert.equal(invalidDate.status, 400);
    assert.equal(await Phone.countDocuments(), beforeInvalidDate);
    const base = { _id: 'repeated-new-receipt', fingerprint: 'b'.repeat(64), sale };
    const duplicate = await request('/api/restore', { method: 'POST', headers, body: JSON.stringify({
      stockOperations: [base, { ...base, fingerprint: 'c'.repeat(64) }],
    }) });
    assert.equal(duplicate.status, 409);
  });
});

test('restore rejects receipt snapshots without a matching existing or incoming sale', async () => {
  const item = await phone();
  await withApp(app, async request => {
    const sold = await sell(request, item);
    const { sale } = await sold.json();
    const missing = { ...sale, _id: new fixture.db.mongoose.Types.ObjectId().toString() };
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };
    const response = await request('/api/restore', { method: 'POST', headers, body: JSON.stringify({ stockOperations: [{ _id: 'missing-sale-receipt', fingerprint: 'd'.repeat(64), sale: missing }] }) });
    assert.equal(response.status, 409);
  });
});

test('restore rejects conflicting incoming sale IDs referenced by a receipt', async () => {
  const item = await phone();
  await withApp(app, async request => {
    const response = await sell(request, item);
    const { sale } = await response.json();
    const different = { ...sale, salePrice: 201, salePriceMinor: 20100, profit: 101, profitMinor: 10100 };
    const restored = await request('/api/restore', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ sales: [sale, different], stockOperations: [{ _id: 'duplicate-sale-reference', fingerprint: 'e'.repeat(64), sale }] }),
    });
    assert.equal(restored.status, 409);
    assert.equal((await Sale.findById(sale._id)).salePrice, 200);
  });
});
