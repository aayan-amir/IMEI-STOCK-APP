/* ── IMEI Scan, Stock List, Sales Log, Batch ── */
/* Auto-split from index.html — 2026-04-25T15:26:28.694Z */

// ── IMEI SCAN ──
function setMode(m) {
  scanMode = m;
  $('modeAdd').classList.toggle('active', m === 'add');
  $('modeBatch').classList.toggle('active', m === 'batch');
  $('modeSell').classList.toggle('active', m === 'sell');
  $('modeProduct').classList.toggle('active', m === 'product');
  cancelForm();
  if (m === 'batch') {
    $('batchForm').style.display = 'block';
    if (typeof restoreIntakeBatch === 'function') restoreIntakeBatch();
    setTimeout(() => $('bBrand')?.focus(), 80);
  } else if (m === 'product') {
    $('productForm').style.display = 'block';
    loadProducts();
    setTimeout(() => $('pName')?.focus(), 80);
  } else {
    $('imeiInput')?.focus();
  }
}

// ── BATCH ADD ──────────────────────────────────────────────────────
var batchQueueVersion = 0;
var batchQueue = []; // [{imei1, imei2, color}]

function addToBatchQueue() {
  if (typeof intakeQueueLocked === 'function' && intakeQueueLocked()) { showToast('Retry the saved batch before changing its phones', 'warn'); return; }
  batchQueueVersion++;
  const imei1 = $('bImei1').value.trim().replace(/\D/g, '');
  const imei2 = $('bImei2').value.trim().replace(/\D/g, '');
  const entryColor = $('bEntryColor').value.trim();
  const sharedColor = $('bColor').value.trim();
  if (!imei1) { showToast('IMEI 1 is required', 'error'); $('bImei1').focus(); return; }
  if (imei1.length !== 15) { showToast('IMEI 1 must be exactly 15 digits', 'error'); return; }
  if (imei2 && imei2.length !== 15) { showToast('IMEI 2 must be exactly 15 digits', 'error'); return; }
  if (!entryColor && !sharedColor) { showToast('Set color for this phone (or set a shared color)', 'error'); $('bEntryColor').focus(); return; }
  // Check for duplicates in queue
  const dup = batchQueue.find(e =>
    e.imei1 === imei1 ||
    e.imei2 === imei1 ||
    (imei2 && (e.imei1 === imei2 || e.imei2 === imei2))
  );
  if (dup) {
    showToast('This IMEI is already in the queue', 'warn'); return;
  }
  batchQueue.push({ imei1, imei2, color: entryColor || sharedColor });
  $('bImei1').value = '';
  $('bImei2').value = '';
  $('bEntryColor').value = '';
  $('bImei1').focus();
  renderBatchQueue();
  showToast(`Phone ${batchQueue.length} added to queue`, 'success');
}

function renderBatchQueue() {
  const qEl = $('batchQueue');
  const listEl = $('batchList');
  const countEl = $('batchCount');
  const saveBtn = $('batchSaveBtn');
  if (!batchQueue.length) {
    qEl.style.display = 'none';
    saveBtn.disabled = true;
    return;
  }
  qEl.style.display = 'block';
  saveBtn.disabled = false;
  countEl.textContent = batchQueue.length;
  listEl.innerHTML = batchQueue.map((e, i) => `
<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--bg);border:1px solid var(--border);border-radius:7px;margin-bottom:5px;font-family:var(--mono);font-size:.68rem;">
  <span style="color:var(--a1);font-weight:700;min-width:20px;">#${i + 1}</span>
  <div style="flex:1;min-width:0;">
    <div style="color:var(--white);">IMEI 1: ${esc(e.imei1)}</div>
    <div style="color:var(--text2);font-size:.62rem;margin-top:2px;">Color: ${esc(titleCase(e.color || '—'))}</div>
    <div style="display:flex;gap:4px;margin-top:2px">
      ${e.imei2 ? `<span style="font-size:.58rem;background:rgba(22,163,74,.15);color:var(--a1);border:1px solid rgba(22,163,74,.3);padding:1px 5px;border-radius:10px;">2 IMEIs</span>` : `<span style="font-size:.58rem;background:var(--s3);color:var(--text2);border:1px solid var(--border);padding:1px 5px;border-radius:10px;">1 IMEI</span>`}
    </div>
  </div>
  <button class="bx" onclick="removeBatchEntry(${i})">✕</button>
</div>`).join('');
}

function removeBatchEntry(i) {
  if (typeof intakeQueueLocked === 'function' && intakeQueueLocked()) { showToast('Retry the saved batch before changing its phones', 'warn'); return; }
  batchQueueVersion++;
  batchQueue.splice(i, 1);
  renderBatchQueue();
}

function clearBatchQueue() {
  if (typeof discardResolvedIntake === 'function' && !discardResolvedIntake()) return;
  if (typeof intakeQueueLocked === 'function' && intakeQueueLocked()) { showToast('Retry the saved batch before changing its phones', 'warn'); return; }
  batchQueueVersion++;
  batchQueue = [];
  renderBatchQueue();
}

async function handleImeiSubmit() {
  const raw = $('imeiInput').value.trim().replace(/\D/g, '');
  if (!raw) { showToast('Enter or scan an IMEI', 'error'); return; }
  if (raw.length !== 15) { showToast(`IMEI must be exactly 15 digits (got ${raw.length})`, 'error'); return; }
  pendingIMEI = raw; $('imeiInput').value = '';
  if (scanMode === 'add') {
    try {
      const r = await api('GET', `/api/lookup/${pendingIMEI}`);
      if (r.imei) {
        if (r.status === 'sold') {
          showPreview('Already Sold', phoneCardHTML(r, true));
          showToast('This IMEI belongs to a sold phone', 'warn');
        } else {
          showPreview('Already in Stock', phoneCardHTML(r, true));
          showToast('IMEI already exists!', 'warn');
        }
        return;
      }
    } catch (e) { $('imeiInput').value = raw; return handleApiError(e); }
    showAddForm();
  } else {
    try {
      const r = await api('GET', `/api/lookup/${pendingIMEI}`);
      if (!r.imei) {
        showToast('IMEI not found in stock', 'error');
        showPreview('Not Found', `<p style="color:var(--danger);font-size:.8rem">IMEI <code style="font-family:var(--mono)">${pendingIMEI}</code> is not in stock.</p>`);
        return;
      }
      if (r.status === 'sold') {
        showToast('This phone is already sold!', 'error');
        showPreview('Already Sold', phoneCardHTML(r, true));
        return;
      }
      showSellForm(r);
    } catch (e) { $('imeiInput').value = raw; return handleApiError(e); }
  }
}

function showAddForm() {
  hidePreview();
  $('fImei1').value = pendingIMEI;
  $('fImei2').value = '';
  $('addForm').style.display = 'block';
  $('addForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  autoBrandFromCat('fCat', 'fBrand'); // auto-fill brand based on current category
  setTimeout(() => $('fImei2')?.focus(), 150);
}
function showSellForm(phone) {
  hidePreview();
  if ($('fPaymentMethod')) $('fPaymentMethod').value = '';
  const imeiLine = phone.imei2 ? `<div class="phone-imei">IMEI 1: ${esc(phone.imei)}</div><div class="phone-imei2">IMEI 2: ${esc(phone.imei2)}</div>` : `<div class="phone-imei">${esc(phone.imei)}</div>`;
  $('sellPhoneInfo').innerHTML = `
<div style="background:var(--bg);border:1px solid var(--border);border-radius:9px;padding:12px;display:flex;align-items:center;gap:12px">
  <div class="phone-icon">${esc((phone.brand || '?')[0].toUpperCase())}</div>
  <div style="flex:1;">
    <div style="font-weight:700;font-size:.9rem;color:var(--white)">${esc(phone.brand || '')} ${esc(phone.model || '')}</div>
    ${imeiLine}
    <div style="font-size:.72rem;color:var(--text2);margin-top:2px">${[phone.color, phone.storage].filter(Boolean).map(esc).join(' · ')}</div>
    ${phone.buyPrice && authRole === 'admin' ? `<div style="font-size:.72rem;color:var(--a5);margin-top:2px">Cost: ${pkr(phone.buyPrice)}</div>` : ''}
  </div>
</div>
${phone.buyPrice && authRole === 'admin' ? `<div id="profitPreview" style="font-size:.72rem;color:var(--text2);margin-top:8px;font-family:var(--mono)">Enter sale price to see profit</div>` : ''}`;

  const soldByShopEl = $('fSoldByShop');
  const defaultShop = (activeShop === 'HQ' ? (SHOPS.length ? SHOPS[0] : null) : activeShop) || null;
  soldByShopEl.value = authRole === 'shop' ? authShop : defaultShop;
  soldByShopEl.disabled = authRole === 'shop';

  // Cross-shop warning helper
  function updateCrossShopWarning() {
    const sel = soldByShopEl.value;
    const warn = $('crossShopWarning');
    if (phone.shop && sel && sel !== phone.shop) {
      warn.style.display = 'block';
      warn.textContent = `⚠ This phone is from Shop ${phone.shop}'s stock. You are recording this sale under Shop ${sel}.`;
    } else {
      warn.style.display = 'none';
    }
  }
  soldByShopEl.onchange = updateCrossShopWarning;
  updateCrossShopWarning();

  $('sellForm').style.display = 'block';
  $('sellForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  // Wire up profit preview (admin only)
  if (phone.buyPrice && authRole === 'admin') {
    $('fSalePrice').oninput = () => {
      const sp = parseFloat($('fSalePrice').value) || 0;
      const profit = sp - phone.buyPrice;
      const el = $('profitPreview');
      if (el && sp > 0) {
        el.style.color = profit >= 0 ? 'var(--success)' : 'var(--danger)';
        el.textContent = `Profit: ${pkr(profit)} ${profit >= 0 ? '▲' : '▼'}`;
      } else if (el) {
        el.style.color = 'var(--text2)'; el.textContent = 'Enter sale price to see profit';
      }
    };
  }
  setTimeout(() => $('fSalePrice')?.focus(), 150);
}
function cancelForm() {
  batchQueueVersion++;
  $('addForm').style.display = 'none';
  $('sellForm').style.display = 'none';
  $('batchForm').style.display = 'none';
  if ($('productForm')) $('productForm').style.display = 'none';
  hidePreview();
  pendingIMEI = '';
  batchQueue = [];
  renderBatchQueue();
}
function showPreview(title, html) { $('previewTitle').textContent = title; $('previewContent').innerHTML = html; $('resultPreview').classList.add('show'); }
function hidePreview() { $('resultPreview').classList.remove('show'); }

let singleAddRunning = false;
async function submitAdd() {
  if (singleAddRunning) return;
  const scope = destructiveScope(), version = batchQueueVersion;
  const ids = ['fImei2', 'fCat', 'fBrand', 'fModel', 'fColor', 'fStorage', 'fBuyPrice', 'fNotes'];
  const values = ids.map(id => $(id).value), originalImei = pendingIMEI;
  const current = () => scope === destructiveScope() && version === batchQueueVersion;
  const unchanged = () => current() && pendingIMEI === originalImei && ids.every((id, i) => $(id).value === values[i]);
  singleAddRunning = true;
  try {
    const imei2 = $('fImei2').value.trim().replace(/\D/g, '');
    const payload = {
      imei: pendingIMEI,
      imei2: imei2 || '',
      cat: $('fCat').value,
      brand: $('fBrand').value.trim(),
      model: $('fModel').value.trim(),
      color: $('fColor').value.trim(),
      storage: $('fStorage').value,
      buyPrice: $('fBuyPrice').value !== '' ? Number($('fBuyPrice').value) : undefined,
      notes: $('fNotes').value.trim(),
      shop: activeShop === 'HQ' ? null : activeShop
    };
    await api('POST', '/api/stock/add', payload);

    if (!current()) return;
    loadSidebarStats();
    if (!unchanged()) { showToast('Phone saved. Your newer form was kept.', 'success'); return; }
    const imeiInfo = imei2 ? ` (2 IMEIs)` : '';
    showToast(`${payload.brand || 'Phone'} ${payload.model || ''}${imeiInfo} added!`, 'success');
    cancelForm();
    ['fBrand', 'fModel', 'fColor', 'fBuyPrice', 'fNotes', 'fImei1', 'fImei2'].forEach(id => { if ($(id)) $(id).value = ''; });
    $('fStorage').value = ''; $('fCat').value = 'IPHONE';
    setTimeout(() => $('imeiInput')?.focus(), 100);
  } catch (error) {
    if (current()) return handleApiError(error);
  } finally {
    singleAddRunning = false;
  }
}

let pendingSaleRequest = null;

function readSaleIntent() {
  return {
    scope: JSON.stringify([localStorage.getItem('clientId'), authRole, authShop]),
    payload: {
      imei: pendingIMEI, salePrice: $('fSalePrice').value,
      ...(typeof hasBusinessCapability === 'function' && hasBusinessCapability('fullyPaidTender') ? { paymentMethod: $('fPaymentMethod').value } : {}),
      buyerName: $('fBuyerName').value.trim(),
      buyerPhone: $('fBuyerPhone').value.trim(),
      notes: $('fSaleNotes').value.trim(),
      soldByShop: authRole === 'shop' ? authShop : ($('fSoldByShop').value || undefined)
    },
  };
}

async function submitSell() {
  try {
    const intent = readSaleIntent();
    const payload = intent.payload;
    if (payload.paymentMethod !== undefined && !['cash', 'bank'].includes(payload.paymentMethod)) throw Error('Choose Cash or Bank before saving this fully paid sale.');
    const fingerprint = JSON.stringify(intent);
    if (!pendingSaleRequest || pendingSaleRequest.fingerprint !== fingerprint) {
      const key = newRequestKey();
      pendingSaleRequest = { fingerprint, key, page: activePage, shop: activeShop };
    }
    const request = pendingSaleRequest;
    const d = await api('POST', '/api/stock/sell', payload, { operationId: request.key, ...(payload.paymentMethod ? { saleVersion: '2' } : {}) });
    const currentIntent = readSaleIntent();
    const ownsForm = pendingSaleRequest === request && JSON.stringify(currentIntent) === fingerprint;
    if (pendingSaleRequest === request) pendingSaleRequest = null;
    if (currentIntent.scope !== intent.scope) return;

    const profit = d.sale?.profit;
    showToast(`Sale recorded for ${payload.imei}${profit != null && authRole === 'admin' ? ' — Profit: ' + pkr(profit) : ''}`, 'success');
    const soldIMEI = payload.imei;
    const soldPrice = d.sale?.salePrice;
    const soldAt = d.sale?.soldAt || new Date().toISOString();
    if (ownsForm) {
      cancelForm();
      ['fSalePrice', 'fBuyerName', 'fBuyerPhone', 'fSaleNotes', 'fPaymentMethod'].forEach(id => { if ($(id)) $(id).value = ''; });
    }
    // Update local cache immediately so imeistock page reflects the sale without waiting for a full refresh
    const soldIdx = allIMEIStock.findIndex(p => p.imei === soldIMEI);
    if (soldIdx !== -1) {
      allIMEIStock[soldIdx] = { ...allIMEIStock[soldIdx], status: 'sold', salePrice: soldPrice, soldAt };
      renderIMEIStock();
    }
    loadSidebarStats();
    if (request.page === activePage && request.shop === activeShop) {
      if (activePage === 'stock') loadDay();
      if (activePage === 'saleslog') loadSalesLog();
      if (activePage === 'imeistock') loadIMEIData();
      if (ownsForm) setTimeout(() => $('imeiInput')?.focus(), 100);
    }
  } catch (error) {
    return handleApiError(error);
  }
}

// ── IMEI STOCK LIST ──
var groupedView = true; // default: grouped by model
var groupedStockMap = {};
var groupOpenState = {};
var initialLoad = true;

function expandAllGroups() {
  Object.keys(groupedStockMap).forEach(uid => groupOpenState[uid] = true);
  renderIMEIStock();
}
function collapseAllGroups() {
  Object.keys(groupedStockMap).forEach(uid => groupOpenState[uid] = false);
  renderIMEIStock();
}
var inventoryPage = null, inventoryLoadGeneration = 0, inventoryLoading = false, inventorySearchTimer;
function stockListScope() { return JSON.stringify([localStorage.getItem('clientId'), authRole, authShop, activeShop, imeiFilter, $('imeiSearch').value.trim()]); }
function stockListQuery() {
  const params = new URLSearchParams({ status: imeiFilter });
  if (activeShop !== 'HQ') params.set('shop', activeShop);
  const search = $('imeiSearch').value.trim(); if (search) params.set('q', search);
  return params;
}
function renderInventoryPager() {
  const current = inventoryPage?.scope === stockListScope();
  $('imei-prev').disabled = inventoryLoading || !current || !inventoryPage.previous.length;
  $('imei-next').disabled = inventoryLoading || !current || !inventoryPage.nextCursor;
}
async function loadIMEIData(options = {}) {
  const scope = stockListScope(), generation = ++inventoryLoadGeneration;
  const current = () => generation === inventoryLoadGeneration && scope === stockListScope();
  const list = $('imeiList');
  inventoryLoading = true; renderInventoryPager();
  if (!inventoryPage || inventoryPage.scope !== scope) {
    list.innerHTML = '<div class="empty" role="status">Loading matching stock…</div>';
    $('bulkActions').style.display = 'none';
  }
  try {
    const query = stockListQuery(); query.set('limit', '50');
    if (options.cursor) query.set('cursor', options.cursor);
    const page = await api('GET', `/api/v2/stock?${query}`);
    if (!current()) return;
    if (!Array.isArray(page.items) || !Number.isSafeInteger(page.total) || page.total < 0 || typeof page.hasMore !== 'boolean' || page.hasMore !== !!page.nextCursor) throw Error('Invalid stock page. Refresh before continuing.');
    const changedPage = inventoryPage?.scope !== scope || inventoryPage?.cursor !== (options.cursor || null);
    allIMEIStock = page.items;
    if (changedPage) selectedPhoneIds.clear();
    const validIds = new Set(allIMEIStock.map(phone => phone.id));
    selectedPhoneIds.forEach(id => { if (!validIds.has(id)) selectedPhoneIds.delete(id); });
    inventoryPage = { scope, cursor: options.cursor || null, nextCursor: page.nextCursor, previous: options.previous || [], total: page.total };
    renderIMEIStock(); updateBulkActions(); initialLoad = false;
  } catch (error) {
    if (!current()) return;
    if (inventoryPage?.scope !== scope) list.innerHTML = '<div class="empty">Stock could not be loaded. Refresh to retry.</div>';
    $('imei-page-status').textContent = 'Could not load this page. Refresh to retry. Last loaded data is retained.';
    return handleApiError(error);
  } finally { if (current()) { inventoryLoading = false; renderInventoryPager(); } }
}
function nextIMEIPage() {
  if (!inventoryLoading && inventoryPage?.scope === stockListScope() && inventoryPage.nextCursor) return loadIMEIData({ cursor: inventoryPage.nextCursor, previous: [...inventoryPage.previous, inventoryPage.cursor] });
}
function previousIMEIPage() {
  if (!inventoryLoading && inventoryPage?.scope === stockListScope() && inventoryPage.previous.length) return loadIMEIData({ cursor: inventoryPage.previous.at(-1), previous: inventoryPage.previous.slice(0, -1) });
}
function scheduleIMEISearch() {
  clearTimeout(inventorySearchTimer); updateSearchClearBtn();
  inventorySearchTimer = setTimeout(() => loadIMEIData(), 250);
}
function setIMEIFilter(f, el) {
  imeiFilter = f; document.querySelectorAll('.filter-chip').forEach(chip => chip.classList.remove('active')); el.classList.add('active');
  return loadIMEIData();
}
function toggleGrouped() { groupedView = !groupedView; $('groupBtn').textContent = groupedView ? 'Flat List' : 'Group by Model'; renderIMEIStock(); }

function renderIMEIStock() {
  if (inventoryPage && inventoryPage.scope !== stockListScope()) {
    $('imeiList').innerHTML = '<div class="empty">Load the selected stock filters before viewing or selecting phones.</div>';
    $('imeiCount').textContent = 'Selected stock has not loaded';
    groupedStockMap = {}; updateBulkActions(); return;
  }
  const items = allIMEIStock;
  $('imeiCount').textContent = `${items.length} on this page · ${inventoryPage?.total ?? items.length} matching phones`;
  $('imei-page-status').textContent = 'Group counts and selection apply to this page. Stock is live; refresh to include new arrivals.';
  updateBulkActions();
  const list = $('imeiList');
  if (!list) return;
  if (!items.length) { 
    list.innerHTML = `<div class="empty"><div class="empty-icon">—</div><h3>No phones found</h3></div>`; 
    return; 
  }

  if (!groupedView) {
    list.innerHTML = items.map(p => phoneCardHTML(p, true)).join('');
    return;
  }

  // Group by category+brand+model only (Combining different storages)
  const groups = {};
  groupedStockMap = {};
  items.forEach(p => {
    const category = guessCat(p.brand, p.model, p.cat);
    const key = `${category}|${(p.brand || '').toLowerCase()}|${(p.model || '').toLowerCase()}`;
    if (!groups[key]) {
      groups[key] = { 
        phones: [], cat: category, brand: p.brand, model: p.model, 
        buyPrice: p.buyPrice, colors: new Set(), storages: new Set() 
      };
    }
    groups[key].phones.push(p);
    const clr = (p.color || '').trim();
    if (clr) groups[key].colors.add(clr.toLowerCase());
    const str = (p.storage || '').trim();
    if (str) groups[key].storages.add(str);
  });

  list.innerHTML = Object.entries(groups).map(([key, g], idx) => {
    const count = g.phones.length;
    const inStockCount = g.phones.filter(p => p.status === 'in_stock').length;
    const soldCount = g.phones.filter(p => p.status === 'sold').length;
    const uid = `g${idx}`;
    
    // Collapse all by default on initial load
    if (initialLoad && !groupOpenState.hasOwnProperty(uid)) {
      groupOpenState[uid] = false;
    }
    
    const isOpen = !!groupOpenState[uid];
    groupedStockMap[uid] = g.phones.map(p => p.id).filter(Boolean);
    
    const storageArr = [...g.storages];
    const storageLabel = storageArr.length === 1 ? storageArr[0] : (storageArr.length > 1 ? 'Multiple Storages' : '');
    // Always show group header — never silently hide phones
    return `
  <div style="background:var(--s1);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:8px;overflow:hidden;">
    <div id="grp-head-${uid}" style="display:flex;align-items:center;gap:12px;padding:12px 14px;cursor:pointer;transition:background .15s;background:${isOpen ? 'rgba(22,163,74,.08)' : 'var(--s1)'};"
      onclick="toggleGroup('grp-${uid}')">
      <div class="phone-icon">${(g.brand || '?')[0].toUpperCase()}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:.9rem;color:var(--white);">${fmtPhoneName(g.brand, g.model)}</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px;">
          <span style="font-family:var(--mono);font-size:.7rem;font-weight:700;background:rgba(22,163,74,.15);color:var(--a1);border:1px solid rgba(22,163,74,.3);padding:2px 9px;border-radius:20px;">${count} unit${count !== 1 ? 's' : ''} on this page</span>
          ${inStockCount ? `<span class="badge badge-green">${inStockCount} in stock</span>` : ''}
          ${soldCount ? `<span class="badge badge-red">${soldCount} sold</span>` : ''}
          <span class="badge badge-blue">${esc((CATS[g.cat]?.label) || titleCase(g.cat || 'Other'))}</span>
          <span class="badge ${isOpen ? 'badge-green' : 'badge-gray'}" id="grp-state-${uid}">${isOpen ? 'Open' : 'Closed'}</span>
          ${(g.colors && g.colors.size === 1) ? `<span class="badge badge-gray">${esc(titleCase([...g.colors][0]))}</span>` : (g.colors && g.colors.size > 1 ? `<span class="badge badge-gray">Multiple Colors</span>` : '')}
          ${storageLabel ? `<span class="badge badge-purple">${esc(storageLabel)}</span>` : ''}
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        ${authRole === 'admin' && g.buyPrice ? `<div style="font-family:var(--mono);font-size:.82rem;color:var(--a5)">${pkr(g.buyPrice)}</div><div style="font-size:.6rem;color:var(--text2)">ea.</div>` : ''}
        ${authRole === 'admin' && count > 1 ? `<button class="btn bg" style="margin-top:6px;font-size:.62rem;padding:.2rem .45rem;" onclick="event.stopPropagation();openGroupBatchEdit('${uid}')">Batch Edit Group</button>` : ''}
      </div>
      <div style="color:${isOpen ? 'var(--a1)' : 'var(--text2)'};font-size:.75rem;margin-left:4px;" id="grp-arr-${uid}">${count === 1 ? '' : '▶'}</div>
    </div>
    <div id="grp-${uid}" style="display:${isOpen ? 'block' : 'none'};border-top:1px solid var(--border);">
      ${g.phones.map(p => phoneCardHTML(p, false)).join('')}
    </div>
  </div>`;
  }).join('');
}

function updateBulkActions() {
  const bar = $('bulkActions'); if (!bar) return;
  if (authRole !== 'admin') { bar.style.display = 'none'; return; }
  const count = inventoryPage && inventoryPage.scope !== stockListScope() ? 0 : selectedPhoneIds.size;
  bar.style.display = count > 0 ? 'flex' : 'none';
  const lbl = $('bulkSelectionLabel'); if (lbl) lbl.textContent = `${count} selected`;
  const btn = $('bulkEditBtn'); if (btn) btn.disabled = count === 0;
  const clr = $('bulkClearBtn'); if (clr) clr.disabled = count === 0;
}

function togglePhoneSelection(id, checked) {
  if (checked) selectedPhoneIds.add(id); else selectedPhoneIds.delete(id);
  const card = $('card-' + id);
  if (card) card.classList.toggle('selected', checked);
  updateBulkActions();
}

function clearPhoneSelection(rerender = false) {
  if (!selectedPhoneIds.size) { updateBulkActions(); return; }
  const ids = [...selectedPhoneIds];
  selectedPhoneIds.clear();
  ids.forEach(pid => {
    const card = $('card-' + pid);
    if (card) {
      card.classList.remove('selected');
      const cb = card.querySelector('.bulk-check input');
      if (cb) cb.checked = false;
    }
  });
  if (rerender) renderIMEIStock();
  updateBulkActions();
}

function getSelectedPhones() {
  if (inventoryPage && inventoryPage.scope !== stockListScope()) return [];
  const map = new Map(allIMEIStock.map(p => [p.id, p]));
  return Array.from(selectedPhoneIds).map(id => map.get(id)).filter(Boolean);
}

function openGroupBatchEdit(uid) {
  if (authRole !== 'admin') { showToast('Admin only', 'error'); return; }
  const ids = (groupedStockMap[uid] || []).filter(Boolean);
  if (!ids.length) { showToast('No phones in this group', 'warn'); return; }
  selectedPhoneIds.clear();
  ids.forEach(id => selectedPhoneIds.add(id));
  renderIMEIStock();
  updateBulkActions();
  openBatchEditModal();
}

function toggleGroup(id) {
  const el = $(id); if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  const uid = id.replace('grp-', '');
  groupOpenState[uid] = !open;
  const arr = $('grp-arr-' + uid);
  if (arr) {
    arr.textContent = open ? '▶' : '▼';
    arr.style.color = open ? 'var(--text2)' : 'var(--a1)';
  }
  const head = $('grp-head-' + uid);
  if (head) head.style.background = open ? 'var(--s1)' : 'rgba(22,163,74,.08)';
  const state = $('grp-state-' + uid);
  if (state) {
    state.textContent = open ? 'Closed' : 'Open';
    state.className = `badge ${open ? 'badge-gray' : 'badge-green'}`;
  }
}

function phoneCardHTML(p, standalone = true) {
  const imei2line = p.imei2 ? `<div class="phone-imei2">IMEI 2: ${esc(p.imei2)}</div>` : '';
  const profitTag = authRole === 'admin' && p.salePrice != null && p.buyPrice != null ? `<span class="badge ${p.salePrice - p.buyPrice >= 0 ? 'badge-green' : 'badge-red'}">${p.salePrice - p.buyPrice >= 0 ? '+' : ''}${pkr(p.salePrice - p.buyPrice)}</span>` : '';
  const border = standalone ? 'border-radius:var(--radius);margin-bottom:8px;' : 'border-top:1px solid var(--border2);border-radius:0;margin-bottom:0;';
  const selected = selectedPhoneIds.has(p.id);
  return `<div class="phone-card${selected ? ' selected' : ''}" id="card-${p.id}" style="${border}">
${authRole === 'admin' ? `<label class="bulk-check" aria-label="Select phone">
  <input type="checkbox" ${selected ? 'checked' : ''} onchange="togglePhoneSelection('${p.id}',this.checked)">
</label>`: ''}
<div class="phone-icon">${esc((p.brand || '?')[0].toUpperCase())}</div>
<div class="phone-info">
  <div class="phone-name">${fmtPhoneName(p.brand, p.model)}</div>
  <div class="phone-imei">IMEI 1: ${esc(p.imei)}</div>
  ${imei2line}
  <div class="phone-meta">
    <span class="badge ${p.status === 'in_stock' ? 'badge-green' : 'badge-red'}">${p.status === 'in_stock' ? 'In Stock' : 'Sold'}</span>
    ${p.cat && CATS[p.cat] ? `<span class="badge badge-blue">${CATS[p.cat].label}</span>` : ''}
    ${p.color ? `<span class="badge badge-gray">${esc(p.color)}</span>` : ''}
    ${p.storage ? `<span class="badge badge-purple">${esc(p.storage)}</span>` : ''}
    ${p.imei2 ? `<span class="badge badge-blue">2 IMEIs</span>` : ''}
    ${profitTag}
    ${p.addedAt ? `<span class="badge badge-gray">${fmtDate(p.addedAt)}</span>` : ''}
  </div>
</div>
<div class="phone-price">
  ${authRole === 'admin' && p.buyPrice != null ? `<div style="color:var(--text2);font-size:.62rem">Cost</div><div>${pkr(p.buyPrice)}</div>` : ''}
  ${p.salePrice != null ? `<div style="color:var(--text2);font-size:.62rem;margin-top:3px">Sold</div><div style="color:var(--success)">${pkr(p.salePrice)}</div>` : ''}
</div>
<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
  ${authRole === 'admin' && /^\d{15}$/.test(String(p.imei)) ? `<button class="btn bo" onclick="openIMEIDetail('${p.imei}')">History</button>` : ''}
  ${!IS_PHONE ? `<button class="btn bo" onclick="openEditPhone('${p.id}')" style="font-size:.62rem;padding:.22rem .5rem;">Edit</button>` : ''}
  ${p.status === 'in_stock' && authRole === 'admin' ? `<button class="del-btn" onclick="deletePhone('${p.id}')" title="Remove" aria-label="Delete phone">×</button>` : ''}
  ${p.status === 'sold' && authRole === 'admin' ? `<button class="del-btn" onclick="deleteSaleByIMEI('${esc(p.imei)}')" title="Reverse sale" aria-label="Reverse sale">×</button>` : ''}
</div>
  </div>`;
}

function openEditPhone(id) {
  const p = allIMEIStock.find(x => x.id === id);
  if (!p) { showToast('Phone not found', 'error'); return; }
  // Use DOM to build modal so values with quotes/apostrophes are safe
  const m = document.createElement('div');
  m.innerHTML = `<h3>Edit Phone</h3>
<div class="fc">
  <div style="background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-family:var(--mono);font-size:.72rem;color:var(--text2);">
    IMEI 1: <span style="color:var(--white)">${esc(p.imei)}</span>${p.imei2 ? `<br>IMEI 2: <span style="color:var(--white)">${esc(p.imei2)}</span>` : ''}
  </div>
  <div class="f2">
    <div class="fi"><label>Category</label>
      <select id="ep-cat">
        <option value="IPHONE">iPhone</option>
        <option value="SAMSUNG">Samsung</option>
        <option value="GOOGLE">Google Pixel</option>
        <option value="OTHER">Other</option>
        <option value="BOX">Box / Sealed</option>
        <option value="EXTRA">Extra / Misc</option>
      </select>
    </div>
    <div class="fi"><label>Brand</label><input type="text" id="ep-brand"></div>
  </div>
  <div class="f2">
    <div class="fi"><label>Model</label><input type="text" id="ep-model"></div>
    <div class="fi"><label>Color</label><input type="text" id="ep-color" placeholder="Phantom Black…"></div>
  </div>
  <div class="f2">
    <div class="fi"><label>Storage</label>
      <select id="ep-storage">
        <option value="">—</option>
        ${['64GB', '128GB', '256GB', '512GB', '1TB'].map(s => `<option value="${s}">${s}</option>`).join('')}
      </select>
    </div>
    <div class="fi"><label>Buy Price (PKR)</label><input type="number" id="ep-price" placeholder="Cost price"></div>
  </div>
  <div class="fi"><label>IMEI 2</label><input type="text" id="ep-imei2" placeholder="Second IMEI" inputmode="numeric"></div>
  <div class="fi"><label>Notes</label><input type="text" id="ep-notes" placeholder="Condition, accessories…"></div>
</div>
<div class="mf">
  <button class="btn bo" onclick="closeModal()">Cancel</button>
  <button class="btn bg" onclick="saveEditPhone('${p.id}')">Save Changes</button>
</div>`;
  // Set values safely via JS (handles any special chars)
  $('modal').innerHTML = ''; $('modal').appendChild(m);
  $('modal').style.maxWidth = '520px';
  $('modal-bg').classList.add('open');
  document.getElementById('ep-brand').value = p.brand || '';
  document.getElementById('ep-model').value = p.model || '';
  document.getElementById('ep-cat').value = p.cat || guessCat(p.brand, p.model, null);
  document.getElementById('ep-color').value = p.color || '';
  document.getElementById('ep-storage').value = p.storage || '';
  document.getElementById('ep-price').value = p.buyPrice || '';
  document.getElementById('ep-imei2').value = p.imei2 || '';
  document.getElementById('ep-notes').value = p.notes || '';
  setTimeout(() => document.getElementById('ep-brand')?.focus(), 80);
}

async function saveEditPhone(id) {
  try {
    const payload = {
      brand: document.getElementById('ep-brand').value.trim(),
      model: document.getElementById('ep-model').value.trim(),
      color: document.getElementById('ep-color').value.trim(),
      storage: document.getElementById('ep-storage').value,
      buyPrice: document.getElementById('ep-price').value !== '' ? Number(document.getElementById('ep-price').value) : undefined,
      imei2: document.getElementById('ep-imei2').value.trim().replace(/\D/g, ''),
      notes: document.getElementById('ep-notes').value.trim(),
      cat: document.getElementById('ep-cat').value,
    };
    await api('PUT', `/api/stock/${id}`, payload);

    closeModal();
    showToast('Phone updated');
    await loadIMEIData();
  } catch (error) {
    return handleApiError(error);
  }
}

function openBatchEditModal() {
  if (authRole !== 'admin') { showToast('Admin only', 'error'); return; }
  const selected = getSelectedPhones();
  if (!selected.length) { showToast('Select phones to edit', 'warn'); return; }
  const sample = selected.slice(0, 3).map(p => titleCase(((p.brand || 'Unknown') + ' ' + (p.model || '')).trim())).filter(Boolean).join(', ');
  const extra = selected.length > 3 ? ` +${selected.length - 3} more` : '';
  showModal(`<h3>Batch Edit (${selected.length} phone${selected.length !== 1 ? 's' : ''})</h3>
<p style="color:var(--text2);font-size:.8rem;line-height:1.45;margin-bottom:10px;">
  Only fields you fill will be updated. Leave others blank to keep existing values.
  ${sample ? `<br><span style="display:inline-block;margin-top:6px;font-family:var(--mono);color:var(--text3);">Examples: ${esc(sample)}${extra}</span>` : ''}
</p>
<div class="fc">
  <div class="f2">
    <div class="fi"><label>Category</label>
      <select id="be-cat">
        <option value="">— Leave unchanged —</option>
        <option value="IPHONE">iPhone</option>
        <option value="SAMSUNG">Samsung</option>
        <option value="GOOGLE">Google Pixel</option>
        <option value="OTHER">Other</option>
        <option value="BOX">Box / Sealed</option>
        <option value="EXTRA">Extra / Misc</option>
      </select>
    </div>
    <div class="fi"><label>Brand</label><input type="text" id="be-brand" placeholder="Keep existing"></div>
  </div>
  <div class="f2">
    <div class="fi"><label>Model</label><input type="text" id="be-model" placeholder="Keep existing"></div>
    <div class="fi"><label>Color</label><input type="text" id="be-color" placeholder="Keep existing"></div>
  </div>
  <div class="f2">
    <div class="fi"><label>Storage</label>
      <select id="be-storage">
        <option value="">— Leave unchanged —</option>
        ${['64GB', '128GB', '256GB', '512GB', '1TB'].map(s => `<option value="${s}">${s}</option>`).join('')}
      </select>
    </div>
    <div class="fi"><label>Buy Price (PKR)</label><input type="number" id="be-price" placeholder="Only if changing"></div>
  </div>
  <div class="fi"><label>IMEI 2</label><input type="text" id="be-imei2" placeholder="Only if updating" inputmode="numeric"></div>
  <div class="fi"><label>Notes</label><input type="text" id="be-notes" placeholder="Only if updating notes"></div>
</div>
<div class="mf">
  <button class="btn bo" onclick="closeModal()">Cancel</button>
  <button class="btn bg" onclick="saveBatchEdit()">Update Phones</button>
</div>`, true);
}

async function saveBatchEdit() {
  try {
    const ids = [...selectedPhoneIds];
    if (!ids.length) { closeModal(); showToast('Select phones first', 'warn'); return; }
    const payload = { ids };
    const brand = $('be-brand').value.trim(); if (brand) payload.brand = brand;
    const model = $('be-model').value.trim(); if (model) payload.model = model;
    const color = $('be-color').value.trim(); if (color) payload.color = color;
    const storage = $('be-storage').value; if (storage) payload.storage = storage;
    const cat = $('be-cat').value; if (cat) payload.cat = cat;
    const imei2 = $('be-imei2').value.trim().replace(/\D/g, ''); if (imei2) payload.imei2 = imei2;
    const notes = $('be-notes').value.trim(); if (notes) payload.notes = notes;
    const bpVal = $('be-price').value;
    if (bpVal !== '') {
      const bp = Number(bpVal);
      if (Number.isNaN(bp) || bp < 0) { showToast('Enter a valid buy price', 'error'); return; }
      payload.buyPrice = bp;
    }
    if (Object.keys(payload).length === 1) { showToast('Fill at least one field to update', 'warn'); return; }
    const d = await api('PUT', '/api/stock/batch', payload);

    closeModal();
    showToast(`Updated ${d.modified || ids.length} phone${(d.modified || ids.length) !== 1 ? 's' : ''}`);
    clearPhoneSelection();
    await loadIMEIData();
  } catch (error) {
    return handleApiError(error);
  }
}

async function deletePhone(id) {
  const review = destructiveScope();
  try {
    if (!id || id === 'undefined') { showToast('Invalid phone id', 'error'); return; }
    const scope = stockListScope(), page = inventoryPage;
    const phone = allIMEIStock.find(row => String(row.id || row._id) === String(id));
    if (authRole !== 'admin' || !phone || phone.status !== 'in_stock' || (page && page.scope !== scope)) throw Error('Load this in-stock phone before removing it.');
    const ok = await confirmModal({
      title: 'Remove Phone',
      message: 'Remove this in-stock phone? Retained sales and corrections stay in history. Sold phones must be returned or reversed first.',
      confirmText: 'Remove Phone',
      danger: true
    });
    if (!ok) return;
    if (review !== destructiveScope()) throw Error('Account or page changed. Review this action again.');
    if (scope !== stockListScope() || page !== inventoryPage) throw Error('Stock page changed. Review the phone again.');
    await api('DELETE', `/api/stock/${id}`);
    if (review !== destructiveScope() || scope !== stockListScope() || page !== inventoryPage) return;
    selectedPhoneIds.delete(id);
    updateBulkActions();
    showToast('Phone removed', 'warn');
    await loadIMEIData();
    loadSidebarStats();
    if (activePage === 'stock') loadDay();
  } catch (error) {
    return handleApiError(error);
  }
}
async function completeStockExport() {
  const scope = stockListScope();
  const result = await api('GET', `/api/v2/stock/export?${stockListQuery()}`);
  if (scope !== stockListScope()) return null;
  if (result.complete !== true || !Array.isArray(result.items) || result.total !== result.items.length) throw Error('Complete stock export was not acknowledged. Narrow the filters and retry.');
  return result.items;
}
async function exportIMEICSV() {
  try {
    const items = await completeStockExport(); if (!items) return;
    const header = 'IMEI 1,IMEI 2,Brand,Model,Color,Storage,Buy Price,Sale Price,Profit,Status,Shop,Added,Sold';
    const rows = items.map(phone => [phone.imei, phone.imei2 || '', phone.brand, phone.model, phone.color, phone.storage,
      phone.buyPrice ?? '', phone.salePrice ?? '', phone.salePrice == null ? '' : StocklyBusinessRules.sumMoney([phone.salePrice, -(phone.buyPrice || 0)]),
      phone.status, phone.shop || '', phone.addedAt || '', phone.soldAt || ''].map(quoteCSVCell).join(','));
    dlCSV([header, ...rows].join('\n'), `IMEI_Stock_${today()}.csv`);
  } catch (error) { return handleApiError(error); }
}

// ── SALES LOG ──
var allSalesData = [];
var imeiDetailContext = null, imeiEvidencePager = null;
async function openIMEIDetail(imei) {
  if (authRole !== 'admin' || !/^\d{15}$/.test(imei)) { showToast('Owner access and a valid IMEI are required', 'error'); return; }
  imeiDetailContext = { imei, source: 'sales', items: [] };
  showModal(`<h3>Phone history</h3><p style="font-family:var(--mono)">${esc(imei)}</p><p>Live retained evidence. Older records may have gaps. No missing movement or staff name is inferred.</p><div class="filter-row">${[['sales','Sales and returns'],['receipts','Received'],['dispatches','Sent to shops'],['activity','Activity']].map(([source,label]) => `<button class="btn bo" onclick="loadIMEIEvidence('${source}')">${label}</button>`).join('')}</div><p id="imei-evidence-status" role="status" aria-live="polite"></p><div id="imei-history-body"></div><div class="mf"><button class="btn bo" id="imei-evidence-prev" onclick="imeiEvidencePager.previous()" disabled>Previous</button><button class="btn bo" id="imei-evidence-next" onclick="imeiEvidencePager.next()" disabled>Next</button><button class="btn bo" onclick="closeModal()">Close</button></div>`);
  return loadIMEIEvidence('sales');
}
function loadIMEIEvidence(source) {
  const context = imeiDetailContext;
  if (!context || !['sales','receipts','dispatches','activity'].includes(source)) return;
  context.source = source;
  const generation = context.generation = (context.generation || 0) + 1;
  imeiEvidencePager = createListPager({ endpoint: `/api/stock/${context.imei}/history/${source}`, prefix: 'imei-evidence', body: 'imei-history-body', query: () => new URLSearchParams(),
    scope: () => JSON.stringify([listOwner(), context === imeiDetailContext, context.generation === generation, context.source, source, !!$('imei-history-body')]),
    onPage: items => { context.items = items; }, render: () => {
      const body = $('imei-history-body'); if (!body) return;
      body.innerHTML = context.items.length ? context.items.map(item => `<div class="shop-card"><div class="shop-card-body"><strong>${esc(item.action || (source === 'sales' ? item.reversedAt ? 'Sale returned / reversed' : 'Sale recorded' : source === 'receipts' ? 'Stock received' : 'Sent to shop'))}</strong><p>${esc(item.businessDate || item.date || item.ts || '')} · ${esc(item.soldByShop || item.toShop || item.shop || '')}</p>${source === 'sales' ? `<p>Original sale: ${pkr(item.salePrice)}</p><button class="btn bo" onclick="printSaleReceipt('${item._id}')">Receipt</button>` : ''}<small>Source record: ${esc(item._id)}</small></div></div>`).join('') : '<div class="empty">No retained records for this source. Older history may be incomplete.</div>';
    } });
  return imeiEvidencePager.load();
}
async function printSaleReceipt(id) {
  try {
    const owner = listOwner();
    const receipt = await api('GET', `/api/sales/${encodeURIComponent(id)}/receipt`);
    if (owner !== listOwner()) return;
    const amount = receipt.amountMinor / 100;
    printSection('Sale receipt', `<h1>Sale receipt</h1><p>${receipt.status === 'reversed' ? 'Reversed — original sale retained' : 'Recorded sale'}</p><table><tbody><tr><th>Receipt / sale ID</th><td>${esc(receipt.saleId)}</td></tr><tr><th>IMEI</th><td class="num">${esc(receipt.imei)}</td></tr><tr><th>Phone</th><td>${esc(receipt.phone)}</td></tr><tr><th>Selling shop</th><td>${esc(receipt.sellingShop)}</td></tr><tr><th>Business date (Karachi)</th><td>${esc(receipt.businessDate)}</td></tr><tr><th>Customer</th><td>${esc(receipt.buyerName || 'Not recorded')}</td></tr><tr><th>Amount</th><td>${pkr(amount)}</td></tr><tr><th>Payment method</th><td>${receipt.paymentMethod === 'cash' ? 'Cash' : receipt.paymentMethod === 'bank' ? 'Bank' : 'not recorded'}</td></tr></tbody></table><p>This receipt does not confirm a refund payment.</p>`);
  } catch (error) { return handleApiError(error); }
}

var salesPage = null, salesLoading = false, salesLoadGeneration = 0, salesSearchTimer;
function salesLogScope() { return JSON.stringify([localStorage.getItem('clientId'), authRole, authShop, $('sl-shop').value || 'ALL', $('sl-from').value, $('sl-to').value, $('sl-kind').value || 'all', $('sl-search').value.trim()]); }
function salesListQuery() {
  const query = new URLSearchParams({ shop: $('sl-shop').value || 'ALL', kind: $('sl-kind').value || 'all' });
  for (const [key, id] of [['from', 'sl-from'], ['to', 'sl-to'], ['q', 'sl-search']]) { const value = $(id).value.trim(); if (value) query.set(key, value); }
  return query;
}
function renderSalesPager() {
  const current = salesPage?.scope === salesLogScope();
  $('sl-prev').disabled = salesLoading || !current || !salesPage.previous.length;
  $('sl-next').disabled = salesLoading || !current || !salesPage.nextCursor;
}
async function loadSalesLog(options = {}) {
  const scope = salesLogScope(), generation = ++salesLoadGeneration;
  const current = () => scope === salesLogScope() && generation === salesLoadGeneration;
  salesLoading = true; renderSalesPager();
  if (salesPage?.scope !== scope) $('sl-body').innerHTML = '<div class="empty" role="status">Loading matching sales events…</div>';
  try {
    const query = salesListQuery(); query.set('limit', '50'); if (options.cursor) query.set('cursor', options.cursor);
    const page = await api('GET', `/api/v2/sales?${query}`);
    if (!current()) return;
    if (!Array.isArray(page.items) || page.items.length > 50 || !Number.isSafeInteger(page.total) || page.total < 0 || typeof page.hasMore !== 'boolean' || page.hasMore !== !!page.nextCursor) throw Error('Invalid sales page. Refresh before continuing.');
    allSalesData = page.items;
    salesPage = { scope, cursor: options.cursor || null, nextCursor: page.nextCursor, previous: options.previous || [], total: page.total };
    renderSalesLog();
  } catch (error) {
    if (!current()) return;
    if (salesPage?.scope !== scope) $('sl-body').innerHTML = '<div class="empty">Sales could not be loaded. Refresh to retry.</div>';
    $('sl-page-status').textContent = 'Could not load this page. Last loaded data is retained; refresh to retry.';
    return handleApiError(error);
  } finally { if (current()) { salesLoading = false; renderSalesPager(); } }
}
function nextSalesPage() {
  if (!salesLoading && salesPage?.scope === salesLogScope() && salesPage.nextCursor) return loadSalesLog({ cursor: salesPage.nextCursor, previous: [...salesPage.previous, salesPage.cursor] });
}
function previousSalesPage() {
  if (!salesLoading && salesPage?.scope === salesLogScope() && salesPage.previous.length) return loadSalesLog({ cursor: salesPage.previous.at(-1), previous: salesPage.previous.slice(0, -1) });
}
function scheduleSalesSearch() { clearTimeout(salesSearchTimer); salesSearchTimer = setTimeout(() => loadSalesLog(), 250); }
async function completeSalesExport() {
  const scope = salesLogScope();
  const result = await api('GET', `/api/v2/sales/export?${salesListQuery()}`);
  if (scope !== salesLogScope()) return null;
  if (result.complete !== true || !Array.isArray(result.items) || result.items.length !== result.total) throw Error('Complete sales export was not acknowledged. Narrow the filters and retry.');
  return result.items;
}

function renderSalesLog() {
  const body = $('sl-body');
  if (salesPage && salesPage.scope !== salesLogScope()) { body.innerHTML = '<div class="empty">Load the selected sales filters before viewing events.</div>'; return; }
  const sales = allSalesData;
  $('sl-page-status').textContent = `${sales.length} on this page · ${salesPage?.total ?? sales.length} matching events. Totals and reversal actions apply to this page.`;
  if (!sales.length) { body.innerHTML = `<div class="empty"><div class="empty-icon">—</div><h3>No sales found</h3><p>Try adjusting the date filters</p></div>`; return; }
  const byDate = {};
  sales.forEach(s => { const d = s.soldAt ? (s.businessDate || StocklyBusinessRules.businessDate(s.soldAt)) : 'Unknown'; if (!byDate[d]) byDate[d] = []; byDate[d].push(s); });
  const totals = StocklyBusinessRules.sumSaleEvents(sales);
  const tRev = totals.revenue, tPL = totals.profit;
  let html = `<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin:.7rem .7rem .4rem;padding:.55rem .8rem;background:var(--s2);border:1px solid var(--border);border-radius:10px;">
<div style="flex:1;min-width:110px;"><div style="font-size:.55rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px">Revenue (this page)</div><div style="font-family:var(--mono);font-size:.95rem;color:var(--success)">${pkr(tRev)}</div></div>
<div style="flex:1;min-width:110px;"><div style="font-size:.55rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px">Phone profit (this page)</div><div style="font-family:var(--mono);font-size:.95rem;color:${tPL >= 0 ? 'var(--success)' : 'var(--danger)'}">${pkr(tPL)}</div></div>
<div style="flex:1;min-width:90px;"><div style="font-size:.55rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px">Net phone units (this page)</div><div style="font-family:var(--mono);font-size:.95rem;color:var(--a1)">${totals.units}</div></div>
  </div><div style="padding:0 .7rem .7rem">`;
  Object.entries(byDate).forEach(([date, daySales]) => {
    const uid = date.replace(/-/g, '');
    const dayRev = StocklyBusinessRules.sumMoney(daySales.map(s => s.salePrice || 0));
    const dayPL = StocklyBusinessRules.sumMoney(daySales.map(s => s.profit || 0));
    html += `<div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;margin-bottom:.5rem;overflow:hidden;">
  <div style="display:flex;align-items:center;gap:.6rem;padding:.5rem .85rem;cursor:pointer;transition:background .15s;"
    onclick="toggleDateGroup('${uid}')" onmouseover="this.style.background='var(--s3)'" onmouseout="this.style.background=''">
    <div style="flex:1;">
      <div style="font-weight:700;font-size:.82rem;color:var(--white);font-family:var(--mono)">${date}</div>
      <div style="font-size:.62rem;color:var(--text2);margin-top:1px">${daySales.length} events on this page</div>
    </div>
    <div style="text-align:right;flex-shrink:0;">
      <div style="font-family:var(--mono);font-size:.8rem;color:var(--success)">${pkr(dayRev)}</div>
      <div style="font-size:.6rem;color:${dayPL >= 0 ? 'var(--a4)' : 'var(--danger)'};margin-top:1px">P/L: ${pkr(dayPL)}</div>
    </div>
    <div id="slg-arr-${uid}" style="color:var(--text2);font-size:.75rem;margin-left:4px;">▶</div>
  </div>
  <div id="slg-${uid}" style="display:none;border-top:1px solid var(--border);">
    <table style="width:100%;border-collapse:collapse;font-size:.65rem;">
      <thead><tr style="background:var(--s3)">
        <th style="text-align:left;padding:.3rem .7rem;color:var(--text3);font-size:.57rem;font-weight:600;letter-spacing:.06em">PHONE</th>
        <th style="text-align:left;padding:.3rem .7rem;color:var(--text3);font-size:.57rem;font-weight:600">IMEI</th>
        <th style="text-align:left;padding:.3rem .7rem;color:var(--text3);font-size:.57rem;font-weight:600">SHOP</th>
        <th style="text-align:left;padding:.3rem .7rem;color:var(--text3);font-size:.57rem;font-weight:600">BUYER</th>
        <th style="text-align:right;padding:.3rem .7rem;color:var(--text3);font-size:.57rem;font-weight:600">COST</th>
        <th style="text-align:right;padding:.3rem .7rem;color:var(--text3);font-size:.57rem;font-weight:600">SOLD FOR</th>
        <th style="text-align:right;padding:.3rem .7rem;color:var(--text3);font-size:.57rem;font-weight:600">PROFIT</th>
        <th style="width:28px"></th>
      </tr></thead>
      <tbody>${daySales.map(s => `<tr style="border-top:1px solid var(--border2)">
        <td style="padding:.3rem .7rem;color:var(--white);font-weight:600">${esc(s.brand || '')} ${esc(s.model || '')}${s.kind === 'reversal' ? ' — Correction' : s.reversedAt ? ' — Reversed' : ''}</td>
        <td style="padding:.3rem .7rem;font-family:var(--mono);font-size:.62rem;color:var(--text2)">${s.imei || ''}</td>
        <td style="padding:.3rem .7rem"><span style="background:rgba(${SHOP_RGBA[s.soldByShop || s.shop] || '22,163,74'},.15);color:${SHOP_COLOR[s.soldByShop || s.shop] || 'var(--a5)'};border:1px solid rgba(${SHOP_RGBA[s.soldByShop || s.shop] || '22,163,74'},.3);padding:1px 6px;border-radius:10px;font-size:.6rem;font-weight:600">${s.soldByShop || s.shop || '—'}</span></td>
        <td style="padding:.3rem .7rem;color:var(--text2)">${esc(s.buyerName || '—')}${s.buyerPhone ? `<div style="font-size:.6rem;font-family:var(--mono);color:var(--text3)">${esc(s.buyerPhone)}</div>` : ''}</td>
        <td style="padding:.3rem .7rem;text-align:right;font-family:var(--mono);color:var(--text2)">${s.buyPrice != null ? pkr(s.buyPrice) : '—'}</td>
        <td style="padding:.3rem .7rem;text-align:right;font-family:var(--mono);color:var(--success)">${pkr(s.salePrice)}</td>
        <td style="padding:.3rem .7rem;text-align:right;font-family:var(--mono);color:${(s.profit || 0) >= 0 ? 'var(--a4)' : 'var(--danger)'}">${s.profit != null ? pkr(s.profit) : '—'}</td>
        <td style="padding:.3rem .4rem;text-align:center"><button class="btn bo" onclick="printSaleReceipt('${s.saleId || s._id}')" aria-label="Print sale receipt">Receipt</button>${typeof customerReturnButton === 'function' ? customerReturnButton(s) : ''}${s.kind !== 'reversal' && !s.reversedAt ? `<button class="bx" onclick="deleteSale('${s._id || s.id}')" title="Reverse sale" aria-label="Reverse sale">×</button>` : '—'}</td>
      </tr>`).join('')}</tbody>
    </table>
  </div>
</div>`;
  });
  html += `</div>`;
  body.innerHTML = html;
}

function toggleDateGroup(uid) {
  const el = $('slg-' + uid); if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  const arr = $('slg-arr-' + uid); if (arr) arr.textContent = open ? '▶' : '▼';
}

async function deleteSale(id) {
  const review = destructiveScope();
  try {
    const context = salesLogScope(), page = salesPage;
    const sale = allSalesData.find(event => (event._id || event.id) === id);
    if (page && (page.scope !== context || !sale || sale.kind === 'reversal' || sale.reversedAt)) throw Error('Load the active sale on the selected page before reversing it.');
    const ok = await confirmModal({
      title: 'Reverse Sale',
      message: 'Return this phone to stock and record a dated correction? The original sale will remain in history.',
      confirmText: 'Return to Stock',
      danger: true
    });
    if (!ok) return;
    if (review !== destructiveScope()) throw Error('Account or page changed. Review this action again.');
    if (context !== salesLogScope() || page !== salesPage) throw Error('Sales context changed. Review the sale again.');
    await api('DELETE', `/api/sales/${id}`);
    if (review !== destructiveScope() || context !== salesLogScope() || page !== salesPage) return;

    showToast('Sale reversed — phone returned to stock', 'warn');
    await loadSalesLog();
    loadSidebarStats();
    loadIMEIData();
    if (activePage === 'stock') loadDay();
  } catch (error) {
    return handleApiError(error);
  }
}

async function deleteSaleByIMEI(imei) {
  const review = destructiveScope();
  const page = inventoryPage, scope = stockListScope();
  try {
    const sale = await api('GET', `/api/sales/current/${encodeURIComponent(imei)}`);
    if (review !== destructiveScope() || page !== inventoryPage || scope !== stockListScope()) return;
    if (!sale || sale.imei !== imei || sale.reversedAt || !/^[a-f0-9]{24}$/.test(sale._id)) throw Error('Reload the current sale before reversing it.');
    const ok = await confirmModal({
      title: 'Reverse Sale',
      message: 'Return this phone to stock and record a dated correction? The original sale will remain in history.',
      confirmText: 'Return to Stock',
      danger: true
    });
    if (!ok) return;
    if (review !== destructiveScope() || page !== inventoryPage || scope !== stockListScope()) throw Error('Account or page changed. Review this action again.');
    await api('DELETE', `/api/sales/by-imei/${encodeURIComponent(imei)}`, { saleId: sale._id });
    if (review !== destructiveScope() || page !== inventoryPage || scope !== stockListScope()) return;

    showToast('Sale reversed — phone returned to stock', 'warn');
    await loadIMEIData();
    loadSidebarStats();
    if (activePage === 'saleslog') loadSalesLog();
    if (activePage === 'stock') loadDay();
  } catch (error) {
    return handleApiError(error);
  }
}

async function exportSalesLogCSV() {
  try {
    const sales = await completeSalesExport(); if (!sales) return;
    const header = 'Date,Shop,Brand,Model,IMEI,Buyer,Cost,Sold For,Profit,Notes,Type,Sale ID';
    const rows = sales.map(event => [event.businessDate, event.soldByShop || event.shop || '', event.brand || '', event.model || '',
      event.imei, event.buyerName || '', event.buyPrice, event.salePrice, event.profit, event.notes || '', event.kind, event.saleId || event._id].map(quoteCSVCell).join(','));
    dlCSV([header, ...rows].join('\n'), `Sales_Log_${today()}.csv`);
  } catch (error) { return handleApiError(error); }
}

async function clearAllSales() {
  const review = destructiveScope();
  try {
    const context = salesLogScope(), page = salesPage;
    if (page && page.scope !== context) throw Error('Load the selected sales page before reversing it.');
    const saleIds = allSalesData.filter(s => s.kind !== 'reversal' && !s.reversedAt).map(s => s._id || s.id);
    if (!saleIds.length) return;
    const shop = $('sl-shop').value;
    const scope = shop === 'ALL' ? 'this loaded page' : 'this loaded page for Shop ' + shop;
    const ok = await confirmModal({
      title: 'Reverse Sales',
      message: `Reverse ${saleIds.length} selected sale(s) from ${scope}? Phones will return to stock; original sales and dated corrections will remain in history.`,
      confirmText: 'Reverse Sales',
      danger: true
    });
    if (!ok) return;
    if (review !== destructiveScope()) throw Error('Account or page changed. Review this action again.');
    if (context !== salesLogScope() || page !== salesPage) throw Error('Sales context changed. Review the current page again.');
    let reversed = 0;
    for (let start = 0; start < saleIds.length; start += 100) {
      if (review !== destructiveScope() || context !== salesLogScope() || page !== salesPage) throw Error('Stopped after ' + reversed + ' acknowledged reversals because the page changed. Refresh before continuing.');
      await api('DELETE', '/api/sales', { saleIds: saleIds.slice(start, start + 100) });
      reversed += Math.min(100, saleIds.length - start);
      if (review !== destructiveScope() || context !== salesLogScope() || page !== salesPage) return;
    }
    showToast(`${saleIds.length} sale(s) reversed — phones returned to stock`, 'warn');
    await loadSalesLog();
    loadSidebarStats();
    loadIMEIData();
  } catch (error) {
    return handleApiError(error);
  }
}

// ── PRODUCTS (non-IMEI items) ──────────────────────────────────────────────
var allProducts = [];

let pendingProductRequests = {};
let productEditContext = null;
function productScope() { return JSON.stringify([localStorage.getItem('clientId'), authRole, authShop, activeShop]); }
function productAddIntent() {
  return { scope: productScope(), payload: {
    name: ($('pName')?.value || '').trim(), quantity: $('pQty')?.value ?? '',
    buyPrice: $('pBuyPrice')?.value === '' ? undefined : $('pBuyPrice')?.value,
    notes: ($('pNotes')?.value || '').trim(), shop: activeShop === 'HQ' ? null : activeShop
  } };
}
function checkedProductQuantity(value) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw Error('Quantity must be a nonnegative whole number');
  return Number(value);
}
function productRequest(slot, method, url, payload) {
  return keyedRequest(pendingProductRequests, slot, productScope(), method, url, payload);
}
async function submitProduct() {
  try {
    const intent = productAddIntent();
    const { name, quantity } = intent.payload;
    if (!name) { showToast('Product name is required', 'error'); $('pName')?.focus(); return false; }
    checkedProductQuantity(quantity);
    const { request, send } = productRequest('add', 'POST', '/api/products', intent.payload);
    const { result, current } = await send();
    if (!current || request.scope !== productScope()) return;
    if (JSON.stringify(productAddIntent()) === JSON.stringify(intent)) {
      $('pName').value = '';
      $('pQty').value = '1';
      $('pBuyPrice').value = '';
      $('pNotes').value = '';
      $('pName')?.focus();
    }
    const merged = result.merged ? ` (total now ${result.product.quantity})` : '';
    showToast(`${name} ×${quantity} added${merged}`, 'success');
    loadProducts();
  } catch (error) {
    return handleApiError(error);
  }
}

function productQuery() {
  const query = new URLSearchParams({ shop: activeShop === 'HQ' ? 'ALL' : activeShop, availability: $('products-availability').value || 'all' });
  const q = $('products-search').value.trim(); if (q) query.set('q', q); return query;
}
function productListScope() { return JSON.stringify([listOwner(), productQuery().toString()]); }
var productPager = createListPager({ endpoint: '/api/v2/products', prefix: 'products', body: 'productList',
  scope: productListScope, query: productQuery, onPage: items => { allProducts = items; }, render: renderProducts });
function loadProducts() { return productPager.load(); }
function searchProducts() { clearTimeout(searchProducts.timer); searchProducts.timer = setTimeout(loadProducts, 250); }
async function exportProductsCSV() {
  try {
    const items = await productPager.exportAll(); if (!items) return;
    const rows = items.map(row => [row.name, row.shop, row.quantity, row.buyPrice, row.revision, row.notes].map(quoteCSVCell).join(','));
    dlCSV(['Name,Shop,Quantity,Buy Price,Revision,Notes', ...rows].join('\n'), `Products_${today()}.csv`);
  } catch (error) { return handleApiError(error); }
}

function renderProducts() {
  if (productPager.page && !productPager.isCurrent()) { $('productList').innerHTML = '<div class="empty">Load the selected products before viewing or editing.</div>'; return; }
  const el = $('productList');
  if (!el) return;
  if (!allProducts.length) {
    el.innerHTML = '<div style="color:var(--text3);font-size:.68rem;text-align:center;padding:12px;">No products yet — add one above.</div>';
    return;
  }
  el.innerHTML = `
<div style="font-size:.6rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">Current Products</div>
${allProducts.map(p => `
<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--bg);border:1px solid var(--border);border-radius:7px;margin-bottom:5px;">
  <div style="flex:1;min-width:0;">
    <div style="font-weight:600;font-size:.78rem;color:var(--white);">${esc(p.name)}</div>
    <div style="font-size:.62rem;color:var(--text2);margin-top:2px;">
      Qty: <b style="color:var(--a1)">${p.quantity || 0}</b>
      ${p.buyPrice ? ' · ' + pkr(p.buyPrice) + '/each' : ''}
      ${p.notes ? ' · ' + esc(p.notes) : ''}
    </div>
  </div>
  <button class="btn bo" style="font-size:.58rem;padding:.14rem .4rem;" onclick="editProductQty('${p._id || p.id}')">Edit</button>
  <button class="bx" onclick="deleteProduct('${p._id || p.id}')" aria-label="Delete product">✕</button>
</div>`).join('')}`;
}

function editProductQty(id) {
  if (productPager.page && !productPager.isCurrent()) { showToast('Reload products before editing', 'error'); return; }
  const product = allProducts.find(item => String(item._id || item.id) === id);
  if (!product) { showToast('Reload products before editing', 'error'); return; }
  const name = product.name, currentQty = product.quantity;
  productEditContext = { id, revision: product.revision ?? 0, scope: productScope() };
  showModal(`<h3>Edit ${esc(name)}</h3>
<div class="fc">
  <div class="fi"><label for="ep-qty">New Quantity</label><input type="number" id="ep-qty" value="${currentQty}" min="0" step="1"></div>
</div>
<div class="mf"><button class="btn bo" onclick="closeModal()">Cancel</button><button class="btn bv" onclick="saveProductQty('${id}')">Save</button></div>`);
  setTimeout(() => $('ep-qty')?.focus(), 100);
}

async function saveProductQty(id) {
  try {
    const edit = productEditContext;
    if (!edit || edit.id !== id || edit.scope !== productScope()) throw Error('Reload this product before editing');
    const qty = checkedProductQuantity($('ep-qty')?.value ?? '');
    const { request, send } = productRequest('edit', 'PUT', `/api/products/${id}`, { quantity: qty, expectedRevision: edit.revision });
    const { current } = await send();
    if (!current || request.scope !== productScope()) return;

    if (productEditContext === edit && Number($('ep-qty')?.value) === qty) { productEditContext = null; closeModal(); }
    showToast('Quantity updated', 'success');
    loadProducts();
  } catch (error) {
    return handleApiError(error);
  }
}

async function deleteProduct(id) {
  const review = destructiveScope();
  try {
    const page = productPager.page;
    if (page && !productPager.isCurrent()) throw Error('Reload products before deleting');
    const product = allProducts.find(item => String(item._id || item.id) === id);
    if (!product) throw Error('Reload this product before deleting');
    const name = product.name;
    const expectedRevision = product.revision ?? 0;
    const scope = productScope();
    const ok = await confirmModal({
      title: 'Delete Product',
      message: `Are you sure you want to delete "${name}" from products / accessories?`,
      confirmText: 'Delete Product',
      danger: true
    });
    if (!ok) return;
    if (review !== destructiveScope()) throw Error('Account or page changed. Review this action again.');
    if (scope !== productScope() || page !== productPager.page || (page && !productPager.isCurrent())) throw Error('Product page changed. Review it again before deleting');
    const { request, send } = productRequest('delete', 'DELETE', `/api/products/${id}`, { expectedRevision });
    const { current } = await send();
    if (!current || request.scope !== productScope() || review !== destructiveScope() || page !== productPager.page || (page && !productPager.isCurrent())) return;

    showToast(`${name} deleted`, 'warn');
    loadProducts();
  } catch (error) {
    return handleApiError(error);
  }
}

function updateSearchClearBtn() {
  const input = $('imeiSearch');
  const btn = $('imeiSearchClear');
  if (!input || !btn) return;
  btn.style.display = input.value.trim() ? 'block' : 'none';
}

function clearIMEISearch() {
  const input = $('imeiSearch');
  if (input) {
    input.value = '';
    updateSearchClearBtn();
    input.focus();
    loadIMEIData();
  }
}
