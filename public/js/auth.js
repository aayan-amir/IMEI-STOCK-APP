/* ── Tenant Auth, Session, Dynamic Shops ── */
/* Auto-split from index.html — 2026-04-25T15:26:28.701Z */

// ── RATE LIMITING ──
var _RL_MAX = 5;
var _RL_MS  = 30 * 60 * 1000;
var _RL_MSG = 'Too many failed attempts. Contact 03043648597 to reset your password.';
var _rlCache = Object.create(null);

function _rlGet(key) {
  if (_rlCache[key]) return _rlCache[key];
  let data = { n: 0, until: 0 };
  try {
    const raw = localStorage.getItem('rl_' + key);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      data = { n: Number(parsed.n) || 0, until: Number(parsed.until) || 0 };
    }
  } catch (e) { data = { n: 0, until: 0 }; }
  _rlCache[key] = data;
  return data;
}
function _rlFail(key) {
  var d = _rlGet(key);
  if (d.until && Date.now() < d.until) return;
  d.n = (d.n || 0) + 1;
  if (d.n >= _RL_MAX) d.until = Date.now() + _RL_MS;
  localStorage.setItem('rl_' + key, JSON.stringify(d));
  _rlCache[key] = d;
}
function _rlClear(key) { localStorage.removeItem('rl_' + key); delete _rlCache[key]; }
function _rlLocked(key) { var d = _rlGet(key); return d.until && Date.now() < d.until; }
function _rlTimeLeft(key) { var d = _rlGet(key); return (!d.until || Date.now() >= d.until) ? 0 : d.until - Date.now(); }
function _rlRemaining(key) { var d = _rlGet(key); return _rlLocked(key) ? 0 : Math.max(0, _RL_MAX - (d.n || 0)); }
function _rlLockedMsg(key) {
  var mins = Math.ceil(_rlTimeLeft(key) / 60000);
  return 'Too many failed attempts. Try again in ' + mins + ' minute' + (mins !== 1 ? 's' : '') + '. Contact 03043648597 to reset.';
}
function _rlErrMsg(key, defaultMsg) {
  if (_rlLocked(key)) return _rlLockedMsg(key);
  var rem = _rlRemaining(key);
  if (rem > 0 && rem <= 2) return defaultMsg + ' ' + rem + ' attempt' + (rem !== 1 ? 's' : '') + ' remaining.';
  return defaultMsg;
}

var _RL_LOCK_LABELS = { client: 'Client Login', gate: 'Gate Password', admin: 'Admin Login' };

// ── AUTH CHECK ──
// --- Client Multi-Tenant Logic ---
var currentClientId = localStorage.getItem('clientId') || '';
var currentClientShops = JSON.parse(localStorage.getItem('clientShops') || '[]');

async function checkClientAndGate() {
  if (_rlLocked('client')) {
    $('auth-client-err').textContent = _rlLockedMsg('client');
    $('auth-client-err').style.display = 'block';
    return;
  }
  const id = $('auth-client-input').value.trim();
  const pw = $('auth-gate-input-combined').value;
  if (!id || !pw) { $('auth-client-err').textContent = 'Please enter both Client ID and password.'; $('auth-client-err').style.display = 'block'; return; }
  try {
    const res = await fetch(BASE + '/api/clients/lookup?clientId=' + encodeURIComponent(id));
    const data = await res.json();
    if (!res.ok) { 
      $('auth-client-err').textContent = data.error || 'Client not found.'; 
      $('auth-client-err').style.display = 'block'; 
      return; 
    }
    // Verify gate password
    const gateRes = await _authPost({ type: 'gate', password: pw, clientId: id });
    if (!gateRes.ok) {
      _rlFail('client');
      $('auth-client-err').textContent = _rlErrMsg('client', gateRes.error || 'Incorrect site password.');
      $('auth-client-err').style.display = 'block'; 
      return; 
    }
    // Success — store client and move to role selection
    _rlClear('client');
    currentClientId = id;
    currentClientShops = data.shops || [];
    localStorage.setItem('clientId', currentClientId);
    localStorage.setItem('clientShops', JSON.stringify(currentClientShops));
    _pendingGatePassword = pw;
    $('auth-client-err').style.display = 'none';
    $('auth-client').style.display = 'none';
    $('auth-role').style.display = '';
    renderDynamicShops();
    setTimeout(() => $('auth-admin-input')?.focus(), 80);
  } catch (err) {
    console.error('Login error:', err);
    $('auth-client-err').textContent = 'Cannot reach server. Check your connection.';
    $('auth-client-err').style.display = 'block';
  }
}

function renderDynamicShops() {
  const tabsContainer = document.querySelector('.shop-tabs');
  const authGrid = document.getElementById('auth-shop-grid');
  if (tabsContainer) tabsContainer.innerHTML = '';
  if (authGrid) authGrid.innerHTML = '';

  if (currentClientShops.length === 0) {
    if (authGrid) authGrid.innerHTML = '<div style="grid-column:1/-1;color:var(--text3);font-size:.7rem;text-align:center;padding:10px;">No shops configured for this client.</div>';
  }

  // Reset global arrays/maps
  SHOPS = currentClientShops.map(s => s.id);
  SHOP_COLOR = { 'HQ': 'var(--chq)' };
  SHOP_RGBA = { 'HQ': '2,132,199' };

  if (!activeShop && SHOPS.length > 0) activeShop = SHOPS[0];

  let styleSheet = document.getElementById('dynamic-shop-colors');
  if (!styleSheet) {
    styleSheet = document.createElement('style');
    styleSheet.id = 'dynamic-shop-colors';
    document.head.appendChild(styleSheet);
  }
  let css = '';

  currentClientShops.forEach(s => {
    const hex = s.color || '#16a34a';
    SHOP_COLOR[s.id] = hex;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    SHOP_RGBA[s.id] = `${r},${g},${b}`;

    if (tabsContainer) {
      const div = document.createElement('div');
      div.className = 'stab' + (s.id === activeShop ? ' on' : '');
      div.setAttribute('data-s', s.id);
      div.onclick = () => switchShop(s.id);
      div.textContent = s.name || s.id;
      tabsContainer.appendChild(div);
    }

    if (authGrid) {
      const btn = document.createElement('button');
      btn.className = 'auth-shop-btn';
      btn.setAttribute('data-s', s.id);
      btn.onclick = () => enterShopMode(s.id);
      btn.textContent = s.name || s.id;
      authGrid.appendChild(btn);
    }

    css += `
      :root { --c${s.id}: ${hex}; }
      .stab[data-s="${s.id}"].on { background: rgba(${SHOP_RGBA[s.id]},.18); border-color: rgba(${SHOP_RGBA[s.id]},.35); color: ${hex}; }
      .auth-shop-btn[data-s="${s.id}"]:hover, .auth-shop-btn[data-s="${s.id}"]:active { border-color: var(--c${s.id}); color: var(--c${s.id}); background: rgba(${SHOP_RGBA[s.id]},.06); }
    `;
  });

  styleSheet.innerHTML = css;

  const selects = ['log-shop', 'rpt-shop', 'sl-shop', 'exp-shop-filter', 'hist-shop', 'ship-shop-filter', 'monthly-shop', 'fSoldByShop'];
  selects.forEach(id => {
    const el = $(id);
    if (!el) return;
    const currentVal = el.value;
    const firstOpt = id === 'ship-shop-filter' ? '<option value="ALL">All movements</option><option value="HQ">Warehouse receipts</option>'
      : el.options[0] && (el.options[0].value === '' || el.options[0].value === 'ALL') ? el.options[0].outerHTML : '';
    el.innerHTML = firstOpt + currentClientShops.map(s => `<option value="${escAttr(s.id)}">${esc(s.name || s.id)}</option>`).join('');

    if (currentVal) el.value = currentVal;
  });

  updateShopBadges();
}

function updateShopBadges() {
  const s = currentClientShops.find(x => x.id === activeShop) || { id: activeShop, name: activeShop, color: '#16a34a' };
  const badges = ['scan-shop-badge', 'imei-shop-badge', 'stock-badge'];
  badges.forEach(id => {
    const el = $(id);
    if (el) {
      el.textContent = s.name || s.id;
      el.style.color = s.color;
      el.style.borderColor = s.color + '4d';
      el.style.background = s.color + '1a';
    }
  });
  const lbl = $('sb-lbl2');
  if (lbl) lbl.textContent = s.name || s.id;
}
