const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');
function screen(sharedStorage) {
  const browser = browserContext(), s = browser.context;
  if (sharedStorage) s.localStorage = { getItem: key => sharedStorage.get(key) ?? null, setItem: (key, value) => sharedStorage.set(key, String(value)), removeItem: key => sharedStorage.delete(key) };
  const element = s.document.getElementById.bind(s.document);
  s.document.getElementById = id => { const node = element(id); node.setAttribute = (name, value) => { node[name] = value; }; return node; };
  for (const name of ['globals', 'utils', 'cash']) browser.load('public/js/' + name + '.js');
  s.businessCapabilityOwner = () => 'owner-A'; s.hasBusinessCapability = () => true;
  s.selectedDay = () => ({ shop: 'A' }); s.SHOPS = ['A', 'B']; s.currentClientShops = []; s.authRole = 'admin'; s.localStorage.setItem('clientId', 'cash-ui-owner');
  s.showModal = html => { s.modalHTML = html; }; s.closeModal = () => {}; s.showToast = () => {};
  return s;
}
const review = { needsOpening: false, shop: 'A', date: '2026-11-10', reviewFingerprint: 'a'.repeat(64), calculation: { complete: true, expectedMinor: 130, issues: [] } };

test('cash count shows expected, counted and difference while incomplete records cannot be submitted', async () => {
  const s = screen(); let posts = 0;
  s.api = async method => { if (method === 'POST') posts++; return { ...review, calculation: { complete: false, expectedMinor: null, issues: [{ id: 'refund:1', code: 'REFUND_NOT_RECORDED' }] } }; };
  await s.openCashClose(); assert.match(s.modalHTML, /Cash records incomplete/);
  s.document.getElementById('cash-counted').value = '1.30'; s.document.getElementById('cash-confirmed').checked = true;
  await s.submitCashCount(); assert.equal(posts, 0);
});

test('cash count retries preserve the exact reviewed command and key after an unknown response', async () => {
  const s = screen(), calls = [];
  s.api = async (method, url, body, options) => { if (method === 'GET') return review; calls.push({ body: JSON.parse(JSON.stringify(body)), key: options.operationId }); throw Error('unknown outcome'); };
  await s.openCashClose(); s.document.getElementById('cash-counted').value = '1.20';
  s.document.getElementById('cash-reason').value = 'Ten paisa short'; s.document.getElementById('cash-confirmed').checked = true;
  await s.submitCashCount(); s.document.getElementById('cash-counted').value = '99'; await s.submitCashCount();
  assert.equal(calls.length, 2); assert.equal(calls[0].body.amount, '1.20'); assert.deepEqual(calls[0], calls[1]);
});

test('a late cash review cannot expose the previous signed-in account evidence', async () => {
  const s = screen(); let release; s.api = () => new Promise(resolve => { release = resolve; });
  const loading = s.openCashClose(); s.businessCapabilityOwner = () => 'owner-B'; release(review); await loading;
  assert.doesNotMatch(s.modalHTML, /1\.30/);
});

test('actual payment recording requires explicit method and completed-payment confirmation', async () => {
  const s = screen(); let posts = 0; s.api = async () => { posts++; return { success: true }; };
  s.openCashPayment('expense'); s.document.getElementById('cash-payment-amount').value = '0.30';
  s.document.getElementById('cash-payment-description').value = 'Paid expense';
  await s.submitCashPayment(); assert.equal(posts, 0);
  s.document.getElementById('cash-payment-method').value = 'bank';
  s.document.getElementById('cash-payment-confirmed').checked = true;
  await s.submitCashPayment(); assert.equal(posts, 1);
});


test('unknown payment requests survive switching shops without replacing the original retry key', async () => {
  const s = screen(), calls = []; let shop = 'A'; s.selectedDay = () => ({ shop });
  s.api = async (method, url, body, options) => { calls.push({ shop: body.shop, key: options.operationId }); throw Error('unknown outcome'); };
  async function pay() {
    s.openCashPayment('expense'); s.document.getElementById('cash-payment-amount').value = '0.30';
    s.document.getElementById('cash-payment-method').value = 'cash'; s.document.getElementById('cash-payment-description').value = 'Paid now';
    s.document.getElementById('cash-payment-confirmed').checked = true; await s.submitCashPayment();
  }
  await pay(); shop = 'B'; await pay(); shop = 'A'; s.openCashPayment('expense'); await s.sendCashCommand();
  assert.equal(calls[0].shop, 'A'); assert.equal(calls[1].shop, 'B'); assert.equal(calls[2].shop, 'A');
  assert.equal(calls[0].key, calls[2].key);
});


test('completed transfers offer configured receiving shops and escape their names', () => {
  const s = screen(); s.SHOPS = ['A', 'B"<']; s.openCashPayment('transfer');
  assert.match(s.modalHTML, /B&amp;quot;|B&quot;/); assert.match(s.modalHTML, /Received by shop/);
});


test('an unresolved completed payment retains its exact request across browser reload', async () => {
  const storage = new Map(), calls = [], first = screen(storage);
  const api = async (method, url, body, options) => { calls.push({ body: JSON.parse(JSON.stringify(body)), key: options.operationId }); throw Error('response lost'); };
  first.api = api; first.openCashPayment('expense'); first.document.getElementById('cash-payment-amount').value = '0.30';
  first.document.getElementById('cash-payment-description').value = 'Already paid'; first.document.getElementById('cash-payment-method').value = 'cash';
  first.document.getElementById('cash-payment-confirmed').checked = true; await first.submitCashPayment();
  const second = screen(storage); second.api = api; second.openCashPayment('expense');
  assert.match(second.modalHTML, /Retry same request/); await second.sendCashCommand();
  assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
});

test('payment submission stops before the network when its recovery journal cannot be saved', async () => {
  const s = screen(); let calls = 0; s.api = async () => { calls++; return { success: true }; };
  s.openCashPayment('expense'); s.document.getElementById('cash-payment-amount').value = '0.30';
  s.document.getElementById('cash-payment-description').value = 'Paid now'; s.document.getElementById('cash-payment-method').value = 'cash';
  s.document.getElementById('cash-payment-confirmed').checked = true; s.localStorage.setItem = () => { throw Error('storage full'); };
  await s.submitCashPayment(); assert.equal(calls, 0);
});


test('a temporary feature rejection cannot discard an earlier uncertain committed-payment request', async () => {
  const storage = new Map(), first = screen(storage); let key;
  first.api = async (method, url, body, options) => { key = options.operationId; throw Error('response lost'); };
  first.openCashPayment('expense'); first.document.getElementById('cash-payment-amount').value = '0.30';
  first.document.getElementById('cash-payment-description').value = 'Already paid'; first.document.getElementById('cash-payment-method').value = 'cash';
  first.document.getElementById('cash-payment-confirmed').checked = true; await first.submitCashPayment();
  const second = screen(storage); second.api = async () => { throw Object.assign(Error('feature temporarily disabled'), { status: 503 }); };
  second.openCashPayment('expense'); await second.sendCashCommand();
  const third = screen(storage); let retried;
  third.api = async (method, url, body, options) => { retried = options.operationId; return { success: true, entryId: 'retained', occurredAt: '2026-11-10T00:00:00.000Z' }; };
  third.openCashPayment('expense'); await third.sendCashCommand(); assert.equal(retried, key);
  const fourth = screen(storage); fourth.openCashPayment('expense'); assert.doesNotMatch(fourth.modalHTML, /Retry same request/);
});


test('a saved cash count presents its exact frozen expected, count and difference with reference details collapsed', async () => {
  const s = screen(); s.api = async method => method === 'GET' ? review : { success: true, checkpointId: 'retained-count', at: '2026-11-10T00:00:00.000Z', expectedMinor: 130, countedMinor: 120, differenceMinor: -10 };
  await s.openCashClose(); s.document.getElementById('cash-counted').value = '1.20'; s.document.getElementById('cash-reason').value = 'Short ten paisa'; s.document.getElementById('cash-confirmed').checked = true;
  await s.submitCashCount(); assert.match(s.modalHTML, /Expected cash/); assert.match(s.modalHTML, /Rs 1.30/); assert.match(s.modalHTML, /Rs 1.20/); assert.match(s.modalHTML, /Rs -0.10/);
  assert.match(s.modalHTML, /<details>/);
});
