const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');
const imei = '600000000000000', entryId = 'a'.repeat(64);
function screen() {
  const b = browserContext();
  for (const file of ['globals', 'utils', 'imei', 'daily', 'ceo']) b.load(`public/js/${file}.js`);
  const s = b.context;
  s.localStorage.setItem('clientId', 'test-client'); s.activeShop = 'HQ'; s.authRole = 'admin';
  s.showToast = () => {}; s.showModal = () => {}; s.closeModal = () => {};
  s.loadWarehouse = async () => {}; s.loadShipments = async () => {}; s.confirmModal = async () => true;
  s.rcItems = [{ imei, buyPrice: 0.1, brand: 'Test', notes: '' }];
  for (const [id, value] of Object.entries({ 'rc-date': '2026-11-09', 'rc-supplier': 'Test', 'rc-ref': '', 'ds-date': '2026-11-09', 'ds-shop': 'A', 'ds-note': '' })) s.document.getElementById(id).value = value;
  s.document.getElementById('dsi-0').checked = true;
  s.hqStock = { items: [{ imei, entryId, buyPrice: 0.1 }] };
  s.warehouseDataOwner = s.warehouseReadScope();
  return s;
}
test('receipt retries preserve the key and keep the queue after an unknown outcome', async () => {
  const s = screen(), keys = [];
  s.api = async (method, url, body, options) => { keys.push(options?.operationId); throw Error('unknown outcome'); };
  await s.saveReceive(); await s.saveReceive();
  assert.match(keys[0] || '', /^[a-f0-9-]{32,36}$/);
  assert.equal(keys[0], keys[1]);
  assert.equal(s.rcItems.length, 1);
  assert.equal(s.document.getElementById('rc-save-btn').disabled, false);
});
test('an older receipt cannot clear a newer matching queue or its retry key', async () => {
  const s = screen(), pending = [];
  s.api = (method, url, body, options) => new Promise((resolve, reject) => pending.push({ resolve, reject, key: options?.operationId }));
  const a = s.saveReceive(); s.rcItems[0].buyPrice = 0.2;
  const b = s.saveReceive(); s.rcItems[0].buyPrice = 0.1;
  const c = s.saveReceive();
  pending[0].resolve({ success: true }); await a;
  assert.equal(s.rcItems.length, 1);
  pending[1].reject(Error('unknown')); await b;
  pending[2].reject(Error('unknown')); await c;
  const retry = s.saveReceive();
  assert.equal(pending[3].key, pending[2].key);
  pending[3].resolve({ success: true }); await retry;
});
test('dispatch sends only captured warehouse identities and reuses a retry key', async () => {
  const s = screen(), calls = [], items = [{ imei, entryId, buyPrice: 999 }];
  s.api = async (method, url, body, options) => { calls.push({ body, key: options?.operationId }); throw Error('unknown'); };
  await s.saveDispatch(items); await s.saveDispatch(items);
  assert.equal(calls[0].body.items[0].entryId, entryId);
  assert.equal(calls[0].body.items[0].buyPrice, undefined);
  assert.match(calls[0].key || '', /^[a-f0-9-]{32,36}$/);
  assert.equal(calls[1].key, calls[0].key);
});
test('warehouse removal captures its entry token before confirmation', async () => {
  const s = screen(); let sent;
  s.confirmModal = async () => { s.hqStock.items[0].entryId = 'b'.repeat(64); return true; };
  s.api = async (method, url, body) => { sent = body; return { success: true }; };
  await s.deleteWarehouseImei(imei);
  assert.equal(sent?.entryId, entryId);
});
test('dispatch modal keeps phone metadata out of inline action JavaScript', () => {
  const s = screen();
  s.hqStock.items[0].notes = '" onclick="unexpected()';
  let html = '';
  s.showModal = value => { html = value; };
  s.openDispatchModal();
  assert.match(html, /onclick="saveDispatch\(\)"/);
  assert.doesNotMatch(html, /unexpected/);
});

test('malformed legacy warehouse identities stay text and cannot become action arguments', () => {
  const s = screen();
  s.hqStock = { items: [{ imei: "600000000000000');unexpected('//", brand: 'Legacy' }] };
  s.warehouseDataOwner = s.warehouseReadScope();
  s.renderWarehouse();
  const html = s.document.getElementById('wh-body').innerHTML;
  assert.doesNotMatch(html, /onclick="deleteWarehouseImei/);
  assert.match(html, /Legacy/);
});
