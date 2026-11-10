const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');
function screen() {
  const b = browserContext();
  for (const file of ['globals', 'utils', 'ceo']) b.load(`public/js/${file}.js`);
  const s = b.context, messages = [], modals = [], downloads = [];
  s.authRole = 'admin'; s.localStorage.setItem('clientId', 'target'); s.localStorage.setItem('authToken', 'token');
  s.showToast = (message, type) => messages.push({ message, type });
  s.showModal = html => modals.push(html); s.closeModal = () => {};
  s.confirmModal = async () => true;
  s.downloadBackup = data => downloads.push(data);
  s.location.reload = () => { s.reloaded = true; };
  const file = { size: 100, text: async () => JSON.stringify({ version: 2, source: { clientId: 'source' }, collections: { HQStock: [] } }) };
  s.document.getElementById('restoreFile').files = [file];
  return { s, messages, modals, downloads };
}
function preview(id = 'review-plan') { return { success: true, ready: true, planId: id, checksum: 'a'.repeat(64), counts: { Phone: 1, Sale: 2, Product: 3 }, expiresAt: '2099-01-01T00:00:00.000Z' }; }
test('backup uses the complete versioned API and downloads the validated file', async () => {
  const { s, downloads } = screen(); let url;
  s.api = async (method, path) => { url = path; return { version: 3, validation: { ready: true } }; };
  await s.doBackup();
  assert.equal(url, '/api/backup?version=3');
  assert.equal(downloads.length, 1);
});
test('restore validates first and applies only the captured reviewed plan', async () => {
  const { s, modals } = screen(), calls = [];
  s.api = async (method, url, body) => { calls.push({ url, body }); return url.endsWith('validate') ? preview() : { success: true }; };
  await s.doRestore();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/restore/validate');
  assert.equal(calls[0].body.mode, 'empty');
  assert.match(modals[0], /empty account/i);
  await s.applyReviewedRestore();
  assert.equal(calls[1].url, '/api/restore/apply');
  assert.equal(calls[1].body.planId, 'review-plan');
  assert.match(calls[1].body.operationId, /^[a-f0-9-]{32,36}$/);
  assert.equal(s.reloaded, true);
});
test('unknown restore outcomes retain the reviewed operation key for retry', async () => {
  const { s } = screen(), keys = [];
  s.api = async (method, url, body) => { if (url.endsWith('validate')) return preview(); keys.push(body.operationId); throw Error('unknown response'); };
  await s.doRestore();
  await s.applyReviewedRestore(); await s.applyReviewedRestore();
  assert.ok(keys[0]); assert.equal(keys[1], keys[0]);
  assert.equal(s.reloaded, undefined);
});
test('conflicts never expose an apply action and oversized files are rejected before parsing', async () => {
  const { s, modals } = screen(); let calls = 0;
  s.api = async () => { calls++; return { success: true, ready: false, issues: [{ code: 'ACTIVE_SALE_LINK' }] }; };
  await s.doRestore();
  assert.doesNotMatch(modals[0], /onclick="applyReviewedRestore/);
  s.document.getElementById('restoreFile').files = [{ size: 9 * 1024 * 1024, text() { throw Error('must not parse'); } }];
  assert.equal(await s.doRestore(), false);
  assert.equal(calls, 1);
});
test('changing account or file invalidates a reviewed restore on the client', async () => {
  const { s } = screen(); let applies = 0;
  s.api = async (method, url) => { if (url.endsWith('validate')) return preview(); applies++; return { success: true }; };
  await s.doRestore();
  s.localStorage.setItem('clientId', 'different-target');
  assert.equal(await s.applyReviewedRestore(), false);
  assert.equal(applies, 0);
});


test('restore approval includes retained return, actual payment and counted cash evidence counts', async () => {
  const { s, modals } = screen(); s.api = async () => ({ ...preview(), counts: { CustomerReturn: 2, CashEntry: 3, CashCheckpoint: 4 } });
  await s.doRestore(); assert.match(modals[0], /Customer returns/); assert.match(modals[0], /Recorded payments/); assert.match(modals[0], /Cash counts/);
});
