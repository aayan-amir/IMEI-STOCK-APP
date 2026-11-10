const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');
function screen() {
  const browser = browserContext(); for (const f of ['globals', 'utils', 'imei', 'daily', 'ceo']) browser.load(`public/js/${f}.js`);
  const s = browser.context; s.localStorage.setItem('clientId', 'account'); s.authRole = 'admin'; s.authShop = null; s.activeShop = 'A'; s.showToast = () => {}; s.showModal = () => {}; s.closeModal = () => {};
  return s;
}
const row = id => ({ _id: id, id, name: 'Cable', quantity: 2, buyPrice: 0.1, revision: 3, shop: 'A' });
const page = (id, nextCursor = null) => ({ items: [row(id)], total: 100, hasMore: !!nextCursor, nextCursor });
for (const [name, load, pager, state, prefix] of [['contacts', 'loadContacts', 'contactPager', 'allContacts', 'contacts'], ['products', 'loadProducts', 'productPager', 'allProducts', 'products']]) {
  test(`${name} replace bounded pages and preserve the last good page after failure`, async () => {
    const s = screen(), calls = []; s.api = async (_method, url) => { calls.push(url); return page(url.includes('cursor=next') ? 'two' : 'one', 'next'); };
    await s[load](); assert.match(calls[0], /\/api\/v2\//); assert.match(calls[0], /limit=50/);
    assert.match(s.document.getElementById(`${prefix}-status`).textContent, /1.*100/);
    await s[pager].next(); assert.equal(s[state][0]._id, 'two');
    s.api = async () => { throw Error('offline'); }; assert.equal(await s[pager].previous(), false); assert.equal(s[state][0]._id, 'two');
  });
  test(`${name} reject superseded account responses and hide stale re-renders`, async () => {
    const s = screen(); let release; s.api = () => new Promise(resolve => { release = resolve; }); const old = s[load]();
    s.localStorage.setItem('clientId', 'other'); s.api = async () => page('new'); await s[load](); release(page('old')); await old;
    assert.equal(s[state][0]._id, 'new');
    s.localStorage.setItem('clientId', 'third'); s[name === 'contacts' ? 'renderContacts' : 'renderProducts']();
    assert.doesNotMatch(s.document.getElementById(name === 'contacts' ? 'contacts-body' : 'productList').innerHTML, /onclick=.*new/);
  });
}
test('contact print and product CSV fetch complete exports rather than the loaded page', async () => {
  const s = screen(), calls = []; s.allContacts = [row('loaded')]; s.allProducts = [row('loaded')];
  s.api = async (_method, url) => { calls.push(url); return { items: [{ ...row('one'), name: 'First' }, { ...row('two'), name: 'Unloaded' }], complete: true, total: 2 }; };
  let printed, csv; s.printSection = (_title, html) => { printed = html; }; s.dlCSV = value => { csv = value; };
  await s.printContacts(); await s.exportProductsCSV();
  assert.ok(calls.every(url => url.includes('/export?'))); assert.match(printed, /Unloaded/); assert.match(csv, /Unloaded/);
});
test('contact deletion cannot use an old page after search changes or an account switch during confirmation', async () => {
  const s = screen(); s.api = async () => page('one'); await s.loadContacts(); let deletes = 0;
  s.api = async method => { if (method === 'DELETE') deletes++; return {}; }; s.confirmModal = async () => true;
  s.document.getElementById('contact-search').value = 'new search'; assert.equal(await s.deleteContact('one'), false);
  s.document.getElementById('contact-search').value = '';
  s.confirmModal = async () => { s.localStorage.setItem('clientId', 'changed'); return true; };
  assert.equal(await s.deleteContact('one'), false); assert.equal(deletes, 0);
});
test('product edits capture the loaded revision and cannot open stale page data after a shop switch', async () => {
  const s = screen(); s.api = async () => page('one'); await s.loadProducts();
  s.editProductQty('one', 'Cable', 2); s.document.getElementById('ep-qty').value = '3';
  let revision; s.api = async (_method, _url, body) => { revision = body.expectedRevision; throw Error('offline'); };
  await s.saveProductQty('one'); assert.equal(revision, 3);
  s.activeShop = 'B'; let opened = false; s.showModal = () => { opened = true; }; s.editProductQty('one', 'Cable', 2); assert.equal(opened, false);
});
test('product deletion confirmation is invalidated by a changed search page', async () => {
  const s = screen(); s.api = async () => page('one'); await s.loadProducts();
  let deletes = 0; s.api = async method => { if (method === 'DELETE') deletes++; return { success: true }; };
  s.confirmModal = async () => { s.document.getElementById('products-search').value = 'other'; return true; };
  assert.equal(await s.deleteProduct('one'), false); assert.equal(deletes, 0);
});
test('product CSV keeps formula-like names and notes as literal text while preserving numeric values', async () => {
  const s = screen(); s.api = async () => ({ complete: true, total: 1, items: [{ ...row('one'), name: '=1+1', notes: '\t @SUM(1,1)', buyPrice: 0 }] });
  let csv; s.dlCSV = value => { csv = value; }; await s.exportProductsCSV();
  assert.match(csv, /"'=1\+1"/); assert.match(csv, /"'\t @SUM\(1,1\)"/); assert.match(csv, /"2","0","3"/);
});
test('malformed pager cursors cannot replace an already loaded catalog page', async () => {
  const s = screen(); s.api = async () => page('old', 'next'); await s.loadContacts();
  s.api = async () => ({ ...page('bad'), hasMore: true, nextCursor: { unexpected: true } });
  assert.equal(await s.loadContacts(), false); assert.equal(s.allContacts[0]._id, 'old');
});
