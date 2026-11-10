const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');

function screen() {
  const browser = browserContext();
  for (const name of ['globals', 'utils', 'imei']) browser.load(`public/js/${name}.js`);
  const state = browser.context;
  state.authRole = 'shop';
  state.authShop = 'A';
  state.pendingIMEI = '123456789012345';
  state.showToast = () => {};
  state.loadSidebarStats = async () => {};
  state.document.getElementById('fSalePrice').value = '100';
  return state;
}

test('sale retry keeps its request key while a changed intent gets a fresh key', async () => {
  const state = screen();
  const keys = [];
  state.api = async (method, url, body, options) => { keys.push(options?.operationId); throw Error('unknown outcome'); };
  await state.submitSell();
  await state.submitSell();
  assert.match(keys[0] || '', /^[a-f0-9-]{36}$/);
  assert.equal(keys[1], keys[0]);
  state.document.getElementById('fSalePrice').value = '101';
  await state.submitSell();
  assert.notEqual(keys[2], keys[0]);
});

test('an acknowledged sale clears its key for a new sale intent', async () => {
  const state = screen();
  const keys = [];
  state.api = async (method, url, body, options) => {
    keys.push(options.operationId);
    return { success: true, sale: { salePrice: 100, profit: 50 } };
  };
  await state.submitSell();
  state.document.getElementById('fSalePrice').value = '100';
  state.pendingIMEI = '123456789012345';
  await state.submitSell();
  assert.notEqual(keys[1], keys[0]);
});

test('sale requests still obtain a random key on HTTP browsers without randomUUID', async () => {
  const state = screen();
  const original = state.crypto;
  state.crypto = { getRandomValues: original.getRandomValues.bind(original) };
  let key;
  state.api = async (method, url, body, options) => { key = options.operationId; throw Error('unknown outcome'); };
  await state.submitSell();
  assert.match(key || '', /^[a-f0-9]{32}$/);
});

test('an earlier acknowledgment cannot clear a newer intent or use its IMEI', async () => {
  const state = screen();
  const requests = [];
  state.renderIMEIStock = () => {};
  state.allIMEIStock = [{ imei: '123456789012345', status: 'in_stock' }, { imei: '222222222222222', status: 'in_stock' }];
  state.api = (method, url, payload, options) => new Promise((resolve, reject) => requests.push({ payload, key: options.operationId, resolve, reject }));
  const first = state.submitSell();
  state.pendingIMEI = '222222222222222';
  state.document.getElementById('fSalePrice').value = '200';
  const second = state.submitSell();
  requests[0].resolve({ success: true, sale: { salePrice: 100, profit: 50 } });
  await first;
  assert.equal(state.allIMEIStock[0].status, 'sold');
  assert.equal(state.allIMEIStock[1].status, 'in_stock');
  assert.equal(state.pendingIMEI, '222222222222222');
  assert.equal(state.document.getElementById('fSalePrice').value, '200');
  requests[1].reject(Error('lost acknowledgment'));
  await second;
  const retry = state.submitSell();
  assert.equal(requests[2].key, requests[1].key);
  requests[2].reject(Error('offline'));
  await retry;
});
