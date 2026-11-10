const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');

function screen() {
  const b = browserContext();
  for (const name of ['globals', 'utils', 'imei', 'daily']) b.load(`public/js/${name}.js`);
  for (const name of ['showToast', 'loadSidebarStats', 'loadIMEIData', 'renderStock', 'renderExpenses', 'renderPurchases', 'renderTransfers', 'recalc']) b.context[name] = () => {};
  b.context.loadSalesLog = async () => {};
  b.context.confirmModal = async () => true;
  b.context.activeShop = 'A';
  return b;
}
test('PKR amounts show two decimal places, including negative corrections', () => {
  const b = screen();
  assert.equal(b.context.pkr(0.1), 'Rs 0.10');
  assert.equal(b.context.pkr(-100.2), 'Rs -100.20');
});
test('IMEI reversal captures a specific sale before confirmation', async () => {
  const b = screen(), calls = [];
  b.context.api = async (method, url, body) => { calls.push({ method, url, body }); return { _id: 'a'.repeat(24), imei: '123456789012345' }; };
  await b.context.deleteSaleByIMEI('123456789012345');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[1].body.saleId, 'a'.repeat(24));
});
test('bulk reversal keeps the captured IDs even if data changes during confirmation', async () => {
  const b = screen(), bodies = [];
  b.context.allSalesData = [{ _id: 'old-sale', kind: 'sale' }, { _id: 'old-return', kind: 'reversal' }, { _id: 'reversed-sale', reversedAt: 'date', kind: 'sale' }];
  b.context.confirmModal = async () => { b.context.allSalesData = [{ _id: 'new-sale', kind: 'sale' }]; return true; };
  b.context.api = async (method, url, body) => { bodies.push(body); return { reversed: 1 }; };
  await b.context.clearAllSales();
  assert.deepEqual(JSON.parse(JSON.stringify(bodies)), [{ saleIds: ['old-sale'] }]);
});
test('daily finance reads immutable events and adds a read-only negative correction', async () => {
  const b = screen();
  b.context.document.getElementById('work-date').value = '2026-11-09';
  b.context.api = async (method, url) => url.startsWith('/api/days/') ? {} : url.startsWith('/api/stock') ? [] : { sources: [], expenseBreakdown: [], ledger: [
    { _id: 's1', brand: 'Apple', model: 'Phone', kind: 'sale', units: 1, salePrice: 200, buyPrice: 100 },
    { _id: 's2', brand: 'Apple', model: 'Phone', kind: 'sale', units: 1, salePrice: 300, buyPrice: 150 },
    { _id: 'r1', brand: 'Apple', model: 'Old', kind: 'reversal', units: -1, salePrice: -200, buyPrice: -100 }] };
  await b.context.loadDay();
  const rows = b.context.dayState.cats.IPHONE.rows;
  assert.equal(rows[0].soldCost, 250);
  assert.equal(rows[0].soldFor, 500);
  const adjustment = b.context.dayState.cats.EXTRA.rows[0];
  assert.equal(adjustment.saleAdjustmentId, 'r1');
  assert.equal(adjustment.boughtFor, -100);
  assert.equal(adjustment.soldFor, -200);
  b.context.onRC('EXTRA', 0, 'soldFor', 900);
  b.context.removeRow('EXTRA', 0);
  assert.equal(adjustment.soldFor, -200);
  assert.equal(b.context.dayState.cats.EXTRA.rows.length, 1);
});

test('rendering, printing and CSV use the same Karachi ledger dates and correction labels', async () => {
  const b = screen();
  b.context.allSalesData = [{ _id: 'r1', soldAt: '2026-11-08T20:00:00.000Z', businessDate: '2026-11-09',
    kind: 'reversal', units: -1, salePrice: -0.3, buyPrice: -0.1, profit: -0.2,
    salePriceMinor: -30, buyPriceMinor: -10, profitMinor: -20 }];
  b.context.document.getElementById('sl-from').value = '2026-11-09';
  b.context.document.getElementById('sl-to').value = '2026-11-09';
  b.context.renderSalesLog();
  const html = b.context.document.getElementById('sl-body').innerHTML;
  assert.match(html, /Correction/);
  assert.doesNotMatch(html, /onclick="deleteSale\(/);
  let printed = '', csv = '';
  b.context.printSection = (title, content) => { printed = content; };
  b.context.dlCSV = content => { csv = content; };
  b.context.api = async () => ({ complete: true, total: b.context.allSalesData.length, items: b.context.allSalesData });
  await b.context.printSalesLog();
  await b.context.exportSalesLogCSV();
  assert.match(printed, /Correction/);
  assert.match(printed, /-1 net units/);
  assert.match(csv, /2026-11-09/);
  assert.match(csv, /reversal/);
});

test('monthly screen and print include negative correction costs and units', async () => {
  const b = screen();
  b.context.document.getElementById('monthly-month').value = '2026-11';
  b.context.document.getElementById('monthly-shop').value = 'A';
  b.context.pkr = value => `PKR ${value}`;
  const f = { revenue: -200, cost: -100, grossProfit: -100, expenses: 0, netProfit: -100, units: -1, cashMovement: -200 };
  b.context.api = async () => ({ sources: [{ shop: 'A' }], shopStats: { A: f }, financial: f });
  await b.context.renderMonthly();
  const html = b.context.document.getElementById('monthly-body').innerHTML;
  assert.match(html, /Cost of Sold<\/span><span[^>]*>PKR -100/);
  assert.match(html, /Units Sold<\/span><span[^>]*>-1/);
  let printed = '';
  b.context.printSection = (title, content) => { printed = content; };
  await b.context.printMonthly();
  assert.match(printed, /PKR -100/);
  assert.match(printed, /class="right">-1<\/td>/);
});
