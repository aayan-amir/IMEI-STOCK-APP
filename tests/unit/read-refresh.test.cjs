const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');
function screen() {
  const intervals = [], b = browserContext({ setInterval: (fn, delay) => { intervals.push({ fn, delay }); return intervals.length; } });
  for(const name of ['globals','utils','ui','imei','daily','ceo']) b.load('public/js/' + name + '.js');
  const s = b.context; s.authRole = 'admin'; s.activeShop = 'A'; s.currentClientShops = [{ id: 'A', name: 'A' }]; s.localStorage.setItem('clientId','owner-A'); s.localStorage.setItem('authToken','token-A'); s.showToast = () => {};
  return { s, b, poll: () => intervals.find(row => row.delay === 12000).fn() };
}
const stats = n => ({ inStock: n, sold: n, totalRevenue: n });

test('sidebar reads cannot overwrite the newly selected shop with an older response', async () => {
  const { s } = screen(); let release; s.api = () => new Promise(resolve => { release = resolve; }); const old = s.loadSidebarStats();
  s.activeShop = 'B'; s.api = async () => stats(20); await s.loadSidebarStats(); release(stats(1)); await old;
  assert.equal(s.document.getElementById('sb-is').textContent, 20);
});

test('identical opted-in stats reads share an in-flight request', async () => {
  const { s } = screen(); let calls = 0; s.api = async () => { calls++; return stats(1); };
  await Promise.all([s.loadSidebarStats({ dedupe: true }), s.loadSidebarStats({ dedupe: true })]); assert.equal(calls, 1);
});

test('an explicit fresh stats read after mutation does not reuse or render the earlier result', async () => {
  const { s } = screen(), pending = []; s.api = () => new Promise(resolve => pending.push(resolve));
  const old = s.loadSidebarStats(), fresh = s.loadSidebarStats(); assert.equal(pending.length, 2);
  pending[1](stats(50)); await fresh; pending[0](stats(1)); await old;
  assert.equal(s.document.getElementById('sb-is').textContent, 50);
});

test('routine sidebar polling pauses for hidden documents', async () => {
  const { s, poll } = screen(); let calls = 0; s.api = async () => { calls++; return stats(1); }; s.document.hidden = true;
  await poll(); assert.equal(calls, 0);
});

test('failed or rate-limited stats reads back off routine polling', async () => {
  const { s, poll } = screen(); let calls = 0; s.api = async () => { calls++; throw Object.assign(Error('rate limited'), { status: 429 }); };
  await s.loadSidebarStats(); await poll(); assert.equal(calls, 1);
});

test('boot shares the shop-switch stats request instead of issuing it twice', async () => {
  const { s, b } = screen(); s.localStorage.removeItem('authToken'); let statsCalls = 0, stockCalls = 0;
  s.renderDynamicShops = () => {}; s.applyPhoneMode = () => {}; s.applyShopMode = () => {}; s.loadBusinessCapabilities = async () => {};
  s.loadIMEIData = async () => { stockCalls++; }; s.api = async () => { statsCalls++; return stats(1); };
  b.load('public/js/app.js'); s.localStorage.setItem('authToken','token-A'); await s.bootApp();
  assert.equal(statsCalls, 1); assert.equal(stockCalls, 1);
});

test('a late warehouse response from a previous account cannot replace the current owner stock', async () => {
  const { s } = screen(); let release; s.api = () => new Promise(resolve => { release = resolve; }); const old = s.loadWarehouse();
  s.localStorage.setItem('clientId','owner-B'); s.localStorage.setItem('authToken','token-B'); s.api = async () => ({ items: [{ imei: '001234567890124', brand: 'Private B' }] }); await s.loadWarehouse();
  release({ items: [{ imei: '001234567890123', brand: 'Private A' }] }); await old;
  assert.equal(s.hqStock.items[0].brand, 'Private B'); assert.doesNotMatch(s.document.getElementById('wh-body').innerHTML, /Private A/);
});

test('new-owner warehouse failure clears old private data instead of retaining another account cache', async () => {
  const { s } = screen(); s.api = async () => ({ items: [{ imei: '001234567890123', brand: 'Private A' }] }); await s.loadWarehouse();
  s.localStorage.setItem('clientId','owner-B'); s.localStorage.setItem('authToken','token-B'); s.api = async () => { throw Error('offline'); }; await s.loadWarehouse();
  assert.doesNotMatch(s.document.getElementById('wh-body').innerHTML, /Private A/); assert.equal(s.hqStock.items.length, 0);
});

const analytics = (name, days = 30) => ({ days, topSold: [{ model: name, count: 1, revenue: 1, profit: 1 }], stagnating: [] });
test('analytics cannot render or print a previous account response', async () => {
  const { s } = screen(); let release; s.api = () => new Promise(resolve => { release = resolve; }); const old = s.renderAnalytics();
  s.localStorage.setItem('clientId','owner-B'); s.api = async () => analytics('Private B'); await s.renderAnalytics(); release(analytics('Private A')); await old;
  assert.doesNotMatch(s.document.getElementById('analytics-body').innerHTML, /Private A/);
  s.localStorage.setItem('clientId','owner-C'); let prints = 0; s.printSection = () => prints++; s.printAnalytics(); assert.equal(prints, 0);
});
test('analytics retains only the current filter and does not print mismatched cached results', async () => {
  const { s } = screen(); s.document.getElementById('analytics-days').value = '30'; let release; s.api = () => new Promise(resolve => { release = resolve; }); const old = s.renderAnalytics();
  s.document.getElementById('analytics-days').value = '90'; s.api = async () => analytics('Current', 90); await s.renderAnalytics(); release(analytics('Old',30)); await old;
  assert.equal(s.lastAnalyticsData.days, 90); s.document.getElementById('analytics-days').value = '7'; let prints = 0; s.printSection = () => prints++; s.printAnalytics(); assert.equal(prints,0);
});
test('expense reads and printing retain the current owner and filters', async () => {
  const { s } = screen(); s.document.getElementById('exp-shop-filter').value = 'A'; let release; s.api = () => new Promise(resolve => { release = resolve; }); const old = s.renderShopExpenses();
  s.document.getElementById('exp-shop-filter').value = 'B'; s.api = async () => [{ _key:'current', shop:'B', amount:1, description:'Current' }]; await s.renderShopExpenses(); release([{ _key:'old', shop:'A', amount:2, description:'Private A' }]); await old;
  assert.equal(s.allShopExp[0]._key, 'current'); s.localStorage.setItem('clientId','owner-B'); let prints=0; s.printSection = () => prints++; s.printExpenses(); assert.equal(prints,0);
});

test('dispatch from movements refreshes current warehouse before showing a selection', async () => {
  const { s } = screen(); s.hqStock = { items:[{imei:'001234567890123',brand:'Private A'}] }; let calls=0, opened=0;
  s.api = async () => { calls++; return {items:[{imei:'001234567890124',brand:'Current'}]}; }; s.openDispatchModal=()=>opened++;
  await s.openDispatchFromShipments(); assert.equal(calls,1); assert.equal(opened,1); assert.equal(s.hqStock.items[0].brand,'Current');
});
test('dispatch selection does not open after failure or a changed account', async () => {
  const { s } = screen(); let opened=0; s.openDispatchModal=()=>opened++; s.api=async()=>{throw Error('offline');};
  await s.openDispatchFromShipments(); assert.equal(opened,0);
  let release; s.api=()=>new Promise(resolve=>{release=resolve;}); const old=s.openDispatchFromShipments();
  s.localStorage.setItem('clientId','owner-B'); release({items:[]}); await old; assert.equal(opened,0);
});

test('a pending movement dispatch does not interrupt navigation with a late modal', async () => {
  const { s } = screen(); s.activePage='shipments'; let release,opened=0; s.api=()=>new Promise(resolve=>{release=resolve;}); s.openDispatchModal=()=>opened++;
  const old=s.openDispatchFromShipments(); s.activePage='analytics'; release({items:[]}); await old; assert.equal(opened,0);
});
test('current expense and analytics failures leave a terminal retry message rather than perpetual loading', async () => {
  const { s } = screen(); s.api=async()=>{throw Error('offline');};
  await s.renderShopExpenses(); await s.renderAnalytics();
  for (const id of ['exp-body','analytics-body']) { assert.doesNotMatch(s.document.getElementById(id).innerHTML,/Loading/); assert.match(s.document.getElementById(id).innerHTML,/retry/i); }
});

test('dispatch does not reopen even after navigating away and back to the same page', async () => {
  const { s } = screen(); s.activePage='shipments'; let release,opened=0; s.api=()=>new Promise(resolve=>{release=resolve;}); s.openDispatchModal=()=>opened++;
  const old=s.openDispatchFromShipments(); s.loadShipments=async()=>{}; s.nav('backup'); s.nav('shipments'); release({items:[]}); await old; assert.equal(opened,0);
});
