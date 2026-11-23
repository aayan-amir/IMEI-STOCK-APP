const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { browserContext } = require('../helpers/browser.cjs');

function sales(valid = true) {
  const b = browserContext({ addEventListener() {} });
  const form = b.context.document.getElementById('sales-form');
  let submit;
  form.addEventListener = (_event, callback) => { submit = callback; };
  form.reportValidity = () => valid;
  for (const [id, value] of Object.entries({ name: 'Aayan & team', shop: 'Phone #1', email: 'owner@example.com', count: '2–5 shops', message: 'Pricing?\nA & B' })) {
    b.context.document.getElementById('sales-' + id).value = value;
  }
  b.load('public/js/landing.js');
  return { b, submit: () => submit({ preventDefault() {} }) };
}

test('sales enquiry composes the correct email without claiming submission', () => {
  const { b, submit } = sales(); submit();
  const url = new URL(b.context.location.href);
  assert.equal(url.protocol, 'mailto:'); assert.equal(url.pathname, 'ayanwork1@gmail.com');
  assert.equal(url.searchParams.get('subject'), 'Stock-ly sales enquiry — Phone #1');
  assert.match(url.searchParams.get('body'), /Name: Aayan & team/);
  assert.match(url.searchParams.get('body'), /Pricing\?\nA & B/);
  assert.match(b.context.document.getElementById('sales-status').textContent, /Continue in your email app/);
  assert.equal(b.storage.size, 0);
});

test('invalid enquiry details do not launch an email', () => {
  const { b, submit } = sales(false); submit();
  assert.equal(b.context.location.href, undefined);
});

test('landing page includes accessible sales details and keeps platform administration private', () => {
  const html = fs.readFileSync('public/landing.html', 'utf8');
  assert.ok(html.includes('mailto:ayanwork1@gmail.com'));
  assert.ok(html.includes('Opens your email app'));
  assert.ok(!html.includes('/superadmin'));
  for (const id of ['name', 'shop', 'email', 'count', 'message']) assert.ok(html.includes(`for="sales-${id}"`));
});
