/* ── Auth, Session, Super Admin, Dynamic Shops ── */
/* Auto-split from index.html — 2026-04-25T15:26:28.701Z */

// ── AUTH CHECK ──
// --- Client Multi-Tenant Logic ---
var currentClientId = localStorage.getItem('clientId') || '';
var currentClientShops = JSON.parse(localStorage.getItem('clientShops') || '[]');

async function checkClientAndGate() {
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
      $('auth-client-err').textContent = gateRes.error || 'Incorrect site password.'; 
      $('auth-client-err').style.display = 'block'; 
      return; 
    }
    // Success — store client and move to role selection
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

async function verifySuperAdmin() {
  const pw = $('sa-pass').value;
  if (!pw) return;
  const r = await fetch(BASE + '/api/superadmin/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ superAdminPassword: pw })
  });
  if (r.ok) {
    $('sa-gate-err').style.display = 'none';
    $('sa-gate').style.display = 'none';
    $('sa-form').style.display = '';
    loadClientsList();
  } else {
    $('sa-gate-err').style.display = 'block';
    $('sa-pass').value = '';
    $('sa-pass').focus();
  }
}

function showSuperAdmin() {
  $('auth-client').style.display = 'none';
  $('auth-superadmin').style.display = 'block';
  $('sa-gate').style.display = '';
  $('sa-form').style.display = 'none';
  $('sa-pass').value = '';
  $('sa-gate-err').style.display = 'none';
  setTimeout(() => $('sa-pass')?.focus(), 80);
}

function hideSuperAdmin() {
  $('auth-superadmin').style.display = 'none';
  $('auth-client').style.display = '';
}

// ── Shop Tag Builder ──
var _saShops = [];

function addShopTag() {
  const nameVal = $('sa-shop-name').value.trim();
  if (!nameVal) { $('sa-shop-name').focus(); return; }
  const color = $('sa-shop-color').value;
  // Use a sanitized slug as id (strip spaces, lowercase)
  const id = nameVal.replace(/\s+/g, '-').toUpperCase();
  if (_saShops.find(s => s.id === id)) { showToast('Shop already added', 'warn'); return; }
  _saShops.push({ id, name: nameVal, color });
  renderShopTags();
  $('sa-shop-name').value = '';
  $('sa-shop-name').focus();
}

function removeShopTag(id) {
  _saShops = _saShops.filter(s => s.id !== id);
  renderShopTags();
}

function renderShopTags() {
  const container = $('sa-shop-tags');
  if (!container) return;
  container.innerHTML = _saShops.map(s => `
    <span style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:20px;background:${s.color}22;border:1px solid ${s.color};color:${s.color};font-size:.85rem;font-weight:600;">
      <span style="width:8px;height:8px;border-radius:50%;background:${s.color};display:inline-block;"></span>
      ${esc(s.name)}
      <span onclick="removeShopTag('${esc(s.id)}')" style="cursor:pointer;margin-left:2px;opacity:.7;font-size:1rem;line-height:1;">&times;</span>
    </span>`).join('');

}

async function saveClient() {
  const clientId = $('sa-client-id').value.trim();
  const adminPassword = $('sa-admin-pass').value;
  const gatePassword = $('sa-gate-pass').value;
  if (!clientId) { $('sa-err').textContent = 'Client ID is required.'; $('sa-err').style.display = 'block'; return; }
  if (_saShops.length === 0) { $('sa-err').textContent = 'Add at least one shop.'; $('sa-err').style.display = 'block'; return; }
  const payload = {
    superAdminPassword: $('sa-pass').value,
    clientId,
    adminPassword,
    gatePassword,
    shops: _saShops
  };
  const res = await fetch(BASE + '/api/superadmin/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (res.ok) {
    showToast('Client saved successfully ✅', 'success');
    _saShops = [];
    renderShopTags();
    $('sa-client-id').value = ''; $('sa-admin-pass').value = ''; $('sa-gate-pass').value = '';
    loadClientsList();
  } else {
    const err = await res.json();
    $('sa-err').textContent = err.error || 'Failed to save client.';
    $('sa-err').style.display = 'block';
  }
}

async function loadClientsList() {
  const pw = $('sa-pass').value;
  const res = await fetch(BASE + '/api/superadmin/clients', {
    headers: { 'X-Super-Admin-Password': pw }
  });
  if (!res.ok) return;
  const clients = await res.json();
  const list = $('sa-client-list');
  if (!list) return;
  list.innerHTML = clients.map(c => `
    <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:12px;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-weight:700;font-size:.9rem;color:var(--text);">${esc(c.clientId)}</div>
        <div style="font-size:.7rem;color:var(--text3);margin-top:2px;">

          ${c.shops.length} Shops • 
          <span style="color:${c.status === 'active' ? 'var(--success)' : 'var(--danger)'};font-weight:700;">${c.status.toUpperCase()}</span>
        </div>
      </div>
      <div style="display:flex;gap:8px;">
        <button onclick="toggleClientStatus('${esc(c.clientId)}', '${esc(c.status)}')" style="background:var(--s3);border:1px solid var(--border);padding:5px 8px;border-radius:6px;color:var(--text2);font-size:.65rem;cursor:pointer;">

          ${c.status === 'active' ? 'Pause' : 'Resume'}
        </button>
        <button onclick="deleteClient('${esc(c.clientId)}')" style="background:rgba(220,38,38,.1);border:1px solid rgba(220,38,38,.3);padding:5px 8px;border-radius:6px;color:var(--danger);font-size:.65rem;cursor:pointer;">

          Delete
        </button>
      </div>
    </div>
  `).join('') || '<div style="font-size:.75rem;color:var(--text3);text-align:center;">No clients yet.</div>';
}

async function toggleClientStatus(clientId, currentStatus) {
  if (!confirm(`Are you sure you want to ${currentStatus === 'active' ? 'PAUSE' : 'RESUME'} this client?`)) return;
  const newStatus = currentStatus === 'active' ? 'paused' : 'active';
  const pw = $('sa-pass').value;
  const res = await fetch(BASE + '/api/superadmin/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ superAdminPassword: pw, clientId, status: newStatus })
  });
  if (res.ok) {
    showToast(`Client ${newStatus} successfully`, 'success');
    loadClientsList();
  } else {
    showToast('Failed to update status', 'error');
  }
}

async function deleteClient(clientId) {
  if (!confirm(`CRITICAL WARNING: This will PERMANENTLY DELETE client "${clientId}" and ALL their data. This cannot be undone. Proceed?`)) return;
  const pw = $('sa-pass').value;
  const res = await fetch(BASE + `/api/superadmin/clients/${clientId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ superAdminPassword: pw })
  });
  if (res.ok) {
    showToast('Client deleted permanently', 'warn');
    loadClientsList();
  } else {
    showToast('Failed to delete client', 'error');
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
    const firstOpt = el.options[0] && (el.options[0].value === '' || el.options[0].value === 'ALL') ? el.options[0].outerHTML : '';
    el.innerHTML = firstOpt + currentClientShops.map(s => `<option value="${esc(s.id)}">${esc(s.name || s.id)}</option>`).join('');

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
