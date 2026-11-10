const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function browserContext(overrides = {}) {
  const nodes = new Map();
  const listeners = new Map();
  const storage = new Map();
  const document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, {
        value: '', textContent: '', innerHTML: '', style: {},
        classList: { add() {}, remove() {}, contains() { return false; } },
        isConnected: true, tabIndex: 0, attributes: {}, getClientRects() { return [{}]; },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return this.attributes[name] ?? null; },
        focus() {}, scrollIntoView() {}, querySelector() { return null; }, querySelectorAll() { return []; }, contains() { return false; },
      });
      return nodes.get(id);
    },
    addEventListener(event, callback) { listeners.set(event, callback); },
    querySelectorAll() { return []; },
    createElement() {
      return {
        set textContent(value) { this.innerHTML = String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); },
        innerHTML: '',
      };
    },
  };
  const location = { origin: 'http://localhost:3000', search: '' };
  const window = { location, innerWidth: 1280 };
  const context = vm.createContext({
    window, innerWidth: 1280, location, document, console, URL, URLSearchParams, AbortController,
    crypto: require('node:crypto').webcrypto,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
    setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    ...overrides,
  });
  context.window = context;
  return { context, nodes, listeners, storage, load(file) {
    if (file === 'public/js/globals.js' && !context.StocklyBusinessRules) {
      vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../public/js/business-rules.js'), 'utf8'), context);
    }
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8'), context, { filename: file });
  } };
}

module.exports = { browserContext };
