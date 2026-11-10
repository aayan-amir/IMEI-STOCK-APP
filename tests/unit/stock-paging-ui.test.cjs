const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');
function screen() {
  const browser = browserContext();
  for (const file of ['globals', 'utils', 'daily', 'imei']) browser.load(`public/js/${file}.js`);
  const s = browser.context; s.authRole = 'admin'; s.authShop = null; s.activeShop = 'A'; s.imeiFilter = 'all';
  s.localStorage.setItem('clientId', 'test-client'); s.groupedView = false; s.phoneCardHTML = phone => phone.id; s.updateBulkActions = () => {}; s.showToast = () => {};
  return s;
}
const phone = id => ({ id, _id: id, imei: id, brand: 'Test', model: 'Phone', status: 'in_stock', buyPrice: 0, salePrice: 0 });
const page = (ids, nextCursor = null, total = 2) => ({ items: ids.map(phone), nextCursor, hasMore: !!nextCursor, total });
test('inventory loads a bounded server-filtered page and labels its partial count', async () => {
  const s = screen(), calls = []; s.api = async (_method, url) => { calls.push(url); return page(['one', 'two'], 'next-token', 200); };
  await s.loadIMEIData();
  assert.match(calls[0], /^\/api\/v2\/stock\?/); assert.match(calls[0], /limit=50/);
  assert.match(s.document.getElementById('imeiCount').textContent, /2.*200.*matching/);
  assert.equal(s.allIMEIStock.length, 2); assert.equal(s.document.getElementById('imei-next').disabled, false);
});
test('next and previous replace the rendered page and selection stays on the loaded page', async () => {
  const s = screen(); s.api = async (_method, url) => url.includes('cursor=next-token') ? page(['three']) : page(['one', 'two'], 'next-token', 3);
  await s.loadIMEIData(); s.selectedPhoneIds.add('one'); await s.nextIMEIPage();
  assert.equal(s.allIMEIStock[0].id, 'three'); assert.equal(s.selectedPhoneIds.size, 0);
  await s.previousIMEIPage(); assert.equal(s.allIMEIStock[0].id, 'one');
});
test('a superseded shop response cannot replace the current page', async () => {
  const s = screen(); let release;
  s.api = () => new Promise(resolve => { release = resolve; }); const old = s.loadIMEIData();
  s.activeShop = 'B'; s.api = async () => page(['new']); await s.loadIMEIData(); release(page(['old'])); await old;
  assert.equal(s.allIMEIStock[0].id, 'new');
});
test('a failed next page preserves the last good page, cursor and explicit selection', async () => {
  const s = screen(); s.api = async () => page(['one'], 'next-token'); await s.loadIMEIData(); s.selectedPhoneIds.add('one');
  s.api = async () => { throw Error('offline'); }; assert.equal(await s.nextIMEIPage(), false);
  assert.equal(s.allIMEIStock[0].id, 'one'); assert.equal(s.selectedPhoneIds.has('one'), true);
  assert.equal(s.inventoryPage.nextCursor, 'next-token');
});
test('CSV and print request complete filtered exports rather than the loaded page', async () => {
  const s = screen(), calls = []; s.allIMEIStock = [phone('loaded')];
  s.document.getElementById('imeiSearch').value = 'Pixel & Co';
  s.api = async (_method, url) => { calls.push(url); return { complete: true, total: 3, items: ['loaded', 'second', 'third'].map(phone) }; };
  let csv, printed; s.dlCSV = value => { csv = value; }; s.printSection = (_title, html) => { printed = html; };
  await s.exportIMEICSV(); await s.printIMEIStock();
  assert.ok(calls.every(url => url.startsWith('/api/v2/stock/export?')));
  assert.match(csv, /third/); assert.match(csv, /,"0","0","0",/); assert.match(printed, /third/); assert.match(printed, /3 phones/);
  assert.match(printed, /Search: Pixel &amp; Co/);
  assert.equal(s.allIMEIStock.length, 1);
});
test('filter changes fetch the new query and failed exports do not produce a partial file', async () => {
  const s = screen(); let called = '';
  s.api = async (_method, url) => { called = url; return page([]); };
  await s.setIMEIFilter('sold', { classList: { add() {} } }); assert.match(called, /status=sold/);
  s.api = async () => { throw Error('Too large'); }; s.dlCSV = () => assert.fail('must not export the loaded page');
  assert.equal(await s.exportIMEICSV(), false);
});
test('group toggles cannot reveal cached phones or selection belonging to another shop', async () => {
  const s = screen(); s.api = async () => page(['old-shop']); await s.loadIMEIData(); s.selectedPhoneIds.add('old-shop');
  s.activeShop = 'B'; s.toggleGrouped();
  assert.doesNotMatch(s.document.getElementById('imeiList').innerHTML, /old-shop/);
  assert.equal(s.getSelectedPhones().length, 0);
});
test('an export response arriving after an account switch cannot download the previous account', async () => {
  const s = screen(); let release;
  s.api = () => new Promise(resolve => { release = resolve; }); s.dlCSV = () => assert.fail('account changed');
  const pending = s.exportIMEICSV(); s.localStorage.setItem('clientId', 'new-client');
  release({ complete: true, total: 1, items: [phone('old')] }); await pending;
});
