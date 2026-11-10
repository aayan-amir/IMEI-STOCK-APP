const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');
function screen() {
  const browser = browserContext(), storage = new Map();
  const state = browser.context;
  state.sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key),
    key: index => [...storage.keys()][index], get length() { return storage.size; } };
  for (const file of ['globals', 'utils', 'daily']) browser.load(`public/js/${file}.js`);
  state.activeShop = 'A'; state.authRole = 'admin'; state.SHOPS = ['A']; state.localStorage.setItem('clientId', 'test-client');
  state.document.getElementById('work-date').value = '2026-11-09';
  state.showToast = () => {}; state.showModal = () => {}; state.closeModal = () => {};
  for (const fn of ['renderStock', 'renderExpenses', 'renderPurchases', 'renderTransfers', 'recalc']) state[fn] = () => {};
  return state;
}
const summary = (revision = 0, ledger = []) => ({ ledger, sources: [{ revision }], expenseBreakdown: [] });
const saved = { shop: 'A', date: '2026-11-09', revision: 3, status: 'open', cats: { EXTRA: { rows: [] } }, expenses: [], purchases: [], transfers: [], carryForward: 0 };
async function load(state) {
  state.api = async (method, url) => url.startsWith('/api/days/') ? JSON.parse(JSON.stringify(saved)) : url.startsWith('/api/stock') ? [] : summary(3);
  await state.loadDay();
}
test('daily save captures its revision and preserves request key and edits after an unknown response', async () => {
  const s = screen(); await load(s);
  s.dayState.expenses.push({ desc: 'Keep', amt: 0 });
  const calls = [];
  s.api = async (method, url, body, options) => { calls.push({ body, key: options?.operationId }); throw Error('unknown response'); };
  await s.saveDay(); await s.saveDay();
  assert.equal(calls[0].body.expectedRevision, 3);
  assert.match(calls[0].key || '', /^[a-f0-9-]{32,36}$/);
  assert.equal(calls[0].key, calls[1].key);
  assert.equal(s.dayState.expenses[0].desc, 'Keep');
});
test('an older day response cannot replace a newer shop/date or its pending draft', async () => {
  const s = screen(); let release;
  s.api = async (method, url) => url === '/api/days/A/2026-11-09' ? new Promise(resolve => { release = resolve; }) : url.startsWith('/api/days/') ? { ...saved, shop: 'B', revision: 7 } : url.startsWith('/api/stock') ? [] : summary(7);
  const first = s.loadDay(); s.activeShop = 'B'; await s.loadDay();
  release(saved); await first;
  assert.equal(s.dayState.shop, 'B');
  assert.equal(s.dayState.revision, 7);
});
test('closed load uses retained snapshot instead of current inventory and rejects a save', async () => {
  const s = screen(), calls = [];
  s.api = async (method, url) => { calls.push(url); return { ...saved, status: 'closed', closedSnapshot: { cats: { EXTRA: { rows: [] } }, financial: { revenue: 10 } } }; };
  await s.loadDay();
  assert.equal(calls.length, 1);
  assert.equal(s.dayState.status, 'closed');
  assert.equal(await s.saveDay(), false);
  assert.equal(calls.length, 1);
});
test('manual drafts survive navigation, remain isolated, and can be restored only to the same revision', async () => {
  const s = screen(); await load(s);
  s.dayState.expenses.push({ desc: 'Unsaved local value', amt: 0.2 });
  s.activeShop = 'B'; await s.loadDay();
  s.activeShop = 'A'; await s.loadDay();
  s.dayState.cats.IPHONE = { rows: [{ name: 'Retained sale', out: 1, soldFor: 0.3, soldCost: 0.1 }] };
  s.dayState.cats.EXTRA.rows.push({ name: 'Retained reversal', saleAdjustmentId: 'correction-id', soldFor: -0.2, boughtFor: -0.1 });
  assert.equal(s.dayState.expenses.length, 0);
  assert.equal(s.restoreDayDraft(), true);
  assert.equal(s.dayState.expenses[0].desc, 'Unsaved local value');
  assert.equal(s.dayState.cats.IPHONE.rows[0].name, 'Retained sale');
  assert.equal(s.dayState.cats.EXTRA.rows.filter(row => row.saleAdjustmentId).length, 1);
});
test('close and reopen reviews bind the loaded revision and keep their retry key', async () => {
  const s = screen(); await load(s);
  s.openDayAction('close');
  const calls = [];
  s.api = async (method, url, body, options) => { calls.push({ url, body, key: options?.operationId }); throw Error('unknown response'); };
  await s.applyDayAction(); await s.applyDayAction();
  assert.equal(calls[0].body.expectedRevision, 3);
  assert.match(calls[0].url, /\/close$/);
  assert.equal(calls[0].key, calls[1].key);
});
test('past open sheets do not present current inventory as a historical opening', async () => {
  const s = screen(); s.document.getElementById('work-date').value = '2020-01-01';
  s.api = async (method, url) => url.startsWith('/api/days/') ? {} : url.startsWith('/api/stock') ? [{ imei: '123456789012345', status: 'in_stock', brand: 'Apple', model: 'Test', buyPrice: 100 }] : summary();
  await s.loadDay();
  const row = s.dayState.cats.IPHONE.rows[0];
  assert.equal(row.op, null);
  assert.equal(row.inQty, null);
  assert.equal(row.currentInStock, 1);
});

test('stale drafts remain downloadable for review and explicit logout cleanup removes them', async () => {
  const s = screen(); await load(s);
  s.dayState.expenses.push({ desc: 'Unsaved retained value', amt: 0.2 }); s.persistDayDraft();
  s.api = async (method, url) => url.startsWith('/api/days/') ? { ...saved, revision: 4, expenses: [{ desc: 'New server value', amt: 1 }] } : url.startsWith('/api/stock') ? [] : summary(4);
  await s.loadDay();
  assert.equal(s.restoreDayDraft(), false);
  assert.equal(s.dayState.expenses[0].desc, 'New server value');
  let downloaded;
  s.Blob = class { constructor(parts) { downloaded = JSON.parse(parts.join('')); } };
  s.URL = { createObjectURL() { return 'blob:synthetic'; }, revokeObjectURL() {} };
  s.document.createElement = () => ({ click() {}, remove() {} }); s.document.body = { appendChild() {} };
  s.downloadDayDraft();
  assert.equal(downloaded.manual.expenses[0].desc, 'Unsaved retained value');
  s.clearDailyDrafts();
  assert.equal(s.readDayDraft(), null);
});

test('unknown opening and inbound quantities stay unavailable in print and CSV', async () => {
  const s = screen(); await load(s);
  s.dayState.cats.IPHONE = { rows: [{ name: 'Example', op: null, inQty: null, currentInStock: 1, out: 0, soldCost: 0, soldFor: 0, costPerUnit: 100 }] };
  let csv = '', printed = '';
  s.dlCSV = value => { csv = value; }; s.printSection = (title, value) => { printed = value; };
  s.exportDayCSV(); s.printDaySheet();
  assert.match(csv, /Example,,,0,1/);
  assert.match(printed, /Opening.*unavailable/i);
  assert.match(printed, /<td class="right">—<\/td>/);
});

test('an IMEI tagged EXTRA cannot be counted again as manual income', async () => {
  const s = screen();
  s.api = async (method, url) => url.startsWith('/api/days/') ? saved : url.startsWith('/api/stock') ? [] : summary(3, [{ _id: 'sale', kind: 'sale', brand: 'Test', model: 'Phone', cat: 'EXTRA', salePrice: 300, buyPrice: 100 }]);
  await s.loadDay();
  assert.equal(s.dayState.cats.EXTRA.rows.length, 0);
  assert.equal(s.dayState.cats.OTHER.rows[0].soldFor, 300);
});


test('cash-format sheets save financial corrections with explicit writer negotiation', async () => {
  const s = screen();
  s.api = async (method, url) => url.startsWith('/api/days/') ? { ...saved, cashFormatVersion: 1 } : url.startsWith('/api/stock') ? [] : summary(3);
  await s.loadDay(); let captured;
  s.api = async (method, url, body, options) => { captured = { body, options }; return { day: { revision: 4 } }; };
  await s.saveDay();
  assert.equal(captured.body.cashFinancialOnly, true);
  assert.equal(captured.options.manualVersion, '2');
});


test('canonical manual payments are displayed once as read-only derived rows and never copied into a sheet save', async () => {
  const s = screen();
  const entries = [
    { _id: 'income-id', kind: 'income', amountMinor: 30, costMinor: 10, description: 'Paid income' },
    { _id: 'purchase-id', kind: 'purchase', amountMinor: 20, description: 'Paid supplier' },
    { _id: 'transfer-id', kind: 'transfer', amountMinor: 10, description: 'Paid transfer' },
  ];
  s.api = async (method, url) => url.startsWith('/api/days/') ? { shop: 'A', date: '2026-11-09', revision: 0, status: 'open', cashFormatVersion: 1 } :
    url.startsWith('/api/stock') ? [] : { ...summary(0), cashEntries: entries };
  await s.loadDay();
  assert.equal(s.dayState.cashFormatVersion, 1); assert.equal(s.dailyFinancial().revenue, 0.3);
  assert.equal(s.dailyFinancial().purchases, 0.2); assert.equal(s.dailyFinancial().transfers, 0.1);
  assert.equal(s.dayManual().cats.EXTRA.rows.length, 0); assert.equal(s.dayManual().purchases.length, 0); assert.equal(s.dayManual().transfers.length, 0);
  s.onRC('EXTRA', 0, 'soldFor', 99); s.removeRow('EXTRA', 0);
  assert.equal(s.dayState.cats.EXTRA.rows[0].soldFor, 0.3);
});


test('normal income and outflow actions use confirmed payment forms after cash capability cutover', () => {
  const s = screen(), kinds = []; s.hasBusinessCapability = name => name === 'verifiedCashClose';
  s.openCashPayment = kind => kinds.push(kind); s.dayState = s.makeEmptyDay('A', '2026-11-09');
  s.addRow('EXTRA'); s.addExp(); s.addPurchase(); s.addTransfer(); s.openAddExpenseModal();
  assert.equal(JSON.stringify(kinds), JSON.stringify(['income', 'expense', 'purchase', 'transfer', 'expense']));
  assert.equal(s.dayState.cats.EXTRA.rows.length, 0); assert.equal(s.dayState.purchases.length, 0);
});

test('derived supplier and transfer payment rows cannot be deleted through sheet editing', () => {
  const s = screen(); s.dayState = s.makeEmptyDay('A', '2026-11-09');
  s.dayState.purchases.push({ cashEntryId: 'purchase', desc: 'Retained supplier payment', amt: 0.2 });
  s.dayState.transfers.push({ cashEntryId: 'transfer', desc: 'Retained transfer', amt: 0.1 });
  s.delPurchase(0); s.delTransfer(0);
  assert.equal(s.dayState.purchases.length, 1); assert.equal(s.dayState.transfers.length, 1);
});


test('restoring a manual draft preserves read-only derived supplier and transfer payments', async () => {
  const s = screen(); await load(s);
  s.dayState.purchases.push({ cashEntryId: 'paid-purchase', desc: 'Already paid supplier', amt: 0.2 });
  s.dayState.transfers.push({ cashEntryId: 'paid-transfer', desc: 'Already completed transfer', amt: 0.1 });
  s.dayState.expenses.push({ desc: 'Unsaved manual correction', amt: 0.3 }); s.persistDayDraft();
  s.restoreDayDraft();
  assert.equal(s.dayState.purchases[0]?.cashEntryId, 'paid-purchase');
  assert.equal(s.dayState.transfers[0]?.cashEntryId, 'paid-transfer');
  assert.equal(s.dailyFinancial().purchases, 0.2); assert.equal(s.dailyFinancial().transfers, 0.1);
});
