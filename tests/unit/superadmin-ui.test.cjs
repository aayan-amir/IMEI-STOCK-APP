const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');

function node(tag = 'div') {
  let text = '';
  return { tagName: tag.toUpperCase(), children: [], events: {}, value: '', hidden: false, disabled: false, dataset: {},
    get textContent() { return text + this.children.map(n => n.textContent).join(''); },
    set textContent(value) { text = String(value); this.children = []; },
    append(...values) { this.children.push(...values); }, replaceChildren(...values) { text = ''; this.children = values; },
    addEventListener(name, callback) { this.events[name] = callback; }, setAttribute() {}, focus() {},
    click() { if (!this.disabled) return this.events.click?.({ preventDefault() {} }); },
    querySelectorAll() { return this.children.flatMap(child => [child, ...child.querySelectorAll()]).filter(n => n.tagName === 'BUTTON'); },
  };
}
const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
const client = { clientId: 'SHOP', status: 'active', shops: [{ id: 'ORIGINAL_ID', name: 'Original shop', color: '#16a34a' }] };
function ui(fetch) {
  const nodes = new Map(), listeners = new Map(), calls = [];
  const b = browserContext({ document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); }, createElement: node },
    fetch: async (url, options) => { calls.push({ url, options }); return fetch(url, options); },
    addEventListener: (event, callback) => listeners.set(event, callback), confirm: () => true,
  });
  b.storage.set('authToken', 'tenant-token'); b.storage.set('clientId', 'tenant-client');
  b.load('public/js/superadmin.js');
  const get = id => nodes.get('platform-' + id);
  const submit = id => get(id).events.submit({ preventDefault() {} });
  const login = () => { get('password').value = 'dummy-platform-secret'; return submit('login-form'); };
  const button = label => get('list').querySelectorAll().find(n => n.textContent === label);
  return { b, get, submit, login, button, calls, listeners };
}

test('platform verification gates management and uses no tenant authorization or persistent secret', async () => {
  let finish;
  const s = ui(url => url.endsWith('/verify') ? new Promise(resolve => { finish = resolve; }) : response([client]));
  const pending = s.login();
  assert.equal(s.get('management').hidden, true);
  finish(response({ ok: true })); await pending;
  assert.equal(s.get('management').hidden, false);
  assert.equal(s.get('password').value, '');
  assert.equal(s.calls[1].options.headers['X-Super-Admin-Password'], 'dummy-platform-secret');
  assert.ok(s.calls.every(c => !c.options.headers.Authorization && c.options.credentials === 'omit'));
  assert.equal(s.b.storage.size, 2); assert.equal(s.b.storage.get('authToken'), 'tenant-token');
});

test('late client responses cannot revive a signed-out platform page', async () => {
  let finish;
  const s = ui(url => url.endsWith('/verify') ? response({ ok: true }) : new Promise(resolve => { finish = resolve; }));
  const pending = s.login(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.get('fields').disabled, true);
  s.get('signout').click(); finish(response([client])); await pending;
  assert.equal(s.get('management').hidden, true); assert.equal(s.get('list').textContent, '');
  assert.equal(s.b.storage.get('authToken'), 'tenant-token');
});

test('client edits preserve shop identities and blank replacement passwords', async () => {
  const s = ui((url, options) => response(url.endsWith('/verify') ? { ok: true } : options.method === 'GET' ? [client] : { success: true }));
  await s.login(); s.button('Edit').click();
  assert.equal(s.get('client-id').readOnly, true);
  await s.submit('client-form');
  const write = s.calls.find(c => c.options.method === 'POST' && c.url.endsWith('/clients'));
  const body = JSON.parse(write.options.body);
  assert.equal(body.shops[0].id, 'ORIGINAL_ID'); assert.equal(body.adminPassword, ''); assert.equal(body.gatePassword, '');
});

test('uncertain writes require a refresh and duplicate submissions do not send another write', async () => {
  let fail;
  const s = ui((url, options) => options.method === 'GET' ? response([client]) : url.endsWith('/verify') ? response({ ok: true }) : new Promise((_resolve, reject) => { fail = reject; }));
  await s.login(); s.button('Edit').click();
  const pending = s.submit('client-form'); await s.submit('client-form');
  assert.equal(s.calls.filter(c => c.url.endsWith('/clients') && c.options.method === 'POST').length, 1);
  fail(Error('connection lost')); await pending;
  assert.equal(s.get('save').disabled, true); assert.match(s.get('status').textContent, /Refresh/);
  await s.get('refresh').click(); assert.equal(s.get('save').disabled, false);
});

test('wrong credentials, throttling and invalid acknowledgements never reveal management', async () => {
  for (const value of [response({ error: 'Forbidden' }, 403), response({}, 429), response({ ok: false })]) {
    const s = ui(() => value); await s.login();
    assert.equal(s.get('management').hidden, true); assert.ok(s.get('login-error').textContent);
  }
});

test('page teardown clears platform access while retaining the tenant session', async () => {
  const s = ui(url => response(url.endsWith('/verify') ? { ok: true } : [client]));
  await s.login(); s.listeners.get('pagehide')();
  assert.equal(s.get('management').hidden, true); assert.equal(s.get('list').textContent, '');
  s.listeners.get('pageshow')({ persisted: true });
  assert.equal(s.get('password').value, ''); assert.equal(s.b.storage.get('clientId'), 'tenant-client');
});

test('a verification finishing after page teardown cannot grant access', async () => {
  let finish;
  const s = ui(() => new Promise(resolve => { finish = resolve; }));
  const pending = s.login(); s.listeners.get('pagehide')();
  finish(response({ ok: true })); await pending;
  assert.equal(s.get('management').hidden, true); assert.equal(s.calls.length, 1);
});

test('cancelled updates send no mutation', async () => {
  const s = ui(url => response(url.endsWith('/verify') ? { ok: true } : [client]));
  await s.login(); s.button('Edit').click(); s.b.context.confirm = () => false;
  await s.submit('client-form'); assert.equal(s.calls.length, 2);
});

test('status conflicts require refresh and do not optimistically pause the client', async () => {
  const s = ui(url => url.endsWith('/status') ? response({ error: 'Refresh the client list.' }, 409) : response(url.endsWith('/verify') ? { ok: true } : [client]));
  await s.login(); await s.button('Pause').click();
  assert.equal(s.get('save').disabled, true); assert.match(s.get('list').textContent, /Active/);
  assert.match(s.get('status').textContent, /Refresh/);
  await s.get('refresh').click(); assert.equal(s.get('save').disabled, false);
});
