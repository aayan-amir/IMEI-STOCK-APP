/* ── Pure utility helpers (api, toast, formatting) ── */
/* Auto-split from index.html — 2026-04-25T15:26:28.692Z */

function $(id) { return document.getElementById(id); }
function toggleSidebar() {
  var sb = document.getElementById('sb');
  var ov = document.getElementById('sb-overlay');
  var open = sb.classList.toggle('sb-open');
  ov.classList.toggle('sb-open', open);
}
// ── MODAL MOVED TO UTILS.JS ──

function closeSidebar() {
  document.getElementById('sb').classList.remove('sb-open');
  document.getElementById('sb-overlay').classList.remove('sb-open');
}
let modalFocusOrigin = null;
let modalBackgroundState = null;
function showModal(html, wide = false) {
  var m = $('modal');
  if (!m) return;
  const background = $('modal-bg');
  if (!background?.classList.contains('open')) {
    modalFocusOrigin = document.activeElement;
    modalBackgroundState = ['wrap', 'topbar', 'auth-overlay', 'sb-overlay'].map(id => $(id)).filter(Boolean).map(node => [node, Boolean(node.inert)]);
    for (const [node] of modalBackgroundState) node.inert = true;
  }
  if (_confirmResolver) { const cancel = _confirmResolver; _confirmResolver = null; cancel(false); }
  m.innerHTML = html;
  m.style.maxWidth = wide ? '640px' : '520px';
  const heading = m.querySelector('h1,h2,h3,h4');
  background?.setAttribute('aria-label', heading?.textContent.trim() || 'Dialog');
  background?.classList.add('open');
  const focus = heading || m;
  focus.tabIndex = -1; focus.focus();
}
let _confirmResolver = null;

function confirmModal({ title = 'Confirm Action', message = 'Are you sure?', confirmText = 'Confirm', cancelText = 'Cancel', danger = true } = {}) {
  return new Promise((resolve) => {
    const btnClass = danger ? 'confirm-btn-danger' : 'confirm-btn-primary';
    const icon = danger ? '⚠️' : 'ℹ️';
    const html = `
      <div class="confirm-dialog">
        <h3 class="confirm-dialog-title"><span>${icon}</span> ${esc(title)}</h3>
        <div class="confirm-dialog-msg">${esc(message)}</div>
        <div class="confirm-dialog-actions">
          <button class="confirm-btn-cancel" onclick="_resolveConfirm(false)">${esc(cancelText)}</button>
          <button class="${btnClass}" onclick="_resolveConfirm(true)">${esc(confirmText)}</button>
        </div>
      </div>
    `;
    showModal(html, false);
    _confirmResolver = resolve;
  });
}

function _resolveConfirm(val) {
  const resolve = _confirmResolver;
  _confirmResolver = null;
  closeModal();
  if (resolve) resolve(Boolean(val));
}

function closeModal() { 
  $('modal-bg')?.classList.remove('open');
  if (_confirmResolver) {
    const fn = _confirmResolver;
    _confirmResolver = null;
    fn(false);
  }
  const origin = modalFocusOrigin; modalFocusOrigin = null;
  if (modalBackgroundState) for (const [node, inert] of modalBackgroundState) node.inert = inert;
  modalBackgroundState = null;
  if (origin?.isConnected && origin.getClientRects().length) origin.focus();
}

document.addEventListener('click', e => { if (e.target === $('modal-bg')) closeModal(); });

// ── Global Keyboard Shortcuts & Accessibility ──
document.addEventListener('keydown', e => {
  if (e.key === 'Tab' && $('modal-bg')?.classList.contains('open')) {
    const modal = $('modal');
    const controls = [...modal.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length);
    const first = controls[0], last = controls.at(-1), current = document.activeElement;
    if (!first) { e.preventDefault(); modal.focus(); }
    else if (!controls.includes(current) || (e.shiftKey ? current === first : current === last)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
  }
  if (e.key === 'Escape') {
    if (typeof closeCamera === 'function' && ((typeof camStream !== 'undefined' && camStream) || (typeof cameraOpening !== 'undefined' && cameraOpening))) {
      closeCamera();
    }
    closeModal();
    if (typeof hidePreview === 'function') hidePreview();
  }
  // Enable Enter / Space activation for role="button" elements
  if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.getAttribute && e.target.getAttribute('role') === 'button') {
    if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'A') {
      e.preventDefault();
      e.target.click();
    }
  }
});
function pkr(n) { return 'Rs ' + (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function pkrMinor(value) {
  if (!Number.isSafeInteger(value)) throw new RangeError('Invalid exact paisa amount');
  const amount = BigInt(value), absolute = amount < 0n ? -amount : amount;
  return 'Rs ' + (amount < 0n ? '-' : '') + (absolute / 100n).toLocaleString('en-PK') + '.' + String(absolute % 100n).padStart(2, '0');
}
function newRequestKey() {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}
function keyedRequest(pending, slot, scope, method, url, payload, options = {}) {
  const fingerprint = JSON.stringify({ scope, method, url, payload, options });
  let request = pending[slot];
  if (!request || request.fingerprint !== fingerprint) {
    request = { fingerprint, scope, key: newRequestKey() };
    pending[slot] = request;
  }
  return { request, send: async () => {
    const result = await api(method, url, payload, { ...options, operationId: request.key });
    const current = pending[slot] === request;
    if (current) delete pending[slot];
    return { result, current };
  } };
}
function fmtDate(iso) { if (!iso) return ''; var d = new Date(iso); return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }); }
function fmtBusinessInstant(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}
function esc(s) { if (s === null || s === undefined) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function escAttr(value) { return esc(value).replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
function titleCase(s) { return (s || '').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()); }
function fmtPhoneName(brand, model) { var b = titleCase(brand || 'Unknown'); var m = titleCase(model || ''); return esc((b + ' ' + m).trim()); }
function showToast(msg, type = 'success') { var t = $('toast'); t.textContent = msg; t.className = `show ${type}`; clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 3200); }
class ApiError extends Error {
  constructor(message, { status = 0, code = 'REQUEST_FAILED', fields, requestId } = {}) {
    super(message);
    this.name = 'ApiError';
    Object.assign(this, { status, code, fields, requestId });
  }
}

function handleApiError(error) {
  if (error.code !== 'REQUEST_ABORTED') showToast(error.message || 'Request failed', 'error');
  return false;
}

function expireSession(token) {
  if (!authRole || token !== localStorage.getItem('authToken')) return;
  if (typeof closeCamera === 'function') closeCamera();
  closeModal();
  if (typeof cancelPendingPrint === 'function') cancelPendingPrint();
  ['authToken', 'authRole', 'authShop'].forEach(key => localStorage.removeItem(key));
  authRole = null; authShop = null;
  if ($('topbar')) $('topbar').style.display = 'none';
  if ($('wrap')) $('wrap').style.display = 'none';
  $('auth-overlay')?.classList.remove('hidden');
  for (const [id, display] of [['auth-client', ''], ['auth-role', 'none']]) {
    if ($(id)) $(id).style.display = display;
  }
  if ($('auth-client-input')) $('auth-client-input').value = localStorage.getItem('clientId') || '';
  setTimeout(() => $('auth-gate-input-combined')?.focus(), 80);
}

async function _authPost(payload) {
  try { return await api('POST', '/api/auth', payload, { auth: false }); }
  catch (error) { return { ok: false, error: error.message, code: error.code, status: error.status }; }
}

async function api(method, url, body, options = {}) {
  const isMutation = !['GET', 'HEAD'].includes(method.toUpperCase());
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const token = options.auth === false ? null : localStorage.getItem('authToken');
  const headers = {};
  if (options.saleVersion === '2') headers['X-Stockly-Sale-Version'] = '2';
  if (options.manualVersion === '2') headers['X-Stockly-Manual-Version'] = '2';
  if (options.operationId) headers['Idempotency-Key'] = options.operationId;
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const opts = { method, headers, signal: controller.signal };
  try {
    if (body !== undefined) opts.body = JSON.stringify(body);
    const response = await fetch(BASE + url, opts);
    if (response.status === 401 && options.auth !== false) expireSession(token);
    let data;
    try { data = await response.json(); }
    catch {
      throw new ApiError(isMutation ? 'The change may have been saved; check the result before retrying.' : 'The server returned an invalid response. Try again.', { status: response.status, code: 'INVALID_RESPONSE' });
    }
    if (!response.ok || data?.error || data?.ok === false) {
      throw new ApiError(data?.error || (response.status === 401 ? 'Session expired — please sign in again' : 'Request failed'), {
        status: response.status, code: data?.code || 'HTTP_ERROR', fields: data?.fields,
        requestId: data?.requestId || response.headers?.get('x-request-id'),
      });
    }
    if (isMutation && data?.success !== true && data?.ok !== true) {
      throw new ApiError('The server did not acknowledge the change. Check the result before retrying.', { status: response.status, code: 'INVALID_RESPONSE' });
    }
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) throw new ApiError(timedOut ? 'Request timed out. Check the result before retrying.' : 'Request cancelled', { code: timedOut ? 'REQUEST_TIMEOUT' : 'REQUEST_ABORTED' });
    throw new ApiError(isMutation ? 'Connection lost. The change may have been saved; check the result before retrying.' : 'Connection failed. Check your connection and try again.', { code: 'NETWORK_ERROR' });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

function destructiveScope() { return JSON.stringify([listOwner(), localStorage.getItem('authToken'), activeShop, activePage, navigationVersion]); }
function listOwner() { return JSON.stringify([localStorage.getItem('clientId'), authRole, authShop]); }
function quoteCSVCell(value) {
  const text = String(value ?? '');
  const literal = typeof value === 'string' && /^[\s\u0000-\u001f]*[=+\-@]/u.test(text) ? "'" + text : text;
  return '"' + literal.replaceAll('"', '""') + '"';
}
function createListPager(config) {
  let generation = 0;
  const pager = { page: null, loading: false, scope: config.scope, query: config.query,
    isCurrent() { return pager.page?.scope === config.scope(); },
    draw() {
      $(`${config.prefix}-prev`).disabled = pager.loading || !pager.isCurrent() || !pager.page.previous.length;
      $(`${config.prefix}-next`).disabled = pager.loading || !pager.isCurrent() || !pager.page.nextCursor;
    },
    async load(options = {}) {
      const scope = config.scope(), request = ++generation;
      const current = () => scope === config.scope() && request === generation;
      pager.loading = true; pager.draw();
      if (!pager.isCurrent()) $(config.body).innerHTML = '<div class="empty" role="status">Loading…</div>';
      try {
        const query = config.query(); query.set('limit', '50'); if (options.cursor) query.set('cursor', options.cursor);
        const result = await api('GET', `${config.endpoint}?${query}`);
        if (!current()) return;
        if (!Array.isArray(result.items) || result.items.length > 50 || !Number.isSafeInteger(result.total) || result.total < result.items.length || typeof result.hasMore !== 'boolean' || (result.nextCursor !== null && typeof result.nextCursor !== 'string') || result.hasMore !== !!result.nextCursor) throw Error('Invalid list page. Refresh before continuing.');
        pager.page = { scope, cursor: options.cursor || null, previous: options.previous || [], nextCursor: result.nextCursor, total: result.total };
        config.onPage(result.items); config.render();
        $(`${config.prefix}-status`).textContent = '';
      } catch (error) {
        if (!current()) return;
        if (!pager.isCurrent()) $(config.body).innerHTML = '<div class="empty">Could not load this list. Refresh to retry.</div>';
        $(`${config.prefix}-status`).textContent = 'Could not load this page. Refresh to retry.';
        return handleApiError(error);
      } finally { if (current()) { pager.loading = false; pager.draw(); } }
    },
    next() { if (!pager.loading && pager.isCurrent() && pager.page.nextCursor) return pager.load({ cursor: pager.page.nextCursor, previous: [...pager.page.previous, pager.page.cursor] }); },
    previous() { if (!pager.loading && pager.isCurrent() && pager.page.previous.length) return pager.load({ cursor: pager.page.previous.at(-1), previous: pager.page.previous.slice(0, -1) }); },
    async exportAll() {
      const scope = config.scope();
      const result = await api('GET', `${config.endpoint}/export?${config.query()}`);
      if (scope !== config.scope()) return null;
      if (result.complete !== true || !Array.isArray(result.items) || result.items.length !== result.total) throw Error('Complete export was not acknowledged. Narrow the filters and retry.');
      return result.items;
    },
  };
  return pager;
}
function createRecordPager(resource, prefix, body, filters, onPage, render) {
  const query = () => { const value = new URLSearchParams(); for (const [key, id] of filters) { const text = $(id).value.trim(); if (text) value.set(key, text); } return value; };
  return createListPager({ endpoint: `/api/v2/${resource}`, prefix, body, query,
    scope: () => JSON.stringify([listOwner(), resource, query().toString()]), onPage, render });
}
async function exportRecordsJSON(pager, resource) {
  try {
    const filters = Object.fromEntries(pager.query()), items = await pager.exportAll(); if (!items) return;
    const data = { format: 'stockly-record-export', resource, filters, exportedAt: new Date().toISOString(), items };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `${resource}_${today()}.json`; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  } catch (error) { return handleApiError(error); }
}

// Clock
function tickClock() { var d = new Date(); $('clk').textContent = d.toLocaleDateString('en-GB') + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
setInterval(tickClock, 30000); tickClock();
