const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');
function screen() {
  const b = browserContext(); for(const file of ['globals', 'utils', 'imei', 'daily', 'ceo']) b.load('public/js/' + file + '.js');
  const s = b.context; s.authRole = 'admin'; s.activeShop = 'A'; s.localStorage.setItem('clientId', 'movement-owner'); s.showToast = () => {};
  s.document.getElementById('ship-shop-filter').value = 'A'; s.document.getElementById('ship-month-filter').value = '2026-11'; return s;
}
const row = id => ({ _id: id, id, source: 'dispatch', date: '2026-11-10', toShop: 'A', items: [{ imei: '001234567890123', brand: 'Test', model: id, buyPrice: 0, notes: '<private-note>' }] });
const page = id => ({ items: [row(id)], total: 20, hasMore: false, nextCursor: null });

test('movement loading uses one bounded server-filtered page and rejects an old account response', async () => {
  const s = screen(), calls = []; let release;
  s.api = (method, url) => { calls.push(url); if (!url.startsWith('/api/v2/movements?')) throw Error('Expected bounded movement API'); return new Promise(resolve => { release = resolve; }); }; const old = s.loadShipments();
  s.localStorage.setItem('clientId', 'new-owner'); s.api = async (_method, url) => { calls.push(url); return page('new-record'); }; await s.loadShipments();
  release(page('old-record')); await old;
  assert.equal(s.allMovementData[0].id, 'new-record'); assert.ok(calls.every(url => url.startsWith('/api/v2/movements?') && url.includes('shop=A') && url.includes('month=2026-11')));
  assert.doesNotMatch(s.document.getElementById('ship-body').innerHTML, /old-record/);
});

test('movement cards do not render every nested phone before expansion or claim a current sale came from a particular old dispatch', async () => {
  const s = screen(); s.api = async () => page('retained'); await s.loadShipments(); const html = s.document.getElementById('ship-body').innerHTML;
  assert.match(html, /<details/); assert.doesNotMatch(html, /001234567890123/); assert.doesNotMatch(html, /Sold from this shipment/);
  const output = { innerHTML: '' }, details = { open: true, dataset: { movementId: 'retained', movementSource: 'dispatch' }, querySelector: () => output };
  s.showMovementItems(details); assert.match(output.innerHTML, /001234567890123/); assert.match(output.innerHTML, /Rs 0.00/); assert.match(output.innerHTML, /&lt;private-note&gt;/);
});

test('movement print exports all matching records and item metadata instead of cloning the loaded page', async () => {
  const s = screen(), calls = []; let output;
  s.api = async (_method, url) => { calls.push(url); return url.includes('/export?') ? { complete: true, total: 2, items: [row('loaded'), row('unloaded')] } : page('loaded'); };
  s.printSection = (_title, html) => { output = html; }; await s.loadShipments(); await s.printShipments();
  assert.ok(calls.some(url => url.includes('/api/v2/movements/export?'))); assert.match(output, /unloaded/); assert.match(output, /001234567890123/); assert.doesNotMatch(output, /ontoggle=/);
});

test('a failed complete movement export does not print a truncated success', async () => {
  const s = screen(); let printed = false; s.api = async () => ({ complete: false, total: 20, items: [row('only-page')] }); s.printSection = () => { printed = true; };
  assert.equal(await s.printShipments(), false); assert.equal(printed, false);
});


test('malformed legacy movement items stay visible as review issues without inventing a zero authoritative cost', () => {
  const s = screen(); const html = s.movementItemsHTML([null, { imei: '001234567890123', buyPrice: 'invalid', costPerUnit: 0 }]);
  assert.match(html, /needs review/); assert.match(html, /Cost unavailable/); assert.doesNotMatch(html, /Rs 0.00/);
});


test('shop bootstrap keeps explicit all-movement and warehouse-inbound destinations', () => {
  const b = browserContext(); for(const name of ['globals','utils','auth']) b.load('public/js/' + name + '.js'); const s = b.context;
  s.document.querySelector = () => null; s.document.getElementById('auth-shop-grid').appendChild = () => {};
  const create = s.document.createElement.bind(s.document); s.document.createElement = tag => { const node = create(tag); node.setAttribute = () => {}; return node; };
  for(const id of ['log-shop','rpt-shop','sl-shop','exp-shop-filter','hist-shop','ship-shop-filter','monthly-shop','fSoldByShop']) s.document.getElementById(id).options = [];
  s.currentClientShops = [{ id: 'A', name: 'Shop A' }, { id: 'B', name: 'Shop B' }]; s.renderDynamicShops();
  const html = s.document.getElementById('ship-shop-filter').innerHTML; assert.match(html, /value="ALL"/); assert.match(html, /value="HQ"/); assert.match(html, /value="A"/);
});
