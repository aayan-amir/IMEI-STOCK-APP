const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../../app');
const { readRuntimeConfig } = require('../../config/runtime');
const { withApp } = require('../helpers/http.cjs');

function app(readyState = 0) {
  return createApp({ config: readRuntimeConfig({}), database: { mongoose: { connection: { readyState } } } });
}

test('liveness is independent of database readiness with a generated request ID', async () => {
  await withApp(app(), async request => {
    const live = await request('/health/live');
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { status: 'ok' });
    assert.match(live.headers.get('x-request-id'), /^[a-f0-9-]{36}$/);
    const ready = await request('/health/ready');
    assert.equal(ready.status, 503);
    assert.deepEqual(await ready.json(), { status: 'unavailable' });
    const api = await request('/api/stock');
    assert.equal(api.status, 503);
  });
});

test('static frontend is available while database is down and localhost stays local', async () => {
  await withApp(app(), async request => {
    const page = await request('/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /stock-ly/i);
  });
});

test('CORS permits same-origin and configured native origin, not arbitrary sites', async () => {
  await withApp(app(), async (request, base) => {
    for (const origin of [base, 'capacitor://localhost']) {
      const response = await request('/health/live', { headers: { Origin: origin } });
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
    }
    const response = await request('/health/live', { headers: { Origin: 'https://unlisted.example' } });
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });
});

test('invalid JSON and unknown API paths have safe JSON errors and request IDs', async () => {
  await withApp(app(1), async request => {
    const bad = await request('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(bad.status, 400);
    const error = await bad.json();
    assert.equal(error.code, 'INVALID_JSON');
    assert.equal(error.requestId, bad.headers.get('x-request-id'));
    const missing = await request('/api/unknown');
    assert.equal(missing.status, 401, 'unrecognized protected path still requires identity');
  });
});
