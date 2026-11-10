const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');

async function stockView(storages, grouped) {
  const browser = browserContext();
  for (const file of ['globals', 'utils', 'daily', 'imei']) browser.load(`public/js/${file}.js`);
  const s = browser.context;
  s.authRole = 'admin'; s.authShop = null; s.activeShop = 'A'; s.imeiFilter = 'all';
  s.localStorage.setItem('clientId', 'render-test');
  s.groupedView = grouped; s.updateBulkActions = () => {};
  s.api = async () => ({ items: storages.map((storage, i) => ({
    id: String(i), imei: String(i).padStart(15, '0'), shop: 'A',
    brand: 'Test', model: 'Phone', cat: 'OTHER', storage, status: 'in_stock',
  })), total: storages.length, hasMore: false, nextCursor: null });
  await s.loadIMEIData();
  return s.document.getElementById('imeiList').innerHTML;
}

for (const grouped of [true, false]) {
  test(`stock storage stays text in ${grouped ? 'grouped' : 'flat'} view`, async () => {
    const storage = '<img src=x onerror="document.body.dataset.audit=1">';
    const html = await stockView([storage], grouped);
    assert.ok(html.includes('&lt;img src=x onerror="document.body.dataset.audit=1"&gt;'));
    assert.ok(!html.includes('<img src=x'));
  });
}

test('grouped stock preserves ordinary, mixed and missing storage labels', async () => {
  assert.match(await stockView(['128GB'], true), /badge-purple">128GB<\/span>/);
  assert.match(await stockView(['128GB', '256GB'], true), /badge-purple">Multiple Storages<\/span>/);
  assert.doesNotMatch(await stockView([''], true), /badge-purple/);
});

test('grouped stock shows availability without a duplicate units badge', async () => {
  const html = await stockView(['128GB', '128GB'], true);
  assert.match(html, /2 in stock/);
  assert.doesNotMatch(html, /2 units/);
});
