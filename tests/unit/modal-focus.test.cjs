const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');
function screen() {
  const b = browserContext(); b.load('public/js/globals.js'); b.load('public/js/utils.js');
  const s = b.context, modal = s.document.getElementById('modal'), bg = s.document.getElementById('modal-bg'), names = new Map(), classes = new Set();
  bg.classList = { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) };
  bg.setAttribute = (key, value) => names.set(key, value);
  const node = name => ({ name, isConnected: true, tabIndex: 0, getClientRects: () => [{}], focus() { s.document.activeElement = this; }, setAttribute() {} });
  const origin = node('origin'), heading = { ...node('heading'), textContent: 'Reviewed count' }, first = node('first'), last = node('last');
  modal.querySelector = () => heading; modal.querySelectorAll = () => [first, last]; modal.contains = node => [heading, first, last].includes(node); modal.focus = () => { s.document.activeElement = modal; };
  s.document.activeElement = origin;
  return { s, b, names, origin, heading, first, last };
}

test('reviewed dialogs receive an accessible name and return focus to the launching control', () => {
  const { s, names, origin, heading } = screen(); s.showModal('<h3>Reviewed count</h3>');
  assert.equal(names.get('aria-label'), 'Reviewed count'); assert.equal(s.document.activeElement, heading);
  s.closeModal(); assert.equal(s.document.activeElement, origin);
});

test('Tab and Shift Tab stay inside an open dialog while Escape restores the original focus', () => {
  const { s, b, origin, first, last } = screen(); s.showModal('<h3>Reviewed count</h3>');
  const key = b.listeners.get('keydown'); let prevented = 0;
  key({ key: 'Tab', shiftKey: true, preventDefault() { prevented++; } }); assert.equal(s.document.activeElement, last);
  s.document.activeElement = last; key({ key: 'Tab', shiftKey: false, preventDefault() { prevented++; } });
  assert.equal(s.document.activeElement, first);
  key({ key: 'Tab', shiftKey: true, preventDefault() { prevented++; } }); assert.equal(s.document.activeElement, last); assert.equal(prevented, 3);
  key({ key: 'Escape' }); assert.equal(s.document.activeElement, origin);
});

test('replacing a confirmation cancels its old promise and explicit confirmation accepts the new action', async () => {
  const { s } = screen(); const pending = s.confirmModal({ title: 'Old destructive action' });
  s.showModal('<h3>New reviewed action</h3>'); assert.equal(await Promise.race([pending, new Promise(resolve => setImmediate(() => resolve('unsettled')))]), false);
  const held = s.confirmModal({ title: 'Legacy destructive action' }); s._resolveConfirm(true); assert.equal(await held, true);
});


test('the dialog makes background controls inert and restores their previous state on close', () => {
  const { s } = screen(), wrap = s.document.getElementById('wrap'), topbar = s.document.getElementById('topbar');
  wrap.inert = true; topbar.inert = false; s.showModal('<h3>Reviewed count</h3>');
  assert.equal(topbar.inert, true); s.showModal('<h3>Replaced reviewed count</h3>'); s.closeModal();
  assert.equal(wrap.inert, true); assert.equal(topbar.inert, false);
});


test('session expiry closes old business dialogs and makes the sign-in controls usable again', () => {
  const { s } = screen(); s.authRole = 'admin'; s.localStorage.setItem('authToken','expired-token'); s.showModal('<h3>Reviewed count</h3>');
  s.expireSession('expired-token'); assert.equal(s.document.getElementById('auth-overlay').inert, false);
  assert.equal(s.document.getElementById('modal-bg').classList.contains('open'), false);
});
