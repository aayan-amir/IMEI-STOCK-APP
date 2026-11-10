const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { browserContext } = require('../helpers/browser.cjs');

test('six sidebar destinations retain every workflow in contextual navigation', () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const sidebar = html.slice(html.indexOf('<div id="sb">'), html.indexOf('<div class="sb-stats">'));
  const labels = [...sidebar.matchAll(/data-section="[^"]+"[^>]*>([^<]+)<\/button>/g)].map(row => row[1]);
  assert.deepEqual(labels, ['Overview', 'Stock', 'Sales', 'Daily Close', 'Reports', 'Settings']);
  for (const page of ['scan','imeistock','saleslog','stock','expenses','history','ceo','warehouse','shipments','monthly','analytics','contacts','reports','logs','backup','stocktakes']) {
    assert.equal((html.match(new RegExp('id="ni-' + page + '"', 'g')) || []).length, 1, page);
  }
  assert.ok(!sidebar.includes('Barcode Scanner'));
  assert.ok(html.includes('aria-label="Stock sections"'));
});

test('legacy pages resolve to the correct primary destination', () => {
  const b = browserContext(); for (const file of ['globals', 'utils', 'ui']) b.load('public/js/' + file + '.js');
  const s = b.context;
  for (const [section, pages] of Object.entries({ overview:['ceo'], inventory:['scan','imeistock','warehouse','shipments','stocktakes'], sales:['saleslog','contacts'], daily:['stock','history','expenses'], reports:['monthly','reports','analytics'], settings:['backup','logs'] })) {
    for (const page of pages) assert.equal(s.workspaceForPage(page), section, page);
  }
});

test('shop mode keeps owner navigation restricted', () => {
  const source = fs.readFileSync('public/js/ceo.js', 'utf8');
  assert.match(source, /ADMIN_ONLY_PAGES/);
  assert.match(fs.readFileSync('public/index.html', 'utf8'), /data-admin-only="true"/);
});

test('context navigation highlights the parent and hides owner controls for staff', () => {
  const b = browserContext(); for (const file of ['globals', 'utils', 'ui']) b.load('public/js/' + file + '.js');
  const s = b.context;
  const button = dataset => ({ dataset, hidden: false, classes: {}, attributes: {},
    classList: { toggle(name, on) { this.owner.classes[name] = on; } },
    setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; }
  });
  const stock = button({ section: 'inventory' }), sales = button({ section: 'sales', adminOnly: 'true' });
  const scan = button({ workspacePage: 'scan' }), movement = button({ workspacePage: 'shipments', adminOnly: 'true' });
  for (const node of [stock, sales, scan, movement]) node.classList.owner = node;
  const groups = [{ dataset: { workspace: 'inventory' } }, { dataset: { workspace: 'sales' } }];
  s.document.querySelectorAll = selector => ({ '[data-section]': [stock, sales], '[data-workspace-page]': [scan, movement], '[data-workspace]': groups }[selector] || []);
  s.authRole = 'admin'; s.syncWorkspaceNavigation('shipments');
  assert.equal(stock.classes.on, true); assert.equal(movement.attributes['aria-current'], 'page');
  assert.equal(groups[0].hidden, false); assert.equal(groups[1].hidden, true);
  s.authRole = 'shop'; s.shopModeActive = true; s.syncWorkspaceNavigation('scan');
  assert.equal(sales.hidden, true); assert.equal(movement.hidden, true); assert.equal(scan.hidden, false);
  assert.equal(scan.attributes['aria-current'], 'page'); assert.equal(movement.attributes['aria-current'], undefined);
});

test('overview omits duplicate insights and printed summaries remain reports', () => {
  const source = fs.readFileSync('public/js/ceo.js', 'utf8');
  assert.equal(source.includes('Quick Insights'), false);
  assert.equal(source.includes('Invoice —'), false);
});
