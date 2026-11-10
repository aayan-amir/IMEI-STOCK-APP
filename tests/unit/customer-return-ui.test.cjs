const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');
const id = '123456789012345678901234';
const review = { saleId: id, imei: '001234567890123', phone: 'Test <Phone>', receivingShop: 'B', sellingShop: 'A', amountMinor: 30,
  reviewFingerprint: 'a'.repeat(64), alreadyReturned: false, return: null, refund: null };
function screen() {
  const b = browserContext(); for (const name of ['globals', 'utils', 'capabilities', 'returns']) b.load('public/js/' + name + '.js');
  const s = b.context; s.authRole = 'admin'; s.activePage = 'saleslog';
  s.localStorage.setItem('clientId', 'owner-test'); s.localStorage.setItem('authToken', 'token');
  s.businessCapabilities = { owner: s.businessCapabilityOwner(), customerReturns: true };
  s.currentClientShops = [{ id: 'A' }, { id: 'B' }];
  s.showToast = () => {}; s.loadSalesLog = async () => {}; s.loadSidebarStats = async () => {};
  return s;
}
test('return review names the original owner, exact amount and text IMEI without recording anything', async () => {
  const s = screen(), methods = []; s.api = async method => { methods.push(method); return { ...review }; };
  await s.openCustomerReturn(id);
  const html = s.document.getElementById('customer-return-panel').innerHTML;
  assert.match(html, /001234567890123/); assert.match(html, /Test &lt;Phone&gt;/);
  assert.match(html, /Receive at<\/dt><dd>B/); assert.match(html, /Rs 0\.30/);
  assert.deepEqual(methods, ['GET']);
});
test('return acceptance requires explicit received-phone confirmation', async () => {
  const s = screen(), writes = []; s.api = async (method, url, payload) => { if (method === 'POST') writes.push(payload); return { ...review }; };
  await s.openCustomerReturn(id); await s.acceptCustomerReturnUI();
  assert.equal(writes.length, 0);
});
test('unknown return acknowledgment retains the exact reviewed action for retry', async () => {
  const s = screen(), commands = []; let accepted = false;
  s.api = async (method, url, payload, options) => {
    if (method === 'GET') return { ...review, alreadyReturned: accepted, return: accepted ? { acceptedAt: '2026-11-10T00:00:00.000Z' } : null };
    commands.push({ payload, key: options.operationId });
    if (commands.length === 1) throw Error('unknown acknowledgment');
    accepted = true; return { success: true, saleId: id, returnId: id, amountMinor: 30, stockRestored: true };
  };
  await s.openCustomerReturn(id); s.document.getElementById('customer-return-received').checked = true;
  await s.acceptCustomerReturnUI(); await s.retryCustomerReturnCommand();
  assert.equal(commands[0].key, commands[1].key); assert.deepEqual(commands[0].payload, commands[1].payload);
  assert.equal(commands[0].payload.receivingShop, 'B');
});
test('refund recording needs actual method, paying shop and full-refund confirmation', async () => {
  const s = screen(), writes = [];
  s.api = async (method, url, payload) => { if (method === 'POST') { writes.push(payload); throw Error('offline'); } return { ...review, alreadyReturned: true, return: {} }; };
  await s.openCustomerReturn(id); await s.recordCustomerRefundUI(); assert.equal(writes.length, 0);
  s.document.getElementById('customer-refund-method').value = 'bank';
  s.document.getElementById('customer-refund-shop').value = 'B';
  s.document.getElementById('customer-refund-confirmed').checked = true;
  await s.recordCustomerRefundUI();
  assert.equal(writes.length, 1); assert.equal(writes[0].method, 'bank'); assert.equal(writes[0].paidByShop, 'B');
  assert.equal(writes[0].confirmed, true); assert.equal('amountMinor' in writes[0], false);
});
test('late return review cannot replace another account or selected sale', async () => {
  const s = screen(); let release; s.api = () => new Promise(resolve => { release = resolve; });
  const pending = s.openCustomerReturn(id); s.localStorage.setItem('clientId', 'another-owner');
  release({ ...review }); await pending;
  assert.equal(s.document.getElementById('customer-return-panel').innerHTML, '');
});

test('sale actions link retained original IDs and hide return writers from staff', () => {
  const s = screen();
  assert.match(s.customerReturnButton({ _id: 'reversal_' + id, saleId: id }), new RegExp("openCustomerReturn\\('" + id + "'\\)"));
  assert.equal(s.customerReturnButton({ _id: "bad' onclick='x" }), '');
  s.authRole = 'shop'; assert.equal(s.customerReturnButton({ _id: id }), '');
});

test('sales page includes a labelled return panel and loads its controller', () => {
  const fs = require('node:fs'), html = fs.readFileSync('public/index.html', 'utf8');
  assert.ok(html.includes('id="customer-return-panel"'), 'return review panel is reachable from the sales page');
  assert.ok(html.includes('src="/js/returns.js"'), 'return controller is loaded');
  assert.ok(fs.readFileSync('public/js/imei.js', 'utf8').includes('customerReturnButton(s)'), 'sales rows expose the authorized return action');
});

test('confirmed refund details show a readable Karachi time instead of a raw server timestamp', async () => {
  const s = screen();
  s.api = async () => ({ ...review, alreadyReturned: true, return: {}, refund: { method: 'bank', paidByShop: 'B', occurredAt: '2026-11-10T03:56:20.858Z' } });
  await s.openCustomerReturn(id);
  const html = s.document.getElementById('customer-return-panel').innerHTML;
  assert.match(html, /10 Nov 2026/); assert.match(html, /08:56/);
  assert.doesNotMatch(html, /T03:56/);
  assert.doesNotMatch(html, /Record refund already paid/);
});
