const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');
function screen() {
  const browser = browserContext();
  for (const file of ['globals', 'utils', 'daily', 'ceo']) browser.load(`public/js/${file}.js`);
  const s = browser.context;
  s.authRole = 'admin'; s.activeShop = 'A'; s.SHOPS = ['A']; s.currentClientShops = [{ id: 'A', name: 'Shop A' }]; s.pkr = value => `PKR ${value}`;
  s.showToast = () => {}; s.document.getElementById('monthly-month').value = '2026-11'; s.document.getElementById('monthly-shop').value = 'ALL';
  return s;
}
test('monthly screen and print use the canonical summary including unsaved-day sales', async () => {
  const s = screen(), calls = [], f = { revenue: 1.05, cost: 0.45, grossProfit: 0.6, expenses: 0.06, netProfit: 0.54, units: 2, cashMovement: 0.94 };
  s.api = async (_method, url) => { calls.push(url); return { shopStats: { A: f }, sources: [{ shop: 'A' }], financial: f }; };
  let printed; s.printSection = (_title, html) => { printed = html; };
  await s.renderMonthly(); await s.printMonthly();
  assert.ok(calls.every(url => url.startsWith('/api/financial-summary?')));
  assert.match(s.document.getElementById('monthly-body').innerHTML, /PKR 0.54/);
  assert.match(printed, /PKR 0.54/); assert.match(printed, /Cash movement/);
});
test('daily screen, CSV and print include separate shop expenses without changing profit for transfers', () => {
  const s = screen();
  s.dayState = s.makeEmptyDay('A', '2026-11-09');
  s.dayState.cats.EXTRA.rows = [{ name: 'Extra', soldFor: 1, boughtFor: 0.2 }];
  s.dayState.expenses = [{ desc: 'Daily', amt: 0.1 }];
  s.dayState.standaloneExpenses = [{ description: 'Shop rent', amount: 0.2 }];
  s.dayState.transfers = [{ amt: 0.3 }]; s.document.getElementById('cf-carry').value = '0.1';
  let csv, printed; s.dlCSV = value => { csv = value; }; s.printSection = (_title, html) => { printed = html; };
  s.recalc(); s.exportDayCSV(); s.printDaySheet();
  assert.equal(s.document.getElementById('cf-ex').textContent, 'PKR 0.3');
  assert.match(csv, /Net Profit,0.5/); assert.match(csv, /Cash movement,0.4/);
  assert.match(csv, /Extra,,,0,,,0.2,1,0.8/);
  assert.match(printed, /PKR 0.5/); assert.match(printed, /Shop rent/);
});
test('CEO print refuses a cached summary from another selected month', () => {
  const s = screen(); let prints = 0;
  s.document.getElementById('ceo-month').value = '2026-11';
  s.lastCEOSummary = { month: '2026-10' }; s.printSection = () => { prints++; };
  s.printCEO(); assert.equal(prints, 0);
});
test('CEO print uses the exact reported net profit and labels inventory as current', () => {
  const s = screen(); s.document.getElementById('ceo-month').value = '2026-11';
  const f = { revenue: 0.4, cost: 0.1, profit: 0.3, expenses: 0.1, netProfit: 0.2, units: 1 };
  s.lastCEOSummary = { month: '2026-11', owner: s.dayOwner(), current: f, shopStats: { A: f }, topModels: [], inventoryCount: 0, inventoryValue: 0 };
  let printed; s.printSection = (_title, html) => { printed = html; }; s.printCEO();
  assert.doesNotMatch(printed, /199999/); assert.match(printed, /Current inventory/);
});
test('report screen, print and CSV expose cash separately and retain zero sale amounts', () => {
  const s = screen(), data = { totalSales: 0, totalCost: 0, grossProfit: 0, netProfit: -0.1, totalExpenses: 0.1, cashMovement: -0.3, purchases: 0.2,
    manualEntries: [{ shop: 'A', date: '2026-11-09', name: 'Manual income', boughtFor: 0.2, soldFor: 0.3 }],
    salesList: [{ model: 'Gift', imei: '123', buyPrice: 0, salePrice: 0, profit: 0 }] };
  const report = { _id: '123', type: 'daily', shop: 'A', period: '2026-11-09', data }; s.allReports = [report];
  let csv, printed; s.dlCSV = value => { csv = value; }; s.printSection = (_title, html) => { printed = html; };
  s.exportReportCSV('123'); s.printReport('123');
  assert.match(csv, /Cash movement,-0.3/); assert.match(csv, /Gift,123,,0,0,0/);
  assert.match(s.renderReportData(report), /Cash movement/); assert.match(printed, /Cash movement/);
  assert.match(csv, /Manual income,0.2,0.3/); assert.match(printed, /Manual income/);
});
test('a superseded CEO response cannot replace the selected month', async () => {
  const s = screen(); let resolve;
  const dto = revenue => ({ current: { revenue, profit: 0, expenses: 0, units: 0, netProfit: 0 }, prev: { revenue: 0, profit: 0 }, shopStats: {}, topModels: [], inventoryCount: 0, inventoryValue: 0 });
  s.document.getElementById('ceo-month').value = '2026-10';
  s.api = () => new Promise(done => { resolve = done; }); const old = s.renderCEO();
  s.document.getElementById('ceo-month').value = '2026-11'; s.api = async () => dto(2); await s.renderCEO();
  resolve(dto(1)); await old;
  assert.equal(s.lastCEOSummary.month, '2026-11'); assert.equal(s.lastCEOSummary.current.revenue, 2);
});
