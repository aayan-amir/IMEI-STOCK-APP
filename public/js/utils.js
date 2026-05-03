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
function showModal(html, wide = false) { 
  var m = $('modal');
  if (!m) return;
  m.innerHTML = html; 
  m.style.maxWidth = wide ? '640px' : '520px'; 
  $('modal-bg')?.classList.add('open'); 
}
function closeModal() { $('modal-bg')?.classList.remove('open'); }
document.addEventListener('click', e => { if (e.target === $('modal-bg')) closeModal(); });
function pkr(n) { return 'Rs ' + (Number(n) || 0).toLocaleString('en-PK'); }
function fmtDate(iso) { if (!iso) return ''; var d = new Date(iso); return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }); }
function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function titleCase(s) { return (s || '').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()); }
function fmtPhoneName(brand, model) { var b = titleCase(brand || 'Unknown'); var m = titleCase(model || ''); return esc((b + ' ' + m).trim()); }
function showToast(msg, type = 'success') { var t = $('toast'); t.textContent = msg; t.className = `show ${type}`; clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 3200); }
async function _authPost(payload) {
  try {
    const r = await fetch(BASE + '/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return await r.json();
  } catch (e) { return { ok: false, error: 'Connection failed' }; }
}
async function api(method, url, body) {
  var opts = { method, headers: { 'Content-Type': 'application/json' } };
  var tok = localStorage.getItem('authToken');
  if (tok) opts.headers['Authorization'] = 'Bearer ' + tok;
  var clientId = localStorage.getItem('clientId');
  if (clientId) opts.headers['X-Client-ID'] = clientId;
  if (body) opts.body = JSON.stringify(body);
  try {
    var r = await fetch(BASE + url, opts);
    if (r.status === 401) {
      console.warn(`[401] URL: ${url} | authRole: ${authRole}`);
      // Only treat as session expiry if we actually had a session
      if (authRole) {
        localStorage.removeItem('authToken'); localStorage.removeItem('authRole'); localStorage.removeItem('authShop');
        authRole = null; authShop = null;
        $('auth-overlay').classList.remove('hidden');
        $('auth-client').style.display = 'none';
        $('auth-gate').style.display = '';
        $('auth-role').style.display = 'none';
        showToast('Session expired — please sign in again', 'warn');
      }
      return {};
    }
    try { return await r.json(); } catch (e) { return {}; }
  } catch (e) { return {}; }
}

// Clock
function tickClock() { var d = new Date(); $('clk').textContent = d.toLocaleDateString('en-GB') + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
setInterval(tickClock, 30000); tickClock();
