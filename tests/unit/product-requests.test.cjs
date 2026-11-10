const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');

function screen() {
  const b = browserContext();
  for (const file of ['globals', 'utils', 'imei']) b.load(`public/js/${file}.js`);
  const s = b.context;
  s.activeShop = 'A'; s.authRole = 'admin'; s.localStorage.setItem('clientId', 'synthetic-client');
  s.showToast = () => {}; s.showModal = () => {}; s.closeModal = () => {};
  s.loadProducts = async () => {}; s.confirmModal = async () => true;
  for (const [id, value] of Object.entries({ pName: 'Charger', pQty: '2', pBuyPrice: '0.10', pNotes: '', 'ep-qty': '3' })) s.document.getElementById(id).value = value;
  return s;
}
test('product receipt retry keeps its key; changed quantity rotates it', async () => {
  const s = screen(), keys = [];
  s.api = async (method, url, body, options) => { keys.push(options?.operationId); throw Error('unknown response'); };
  await s.submitProduct(); await s.submitProduct();
  assert.match(keys[0] || '', /^[a-f0-9-]{32,36}$/);
  assert.equal(keys[1], keys[0]);
  s.document.getElementById('pQty').value = '3';
  await s.submitProduct();
  assert.notEqual(keys[2], keys[0]);
});
test('product quantity editor captures its opening revision instead of a newer list value', async () => {
  const s = screen(), bodies = [];
  s.allProducts = [{ _id: 'product-id', name: 'Charger', quantity: 2, revision: 4 }];
  s.editProductQty('product-id', 'Charger', 2);
  s.allProducts[0].revision = 5;
  s.api = async (method, url, body, options) => { bodies.push({ body, key: options?.operationId }); throw Error('unknown response'); };
  await s.saveProductQty('product-id'); await s.saveProductQty('product-id');
  assert.equal(bodies[0].body.expectedRevision, 4);
  assert.equal(bodies[0].key, bodies[1].key);
});
test('product deletion captures revision before confirmation', async () => {
  const s = screen(); let sent;
  s.allProducts = [{ _id: 'product-id', revision: 4 }];
  s.confirmModal = async () => { s.allProducts[0].revision = 5; return true; };
  s.api = async (method, url, body) => { sent = body; return { success: true }; };
  await s.deleteProduct('product-id', 'Charger');
  assert.equal(sent?.expectedRevision, 4);
});
test('unknown reply and newer product intent retain the newer form and request key', async () => {
  const s = screen(), pending = [];
  s.api = (method, url, body, options) => new Promise((resolve, reject) => pending.push({ resolve, reject, key: options?.operationId }));
  const first = s.submitProduct();
  s.document.getElementById('pQty').value = '3';
  const second = s.submitProduct();
  pending[0].resolve({ product: { quantity: 2 } }); await first;
  assert.equal(s.document.getElementById('pQty').value, '3');
  pending[1].reject(Error('unknown response')); await second;
  const retry = s.submitProduct();
  assert.equal(pending[2].key, pending[1].key);
  pending[2].resolve({ product: { quantity: 5 } }); await retry;
});
test('product quantities are never truncated or changed from zero to one', async () => {
  const s = screen(), sent = [];
  s.api = async (method, url, body) => { sent.push(body); throw Error('unknown response'); };
  s.document.getElementById('pQty').value = '0';
  await s.submitProduct();
  assert.equal(Number(sent[0].quantity), 0);
  for (const value of ['1.5', '-1', '2garbage']) {
    s.document.getElementById('pQty').value = value;
    await s.submitProduct();
  }
  assert.equal(sent.length, 1);
});

test('a reply from an earlier signed-in tenant cannot clear or refresh the current product screen', async () => {
  const s = screen(); let complete, reloads = 0;
  s.loadProducts = async () => { reloads++; };
  s.api = () => new Promise(resolve => { complete = resolve; });
  const pending = s.submitProduct();
  s.localStorage.setItem('clientId', 'different-client');
  s.document.getElementById('pName').value = 'New client input';
  complete({ product: { quantity: 2 } }); await pending;
  assert.equal(s.document.getElementById('pName').value, 'New client input');
  assert.equal(reloads, 0);
});

test('product action handlers use identity without interpolating product names into JavaScript', () => {
  const s = screen();
  s.allProducts = [{ _id: '123456789012345678901234', name: "Customer's charger", quantity: 2, revision: 0 }];
  s.renderProducts();
  const html = s.document.getElementById('productList').innerHTML;
  assert.match(html, /onclick="editProductQty\('123456789012345678901234'\)"/);
  assert.match(html, /aria-label="Delete product"/);
  assert.doesNotMatch(html, /onclick="[^"\n]*Customer/);
});

test('an earlier matching payload cannot clear a later request after changing away and back', async () => {
  const s = screen(), pending = [];
  s.api = (method, url, body, options) => new Promise((resolve, reject) => pending.push({ resolve, reject, key: options.operationId }));
  const first = s.submitProduct();
  s.document.getElementById('pQty').value = '3';
  const second = s.submitProduct();
  s.document.getElementById('pQty').value = '2';
  const third = s.submitProduct();
  assert.notEqual(pending[0].key, pending[2].key);
  pending[0].resolve({ product: { quantity: 2 } }); await first;
  assert.equal(s.document.getElementById('pName').value, 'Charger');
  assert.equal(s.document.getElementById('pQty').value, '2');
  pending[1].reject(Error('unknown response')); await second;
  pending[2].reject(Error('unknown response')); await third;
  const retry = s.submitProduct();
  assert.equal(pending[3].key, pending[2].key);
  pending[3].resolve({ product: { quantity: 4 } }); await retry;
});
