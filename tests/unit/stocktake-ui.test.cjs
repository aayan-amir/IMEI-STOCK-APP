const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');
function screen() {
  const b = browserContext();
  for (const name of ['globals', 'utils', 'capabilities', 'stocktake']) b.load('public/js/' + name + '.js');
  const s = b.context;
  s.authRole = 'admin'; s.activePage = 'stocktakes';
  s.currentClientShops = [{ id: 'A', name: 'Shop A' }];
  s.localStorage.setItem('clientId', 'test-owner'); s.localStorage.setItem('authToken', 'token');
  s.showToast = () => {};
  return s;
}
const empty = { items: [], total: 0, hasMore: false, nextCursor: null };

test('stock-check controls require an explicit owner capability', async () => {
  const s = screen(); let writes = 0;
  s.api = async method => { if (method !== 'GET') writes++; return { features: { stocktake: false } }; };
  await s.loadBusinessCapabilities(); await s.loadStocktakes(); await s.startStocktake();
  assert.equal(s.document.getElementById('ni-stocktakes').style.display, 'none');
  assert.equal(writes, 0);
});

test('late capability response cannot enable stock checks after an account change', async () => {
  const s = screen(); let release;
  s.api = () => new Promise(resolve => { release = resolve; });
  const request = s.loadBusinessCapabilities();
  s.localStorage.setItem('clientId', 'other-owner');
  release({ features: { stocktake: true } }); await request;
  assert.equal(s.document.getElementById('ni-stocktakes').style.display, 'none');
});

test('late capability failure cannot disable a newly loaded account', async () => {
  const s = screen(); let fail;
  s.api = () => new Promise((resolve, reject) => { fail = reject; });
  const old = s.loadBusinessCapabilities();
  s.localStorage.setItem('clientId', 'new-owner');
  s.api = async () => ({ features: { stocktake: true } });
  await s.loadBusinessCapabilities();
  fail(Error('old connection failed')); await old;
  assert.equal(s.hasBusinessCapability('stocktake'), true);
});

test('unknown start acknowledgment preserves its key and a retry loads the recorded count', async () => {
  const s = screen(), keys = []; let attempts = 0;
  s.api = async (method, url, body, options) => {
    if (url === '/api/capabilities') return { features: { stocktake: true } };
    if (method === 'POST') { keys.push(options.operationId); if (++attempts === 1) throw Error('unknown acknowledgment'); return { success: true, stocktakeId: '123456789012345678901234' }; }
    if (url.includes('/api/stocktakes/')) return { stocktakeId: '123456789012345678901234', shop: 'A', revision: 0, status: 'open', baselineCount: 1, observationCount: 0, differences: { missing: ['001234567890123'], matched: [], unexpected: [], wrongShop: [], changed: [], newArrivals: [], duplicates: [], recheckRequired: false } };
    return empty;
  };
  await s.loadBusinessCapabilities(); await s.loadStocktakes();
  s.document.getElementById('stocktake-shop').value = 'A';
  await s.startStocktake();
  s.document.getElementById('stocktake-shop').value = 'B';
  await s.retryStocktakeCommand();
  assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
  assert.match(s.document.getElementById('stocktake-detail').innerHTML, /001234567890123/);
  assert.match(s.document.getElementById('stocktake-detail').innerHTML, /label for="stocktake-imei"/);
});

test('stock-check screen remains reachable with labelled controls and a captured-action retry', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync('public/index.html', 'utf8');
  for (const id of ['ni-stocktakes', 'pg-stocktakes', 'stocktake-shop', 'stocktake-retry', 'stocktake-detail']) assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(html, /label for="stocktake-shop"/);
  assert.match(html, /src="\/js\/stocktake.js"/);
  assert.match(fs.readFileSync('public/js/ui.js', 'utf8'), /stocktakes:.*loadStocktakes/);
});

test('a count needing recheck retains a disabled completion control after requests settle', () => {
  const s = screen();
  s.renderStocktake({ stocktakeId: '123456789012345678901234', shop: 'A', status: 'open', baselineCount: 1, observationCount: 0, differences: { recheckRequired: true } });
  assert.match(s.document.getElementById('stocktake-detail').innerHTML, /data-stocktake-blocked="true"/);
});
