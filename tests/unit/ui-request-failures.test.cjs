const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');

function screen() {
  const browser = browserContext({ fetch: async () => { throw Error('offline'); } });
  for (const file of ['globals', 'utils', 'ui', 'imei', 'daily', 'ceo']) browser.load(`public/js/${file}.js`);
  browser.context.showToast = (message, type) => browser.toasts.push({ message, type });
  browser.toasts = [];
  browser.context.activeShop = 'A';
  browser.context.SHOPS = ['A'];
  browser.context.loadSidebarStats = async () => {};
  return browser;
}

for (const [name, args] of [['submitAdd', []], ['submitSell', []], ['saveDay', []], ['saveProductQty', ['id']], ['deleteShopExp', ['id']]]) {
  test(`${name} preserves input and never reports success when offline`, async () => {
    const browser = screen();
    if (name === 'saveProductQty') {
      browser.context.allProducts = [{ _id: 'id', name: 'Charger', quantity: 2, revision: 0 }];
      browser.context.editProductQty('id', 'Charger', 2);
      browser.context.document.getElementById('ep-qty').value = '2';
    }
    const input = browser.context.document.getElementById('fBrand');
    input.value = 'Retain brand';
    const result = await browser.context[name](...args);
    assert.equal(result, false);
    assert.equal(input.value, 'Retain brand');
    assert.equal(browser.toasts.some(t => t.type === 'success' || t.type === 'warn'), false);
    assert.equal(browser.toasts.some(t => t.type === 'error'), true);
  });
}

test('failed sales and warehouse loads retain previous good data', async () => {
  const browser = screen();
  const sales = [{ imei: 'previous' }];
  const warehouse = { items: [{ imei: 'previous' }] };
  browser.context.allSalesData = sales;
  browser.context.hqStock = warehouse;
  browser.context.warehouseDataOwner = browser.context.warehouseReadScope();
  browser.context.renderSalesLog = () => {};
  browser.context.renderWarehouse = () => {};
  assert.equal(await browser.context.loadSalesLog(), false);
  assert.equal(await browser.context.loadWarehouse(), false);
  assert.equal(browser.context.allSalesData, sales);
  assert.equal(browser.context.hqStock, warehouse);
});

test('failed deletion keeps the phone visible and selected', async () => {
  const browser = screen();
  browser.context.confirmModal = async () => true;
  browser.context.updateBulkActions = () => {};
  browser.context.selectedPhoneIds.add('phone-id');
  const card = browser.context.document.getElementById('card-phone-id');
  card.style.display = '';
  assert.equal(await browser.context.deletePhone('phone-id'), false);
  assert.equal(card.style.display, '');
  assert.equal(browser.context.selectedPhoneIds.has('phone-id'), true);
});

test('an edited inventory price renders even when the IDs and count stay the same', () => {
  const browser = screen();
  browser.context.updateBulkActions = () => {};
  browser.context.groupedView = false;
  browser.context.phoneCardHTML = phone => String(phone.buyPrice);
  browser.context.allIMEIStock = [{ id: 'one', status: 'in_stock', buyPrice: 100 }];
  browser.context.renderIMEIStock();
  browser.context.allIMEIStock[0].buyPrice = 200;
  browser.context.renderIMEIStock();
  assert.equal(browser.context.document.getElementById('imeiList').innerHTML, '200');
});

test('failed day load retains the previous day instead of resetting it', async () => {
  const browser = screen();
  const previous = { shop: 'A', date: '2026-11-09', expenses: [{ amt: 100 }] };
  browser.context.dayState = previous;
  assert.equal(await browser.context.loadDay(), false);
  assert.equal(browser.context.dayState, previous);
});

test('logout revokes the session before clearing local identity', async () => {
  const browser = screen();
  browser.context._RL_LOCK_LABELS = {};
  browser.context.location.reload = () => {};
  browser.storage.set('authToken', 'synthetic');
  let called = false;
  browser.context.api = async (method, url) => {
    assert.equal(method, 'POST');
    assert.equal(url, '/api/auth/logout');
    assert.equal(browser.storage.get('authToken'), 'synthetic');
    called = true;
    return { success: true };
  };
  await browser.context.logout();
  assert.equal(called, true);
  assert.equal(browser.storage.has('authToken'), false);
});

test('shop sale form locks credit to the authenticated shop while admin retains choice', () => {
  const browser = screen();
  browser.context.authRole = 'shop';
  browser.context.authShop = 'A';
  browser.context.showSellForm({ imei: '123456789012345', brand: 'Test', shop: 'B' });
  const select = browser.context.document.getElementById('fSoldByShop');
  assert.equal(select.value, 'A');
  assert.equal(select.disabled, true);
  browser.context.authRole = 'admin';
  browser.context.activeShop = 'B';
  browser.context.showSellForm({ imei: '123456789012345', brand: 'Test', shop: 'B' });
  assert.equal(select.value, 'B');
  assert.equal(select.disabled, false);
});

test('shop mode preserves navigation through repeated initialization', () => {
  const browser = screen();
  const state = browser.context;
  state.loadIMEIData = async () => {};
  state.applyShopMode('A');
  state.applyShopMode('A');
  state.nav('imeistock');
  assert.equal(state.activePage, 'imeistock');
  state.nav('scan');
  assert.equal(state.activePage, 'scan');
  state.nav('reports');
  assert.equal(state.activePage, 'scan', 'shop mode must still deny admin pages');
});

test('failed context switch cannot save previous expenses into the newly selected day', async () => {
  const browser = screen();
  const state = browser.context;
  for (const name of ['renderStock', 'renderExpenses', 'renderPurchases', 'renderTransfers', 'recalc']) state[name] = () => {};
  const saved = state.makeEmptyDay('A', '2026-11-08');
  saved.expenses = [{ amt: 100, desc: 'Shop A expense' }];
  state.document.getElementById('work-date').value = saved.date;
  state.api = async (method, url) => url.startsWith('/api/days/') ? saved : url.startsWith('/api/stock') ? [] : { sources: [], expenseBreakdown: [], ledger: [] };
  await state.loadDay();
  assert.equal(state.dayState.expenses[0].amt, 100);
  state.activeShop = 'B';
  state.dayState.shop = 'B'; // legacy switchShop previously overwrote this before loading
  state.document.getElementById('work-date').value = '2026-11-09';
  state.api = async () => { throw Error('offline'); };
  assert.equal(await state.loadDay(), false);
  let writes = 0;
  state.api = async () => { writes++; return { success: true }; };
  assert.equal(await state.saveDay(), false);
  assert.equal(writes, 0);
});
