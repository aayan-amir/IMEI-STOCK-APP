const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');

function client(fetch) {
  const browser = browserContext({ fetch });
  browser.load('public/js/globals.js');
  browser.load('public/js/utils.js');
  return browser;
}

test('attribute escaping preserves configured names without allowing quote injection', () => {
  const browser = client(async () => {});
  assert.equal(browser.context.escAttr('A" onfocus="x<'), 'A&quot; onfocus=&quot;x&lt;');
});

test('modern fully-paid requests send an explicit contract version without altering legacy requests', async () => {
  const headers = [];
  const browser = client(async (url, options) => { headers.push(options.headers); return { status: 200, ok: true, json: async () => ({ success: true }) }; });
  await browser.context.api('POST', '/api/stock/sell', {}, { saleVersion: '2' });
  await browser.context.api('POST', '/api/stock/sell', {});
  assert.equal(headers[0]['X-Stockly-Sale-Version'], '2');
  assert.equal(headers[1]['X-Stockly-Sale-Version'], undefined);
});

test('network and invalid JSON responses reject instead of returning an empty success', async () => {
  const offline = client(async () => { throw Error('offline'); });
  await assert.rejects(offline.context.api('POST', '/api/stock/add', {}), e => e.code === 'NETWORK_ERROR');
  const html = client(async () => ({ status: 500, ok: false, json: async () => { throw Error('HTML'); } }));
  await assert.rejects(html.context.api('GET', '/api/stock'), e => e.code === 'INVALID_RESPONSE' && e.status === 500);
});

for (const status of [400, 403, 409, 413, 429, 500, 503]) {
  test(`HTTP ${status} preserves the server error and rejects`, async () => {
    const browser = client(async () => ({ status, ok: false, headers: new Headers({ 'x-request-id': 'test-request' }), json: async () => ({ error: 'Request rejected', code: 'TEST_ERROR' }) }));
    await assert.rejects(browser.context.api('PUT', '/api/probe', {}), e => e.status === status && e.message === 'Request rejected' && e.requestId === 'test-request');
  });
}

test('401 clears local session and still rejects the attempted operation', async () => {
  const browser = client(async () => ({ status: 401, ok: false, json: async () => ({ error: 'Unauthorized' }) }));
  browser.context.authRole = 'shop';
  browser.storage.set('authToken', 'synthetic');
  await assert.rejects(browser.context.api('POST', '/api/stock/add', {}), e => e.status === 401);
  assert.equal(browser.storage.has('authToken'), false);
  assert.equal(browser.context.authRole, null);
});

test('successful data is unchanged and includes only expected authentication headers', async () => {
  let captured;
  const browser = client(async (url, options) => { captured = { url, options }; return { status: 200, ok: true, json: async () => ({ success: true }) }; });
  browser.storage.set('authToken', 'synthetic');
  browser.storage.set('clientId', 'synthetic-client');
  const result = await browser.context.api('POST', '/api/probe', { amount: 0 });
  assert.equal(result.success, true);
  assert.equal(captured.url, 'http://localhost:3000/api/probe');
  assert.equal(captured.options.headers.Authorization, 'Bearer synthetic');
  assert.equal(captured.options.body, '{"amount":0}');
});

test('public authentication failure does not destroy an unrelated signed-in session', async () => {
  const browser = client(async () => ({ status: 401, ok: false, json: async () => ({ ok: false }) }));
  browser.context.authRole = 'admin';
  browser.storage.set('authToken', 'existing');
  const result = await browser.context._authPost({ type: 'gate', password: 'incorrect' });
  assert.equal(result.ok, false);
  assert.equal(browser.storage.get('authToken'), 'existing');
});

test('a mutation requires an explicit acknowledgment even on HTTP 200', async () => {
  const browser = client(async () => ({ status: 200, ok: true, json: async () => ({}) }));
  await assert.rejects(browser.context.api('POST', '/api/stock/add', {}), e => e.code === 'INVALID_RESPONSE');
});

test('a late 401 from an old token cannot clear a newly signed-in session', async () => {
  let complete;
  const browser = client(() => new Promise(resolve => { complete = resolve; }));
  browser.context.authRole = 'shop';
  browser.storage.set('authToken', 'old');
  const pending = browser.context.api('GET', '/api/stock');
  browser.storage.set('authToken', 'new');
  complete({ status: 401, ok: false, json: async () => ({ error: 'Unauthorized' }) });
  await assert.rejects(pending);
  assert.equal(browser.storage.get('authToken'), 'new');
  assert.equal(browser.context.authRole, 'shop');
});

test('lost mutation responses warn about an unknown outcome rather than invite a duplicate retry', async () => {
  for (const fetch of [async () => { throw Error('dropped response'); }, async () => ({ status: 200, ok: true, json: async () => { throw Error('truncated JSON'); } })]) {
    const browser = client(fetch);
    await assert.rejects(browser.context.api('POST', '/api/shopexpenses', {}), error => {
      assert.match(error.message, /check (the )?result before retrying/i);
      assert.doesNotMatch(error.message, /try again/i);
      return true;
    });
  }
});

test('explicit operation IDs are sent as request keys', async () => {
  let headers;
  const browser = client(async (url, options) => { headers = options.headers; return { status: 200, ok: true, json: async () => ({ success: true }) }; });
  await browser.context.api('POST', '/api/stock/sell', {}, { operationId: 'stable-sale-request' });
  assert.equal(headers['Idempotency-Key'], 'stable-sale-request');
});


test('financial-only daily requests negotiate their contract and retain it during keyed retries', async () => {
  const headers = [];
  const browser = client(async (url, options) => { headers.push(options.headers); return { status: 200, ok: true, json: async () => ({ success: true }) }; });
  await browser.context.api('PUT', '/api/days/A/2026-11-10', {}, { manualVersion: '2' });
  const pending = {};
  await browser.context.keyedRequest(pending, 'save', 'owner-A', 'PUT', '/api/days/A/2026-11-10', {}, { manualVersion: '2' }).send();
  assert.equal(headers[0]['X-Stockly-Manual-Version'], '2');
  assert.equal(headers[1]['X-Stockly-Manual-Version'], '2');
});


test('integer-paisa cash formatting preserves the last paisa even at the exact supported limit', () => {
  const b = client(async () => {});
  assert.equal(b.context.pkrMinor(0), 'Rs 0.00'); assert.equal(b.context.pkrMinor(-1), 'Rs -0.01');
  assert.equal(b.context.pkrMinor(Number.MAX_SAFE_INTEGER), 'Rs 90,071,992,547,409.91');
  assert.throws(() => b.context.pkrMinor(0.3));
});
