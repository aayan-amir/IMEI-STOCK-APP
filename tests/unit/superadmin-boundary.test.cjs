const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createApp } = require('../../app');
const { readRuntimeConfig } = require('../../config/runtime');
const { withApp } = require('../helpers/http.cjs');

const app = readyState => createApp({ config: readRuntimeConfig({}), database: { mongoose: { connection: { readyState } } } });

test('platform login is independent, uncached and not linked from customer pages', async () => {
  await withApp(app(0), async request => {
    for (const route of ['/superadmin', '/superadmin/']) {
      const response = await request(route);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.match(response.headers.get('x-robots-tag'), /noindex/);
      const html = await response.text();
      assert.ok(html.includes('id="platform-login"'));
      assert.ok(html.includes('id="platform-management" hidden'));
      assert.ok(!html.includes('/js/app.js'));
      assert.ok(!html.includes('/js/auth.js'));
    }
    const alias = await request('/superadmin.html', { redirect: 'manual' });
    assert.equal(alias.headers.get('location'), '/superadmin');
    for (const route of ['/', '/dashboard']) {
      const html = await (await request(route)).text();
      assert.ok(!html.includes('Manage Clients'));
      assert.ok(!html.includes('auth-superadmin'));
      assert.ok(!html.includes('href="/superadmin"'));
    }
  });
});

test('every platform operation rejects tenant credentials and query-string passwords', async () => {
  await withApp(app(1), async request => {
    for (const [method, route] of [['POST', '/verify'], ['GET', '/clients'], ['POST', '/clients'], ['POST', '/clients/dummy/status'], ['DELETE', '/clients/dummy']]) {
      const response = await request('/api/superadmin' + route + '?superAdminPassword=not-a-platform-password', {
        method, headers: { Authorization: 'Bearer dummy-tenant-token', 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      assert.equal(response.status, 403, method + route);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  });
});

test('dashboard browser code has no platform handlers or stale panel references', () => {
  for (const file of ['public/js/auth.js', 'public/js/app.js', 'public/js/utils.js']) {
    const source = fs.readFileSync(file, 'utf8');
    assert.ok(!source.includes('auth-superadmin'), file);
    assert.ok(!source.includes('verifySuperAdmin'), file);
    assert.ok(!source.includes('renderLockStatus'), file);
  }
});

test('repeated invalid platform credentials retain the server rate limit', async () => {
  await withApp(app(1), async request => {
    for (let attempt = 0; attempt < 25; attempt++) {
      const response = await request('/api/superadmin/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (response.status === 429) { assert.equal(response.headers.get('cache-control'), 'no-store'); return; }
      assert.equal(response.status, 403);
    }
    assert.fail('Expected the existing platform limiter to reject repeated attempts');
  });
});
