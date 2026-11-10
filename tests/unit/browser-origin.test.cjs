const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');

for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://example.com']) {
  test(`browser stays on its own API origin: ${origin}`, () => {
    const browser = browserContext();
    browser.context.location.origin = origin;
    browser.load('public/js/globals.js');
    assert.equal(browser.context.BASE, origin);
  });
}

test('native application uses explicitly configured HTTPS API origin', () => {
  const browser = browserContext();
  browser.context.window.Capacitor = { isNativePlatform: () => true };
  browser.context.window.STOCKLY_CONFIG = { nativeApiBase: 'https://api.example.com' };
  browser.load('public/js/globals.js');
  assert.equal(browser.context.BASE, 'https://api.example.com');
});

test('native app rejects missing or cleartext API configuration', () => {
  for (const nativeApiBase of [undefined, 'http://example.com', 'https://example.com/path']) {
    const browser = browserContext();
    browser.context.window.Capacitor = { isNativePlatform: () => true };
    browser.context.window.STOCKLY_CONFIG = { nativeApiBase };
    assert.throws(() => browser.load('public/js/globals.js'), /native API origin/);
  }
});
