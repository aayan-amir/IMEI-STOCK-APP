const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');
function screen() {
  const browser = browserContext();
  for (const file of ['globals', 'utils', 'imei', 'daily']) browser.load(`public/js/${file}.js`);
  const s = browser.context; s.localStorage.setItem('clientId', 'test'); s.authRole = 'admin'; s.authShop = null;
  s.document.getElementById('sl-shop').value = 'ALL'; s.document.getElementById('sl-kind').value = 'all';
  s.showToast = () => {}; s.confirmModal = async () => true; s.loadSidebarStats = () => {}; s.loadIMEIData = () => {};
  return s;
}
const event = id => ({ _id: id, kind: 'sale', units: 1, businessDate: '2026-11-09', soldAt: '2026-11-09T00:00:00.000Z', imei: id, brand: 'Test', model: 'Phone', salePrice: 0, buyPrice: 0, profit: 0, salePriceMinor: 0, buyPriceMinor: 0, profitMinor: 0 });
const page = (ids, nextCursor = null) => ({ items: ids.map(event), total: 200, hasMore: !!nextCursor, nextCursor });
test('sales page keeps server filters and scoped financial totals without technical status copy', async () => {
  const s = screen(); let url;
  s.document.getElementById('sl-from').value = '2026-11-09'; s.api = async (_method, value) => { url = value; return page(['one'], 'next'); };
  await s.loadSalesLog();
  assert.match(url, /^\/api\/v2\/sales\?/); assert.match(url, /from=2026-11-09/); assert.match(url, /limit=50/);
  assert.equal(s.document.getElementById('sl-page-status').textContent, '');
  assert.match(s.document.getElementById('sl-body').innerHTML, /aria-label="Listed sales"/);
  await s.nextSalesPage(); assert.equal(s.allSalesData.length, 1);
});
test('failed and superseded sales pages retain the correct account and filter context', async () => {
  const s = screen(); let release;
  s.api = () => new Promise(resolve => { release = resolve; }); const old = s.loadSalesLog();
  s.document.getElementById('sl-shop').value = 'A'; s.api = async () => page(['new'], 'next'); await s.loadSalesLog();
  release(page(['old'])); await old; assert.equal(s.allSalesData[0]._id, 'new');
  s.api = async () => { throw Error('offline'); }; assert.equal(await s.nextSalesPage(), false); assert.equal(s.allSalesData[0]._id, 'new');
});
test('complete CSV and print include unloaded events and zero amounts', async () => {
  const s = screen(), calls = []; s.allSalesData = [event('loaded')];
  s.api = async (_method, url) => { calls.push(url); return { complete: true, total: 2, items: [event('loaded'), event('unloaded')] }; };
  let csv, printed; s.dlCSV = value => { csv = value; }; s.printSection = (_title, html) => { printed = html; };
  await s.exportSalesLogCSV(); await s.printSalesLog();
  assert.ok(calls.every(url => url.startsWith('/api/v2/sales/export?')));
  assert.match(csv, /unloaded/); assert.match(csv, /"0","0","0"/); assert.match(printed, /unloaded/); assert.match(printed, /All matching events/);
});
test('bulk reversal captures only loaded active originals and aborts after an account change', async () => {
  const s = screen(); s.allSalesData = [event('one'), { ...event('correction'), kind: 'reversal' }];
  s.confirmModal = async () => { s.localStorage.setItem('clientId', 'other'); return true; };
  let mutations = 0; s.api = async method => { if (method === 'DELETE') mutations++; return {}; };
  assert.equal(await s.clearAllSales(), false);
  assert.equal(mutations, 0);
});
test('late export responses and explicit re-render cannot reveal another sales scope', async () => {
  const s = screen(); s.api = async () => page(['private-old']); await s.loadSalesLog();
  s.document.getElementById('sl-shop').value = 'B'; s.renderSalesLog();
  assert.doesNotMatch(s.document.getElementById('sl-body').innerHTML, /private-old/);
  let release, downloads = 0; s.api = () => new Promise(resolve => { release = resolve; }); s.dlCSV = () => { downloads++; };
  const pending = s.exportSalesLogCSV(); s.document.getElementById('sl-kind').value = 'reversal';
  release({ complete: true, total: 1, items: [event('old')] }); await pending;
  assert.equal(downloads, 0);
});
test('single reversal rejects stale-scope rows and corrections rather than using the new filter context', async () => {
  const s = screen(); s.document.getElementById('sl-shop').value = 'A'; s.api = async () => page(['old-sale']); await s.loadSalesLog();
  let mutations = 0;
  s.document.getElementById('sl-shop').value = 'B'; s.api = async method => { if (method === 'DELETE') mutations++; return {}; };
  assert.equal(await s.deleteSale('old-sale'), false);
  s.document.getElementById('sl-shop').value = 'A'; s.allSalesData[0].kind = 'reversal';
  assert.equal(await s.deleteSale('old-sale'), false);
  assert.equal(mutations, 0);
  s.api = async (_method, url) => url.includes('cursor=next') ? page(['new-page']) : page(['old-sale'], 'next');
  await s.loadSalesLog();
  s.confirmModal = async () => { await s.nextSalesPage(); return true; };
  assert.equal(await s.deleteSale('old-sale'), false);
});
