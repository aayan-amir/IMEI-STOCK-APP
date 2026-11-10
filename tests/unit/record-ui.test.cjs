const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');
function screen() {
  const b = browserContext(); for (const file of ['globals', 'utils', 'imei', 'daily', 'ceo']) b.load(`public/js/${file}.js`);
  const s = b.context; s.authRole = 'admin'; s.authShop = null; s.activeShop = 'A'; s.SHOPS = ['A', 'B']; s.localStorage.setItem('clientId', 'account'); s.showToast = () => {};
  s.document.getElementById('hist-shop').value = 'ALL'; return s;
}
const row = id => ({ _id: id, id, shop: 'A', date: '2026-11-09', status: 'open', revision: 1, type: 'daily', period: '2026-11-09', data: { totalSales: 0.3 }, history: [], action: 'stock_add', details: { model: id }, ts: '2026-11-09T00:00:00.000Z' });
const page = (id, nextCursor = null) => ({ items: [row(id)], nextCursor, hasMore: !!nextCursor, total: 200 });
for (const [name, load, pager, state, render, body] of [
  ['history', 'loadAllDays', 'historyPager', 'allDays', 'renderHistory', 'hist-body'],
  ['reports', 'loadReports', 'reportPager', 'allReports', 'renderReports', 'reports-body'],
  ['logs', 'loadLogs', 'logPager', 'allLogsData', 'renderLogs', 'logs-body'],
]) {
  test(`${name} pages replace rows, retain good data on failure and reject stale account responses`, async () => {
    const s = screen(); let release; s.api = () => new Promise(resolve => { release = resolve; }); const old = s[load]();
    s.localStorage.setItem('clientId', 'other'); s.api = async (_method, url) => page(url.includes('cursor=next') ? 'next-record' : 'current-record', 'next'); await s[load]();
    release(page('old-record')); await old; assert.equal(s[state][0]._id, 'current-record');
    await s[pager].next(); assert.equal(s[state].length, 1); assert.equal(s[state][0]._id, 'next-record');
    s.api = async () => { throw Error('offline'); }; assert.equal(await s[pager].previous(), false); assert.equal(s[state][0]._id, 'next-record');
    s.localStorage.setItem('clientId', 'third'); s[render](); assert.doesNotMatch(s.document.getElementById(body).innerHTML, /next-record/);
  });
}
test('history cards do not turn stale open-day draft rows into reported financial totals', async () => {
  const s = screen(); s.api = async () => ({ ...page('one'), items: [{ ...row('one'), cats: { EXTRA: { rows: [{ soldFor: 999 }] } } }] });
  await s.loadAllDays(); const html = s.document.getElementById('hist-body').innerHTML;
  assert.doesNotMatch(html, /999/); assert.match(html, /Open full day/i);
});
test('history and log printing request complete exports and preserve unknown draft totals', async () => {
  const s = screen(), calls = [];
  s.api = async (_method, url) => { calls.push(url); return { complete: true, total: 2, items: [row('loaded'), row('unloaded')] }; };
  let outputs = []; s.printSection = (_title, html) => { outputs.push(html); };
  await s.printHistory(); await s.printLogs();
  assert.ok(calls.every(url => url.includes('/export?'))); assert.match(outputs[0], /Open full day/); assert.match(outputs[1], /unloaded/);
});
test('cached report output and deletion cannot cross report-page ownership', async () => {
  const s = screen(); s.api = async () => page('one'); await s.loadReports(); s.localStorage.setItem('clientId', 'other');
  let outputs = 0, mutations = 0; s.dlCSV = () => { outputs++; }; s.printSection = () => { outputs++; }; s.confirmModal = async () => true;
  s.api = async method => { if (method === 'DELETE') mutations++; return {}; };
  s.printReport('one'); s.exportReportCSV('one'); assert.equal(await s.deleteReport('one'), false);
  assert.equal(outputs, 0); assert.equal(mutations, 0);
});
test('record JSON exports include full retained data and remain separate from recovery backups', async () => {
  const s = screen(); let exported, downloaded = 0;
  s.api = async () => ({ complete: true, total: 1, items: [{ ...row('one'), history: [{ data: { oldTotal: 0.2 } }] }] });
  s.Blob = class { constructor(parts) { exported = JSON.parse(parts.join('')); } };
  s.URL = { createObjectURL() { downloaded++; return 'blob:test'; }, revokeObjectURL() {} };
  s.document.createElement = () => ({ click() {}, remove() {} }); s.document.body = { appendChild() {} };
  await s.exportRecordsJSON(s.reportPager, 'reports');
  assert.equal(downloaded, 1); assert.equal(exported.format, 'stockly-record-export'); assert.equal(exported.items[0].history[0].data.oldTotal, 0.2);
  let release; s.api = () => new Promise(resolve => { release = resolve; });
  const pending = s.exportRecordsJSON(s.reportPager, 'reports'); s.localStorage.setItem('clientId', 'changed');
  release({ complete: true, total: 1, items: [row('old-account')] }); await pending;
  assert.equal(downloaded, 1);
});
