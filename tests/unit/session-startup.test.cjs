const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');

function startup() {
  const b = browserContext();
  for (const file of ['globals', 'utils']) b.load(`public/js/${file}.js`);
  const s = b.context;
  for (const [key, value] of Object.entries({ authToken: 'old-token', authRole: 'admin', clientId: 'test', clientShops: '[]' })) s.localStorage.setItem(key, value);
  for (const id of ['wrap', 'topbar']) s.document.getElementById(id).style.display = 'none';
  const classes = new Set();
  s.document.getElementById('auth-overlay').classList = { add: v => classes.add(v), remove: v => classes.delete(v), contains: v => classes.has(v) };
  for (const name of ['renderDynamicShops', 'nav', 'applyPhoneMode', 'switchShop', 'applyShopMode', 'syncWorkspaceNavigation', 'loadBusinessCapabilities']) s[name] = () => {};
  s.loadSidebarStats = async () => {}; s.loadIMEIData = async () => {};
  let resolve, reject;
  s.api = () => new Promise((a, b) => { resolve = a; reject = b; });
  b.load('public/js/app.js');
  return { s, resolve: value => resolve(value), reject: error => reject(error), classes };
}

test('saved sessions keep login visible until the server validates the token', async () => {
  const { s, resolve, classes } = startup();
  assert.equal(s.document.getElementById('wrap').style.display, 'none');
  assert.equal(classes.has('hidden'), false);
  resolve({ features: {} }); await s.startupPromise;
  assert.equal(s.document.getElementById('wrap').style.display, 'flex');
  assert.equal(classes.has('hidden'), true);
});

test('expired and unreachable sessions never expose the app shell', async () => {
  for (const status of [401, 503]) {
    const { s, reject, classes } = startup();
    if (status === 401) s.expireSession('old-token');
    reject(Object.assign(Error('Session check failed'), { status })); await s.startupPromise;
    assert.equal(s.document.getElementById('wrap').style.display, 'none');
    assert.equal(classes.has('hidden'), false);
  }
});

test('a delayed session check cannot boot after the account changes', async () => {
  const { s, resolve, classes } = startup();
  s.localStorage.setItem('authToken', 'new-token');
  s.localStorage.setItem('clientId', 'other');
  resolve({ features: {} }); await s.startupPromise;
  assert.equal(s.document.getElementById('wrap').style.display, 'none');
  assert.equal(classes.has('hidden'), false);
});
