/* ── CEO Dashboard, Analytics, Reports, Logs, Warehouse, Contacts ── */
/* Auto-split from index.html — 2026-04-25T15:26:28.699Z */

// ── WAREHOUSE ──
async function loadWarehouse() { hqStock = await api('GET', '/api/hqstock'); renderWarehouse(); }
function renderWarehouse() {
  const q = ($('wh-search')?.value || '').toLowerCase();
  const items = (hqStock.items || []).filter(it => {
    const label = (it.name || [it.brand, it.model, it.storage].filter(Boolean).join(' '));
    return !q || (label + String(it.cat || '') + String(it.imei || '')).toLowerCase().includes(q);
  });
  const body = $('wh-body');
  if (!items.length) { body.innerHTML = `<div class="empty"><div class="empty-icon">—</div><h3>Warehouse empty</h3><p>Click + Receive Stock to add items</p></div>`; return; }
  const byCat = {}; items.forEach(it => { const cat = it.cat || guessCat(it.brand, it.model, it.cat); if (!byCat[cat]) byCat[cat] = []; byCat[cat].push(it); });
  body.innerHTML = `<div style="padding:.9rem">${Object.entries(byCat).map(([cat, rows]) => { const c = CATS[cat]; return `<div class="cb ${c ? c.cls : 'cot'}" style="margin-bottom:.65rem"><div class="ch"><div class="cl">${esc(c ? c.label : cat)}</div><div class="cts"><span>Phones:<b>${rows.length}</b></span></div></div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:.45rem">${rows.map(it => { const name = [it.brand, it.model, it.storage].filter(Boolean).join(' ') || it.name || 'Phone'; return `<div class="wh-card"><div class="wh-cat">${esc(it.cat || cat)}</div><div class="wh-name">${esc(name)}</div><div class="wh-meta" style="margin-top:3px;color:var(--text2);font-family:var(--mono);font-size:.62rem">${esc(it.imei || '')}</div>${it.imei2 ? `<div class="wh-meta" style="font-family:var(--mono);font-size:.62rem;color:var(--text3)">IMEI2: ${esc(it.imei2)}</div>` : ''}<div class="wh-meta">${it.costPerUnit ? pkr(it.costPerUnit) : it.buyPrice ? pkr(it.buyPrice) : ''}</div>${it.imei ? `<div style="margin-top:6px;display:flex;justify-content:flex-end"><button class="btn" style="font-size:.58rem;padding:.14rem .45rem;background:var(--danger);border-color:var(--danger);color:#fff" onclick="deleteWarehouseImei('${esc(it.imei || '')}')">Delete</button></div>` : ''}</div>`; }).join('')}</div></div>`; }).join('')}</div>`;

}

var rcItems = [];
function openReceiveModal() {
  rcItems = [];
  showModal(`<h3>+ Receive Stock into Warehouse</h3>
<div class="fc">
  <div class="f2"><div class="fi"><label>Supplier</label><input type="text" id="rc-supplier" placeholder="Supplier name"></div><div class="fi"><label>Date</label><input type="date" id="rc-date" value="${today()}"></div></div>
  <div class="fi"><label>Reference</label><input type="text" id="rc-ref" placeholder="Invoice #, notes…"></div>
  <div style="font-size:.66rem;color:var(--text2);margin:.1rem 0 .35rem;line-height:1.5">Set shared phone details once, then scan IMEI pairs and add each phone to queue.</div>
  <div class="form-grid" style="margin-bottom:10px;">
    <div class="form-group"><label>Category</label>
      <select id="rc-cat" onchange="autoBrandFromCat('rc-cat','rc-brand')">${Object.keys(CATS).map(k => `<option value="${k}" ${k === 'IPHONE' ? 'selected' : ''}>${k}</option>`).join('')}</select>
    </div>
    <div class="form-group"><label>Brand</label><input id="rc-brand" type="text" placeholder="Apple, Samsung…" oninput="autoSelectCat(this.value,'rc-cat')"></div>
    <div class="form-group"><label>Model</label><input id="rc-model" type="text" placeholder="iPhone 14, S24…"></div>
    <div class="form-group"><label>Shared Color</label><input id="rc-color" type="text" placeholder="Black, White…"></div>
    <div class="form-group"><label>Storage</label>
      <select id="rc-storage"><option value="">—</option><option>32GB</option><option>64GB</option><option>128GB</option><option>256GB</option><option>512GB</option><option>1TB</option></select>
    </div>
    <div class="form-group"><label>Buy Price (PKR)</label><input type="number" id="rc-buy" min="0" placeholder="Cost per unit"></div>
    <div class="form-group full"><label>Shared Notes</label><input id="rc-notes" type="text" placeholder="Condition, accessories, box status…"></div>
  </div>
  <div style="background:var(--s2);border:1px solid var(--border);border-radius:9px;padding:10px;margin-bottom:10px;">
    <div style="font-size:.6rem;font-weight:700;color:var(--a1);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">Scan Next IMEI Pair</div>
    <div class="imei-pair-grid" style="margin-bottom:8px;">
      <div>
        <div style="font-size:.58rem;font-weight:700;color:var(--a1);margin-bottom:4px;text-transform:uppercase;letter-spacing:.06em">IMEI 1</div>
        <div style="display:flex;gap:5px;">
          <input type="text" id="rc-next-i1" placeholder="Scan IMEI 1…" inputmode="numeric" class="imei2-field" style="flex:1"
            oninput="this.value=this.value.replace(/[^0-9]/g,'')"
            onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('rc-next-i2').focus();}">
          <button class="btn bo" onclick="openCamera('rc1:next')" style="padding:6px 9px;font-size:.75rem;flex-shrink:0;">Cam</button>
        </div>
      </div>
      <div>
        <div style="font-size:.58rem;font-weight:700;color:var(--text2);margin-bottom:4px;text-transform:uppercase;letter-spacing:.06em">IMEI 2 (optional)</div>
        <div style="display:flex;gap:5px;">
          <input type="text" id="rc-next-i2" placeholder="Scan IMEI 2…" inputmode="numeric" class="imei2-field" style="flex:1"
            oninput="this.value=this.value.replace(/[^0-9]/g,'')"
            onkeydown="if(event.key==='Enter'){event.preventDefault();addToReceiveQueue();}">
          <button class="btn bo" onclick="openCamera('rc2:next')" style="padding:6px 9px;font-size:.75rem;flex-shrink:0;">Cam</button>
        </div>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:8px;">
      <label>This phone color (optional)</label>
      <input type="text" id="rc-next-color" placeholder="Overrides shared color for this phone only">
    </div>
    <button class="btn bb" onclick="addToReceiveQueue()" style="width:100%;font-size:.75rem;">+ Add This Phone to Queue</button>
  </div>
  <div id="rc-queue" style="display:none;">
    <div style="font-size:.62rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">
      <span>Queue <span id="rc-count" style="color:var(--a1);">0</span> phones</span>
      <button class="btn bo" onclick="clearReceiveQueue()" style="font-size:.6rem;padding:.15rem .4rem;">Clear all</button>
    </div>
    <div id="rc-items"></div>
  </div>
</div>
<div class="mf"><button class="btn bo" onclick="closeModal()">Cancel</button><button class="btn bv" id="rc-save-btn" onclick="saveReceive()" disabled>Save All</button></div>`);
  $('rc-brand')?.focus();
}
function addToReceiveQueue() {
  const imei1 = ($('rc-next-i1')?.value || '').trim().replace(/\D/g, '');
  const imei2 = ($('rc-next-i2')?.value || '').trim().replace(/\D/g, '');
  const entryColor = ($('rc-next-color')?.value || '').trim();
  const sharedColor = ($('rc-color')?.value || '').trim();
  const cat = ($('rc-cat')?.value || '').trim();
  const brand = ($('rc-brand')?.value || '').trim();
  const model = ($('rc-model')?.value || '').trim();
  const storage = ($('rc-storage')?.value || '').trim();
  const buyPrice = Number(($('rc-buy')?.value || '').trim()) || 0;
  const notes = ($('rc-notes')?.value || '').trim();
  if (!imei1) { showToast('IMEI 1 is required', 'error'); $('rc-next-i1')?.focus(); return; }
  if (imei1.length !== 15) { showToast('IMEI 1 must be exactly 15 digits', 'error'); return; }
  if (imei2 && imei2.length !== 15) { showToast('IMEI 2, if provided, must be exactly 15 digits', 'error'); return; }
  if (!brand && !model) { showToast('Brand or Model is required', 'error'); $('rc-brand')?.focus(); return; }
  const duplicateEntry = rcItems.find(e =>
    e.imei === imei1 ||
    e.imei2 === imei1 ||
    (imei2 && (e.imei === imei2 || e.imei2 === imei2))
  );
  if (duplicateEntry) { showToast('This IMEI is already in the queue', 'warn'); return; }
  rcItems.push({ imei: imei1, imei2, cat, brand, model, color: entryColor || sharedColor, storage, buyPrice, notes });
  const nextI1 = $('rc-next-i1'); if (nextI1) nextI1.value = '';
  const nextI2 = $('rc-next-i2'); if (nextI2) nextI2.value = '';
  const nextColor = $('rc-next-color'); if (nextColor) nextColor.value = '';
  $('rc-next-i1')?.focus();
  renderRCItems();
  showToast(`Phone ${rcItems.length} added to queue`);
}
function renderRCItems() {
  const el = $('rc-items'); if (!el) return;
  const q = $('rc-queue'), count = $('rc-count'), saveBtn = $('rc-save-btn');
  if (!rcItems.length) {
    if (q) q.style.display = 'none';
    if (saveBtn) saveBtn.disabled = true;
    el.innerHTML = '';
    return;
  }
  if (q) q.style.display = 'block';
  if (count) count.textContent = rcItems.length;
  if (saveBtn) saveBtn.disabled = false;
  el.innerHTML = rcItems.map((it, i) => `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--bg);border:1px solid var(--border);border-radius:7px;margin-bottom:5px;font-family:var(--mono);font-size:.68rem;">
<span style="color:var(--a1);font-weight:700;min-width:20px;">#${i + 1}</span>
<div style="flex:1;min-width:0;">
  <div style="color:var(--white);">IMEI 1: ${esc(it.imei)}</div>
  ${it.imei2 ? `<div style="color:var(--text2);font-size:.62rem;margin-top:2px;">IMEI 2: ${esc(it.imei2)}</div>` : ''}
  <div style="color:var(--text2);font-size:.62rem;margin-top:2px;">${esc([it.brand, it.model, it.storage].filter(Boolean).join(' '))} · ${esc(it.color) || 'No color'}</div>
</div>
<button class="bx" onclick="removeReceiveQueueItem(${i})">✕</button>
  </div>`).join('');
}
function removeReceiveQueueItem(i) { rcItems.splice(i, 1); renderRCItems(); }
function clearReceiveQueue() { rcItems = []; renderRCItems(); }
async function saveReceive() {
  const supplier = $('rc-supplier').value.trim(), date = $('rc-date').value, ref = $('rc-ref').value.trim();
  const items = rcItems
    .map(it => ({
      imei: (it.imei || '').replace(/\D/g, ''),
      imei2: (it.imei2 || '').replace(/\D/g, ''),
      cat: it.cat,
      brand: (it.brand || '').trim(),
      model: (it.model || '').trim(),
      color: (it.color || '').trim(),
      storage: (it.storage || '').trim(),
      buyPrice: Number(it.buyPrice) || 0,
      notes: (it.notes || '').trim()
    }))
    .filter(it => it.imei);
  if (!items.length) { showToast('Queue is empty', 'error'); return; }
  if (items.some(it => it.imei.length !== 15)) { showToast('Each IMEI must be exactly 15 digits', 'error'); return; }
  const unique = new Set(items.map(it => it.imei)); if (unique.size !== items.length) { showToast('Duplicate IMEIs in shipment', 'error'); return; }
  const saveBtn = $('rc-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
  let r = {};
  let shouldReEnable = true;
  let requestError = '';
  try {
    r = await api('POST', '/api/shipments', { date, supplier, ref, items });
    if (!r.error) shouldReEnable = false;
  } catch (e) {
    requestError = 'Network error while saving shipment';
  } finally {
    if (saveBtn && shouldReEnable) { saveBtn.textContent = 'Save All'; saveBtn.disabled = false; }
  }
  if (requestError) { showToast(requestError, 'error'); return; }
  if (r.error) { showToast(r.error, 'error'); return; }
  closeModal(); rcItems = []; loadWarehouse(); loadShipments(); showToast(`${items.length} phone(s) received`);
}

function openDispatchModal() {
  const items = (hqStock.items || []).filter(it => it.imei);
  if (!items.length) { showToast('Warehouse is empty', 'warn'); return; }
  showModal(`<h3>↗ Dispatch to Shop</h3>
<div class="fc">
  <div class="f2"><div class="fi"><label>To Shop</label><select id="ds-shop">${SHOPS.map(s => `<option value="${s}">${s}</option>`).join('')}</select></div><div class="fi"><label>Date</label><input type="date" id="ds-date" value="${today()}"></div></div>
  <div class="fi"><label>Note</label><input type="text" id="ds-note" placeholder="Notes…"></div>
  <div style="font-size:.62rem;color:var(--text2);margin:.3rem 0;font-weight:600">Select phones to dispatch:</div>
  <div style="max-height:230px;overflow-y:auto">${items.map((it, i) => { const label = [it.brand, it.model, it.storage].filter(Boolean).join(' ') || it.name || 'Phone'; return `<div style="display:flex;align-items:center;gap:.5rem;padding:.24rem 0;border-bottom:1px solid var(--border2)"><input type="checkbox" id="dsi-${i}" style="width:14px;height:14px"><label for="dsi-${i}" style="flex:1;color:var(--white);font-size:.68rem">${esc(label)} <span style="color:var(--text2);font-family:var(--mono)">${esc(it.imei || '')}</span></label></div>`; }).join('')}</div>
</div>
<div class="mf"><button class="btn bo" onclick="closeModal()">Cancel</button><button class="btn bb" onclick="saveDispatch(${JSON.stringify(items).replace(/"/g, '&quot;')})">Dispatch</button></div>`);
}
async function saveDispatch(items) {
  const toShop = $('ds-shop').value, date = $('ds-date').value, note = $('ds-note').value.trim();
  const dispatched = [];
  items.forEach((it, i) => {
    const chk = document.getElementById(`dsi-${i}`);
    if (chk?.checked && it.imei) {
      dispatched.push({
        imei: it.imei, imei2: it.imei2 || '', cat: it.cat || guessCat(it.brand, it.model, it.cat),
        brand: it.brand || '', model: it.model || '', color: it.color || '', storage: it.storage || '',
        buyPrice: Number(it.buyPrice || it.costPerUnit || 0), notes: it.notes || ''
      });
    }
  });
  if (!dispatched.length) { showToast('Select at least one phone', 'error'); return; }
  const r = await api('POST', '/api/dispatches', { date, toShop, note, items: dispatched });
  if (r.error) { showToast(r.error, 'error'); return; }
  closeModal(); loadWarehouse(); loadShipments(); showToast(`${dispatched.length} phone(s) dispatched to Shop ${toShop}`);
}

async function openDispatchFromShipments() {
  // Ensure warehouse data is fresh before opening dispatch modal
  if (!hqStock || !hqStock.items) {
    const fetched = await api('GET', '/api/hqstock');
    if (fetched.error) { showToast('Failed to load warehouse data', 'error'); return; }
    hqStock = fetched;
  }
  openDispatchModal();
}

// ── SHIPMENTS ──
async function loadShipments() { [allShipments, allDispatches] = await Promise.all([api('GET', '/api/shipments'), api('GET', '/api/dispatches')]); renderShipments(); }
function renderShipments() {
  const shopF = $('ship-shop-filter').value, monthF = $('ship-month-filter').value;
  let all = [...allShipments.map(s => ({ ...s, source: 'inbound' })), ...allDispatches.map(d => ({ ...d, source: 'dispatch' }))].sort((a, b) => b.date.localeCompare(a.date));
  if (monthF) all = all.filter(s => s.date.startsWith(monthF));
  if (shopF !== 'ALL') { if (shopF === 'HQ') all = all.filter(s => s.source === 'inbound'); else all = all.filter(s => s.source === 'dispatch' && s.toShop === shopF); }
  const body = $('ship-body');
  if (!all.length) { body.innerHTML = `<div class="empty"><div class="empty-icon">—</div><h3>No shipments found</h3></div>`; return; }
  const catC = { IPHONE: 'var(--a1)', SAMSUNG: 'var(--a2)', GOOGLE: 'var(--a4)', OTHER: 'var(--a5)', BOX: 'var(--a6)', EXTRA: 'var(--a3)' };
  body.innerHTML = `<div style="padding:.9rem">${all.map(sh => { const isD = sh.source === 'dispatch'; const c = isD ? (SHOP_COLOR[sh.toShop] || 'var(--a5)') : 'var(--a4)'; const r = isD ? (SHOP_RGBA[sh.toShop] || '22,163,74') : '2,132,199'; const imeiItems = (sh.items || []).filter(it => it.imei); const tot = imeiItems.length || ((sh.items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0)); const sold = isD ? (Number(sh.soldPhones) || 0) : 0; const sellPct = isD && tot ? Math.round((sold / tot) * 100) : 0; const id = sh._id || sh.id || ''; return `<div class="ship-card"><div class="ship-hd" style="background:rgba(${r},.05);border-bottom:1px solid rgba(${r},.12)"><span style="font-size:.82rem;font-weight:700;color:${c}">${isD ? `→ Shop ${esc(sh.toShop)}` : '⬇ Inbound'}</span><span style="font-family:var(--mono);font-size:.63rem;color:var(--text2)">${esc(sh.date)}</span>${sh.supplier ? `<span style="font-size:.63rem;color:var(--text2)">${esc(sh.supplier)}</span>` : ''}${sh.note || sh.ref ? `<span style="font-size:.63rem;color:var(--text2)">${esc(sh.note || sh.ref)}</span>` : ''}<span style="margin-left:auto;font-size:.63rem;color:var(--a5);font-family:var(--mono)">${tot} phone${tot === 1 ? '' : 's'}</span><button class="btn" style="margin-left:8px;font-size:.56rem;padding:.1rem .4rem;background:var(--danger);border-color:var(--danger);color:#fff" onclick="deleteShipmentRecord('${isD ? 'dispatch' : 'shipment'}','${esc(id)}')">Delete</button></div>${isD ? `<div style="padding:.35rem .55rem .15rem;font-size:.6rem;color:var(--text2)">Sold from this shipment: <span style="color:${sold > 0 ? 'var(--success)' : 'var(--text2)'};font-weight:700">${sold}</span> / ${tot} (${sellPct}%)</div>` : ''}<div class="ship-items">${(sh.items || []).map(it => { const name = [it.brand, it.model, it.storage].filter(Boolean).join(' ') || it.name || 'Phone'; return `<div style="display:flex;gap:.5rem;align-items:center;padding:.2rem 0;border-bottom:1px solid var(--border2);font-size:.63rem"><span style="flex:1;color:var(--white)">${esc(name)}</span><span style="padding:.03rem .28rem;background:var(--s3);color:${catC[it.cat] || 'var(--text2)'};border-radius:4px;font-size:.52rem;font-weight:600">${esc(it.cat || '')}</span>${it.imei ? `<span style="color:var(--text2);font-family:var(--mono)">${esc(it.imei)}</span>` : `<span style="color:var(--text2)">×${it.qty}</span>`}${it.costPerUnit || it.buyPrice ? `<span style="color:var(--a5);font-family:var(--mono)">${pkr(it.costPerUnit || it.buyPrice)}</span>` : ''}</div>`; }).join('')}</div></div>`; }).join('')}</div>`;

}

// ── BACKUP ──
async function doBackup() {
  const tok = localStorage.getItem('authToken');
  if (!tok) { showToast('Please sign in again', 'error'); return; }
  try {
    const r = await fetch(BASE + '/api/backup', { headers: { Authorization: 'Bearer ' + tok } });
    if (r.status === 401) { showToast('Session expired — please sign in again', 'warn'); return; }
    if (!r.ok) { showToast('Backup failed', 'error'); return; }
    const data = await r.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `imei-stock-backup-${today()}.json`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    showToast('Backup downloaded');
  } catch (e) { showToast('Backup failed', 'error'); }
}
async function doRestore() {
  const file = $('restoreFile')?.files[0]; if (!file) { showToast('Select a backup file', 'error'); return; }
  if (!confirm('This will overwrite existing data. Continue?')) return;
  try { const data = JSON.parse(await file.text()); const r = await api('POST', '/api/restore', data); if (r.success) { showToast('Restore complete — reloading…'); setTimeout(() => location.reload(), 1200); } else showToast('Restore failed: ' + (r.error || 'unknown'), 'error'); } catch (e) { showToast('Error reading file', 'error'); }
}

async function deleteShipmentRecord(type, id) {
  if (!id) { showToast('Cannot delete this record', 'error'); return; }
  if (!confirm('Delete this shipment record?')) return;
  const ep = type === 'dispatch' ? `/api/dispatches/${id}` : `/api/shipments/${id}`;
  const r = await api('DELETE', ep);
  if (r.success) { loadShipments(); showToast('Shipment deleted', 'warn'); }
  else showToast(r.error || 'Delete failed', 'error');
}

async function deleteWarehouseImei(imei) {
  const raw = String(imei || '').replace(/\D/g, '');
  if (raw.length !== 15) { showToast('Invalid IMEI', 'error'); return; }
  if (!confirm(`Delete IMEI ${raw} from warehouse?`)) return;
  const r = await api('DELETE', `/api/hqstock/${raw}`);
  if (r.success) { loadWarehouse(); showToast('Warehouse phone deleted', 'warn'); }
  else showToast(r.error || 'Delete failed', 'error');
}

// ── CEO DASHBOARD ────────────────────────────────
async function renderCEO() {
  const month = $('ceo-month').value || ym(today());
  const body = $('ceo-body');
  body.innerHTML = `<div class="empty"><div class="empty-icon">—</div><h3>Loading…</h3></div>`;
  const d = await api('GET', `/api/ceo/summary?month=${month}`);
  if (d.error) { body.innerHTML = `<div class="empty"><div class="empty-icon">!</div><h3>${d.error}</h3></div>`; return; }
  lastCEOSummary = { ...d, month };

  const momRev = d.prev.revenue > 0 ? ((d.current.revenue - d.prev.revenue) / d.prev.revenue * 100) : null;
  const momPL = d.prev.profit > 0 ? ((d.current.profit - d.prev.profit) / d.prev.profit * 100) : null;

  function momTag(pct) {
    if (pct === null) return `<div class="kpi-mom flat">— no prior month</div>`;
    const up = pct >= 0; const abs = Math.abs(pct).toFixed(1);
    return `<div class="kpi-mom ${up ? 'up' : 'dn'}">${up ? '▲' : '▼'} ${abs}% vs last month</div>`;
  }
  function sign(n) { return n >= 0 ? '+ ' : '- '; }
  const net = d.current.netProfit;

  let html = `<div class="ceo-grid">
<div class="kpi-card green">
  <div class="kpi-lbl">Monthly Revenue</div>
  <div class="kpi-val success">${pkr(d.current.revenue)}</div>
  ${momTag(momRev)}
</div>
<div class="kpi-card ${net >= 0 ? 'green' : 'red'}">
  <div class="kpi-lbl">Net Profit / Loss</div>
  <div class="kpi-val ${net >= 0 ? 'success' : 'danger'}">${pkr(net)}</div>
  ${momTag(momPL)}
</div>
<div class="kpi-card red">
  <div class="kpi-lbl">Total Expenses</div>
  <div class="kpi-val danger">${pkr(d.current.expenses)}</div>
  <div class="kpi-mom flat">all shops combined</div>
</div>
<div class="kpi-card amber">
  <div class="kpi-lbl">Units Sold</div>
  <div class="kpi-val amber">${d.current.units}</div>
  <div class="kpi-mom flat">phones this month</div>
</div>
<div class="kpi-card blue">
  <div class="kpi-lbl">Inventory (in stock)</div>
  <div class="kpi-val blue">${d.inventoryCount}</div>
  <div class="kpi-mom flat">${pkr(d.inventoryValue)} cost value</div>
</div>
<div class="kpi-card ${d.current.profit >= 0 ? 'green' : 'red'}">
  <div class="kpi-lbl">Gross Profit</div>
  <div class="kpi-val ${d.current.profit >= 0 ? 'success' : 'danger'}">${pkr(d.current.profit)}</div>
  <div class="kpi-mom flat">before expenses</div>
</div>
  </div>`;

  // Per-shop performance
  html += `<div class="ceo-section-title">Shop Performance — ${month}</div><div class="ceo-shop-grid">`;
  currentClientShops.forEach(s => {
    const sh = s.id;
    const v = d.shopStats[sh] || { revenue: 0, profit: 0, units: 0, expenses: 0 };
    const net = v.profit - v.expenses;
    const c = SHOP_COLOR[sh] || 'var(--a5)';
    const r = SHOP_RGBA[sh] || '22,163,74';
    const health = net >= 0 ? 'var(--success)' : 'var(--danger)';
    html += `<div class="ceo-shop-card">
  <div class="ceo-shop-hd" style="background:rgba(${r},.06);border-bottom:1px solid rgba(${r},.15)">
    <div style="font-size:.88rem;font-weight:700;color:${c}">${esc(s.name || sh)}</div>
    <div style="font-size:.62rem;padding:2px 8px;border-radius:20px;background:${net >= 0 ? 'rgba(16,185,129,.1)' : 'rgba(244,63,94,.1)'};color:${health};border:1px solid ${net >= 0 ? 'rgba(16,185,129,.25)' : 'rgba(244,63,94,.25)'};">${net >= 0 ? '✓ Profitable' : '⚠ Loss'}</div>
  </div>
  <div class="ceo-shop-body">
    <div class="ceo-shop-row"><span>Revenue</span><span style="color:var(--success);font-family:var(--mono)">${pkr(v.revenue)}</span></div>
    <div class="ceo-shop-row"><span>Cost of Sales</span><span style="color:var(--text2);font-family:var(--mono)">${pkr(v.cost)}</span></div>
    <div class="ceo-shop-row"><span>Gross Profit</span><span style="color:${v.profit >= 0 ? 'var(--a4)' : 'var(--danger)'};font-family:var(--mono)">${pkr(v.profit)}</span></div>
    <div class="ceo-shop-row"><span>Expenses</span><span style="color:var(--danger);font-family:var(--mono)">${pkr(v.expenses)}</span></div>
    <div class="ceo-shop-row total"><span>Net P/L</span><span style="color:${health};font-family:var(--mono)">${pkr(net)}</span></div>
    <div class="ceo-shop-row"><span>Units Sold</span><span style="color:var(--a1)">${v.units}</span></div>
  </div>
</div>`;
  });
  html += `</div>`;

  // Top models
  if (d.topModels?.length) {
    html += `<div class="ceo-section-title">Top Selling Models — ${month}</div>
<div style="background:var(--s1);border:1px solid var(--border);border-radius:10px;margin:0 .9rem .9rem;overflow:hidden;">
  ${d.topModels.map((m, i) => `<div class="top-model-row">
    <div class="top-model-rank">#${i + 1}</div>
    <div class="top-model-name">${esc(m.model)}</div>
    <div style="display:flex;align-items:center;gap:6px">
      <div class="top-model-count">${m.count} unit${m.count !== 1 ? 's' : ''}</div>
    </div>
  </div>`).join('')}
</div>`;
  }

  // Quick insights
  const bestShop = SHOPS.reduce((best, sh) => {
    const v = d.shopStats[sh] || {};
    return (v.revenue || 0) > (d.shopStats[best]?.revenue || 0) ? sh : best;
  }, SHOPS[0]);
  html += `<div style="margin:.2rem .9rem .9rem;background:rgba(22,163,74,.05);border:1px solid rgba(22,163,74,.18);border-radius:10px;padding:.75rem 1rem;">
<div style="font-size:.62rem;font-weight:700;color:var(--a1);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.5rem">Quick Insights</div>
<div style="font-size:.72rem;color:var(--text2);line-height:1.9">
  ${d.current.revenue > d.prev.revenue ? 'Revenue is <b style="color:var(--success)">up</b>' : 'Revenue is <b style="color:var(--danger)">down</b>'} compared to last month.<br>
  Best performing shop this month: <b style="color:${SHOP_COLOR[bestShop] || 'var(--a5)'}">Shop ${bestShop}</b>.<br>
  Net profit this month: <b style="color:${net >= 0 ? 'var(--success)' : 'var(--danger)'}">${pkr(net)}</b> (after all expenses).<br>
  You have <b style="color:var(--a1)">${d.inventoryCount} phones</b> in stock worth <b style="color:var(--a5)">${pkr(d.inventoryValue)}</b>.
</div>
  </div>`;

  body.innerHTML = html;
}

// ── CONTACTS ─────────────────────────────────────
var allContacts = [];

async function loadContacts() {
  const q = $('contact-search')?.value || '';
  const url = q ? `/api/customers?q=${encodeURIComponent(q)}` : '/api/customers';
  const data = await api('GET', url);
  allContacts = Array.isArray(data) ? data : [];
  renderContacts();
}

function searchContacts() {
  clearTimeout(searchContacts._t);
  searchContacts._t = setTimeout(loadContacts, 300);
}

function renderContacts() {
  const body = $('contacts-body');
  if (!allContacts.length) {
    body.innerHTML = `<div class="empty"><div class="empty-icon">—</div><h3>No contacts found</h3></div>`;
    return;
  }
  body.innerHTML = `<div style="padding:.9rem;overflow-x:auto;">
<table class="contact-table">
  <thead><tr>
    <th>NAME</th><th>PHONE</th><th>EMAIL</th><th>NOTES</th><th>ADDED</th><th style="width:70px"></th>
  </tr></thead>
  <tbody>${allContacts.map(c => `<tr>
    <td style="font-weight:600">${esc(c.name || '')}</td>
    <td style="font-family:var(--mono);font-size:.65rem">${esc(c.phone || '—')}</td>
    <td style="font-size:.65rem;color:var(--text2)">${esc(c.email || '—')}</td>
    <td style="font-size:.65rem;color:var(--text2);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.notes || '')}</td>
    <td style="font-family:var(--mono);font-size:.6rem;color:var(--text3)">${fmtDate(c.addedAt)}</td>
    <td style="text-align:center">
      <button class="btn bo" onclick="openEditContactModal('${c._id}')" style="font-size:.6rem;padding:.18rem .45rem;margin-right:3px">Edit</button>
      <button class="bx" onclick="deleteContact('${c._id}')" title="Delete">✕</button>
    </td>
  </tr>`).join('')}</tbody>
</table>
  </div>`;
}

function openAddContactModal() {
  showModal(`<h3>+ Add Contact</h3>
<div class="fc">
  <div class="f2">
    <div class="fi"><label>Name *</label><input type="text" id="ct-name" placeholder="Full name"></div>
    <div class="fi"><label>Phone</label><input type="text" id="ct-phone" placeholder="+92 300 1234567" inputmode="tel"></div>
  </div>
  <div class="fi"><label>Email</label><input type="text" id="ct-email" placeholder="example@email.com"></div>
  <div class="fi"><label>Notes</label><input type="text" id="ct-notes" placeholder="Any notes…"></div>
</div>
<div class="mf"><button class="btn bo" onclick="closeModal()">Cancel</button><button class="btn bv" onclick="saveContact(null)">Save</button></div>`);
  setTimeout(() => $('ct-name')?.focus(), 80);
}

function openEditContactModal(id) {
  const c = allContacts.find(x => x._id === id);
  if (!c) return;
  showModal(`<h3>Edit Contact</h3>
<div class="fc">
  <div class="f2">
    <div class="fi"><label>Name *</label><input type="text" id="ct-name" placeholder="Full name"></div>
    <div class="fi"><label>Phone</label><input type="text" id="ct-phone" placeholder="+92 300 1234567" inputmode="tel"></div>
  </div>
  <div class="fi"><label>Email</label><input type="text" id="ct-email"></div>
  <div class="fi"><label>Notes</label><input type="text" id="ct-notes"></div>
</div>
<div class="mf"><button class="btn bo" onclick="closeModal()">Cancel</button><button class="btn bv" onclick="saveContact('${id}')">Save</button></div>`);
  setTimeout(() => {
    $('ct-name').value = c.name || '';
    $('ct-phone').value = c.phone || '';
    $('ct-email').value = c.email || '';
    $('ct-notes').value = c.notes || '';
    $('ct-name')?.focus();
  }, 80);
}

async function saveContact(id) {
  const name = $('ct-name')?.value.trim();
  if (!name) { showToast('Name is required', 'error'); return; }
  const payload = { name, phone: $('ct-phone')?.value.trim(), email: $('ct-email')?.value.trim(), notes: $('ct-notes')?.value.trim() };
  const d = id ? await api('PUT', `/api/customers/${id}`, payload) : await api('POST', '/api/customers', payload);
  if (d.error) { showToast(d.error, 'error'); return; }
  closeModal(); showToast(id ? 'Contact updated' : 'Contact added');
  loadContacts();
}

async function deleteContact(id) {
  if (!confirm('Delete this contact?')) return;
  const d = await api('DELETE', `/api/customers/${id}`);
  if (d.error) { showToast(d.error, 'error'); return; }
  showToast('Contact deleted', 'warn');
  loadContacts();
}

// ── ANALYTICS ────────────────────────────────────
async function renderAnalytics() {
  const days = $('analytics-days')?.value || 30;
  const body = $('analytics-body');
  body.innerHTML = `<div class="empty"><div class="empty-icon">—</div><h3>Loading…</h3></div>`;
  const d = await api('GET', `/api/analytics/models?days=${days}`);
  if (d.error) { body.innerHTML = `<div class="empty"><div class="empty-icon">!</div><h3>${d.error}</h3></div>`; return; }
  lastAnalyticsData = d;

  const maxSold = d.topSold.length ? d.topSold[0].count : 1;
  const maxStale = d.stagnating.length ? d.stagnating[0].oldestDays : 1;

  const soldRows = d.topSold.length ? d.topSold.map((m, i) => `
<div class="analytics-row">
  <div class="analytics-rank">#${i + 1}</div>
  <div>
    <div class="analytics-model">${esc(m.model)}</div>
    <div class="analytics-meta">${pkr(m.revenue)} revenue · ${pkr(m.profit)} profit</div>
  </div>
  <div style="display:flex;align-items:center;gap:7px">
    <div class="analytics-bar-wrap"><div class="analytics-bar hot" style="width:${Math.round(m.count / maxSold * 100)}%"></div></div>
    <div class="analytics-count" style="color:var(--success)">${m.count}</div>
  </div>
</div>`).join('') : `<div style="padding:1.5rem;text-align:center;color:var(--text2);font-size:.72rem">No sales in this period</div>`;

  const staleRows = d.stagnating.length ? d.stagnating.map((m, i) => `
<div class="analytics-row">
  <div class="analytics-rank">#${i + 1}</div>
  <div>
    <div class="analytics-model">${esc(m.model)}</div>
    <div class="analytics-meta">${m.count} unit${m.count !== 1 ? 's' : ''} · ${pkr(m.totalCost)} tied up${m.shops ? ` · ${m.shops}` : ''}</div>
  </div>
  <div style="display:flex;align-items:center;gap:7px">
    <div class="analytics-bar-wrap"><div class="analytics-bar stale" style="width:${Math.round(m.oldestDays / maxStale * 100)}%"></div></div>
    <div class="analytics-count" style="color:var(--danger)">${m.oldestDays}d</div>
  </div>
</div>`).join('') : `<div style="padding:1.5rem;text-align:center;color:var(--success);font-size:.72rem">✓ No stagnating stock!</div>`;

  body.innerHTML = `<div class="analytics-grid">
<div class="analytics-panel">
  <div class="analytics-hd">
    <div>
      <div class="analytics-hd-title">Top Selling Models</div>
      <div class="analytics-hd-sub">Last ${days} days · sorted by units sold</div>
    </div>
  </div>
  ${soldRows}
</div>
<div class="analytics-panel">
  <div class="analytics-hd">
    <div>
      <div class="analytics-hd-title">Stagnating Stock</div>
      <div class="analytics-hd-sub">In stock &gt;30 days · sorted by age</div>
    </div>
  </div>
  ${staleRows}
</div>
  </div>`;
}

// ── ACTIVITY LOG ─────────────────────────────────
var LOG_LABELS = {
  stock_add: 'Phone Added to Stock',
  stock_sell: 'Phone Sold',
  stock_delete: 'Phone Deleted from Stock',
};
var LOG_DOT = { stock_add: 'add', stock_sell: 'sell', stock_delete: 'delete' };
var LOG_PAGE_LIMIT = 200;
var logsBeforeCursor = '';
var logsHasMore = false;

function _buildLogDetail(l) {
  const det = l.details || {};
  if (l.action === 'stock_add') return `${det.brand || ''} ${det.model || ''} · IMEI ${det.imei || ''} · ${det.buyPrice ? pkr(det.buyPrice) : 'no price'}`;
  if (l.action === 'stock_sell') return `${det.brand || ''} ${det.model || ''} · IMEI ${det.imei || ''} · Sold ${det.salePrice ? pkr(det.salePrice) : ''} · Profit ${det.profit != null ? pkr(det.profit) : '—'}${det.buyerName ? ' · Buyer: ' + det.buyerName : ''}`;
  if (l.action === 'stock_delete') return `ID: ${det.id || ''}`;
  return '';
}

function _logRowHtml(l) {
  const dotCls = LOG_DOT[l.action] || 'other';
  const label = LOG_LABELS[l.action] || l.action;
  const detail = _buildLogDetail(l);
  const shopBadge = l.shop ? `<span style="background:rgba(${SHOP_RGBA[l.shop] || '22,163,74'},.15);color:${SHOP_COLOR[l.shop] || 'var(--a5)'};border:1px solid rgba(${SHOP_RGBA[l.shop] || '22,163,74'},.3);padding:1px 7px;border-radius:10px;font-size:.57rem;font-weight:700;margin-right:6px">Shop ${l.shop}</span>` : '';
  const d = new Date(l.ts);
  const ts = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `<div class="log-row">
  <div class="log-dot ${dotCls}"></div>
  <div class="log-body">
    <div class="log-action">${shopBadge}${label}</div>
    ${detail ? `<div class="log-detail">${esc(detail)}</div>` : ''}
  </div>
  <div class="log-ts">${ts}</div>
</div>`;
}

function _renderLogsLoadMore() {
  const body = $('logs-body');
  if (!body) return;
  const oldWrap = $('logs-load-more-wrap');
  if (oldWrap) oldWrap.remove();
  if (!logsHasMore || !allLogsData.length) return;
  const wrap = document.createElement('div');
  wrap.id = 'logs-load-more-wrap';
  wrap.style.cssText = 'display:flex;justify-content:center;padding:.75rem .25rem 0;';
  wrap.innerHTML = '<button id="logs-load-more-btn" class="btn bo" style="font-size:.62rem">Load more</button>';
  body.appendChild(wrap);
  const btn = $('logs-load-more-btn');
  if (btn) btn.onclick = function() { loadLogs(false); };
}

async function loadLogs(reset) {
  const shouldReset = reset !== false;
  const shop = $('log-shop')?.value || '';
  if (shouldReset) {
    logsBeforeCursor = '';
    logsHasMore = false;
    allLogsData = [];
  }
  const params = [`limit=${LOG_PAGE_LIMIT}`];
  if (shop) params.push(`shop=${encodeURIComponent(shop)}`);
  if (logsBeforeCursor) params.push(`before=${encodeURIComponent(logsBeforeCursor)}`);
  const url = `/api/logs?${params.join('&')}`;
  const data = await api('GET', url);
  const page = Array.isArray(data) ? data : [];
  allLogsData = shouldReset ? page : allLogsData.concat(page);
  logsHasMore = page.length === LOG_PAGE_LIMIT;
  if (allLogsData.length) {
    const lastLog = allLogsData[allLogsData.length - 1];
    logsBeforeCursor = lastLog?._id || lastLog?.ts || logsBeforeCursor;
  }
  const body = $('logs-body');
  if (!allLogsData.length) {
    body.innerHTML = `<div class="empty"><div class="empty-icon">—</div><h3>No activity yet</h3><p>Actions will appear here once the system is in use</p></div>`;
    return;
  }
  if (shouldReset) {
    body.innerHTML = `<div id="logs-list">${allLogsData.map(_logRowHtml).join('')}</div>`;
  } else {
    const list = $('logs-list');
    if (list) list.insertAdjacentHTML('beforeend', page.map(_logRowHtml).join(''));
  }
  _renderLogsLoadMore();
}

// ── PRINT / PDF HELPER ──
function printSection(title, htmlContent) {
  // Mobile/WebView workaround: Use a hidden iframe instead of window.open
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.write(`<!DOCTYPE html><html><head><title>${title}</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:11pt;color:#111;padding:20px 28px;background:#fff}
h1{font-size:15pt;margin-bottom:6px;border-bottom:2px solid #333;padding-bottom:6px}
h2{font-size:12pt;margin:14px 0 6px;color:#444}
.meta{font-size:9pt;color:#666;margin-bottom:14px}
table{width:100%;border-collapse:collapse;font-size:9.5pt;margin-bottom:12px}
th,td{border:1px solid #ccc;padding:4px 8px;text-align:left;vertical-align:middle}
th{background:#f0f0f0;font-weight:700;font-size:8.5pt;text-transform:uppercase;letter-spacing:.04em}
tr:nth-child(even){background:#fafafa}
.right{text-align:right}
.num{font-family:monospace}
.success{color:#16a34a}
.danger{color:#dc2626}
.badge{display:inline-block;padding:1px 7px;border-radius:10px;font-size:8pt;font-weight:700;background:#f0f0f0}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px}
.stat{border:1px solid #ddd;border-radius:6px;padding:8px 12px}
.stat-lbl{font-size:8pt;color:#666;text-transform:uppercase;letter-spacing:.06em}
.stat-val{font-size:14pt;font-weight:700;margin-top:2px;font-family:monospace}
@media print{body{padding:10px 16px}button{display:none}}
  </style></head><body>${htmlContent}<br></body></html>`);
  doc.close();

  setTimeout(() => {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => document.body.removeChild(iframe), 2000);
  }, 500);
}

// ── REPORTS / INVOICES ───────────────────────────
var allReports = [];
var reportBodyCache = Object.create(null);

async function loadReports() {
  const data = await api('GET', '/api/reports');
  allReports = Array.isArray(data) ? data : [];
  reportBodyCache = Object.create(null);
  renderReports();
}

function renderReports() {
  const body = $('reports-body');
  if (!allReports.length) {
    body.innerHTML = `<div class="empty"><div class="empty-icon">—</div><h3>No reports yet</h3><p>Select type, shop and period then click Generate</p></div>`;
    return;
  }
  // Group reports by shop
  const byShop = {};
  allReports.forEach(r => {
    const key = r.shop === 'ALL' ? 'All Shops' : 'Shop ' + r.shop;
    if (!byShop[key]) byShop[key] = [];
    byShop[key].push(r);
  });
  let html = '<div style="padding:.9rem">';
  Object.entries(byShop).forEach(([shopLabel, reports]) => {
    const sh = reports[0].shop;
    const c = SHOP_COLOR[sh] || 'var(--a5)';
    html += `<div style="margin-bottom:1.2rem">
  <div style="font-size:.7rem;font-weight:700;color:${c};text-transform:uppercase;letter-spacing:.1em;padding:.35rem .6rem;background:rgba(${SHOP_RGBA[sh] || '22,163,74'},.1);border:1px solid rgba(${SHOP_RGBA[sh] || '22,163,74'},.25);border-radius:8px;margin-bottom:.5rem">${shopLabel}</div>
  ${reports.map(r => {
      const uid = r._id;
      return `<div class="report-card" id="rpt-${uid}">
      <div class="report-hd" onclick="toggleReportBody('${uid}')">
        <span class="report-type-badge ${r.type}">${r.type}</span>
        <span style="font-family:var(--mono);font-size:.72rem;font-weight:700;color:var(--white)">${r.period}</span>
        <span style="margin-left:auto;font-size:.6rem;color:var(--text3)">${fmtDate(r.generatedAt)}</span>
        <button class="btn bo" style="font-size:.58rem;padding:.12rem .4rem" onclick="event.stopPropagation();printReport('${uid}')" title="Print / PDF">Print</button>
        <button class="bx" onclick="event.stopPropagation();deleteReport('${uid}')" title="Delete">✕</button>
        <span id="rpt-arr-${uid}" style="color:var(--text2);font-size:.75rem;margin-left:4px">▶</span>
      </div>
      <div class="report-body" id="rpt-body-${uid}" style="display:none"></div>
    </div>`;
    }).join('')}
</div>`;
  });
  html += '</div>';
  body.innerHTML = html;
}

function renderReportData(r) {
  const d = r.data || {};
  const netCls = d.netProfit >= 0 ? 'var(--success)' : 'var(--danger)';
  let html = `<div class="report-stat-grid">
<div class="rs"><div class="rs-lbl">Total Sales</div><div class="rs-val" style="color:var(--success)">${pkr(d.totalSales)}</div></div>
<div class="rs"><div class="rs-lbl">Cost of Sales</div><div class="rs-val" style="color:var(--text2)">${pkr(d.totalCost)}</div></div>
<div class="rs"><div class="rs-lbl">Gross Profit</div><div class="rs-val" style="color:${d.grossProfit >= 0 ? 'var(--a4)' : 'var(--danger)'}">${pkr(d.grossProfit)}</div></div>
<div class="rs"><div class="rs-lbl">Expenses</div><div class="rs-val" style="color:var(--danger)">${pkr(d.expenses || d.totalExpenses || 0)}</div></div>
<div class="rs"><div class="rs-lbl">Net Profit</div><div class="rs-val" style="color:${netCls};font-weight:700">${pkr(d.netProfit)}</div></div>
<div class="rs"><div class="rs-lbl">Units Sold</div><div class="rs-val" style="color:var(--a1)">${d.unitsSold || 0}</div></div>
  </div>`;

  // Sales list for daily reports
  if (r.type === 'daily' && d.salesList?.length) {
    html += `<div style="font-size:.6rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.4rem">Sales Breakdown</div>
<table style="width:100%;border-collapse:collapse;font-size:.62rem;margin-bottom:.65rem;">
  <thead><tr style="background:var(--s3)">
    <th style="text-align:left;padding:.25rem .6rem;color:var(--text3);font-weight:600">PHONE</th>
    <th style="text-align:left;padding:.25rem .6rem;color:var(--text3);font-weight:600">IMEI</th>
    <th style="text-align:left;padding:.25rem .6rem;color:var(--text3);font-weight:600">BUYER</th>
    <th style="text-align:right;padding:.25rem .6rem;color:var(--text3);font-weight:600">SOLD FOR</th>
    <th style="text-align:right;padding:.25rem .6rem;color:var(--text3);font-weight:600">PROFIT</th>
  </tr></thead>
  <tbody>${d.salesList.map(s => `<tr style="border-top:1px solid var(--border2)">
    <td style="padding:.25rem .6rem;color:var(--white);font-weight:600">${esc(s.model || '')}</td>
    <td style="padding:.25rem .6rem;font-family:var(--mono);color:var(--text2)">${esc(s.imei || '')}</td>
    <td style="padding:.25rem .6rem;color:var(--text2)">${esc(s.buyerName || '—')}</td>
    <td style="padding:.25rem .6rem;text-align:right;font-family:var(--mono);color:var(--success)">${pkr(s.salePrice)}</td>
    <td style="padding:.25rem .6rem;text-align:right;font-family:var(--mono);color:${(s.profit || 0) >= 0 ? 'var(--a4)' : 'var(--danger)'}">${s.profit != null ? pkr(s.profit) : '—'}</td>
  </tr>`).join('')}</tbody>
</table>`;
  }

  // Expense breakdown for monthly reports
  if (r.type === 'monthly' && d.expenseBreakdown?.length) {
    html += `<div style="font-size:.6rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.4rem">Expense Breakdown</div>
<table style="width:100%;border-collapse:collapse;font-size:.62rem;">
  <thead><tr style="background:var(--s3)">
    <th style="text-align:left;padding:.25rem .6rem;color:var(--text3);font-weight:600">DATE</th>
    <th style="text-align:left;padding:.25rem .6rem;color:var(--text3);font-weight:600">CATEGORY</th>
    <th style="text-align:left;padding:.25rem .6rem;color:var(--text3);font-weight:600">DESCRIPTION</th>
    <th style="text-align:right;padding:.25rem .6rem;color:var(--text3);font-weight:600">AMOUNT</th>
  </tr></thead>
  <tbody>${d.expenseBreakdown.map(e => `<tr style="border-top:1px solid var(--border2)">
    <td style="padding:.25rem .6rem;font-family:var(--mono);color:var(--text2)">${e.date || ''}</td>
    <td style="padding:.25rem .6rem;color:var(--text2)">${esc(e.category || '')}</td>
    <td style="padding:.25rem .6rem;color:var(--white)">${esc(e.description || '')}</td>
    <td style="padding:.25rem .6rem;text-align:right;font-family:var(--mono);color:var(--danger)">${pkr(e.amount)}</td>
  </tr>`).join('')}</tbody>
</table>`;
  }

  html += `<div style="margin-top:.65rem;display:flex;justify-content:flex-end;gap:6px">
<button class="btn bo" style="font-size:.6rem;padding:.18rem .5rem" onclick="exportReportCSV('${r._id}')">↓ CSV</button>
  </div>`;
  return html;
}

function printReport(id) {
  const r = allReports.find(x => x._id === id);
  if (!r) return;
  const d = r.data || {};
  const shopLabel = r.shop === 'ALL' ? 'All Shops' : 'Shop ' + r.shop;
  const title = `${r.type === 'daily' ? 'Daily' : 'Monthly'} Invoice — ${shopLabel} — ${r.period}`;
  let salesRows = '';
  if (r.type === 'daily' && d.salesList?.length) {
    salesRows = `<h2>Sales Breakdown</h2><table>
  <thead><tr><th>Phone</th><th>IMEI</th><th>Buyer</th><th class="right">Sold For</th><th class="right">Profit</th></tr></thead>
  <tbody>${d.salesList.map(s => `<tr>
    <td>${esc(s.model || '')}</td>
    <td class="num">${s.imei || ''}</td>
    <td>${esc(s.buyerName || '—')}</td>
    <td class="right num success">${pkr(s.salePrice)}</td>
    <td class="right num ${(s.profit || 0) >= 0 ? 'success' : 'danger'}">${s.profit != null ? pkr(s.profit) : '—'}</td>
  </tr>`).join('')}</tbody></table>`;
  }
  if (r.type === 'monthly' && d.expenseBreakdown?.length) {
    salesRows += `<h2>Expense Breakdown</h2><table>
  <thead><tr><th>Date</th><th>Category</th><th>Description</th><th class="right">Amount</th></tr></thead>
  <tbody>${d.expenseBreakdown.map(e => `<tr>
    <td class="num">${e.date || ''}</td>
    <td>${esc(e.category || '')}</td>
    <td>${esc(e.description || '')}</td>
    <td class="right num danger">${pkr(e.amount)}</td>
  </tr>`).join('')}</tbody></table>`;
  }
  const html = `<h1>${title}</h1>
  <div class="meta">Generated: ${r.generatedAt ? new Date(r.generatedAt).toLocaleString() : ''}</div>
  <div class="summary">
<div class="stat"><div class="stat-lbl">Total Sales</div><div class="stat-val success">${pkr(d.totalSales)}</div></div>
<div class="stat"><div class="stat-lbl">Cost of Sales</div><div class="stat-val">${pkr(d.totalCost)}</div></div>
<div class="stat"><div class="stat-lbl">Gross Profit</div><div class="stat-val">${pkr(d.grossProfit)}</div></div>
<div class="stat"><div class="stat-lbl">Expenses</div><div class="stat-val danger">${pkr(d.expenses || d.totalExpenses || 0)}</div></div>
<div class="stat"><div class="stat-lbl">Net Profit</div><div class="stat-val ${(d.netProfit || 0) >= 0 ? 'success' : 'danger'}">${pkr(d.netProfit)}</div></div>
<div class="stat"><div class="stat-lbl">Units Sold</div><div class="stat-val">${d.unitsSold || 0}</div></div>
  </div>
  ${salesRows}`;
  printSection(title, html);
}

function toggleReportBody(uid) {
  const el = $('rpt-body-' + uid); if (!el) return;
  const open = el.style.display !== 'none' && el.style.display !== '';
  if (!open) {
    if (!reportBodyCache[uid]) {
      const report = allReports.find(x => x._id === uid);
      if (report) reportBodyCache[uid] = renderReportData(report);
    }
    if (reportBodyCache[uid] && !el.dataset.rendered) {
      el.innerHTML = reportBodyCache[uid];
      el.dataset.rendered = '1';
    }
  }
  el.style.display = open ? 'none' : 'block';
  const arr = $('rpt-arr-' + uid); if (arr) arr.textContent = open ? '▶' : '▼';
}

async function generateReport() {
  const type = $('rpt-type')?.value, shop = $('rpt-shop')?.value, period = $('rpt-period')?.value.trim();
  if (!period) { showToast('Enter a period (YYYY-MM-DD or YYYY-MM)', 'error'); return; }
  const d = await api('POST', '/api/reports/generate', { type, shop, period });
  if (d.error) { showToast(d.error, 'error'); return; }
  showToast('Report generated!');
  loadReports();
}

async function deleteReport(id) {
  if (!confirm('Delete this report?')) return;
  const d = await api('DELETE', `/api/reports/${id}`);
  if (d.error) { showToast(d.error, 'error'); return; }
  delete reportBodyCache[id];
  showToast('Report deleted', 'warn');
  loadReports();
}

function exportReportCSV(id) {
  const r = allReports.find(x => x._id === id);
  if (!r) return;
  const d = r.data || {};
  const lines = [
    `Report Type,${r.type}`,
    `Shop,${r.shop}`,
    `Period,${r.period}`,
    `Generated,${r.generatedAt}`,
    '',
    `Total Sales,${d.totalSales || 0}`,
    `Cost of Sales,${d.totalCost || 0}`,
    `Gross Profit,${d.grossProfit || 0}`,
    `Expenses,${d.expenses || d.totalExpenses || 0}`,
    `Net Profit,${d.netProfit || 0}`,
    `Units Sold,${d.unitsSold || 0}`,
  ];
  if (d.salesList?.length) {
    lines.push('', 'Sales List', 'Phone,IMEI,Buyer,Cost,Sold For,Profit');
    d.salesList.forEach(s => lines.push(`${s.model || ''},${s.imei || ''},${s.buyerName || ''},${s.buyPrice || ''},${s.salePrice || ''},${s.profit || ''}`));
  }
  dlCSV(lines.join('\n'), `Report_${r.shop}_${r.period}.csv`);
}

// ── MODAL MOVED TO UTILS.JS ──


function dlCSV(content, filename) { const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(content); a.download = filename; a.click(); }

// ── AUTH ──────────────────────────────────────────────────────────

async function checkGate() {
  const pw = $('auth-gate-input').value;
  if (!pw) { $('auth-gate-input').focus(); return; }
  if (_rlLocked('gate')) {
    const e = $('auth-gate-err'); e.textContent = _rlLockedMsg('gate'); e.classList.add('show');
    return;
  }
  const d = await _authPost({ type: 'gate', password: pw, clientId: currentClientId });
  if (d.ok) {
    _rlClear('gate');
    _pendingGatePassword = pw; // kept in memory only — never stored to localStorage
    $('auth-gate').style.display = 'none';
    $('auth-role').style.display = '';
    setTimeout(() => $('auth-admin-input')?.focus(), 80);
  } else {
    _rlFail('gate');
    const e = $('auth-gate-err');
    e.textContent = _rlErrMsg('gate', 'Incorrect password. Try again.');
    e.classList.add('show');
    $('auth-gate-input').value = ''; $('auth-gate-input').focus();
    if (!_rlLocked('gate')) setTimeout(() => e.classList.remove('show'), 3000);
  }
}

async function checkAdmin() {
  const pw = $('auth-admin-input').value;
  if (!pw) { $('auth-admin-input').focus(); return; }
  if (_rlLocked('admin')) {
    const e = $('auth-admin-err'); e.textContent = _rlLockedMsg('admin'); e.classList.add('show');
    return;
  }
  const d = await _authPost({ type: 'admin', password: pw, clientId: currentClientId });
  if (d.ok) {
    _rlClear('admin');
    localStorage.setItem('authToken', d.token);
    localStorage.setItem('authRole', 'admin');
    localStorage.removeItem('authShop');
    authRole = 'admin'; authShop = null;
    $('auth-overlay').classList.add('hidden');
    await bootApp();
  } else {
    _rlFail('admin');
    const e = $('auth-admin-err');
    e.textContent = _rlErrMsg('admin', 'Incorrect admin password.');
    e.classList.add('show');
    $('auth-admin-input').value = ''; $('auth-admin-input').focus();
    if (!_rlLocked('admin')) setTimeout(() => e.classList.remove('show'), 3000);
  }
}

async function enterShopMode(shop) {
  // Shop auth requires the gate password to prevent gate bypass via direct API call
  const d = await _authPost({ type: 'shop', password: _pendingGatePassword, shop, clientId: currentClientId });
  if (!d.ok) { showToast('Auth error — please refresh and try again', 'error'); return; }
  localStorage.setItem('authToken', d.token);
  localStorage.setItem('authRole', 'shop');
  localStorage.setItem('authShop', shop);
  authRole = 'shop'; authShop = shop;
  $('auth-overlay').classList.add('hidden');
  await bootApp();
}

function logout() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('authRole');
  localStorage.removeItem('authShop');
  localStorage.removeItem('clientId');
  localStorage.removeItem('clientShops');
  // Clear rate-limit counters so next user starts clean on this device
  Object.keys(_RL_LOCK_LABELS).forEach(function(k) { _rlClear(k); });
  authRole = null; authShop = null;
  location.reload();
}

function applyShopMode(shop) {
  shopModeActive = true;
  // Only show the selected shop's tab
  document.querySelectorAll('.stab').forEach(t => {
    t.style.display = (t.dataset.s === shop) ? '' : 'none';
  });
  // Restrict sidebar nav to scan and imeistock only
  // Shop mode: hide all admin/desktop pages from sidebar
  ADMIN_ONLY_PAGES.map(p => 'ni-' + p).forEach(id => {
    const el = $(id); if (el) el.style.display = 'none';
  });
  // Hide Head Office and Tools sidebar sections
  document.querySelectorAll('.sb-lbl').forEach(el => {
    if (el.textContent.trim() === 'Head Office' || el.textContent.trim() === 'Tools') {
      const sec = el.closest('.sb-sec');
      if (sec) {
        sec.style.display = 'none';
        const prev = sec.previousElementSibling;
        if (prev && prev.classList.contains('sdiv')) prev.style.display = 'none';
      }
    }
  });
  // Lock nav to allowed pages (flag-based, not function override)
  const _nav = nav;
  window.nav = function (page) {
    if (!['scan', 'imeistock'].includes(page)) { showToast('Not available in shop mode', 'warn'); return; }
    _nav(page);
  };
}
