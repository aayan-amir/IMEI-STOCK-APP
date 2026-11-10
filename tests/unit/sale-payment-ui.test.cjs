const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');
test('disabled feature controls stay hidden even when their component class sets display', () => {
  const css = require('node:fs').readFileSync('public/css/app.css', 'utf8');
  assert.ok(/\[hidden\]\s*\{\s*display:\s*none\s*!important\s*;/.test(css), 'hidden controls must override component display rules');
});
function screen() {
  const b = browserContext();
  for (const name of ['globals', 'utils', 'capabilities', 'imei']) b.load('public/js/' + name + '.js');
  const s = b.context;
  s.authRole = 'shop'; s.authShop = 'A'; s.pendingIMEI = '001234567890123';
  s.localStorage.setItem('clientId', 'test-owner'); s.localStorage.setItem('authToken', 'token');
  s.document.getElementById('fSalePrice').value = '0.3';
  return s;
}
test('shop capability reveals one payment-method choice and includes it in the sale intent', async () => {
  const s = screen(); s.api = async () => ({ features: { fullyPaidTender: true, stocktake: true } });
  await s.loadBusinessCapabilities();
  assert.equal(s.document.getElementById('sale-payment-group').hidden, false);
  assert.equal(s.document.getElementById('fPaymentMethod').required, true);
  assert.equal(s.document.getElementById('ni-stocktakes').style.display, 'none');
  s.document.getElementById('fPaymentMethod').value = 'bank';
  assert.equal(s.readSaleIntent().payload.paymentMethod, 'bank');
});
test('disabled or stale capability never adds a guessed payment method to legacy sales', async () => {
  const s = screen(); s.api = async () => ({ features: { fullyPaidTender: false } });
  await s.loadBusinessCapabilities();
  s.document.getElementById('fPaymentMethod').value = 'cash';
  assert.equal('paymentMethod' in s.readSaleIntent().payload, false);
  s.api = async () => ({ features: { fullyPaidTender: true } }); await s.loadBusinessCapabilities();
  s.localStorage.setItem('clientId', 'another-account');
  assert.equal('paymentMethod' in s.readSaleIntent().payload, false);
});

test('customer-return capability is owner-only even if a response advertises it to staff', async () => {
  const s = screen(); s.api = async () => ({ features: { customerReturns: true } });
  await s.loadBusinessCapabilities(); assert.equal(s.hasBusinessCapability('customerReturns'), false);
  s.authRole = 'admin'; await s.loadBusinessCapabilities(); assert.equal(s.hasBusinessCapability('customerReturns'), true);
});

test('account changes clear previous stock-check and return evidence before loading capabilities', async () => {
  const s = screen(); s.api = async () => ({ features: {} });
  await s.loadBusinessCapabilities();
  s.document.getElementById('stocktake-detail').innerHTML = 'old account IMEI';
  s.document.getElementById('customer-return-panel').innerHTML = 'old account sale';
  s.document.getElementById('customer-return-panel').hidden = false;
  s.localStorage.setItem('clientId', 'new-account');
  await s.loadBusinessCapabilities();
  assert.equal(s.document.getElementById('stocktake-detail').innerHTML, '');
  assert.equal(s.document.getElementById('customer-return-panel').innerHTML, '');
  assert.equal(s.document.getElementById('customer-return-panel').hidden, true);
});
test('enabled sale refuses an omitted method before posting and sends the versioned contract', async () => {
  const s = screen(), requests = [];
  s.api = async (method, url, payload, options) => {
    if (url === '/api/capabilities') return { features: { fullyPaidTender: true } };
    requests.push({ method, url, payload, options }); throw Error('offline');
  };
  s.showToast = () => {};
  await s.loadBusinessCapabilities(); await s.submitSell();
  assert.equal(requests.length, 0);
  s.document.getElementById('fPaymentMethod').value = 'cash'; await s.submitSell();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.saleVersion, '2');
  assert.equal(requests[0].payload.paymentMethod, 'cash');
  assert.equal('paidAmountMinor' in requests[0].payload, false);
});


test('counted-cash controls appear only for an owner with an explicit server capability', async () => {
  const s = screen(); s.api = async () => ({ features: { verifiedCashClose: true } });
  await s.loadBusinessCapabilities(); assert.equal(s.document.getElementById('day-cash-count').hidden, true);
  s.authRole = 'admin'; await s.loadBusinessCapabilities(); assert.equal(s.document.getElementById('day-cash-count').hidden, false);
  s.api = async () => { throw Error('older server'); }; await s.loadBusinessCapabilities();
  assert.equal(s.document.getElementById('day-cash-count').hidden, true);
});
