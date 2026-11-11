const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../../app');
const { readRuntimeConfig } = require('../../config/runtime');
const { withApp } = require('../helpers/http.cjs');

function website(run) {
  return withApp(createApp({ config: readRuntimeConfig({}), database: { mongoose: { connection: { readyState: 0 } } } }), run);
}

test('the homepage is a public landing page without app startup or login fields', () => website(async request => {
  const response = await request('/');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes('href="/dashboard"'));
  assert.ok(!html.includes('id="auth-overlay"'));
  assert.ok(!html.includes('src="/js/app.js"'));
  assert.ok(html.includes('<main'));
}));

test('dashboard and trailing-slash dashboard serve the authenticated app shell without caching', () => website(async request => {
  for (const url of ['/dashboard', '/dashboard/']) {
    const response = await request(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const html = await response.text();
    assert.ok(html.includes('id="auth-overlay"'));
    assert.ok(html.includes('src="/js/app.js"'));
    assert.ok(html.includes('id="wrap" style="display:none;"'));
  }
}));

test('old index URLs redirect to dashboard and retain app mode parameters', () => website(async request => {
  for (const url of ['/index.html?mode=phone', '/dashboard/index.html?mode=phone']) {
    const response = await request(url, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/dashboard?mode=phone');
  }
}));

test('dashboard assets retain their original paths and API requests stay separate', () => website(async request => {
  const script = await request('/js/app.js');
  assert.equal(script.status, 200);
  assert.ok((await script.text()).includes('initializeApp'));
  assert.equal((await request('/css/landing.css')).status, 200);
  const response = await request('/api/stock');
  assert.equal(response.status, 503);
  assert.ok((await response.json()).error);
}));

test('installed web app launches dashboard while preserving its original identity', () => website(async request => {
  const manifest = await (await request('/manifest.json')).json();
  assert.equal(manifest.start_url, '/dashboard');
  assert.equal(manifest.id, '/');
}));
