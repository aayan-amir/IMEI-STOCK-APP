const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');

const actions = [
  ['submitAdd'], ['submitSell'], ['saveEditPhone', 'phone-id'], ['saveBatchEdit'],
  ['deletePhone', 'phone-id'], ['loadSalesLog'], ['deleteSale', 'sale-id'],
  ['deleteSaleByIMEI', '123456789012345'], ['clearAllSales'], ['submitProduct'],
  ['loadProducts'], ['saveProductQty', 'product-id'], ['deleteProduct', 'product-id', 'Charger'],
  ['loadDay'], ['renderShopExpenses'], ['deleteShopExp', 'expense-id'], ['saveShopExp'],
  ['loadAllDays'], ['renderMonthly'], ['printMonthly'], ['loadIMEIData'], ['exportIMEICSV'], ['printIMEIStock'], ['loadWarehouse'],
  ['saveDispatch', [{ imei: '123456789012345' }]], ['openDispatchFromShipments'],
  ['loadShipments'], ['renderCEO'], ['loadContacts'], ['saveContact'],
  ['deleteContact', 'contact-id'], ['renderAnalytics'], ['loadLogs'], ['loadReports'],
  ['generateReport'], ['deleteReport', 'report-id'], ['exportSalesLogCSV'], ['printSalesLog'], ['printContacts'], ['exportProductsCSV'], ['printHistory'], ['printLogs'],
  ['deleteWarehouseImei', '123456789012345'],
];

for (const [name, ...args] of actions) {
  test(`${name} handles rejected requests without false success or unhandled rejection`, async () => {
    const browser = browserContext();
    for (const file of ['globals', 'utils', 'imei', 'daily', 'ceo']) browser.load(`public/js/${file}.js`);
    const state = browser.context;
    const toasts = [];
    let calls = 0;
    state.showToast = (message, type = 'success') => toasts.push({ message, type });
    state.api = async () => { calls++; throw Error('request rejected'); };
    state.confirmModal = async () => true;
    state.updateBulkActions = () => {};
    state.activeShop = 'A'; state.authRole = 'admin';
    state.allIMEIStock = [{ id: 'phone-id', status: 'in_stock', imei: '123456789012345' }];
    state.SHOPS = ['A'];
    state.hqStock = null;
    state.allSalesData = [{ _id: '123456789012345678901234', kind: 'sale' }];
    state.allProducts = [{ _id: 'product-id', name: 'Charger', quantity: 2, revision: 0 }];
    if (name === 'deleteWarehouseImei') state.hqStock = { items: [{ imei: '123456789012345', entryId: 'a'.repeat(64) }] };
    if (name === 'deleteWarehouseImei') state.warehouseDataOwner = state.warehouseReadScope();
    if (name === 'saveProductQty') state.editProductQty('product-id', 'Charger', 2);
    state.selectedPhoneIds.add('phone-id');
    for (const [id, value] of Object.entries({
      'be-brand': 'Test', pName: 'Charger', pQty: '1', pBuyPrice: '100',
      'ct-name': 'Test customer', 'se-shop': 'A', 'se-date': '2026-11-09', 'se-amt': '10',
      'rpt-type': 'daily', 'rpt-shop': 'A', 'rpt-period': '2026-11-09',
      'monthly-month': '2026-11', 'monthly-shop': 'ALL',
      'ep-qty': '2',
    })) state.document.getElementById(id).value = value;
    state.document.getElementById('dsi-0').checked = true;
    assert.equal(await state[name](...args), false);
    assert.ok(calls > 0, 'the fixture must reach the actual request path');
    assert.equal(toasts.some(toast => toast.type !== 'error'), false);
    assert.ok(toasts.some(toast => toast.message === 'request rejected'));
  });
}
