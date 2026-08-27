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
var batchQueue = []; // [{imei1, imei2, color}]

function addToBatchQueue() {
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
  batchQueue.splice(i, 1);
  renderBatchQueue();
}

function clearBatchQueue() {
  batchQueue = [];
  renderBatchQueue();
}

async function submitBatch() {
  if (!batchQueue.length) { showToast('Queue is empty', 'error'); return; }
  const brand = $('bBrand').value.trim();
  const model = $('bModel').value.trim();
  const color = $('bColor').value.trim();
  const storage = $('bStorage').value;
  const buyPrice = $('bBuyPrice').value;
  const cat = $('bCat').value;
  const shop = activeShop === 'HQ' ? null : activeShop;

  if (!brand && !model) { showToast('Enter at least Brand or Model', 'error'); return; }

  const saveBtn = $('batchSaveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = `Saving 0/${batchQueue.length}…`;

  let saved = 0;
  const failed = [];
  const failedEntries = [];
  for (const entry of batchQueue) {
    try {
      const d = await api('POST', '/api/stock/add', {
        imei: entry.imei1, imei2: entry.imei2 || '',
        cat, brand, model, color: (entry.color || color || '').trim(), storage, buyPrice, shop
      });
      if (d.error) {
        failed.push({ entry, reason: d.error });
        failedEntries.push(entry);
      } else {
        saved++;
      }
    } catch (e) {
      failed.push({ entry, reason: 'network error' });
      failedEntries.push(entry);
    }
    saveBtn.textContent = `Saving ${saved + failed.length}/${batchQueue.length}…`;
  }

  saveBtn.textContent = 'Save All to Stock';
  saveBtn.disabled = false;

  if (failed.length) {
    showToast(`⚠ ${saved} saved, ${failed.length} failed`, 'warn');
    const failureList = failed.map(f => {
      const { imei1, imei2 } = f.entry;
      const imeiLabel = imei2 ? `${esc(imei1)} · ${esc(imei2)}` : esc(imei1);
      return `<li style="padding:6px 0;border-bottom:1px solid var(--border2);display:flex;gap:8px;align-items:flex-start;">
    <span style="font-family:var(--mono);color:var(--white);">${imeiLabel}</span>
    <span style="color:var(--danger);font-size:.86rem;">${esc(f.reason || 'unknown error')}</span>
  </li>`;
    }).join('');
    showModal(`<h3>Some phones failed to save</h3>
  <p style="color:var(--text2);font-size:.9rem;margin:4px 0 10px;">${saved} saved, ${failed.length} failed. The failed ones are kept in the queue — fix the issues and retry.</p>
  <div style="max-height:260px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px;background:var(--s2);">
    <ul style="list-style:none;padding:0;margin:0;">${failureList}</ul>
  </div>
  <div class="mf" style="margin-top:12px;"><button class="btn bo" onclick="closeModal()">Close</button></div>`);
    if (saved > 0) loadSidebarStats();
    batchQueue = failedEntries;
    renderBatchQueue();
    return;
  } else {
    showToast(`${saved} phones added to stock!`, 'success');
  }

  batchQueue = [];
  renderBatchQueue();
  $('bImei1').value = ''; $('bImei2').value = ''; $('bEntryColor').value = '';
  loadSidebarStats();
  setTimeout(() => $('bImei1')?.focus(), 100);
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
    } catch (e) { }
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
    } catch (e) { showToast('Connection error', 'error'); }
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

  // Pre-fill "Sold by Shop" dropdown with the active shop
  const soldByShopEl = $('fSoldByShop');
  const defaultShop = (activeShop === 'HQ' ? (SHOPS.length ? SHOPS[0] : null) : activeShop) || null;
  soldByShopEl.value = defaultShop;

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

async function submitAdd() {
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
  const d = await api('POST', '/api/stock/add', payload);
  if (d.error) { showToast(d.error, 'error'); return; }
  const imeiInfo = imei2 ? ` (2 IMEIs)` : '';
  showToast(`${payload.brand || 'Phone'} ${payload.model || ''}${imeiInfo} added!`, 'success');
  cancelForm();
  ['fBrand', 'fModel', 'fColor', 'fBuyPrice', 'fNotes', 'fImei1', 'fImei2'].forEach(id => { if ($(id)) $(id).value = ''; });
  $('fStorage').value = ''; $('fCat').value = 'IPHONE';
  loadSidebarStats();
  setTimeout(() => $('imeiInput')?.focus(), 100);
}

async function submitSell() {
  const d = await api('POST', '/api/stock/sell', {
    imei: pendingIMEI, salePrice: $('fSalePrice').value,
    buyerName: $('fBuyerName').value.trim(),
    buyerPhone: $('fBuyerPhone').value.trim(),
    notes: $('fSaleNotes').value.trim(),
    soldByShop: $('fSoldByShop').value || undefined
  });
  if (d.error) { showToast(d.error, 'error'); return; }
  const profit = d.sale?.profit;
  showToast(`Sale recorded!${profit != null && authRole === 'admin' ? ' Profit: ' + pkr(profit) : ''}`, 'success');
  const soldIMEI = pendingIMEI;
  const soldPrice = d.sale?.salePrice;
  const soldAt = d.sale?.soldAt || new Date().toISOString();
  cancelForm();
  ['fSalePrice', 'fBuyerName', 'fBuyerPhone', 'fSaleNotes'].forEach(id => { if ($(id)) $(id).value = ''; });
  // Update local cache immediately so imeistock page reflects the sale without waiting for a full refresh
  const soldIdx = allIMEIStock.findIndex(p => p.imei === soldIMEI);
  if (soldIdx !== -1) {
    allIMEIStock[soldIdx] = { ...allIMEIStock[soldIdx], status: 'sold', salePrice: soldPrice, soldAt };
    renderIMEIStock();
  }
  loadSidebarStats();
  if (activePage === 'stock') loadDay();
  if (activePage === 'saleslog') loadSalesLog();
  if (activePage === 'imeistock') loadIMEIData();
  setTimeout(() => $('imeiInput')?.focus(), 100);
}

// ── BARCODE SCANNER ──────────────────────────────────────────────
var camMode = 'imei1';
var lastScanResult = '';
var torchTrack = null;
var scanActive = false;
var scanLoopId = 0;
var detectorInstance = null;
var detectorCanvas = null;
var detectorCtx = null;
var zxingReader = null;

var camLabels = {
  imei1: 'Scanning for IMEI 1…', imei2: 'Scanning for IMEI 2…',
  batch1: 'Scanning for batch IMEI 1…', batch: 'Scanning for batch IMEI 2…',
  rc1: 'Scanning for warehouse IMEI 1…', rc2: 'Scanning for warehouse IMEI 2…',
  free: 'Scan any barcode',
};

async function openCamera(mode = 'imei1') {
  if (camStream) {
    camMode = mode;
    $('camLabel').textContent = camLabels[mode] || 'Scanning…';
    clearScanResult();
    return;
  }
  camMode = mode;
  lastScanResult = '';
  $('camLabel').textContent = camLabels[mode] || 'Scanning…';
  $('camUseImei1').style.display = '';
  $('camUseImei2').style.display = '';
  // Reset UI to initial scanning state (without calling clearScanResult to avoid
  // starting a scan loop before the detector is initialised)
  $('camResultBox').style.display = 'none';
  $('camActions').style.display = 'none';
  $('camHint').style.display = 'block';
  $('scanLine').style.animationPlayState = 'running';
  try {
    // getBestCameraStream picks the main rear camera (not ultra-wide/telephoto) and
    // applies continuous autofocus — important for close-up IMEI barcode scanning.
    camStream = await getBestCameraStream();
    torchTrack = camStream.getVideoTracks()[0];
    const caps = torchTrack?.getCapabilities?.();
    $('torchBtn').style.opacity = caps?.torch ? '1' : '0.3';
    $('focusBtn').style.opacity = (caps?.focusMode?.length) ? '1' : '0.3';
    const vid = $('camVideo');
    vid.srcObject = null;           // clear first — required on some iOS 17/18 devices
    vid.srcObject = camStream;
    await vid.play().catch(() => { });  // explicit play() required on iOS Safari
    $('camModal').style.display = 'flex';
    // Initialise detector FIRST, then start the scan loop exactly once
    if (!detectorInstance && !zxingReader) {
      if ('BarcodeDetector' in window) {
        let formats;
        try { formats = await BarcodeDetector.getSupportedFormats(); }
        catch (e) { formats = ['code_128', 'code_39', 'ean_13', 'ean_8', 'itf', 'upc_a', 'upc_e', 'qr_code', 'data_matrix', 'aztec']; }
        detectorInstance = new BarcodeDetector({ formats });
        detectorCanvas = document.createElement('canvas');
        detectorCtx = detectorCanvas.getContext('2d', { willReadFrequently: true });
      } else if (window.ZXing) {
        zxingReader = new ZXing.BrowserMultiFormatReader();
        detectorCanvas = document.createElement('canvas');
        detectorCtx = detectorCanvas.getContext('2d', { willReadFrequently: true });
      }
    }
    scanActive = true;
    startScanning();
  } catch (e) {
    camStream = null;
    showToast('Camera not available — HTTPS required on phone', 'error');
  }
}

async function openCameraForImei2() { openCamera('imei2'); }

// Returns a MediaStream using the best available rear camera for barcode scanning.
// On phones with multiple rear cameras (ultra-wide, main, telephoto) it prefers the
// main 1× camera — the one most likely to autofocus on close-up IMEI labels.
// Compatible with iOS 16 / 17 / 18 (iPhone 16+) and modern Android multi-camera setups.
async function getBestCameraStream() {
  // Step 1 — get an initial stream to trigger the permission prompt.
  // facingMode ideal (not exact) gracefully falls back on iOS.
  const base = { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } };
  let stream = await navigator.mediaDevices.getUserMedia(base);
  try {
    // Step 2 — camera labels are only populated AFTER permission is granted, so
    // enumerate now and check whether a better rear camera exists.
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d => d.kind === 'videoinput');
    if (cams.length > 1) {
      const bestId = pickBestRearCamera(cams);
      if (bestId) {
        const currentId = stream.getVideoTracks()[0]?.getSettings?.()?.deviceId;
        if (bestId !== currentId) {
          // Switch to the better camera; fall back to original stream on any error.
          const alt = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: bestId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          }).catch(() => null);
          if (alt) { stream.getTracks().forEach(t => t.stop()); stream = alt; }
        }
      }
    }
    // Step 3 — enable continuous autofocus so close-up IMEI labels stay sharp.
    const track = stream.getVideoTracks()[0];
    const caps = track?.getCapabilities?.();
    if (caps?.focusMode?.includes('continuous')) {
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => { });
    }
  } catch (e) { }
  return stream;
}

// Score rear cameras by label; higher = better for close-up IMEI barcode scanning.
// Ultra-wide lenses (0.5×) and long-telephoto (5×+) are bad for this use-case.
// Returns the deviceId of the highest-scoring rear camera, or null if undecided.
function pickBestRearCamera(devices) {
  function score(label) {
    const l = (label || '').toLowerCase();
    if (!l || l === 'camera') return 5;                                        // unlabelled — moderate score
    if (/(front|user|selfie|face)/i.test(l)) return -1;                   // front-facing: skip
    if (/ultra.?wide|ultrawide|wide.?angle|\b0\.5x\b/i.test(l)) return 1; // ultra-wide: worst for close-up
    if (/\b(4x|5x|6x)\b/i.test(l)) return 2;                             // long telephoto: bad
    if (/telephoto|\b2x\b|\b3x\b/i.test(l)) return 3;                     // short telephoto: ok
    if (/back|rear|environment|main/i.test(l)) return 10;                 // main rear: best
    return 5;
  }
  const ranked = devices
    .map(d => ({ id: d.deviceId, s: score(d.label) }))
    .filter(d => d.s > 0)
    .sort((a, b) => b.s - a.s);
  return ranked.length ? ranked[0].id : null;
}

function closeCamera() {
  scanActive = false;
  scanLoopId++;
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; torchTrack = null; }
  $('camModal').style.display = 'none';
  lastScanResult = '';
  $('camResultBox').style.display = 'none';
  $('camActions').style.display = 'none';
  $('camHint').style.display = 'block';
  $('scanLine').style.animationPlayState = 'running';
}

function clearScanResult() {
  lastScanResult = '';
  $('camResultBox').style.display = 'none';
  $('camActions').style.display = 'none';
  $('camHint').style.display = 'block';
  $('scanLine').style.animationPlayState = 'running';
  if (camStream) { scanActive = true; startScanning(); }
}

function flashField(el) {
  if (!el) return;
  el.style.borderColor = 'var(--success)';
  el.style.boxShadow = '0 0 0 3px rgba(16,185,129,.2)';
  setTimeout(() => { el.style.borderColor = ''; el.style.boxShadow = ''; }, 800);
}

function onBarcodeDetected(value, format) {
  const digits = value.replace(/\D/g, '');
  if (camMode !== 'free' && (digits.length < 14 || digits.length > 16)) return;
  const result = digits.length >= 14 ? digits : value;
  if (result === lastScanResult) return;
  lastScanResult = result;
  if (camMode === 'rc1:next') {
    closeCamera();
    const clean = result.replace(/\D/g, '');
    const f = $('rc-next-i1');
    if (f) { f.value = clean; flashField(f); }
    $('rc-next-i2')?.focus();
    showToast('IMEI 1 scanned ✓'); return;
  }
  if (camMode === 'rc2:next') {
    closeCamera();
    const clean = result.replace(/\D/g, '');
    const f = $('rc-next-i2');
    if (f) { f.value = clean; flashField(f); f.focus(); }
    showToast('IMEI 2 scanned ✓'); return;
  }
  if (camMode.startsWith('rc1:')) {
    closeCamera();
    const idx = Number(camMode.split(':')[1]);
    const clean = result.replace(/\D/g, '');
    if (Number.isInteger(idx) && idx >= 0 && idx < rcItems.length) {
      rcItems[idx].imei = clean;
      const f = document.getElementById(`rc-i1-${idx}`);
      if (f) { f.value = clean; flashField(f); }
      const next = document.getElementById(`rc-i2-${idx}`);
      if (next) next.focus();
    }
    showToast('IMEI 1 scanned ✓'); return;
  }
  if (camMode.startsWith('rc2:')) {
    closeCamera();
    const idx = Number(camMode.split(':')[1]);
    const clean = result.replace(/\D/g, '');
    if (Number.isInteger(idx) && idx >= 0 && idx < rcItems.length) {
      rcItems[idx].imei2 = clean;
      const f = document.getElementById(`rc-i2-${idx}`);
      if (f) { f.value = clean; flashField(f); }
      const next = document.getElementById(`rc-brand-${idx}`);
      if (next) next.focus();
    }
    showToast('IMEI 2 scanned ✓'); return;
  }
  if (camMode === 'imei1' && scanMode === 'sell') {
    closeCamera();
    const imeiInputElement = $('imeiInput');
    if (!imeiInputElement) return;
    imeiInputElement.value = result;
    flashField(imeiInputElement);
    handleImeiSubmit();
    showToast('IMEI scanned ✓');
    return;
  }
  if (camMode === 'batch1') {
    closeCamera();
    const f = $('bImei1'); if (f) { f.value = result; flashField(f); } $('bImei2')?.focus();
    showToast('IMEI 1 scanned ✓'); return;
  }
  if (camMode === 'batch') {
    closeCamera();
    const f = $('bImei2'); if (f) { f.value = result; flashField(f); f.focus(); }
    showToast('IMEI 2 scanned ✓'); return;
  }
  scanActive = false;
  $('scanLine').style.animationPlayState = 'paused';
  $('camResult').textContent = result;
  $('camFormat').textContent = `${format || 'unknown'} · ${digits.length} digits`;
  $('camResultBox').style.display = 'block';
  $('camActions').style.display = 'flex';
  $('camHint').style.display = 'none';
}

function useScanResult(action) {
  if (!lastScanResult) return;
  const val = lastScanResult;
  const inBatch = $('batchForm').style.display !== 'none';
  if (action === 'imei1') {
    closeCamera();
    if (inBatch) {
      const f = $('bImei1'); if (f) { f.value = val; flashField(f); } $('bImei2')?.focus();
      showToast('IMEI 1 set ✓');
    } else {
      $('imeiInput').value = val; flashField($('imeiInput')); handleImeiSubmit();
    }
  } else if (action === 'imei2') {
    closeCamera();
    const field = inBatch ? $('bImei2') : $('fImei2');
    if (field) { field.value = val; flashField(field); field.focus(); showToast('IMEI 2 set ✓'); }
  } else if (action === 'copy') {
    navigator.clipboard.writeText(val).then(() => showToast('Copied: ' + val)).catch(() => showToast('Value: ' + val));
    clearScanResult();
  }
}

async function toggleTorch() {
  if (!torchTrack) return;
  try {
    const current = torchTrack.getSettings().torch;
    await torchTrack.applyConstraints({ advanced: [{ torch: !current }] });
    $('torchBtn').style.color = !current ? 'var(--warn)' : '';
  } catch (e) { showToast('Torch not available', 'warn'); }
}

async function triggerFocus() {
  if (!torchTrack) return;
  try {
    // Try single-shot focus first (triggers a one-time autofocus)
    await torchTrack.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] });
    showToast('Focusing…');
    // Return to continuous after brief delay so it keeps tracking
    setTimeout(async () => {
      try { await torchTrack.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) { }
    }, 800);
  } catch (e) {
    // Fallback: toggle continuous autofocus to force a re-focus
    try {
      await torchTrack.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      showToast('Focusing…');
    } catch (e2) { showToast('Focus not supported on this device', 'warn'); }
  }
}

async function startScanning() {
  if (!detectorInstance && !zxingReader) {
    $('camHint').innerHTML = '<span style="color:var(--warn)">⚠ Barcode scanning is not supported in this browser. Please use Chrome, Edge, or Safari.</span>';
    return;
  }
  const vid = $('camVideo');
  const myLoopId = ++scanLoopId;
  const scan = async () => {
    if (!scanActive || !camStream || scanLoopId !== myLoopId) return;
    if (vid.readyState >= 2 && vid.videoWidth > 0 && vid.clientWidth > 0) {
      const vw = vid.videoWidth, vh = vid.videoHeight;
      const dw = vid.clientWidth, dh = vid.clientHeight;
      const scale = Math.max(dw / vw, dh / vh);
      const visW = dw / scale, visH = dh / scale;
      const offX = (vw - visW) / 2, offY = (vh - visH) / 2;
      const bx = offX + visW * 0.10, by = offY + visH * 0.31;
      const bw = visW * 0.80, bh = visH * 0.38;
      detectorCanvas.width = Math.round(bw);
      detectorCanvas.height = Math.round(bh);
      try {
        detectorCtx.drawImage(vid, bx, by, bw, bh, 0, 0, detectorCanvas.width, detectorCanvas.height);
        if (detectorInstance) {
          const codes = await detectorInstance.detect(detectorCanvas);
          // Do NOT return here — let scanActive decide whether to reschedule.
          // If onBarcodeDetected rejects the value (wrong digit count, duplicate)
          // the loop must keep running so the user can point at a valid barcode.
          if (codes.length > 0) onBarcodeDetected(codes[0].rawValue, codes[0].format);
        } else {
          const result = zxingReader.decodeFromCanvas(detectorCanvas);
          if (result) onBarcodeDetected(result.getText(), result.getBarcodeFormat().toString());
        }
      } catch (e) { }
    }
    // Reschedule only if still active (onBarcodeDetected may have set scanActive=false)
    if (scanActive && scanLoopId === myLoopId) setTimeout(() => requestAnimationFrame(scan), 66);
  };
  if (vid.readyState >= 2 && vid.videoWidth > 0) requestAnimationFrame(scan);
  else {
    // 'playing' fires reliably on iOS Safari; 'canplay' may not
    let fired = false;
    const go = () => { if (!fired) { fired = true; requestAnimationFrame(scan); } };
    vid.addEventListener('playing', go, { once: true });
    vid.addEventListener('loadeddata', go, { once: true });
    setTimeout(go, 2000); // safety fallback in case neither event fires
  }
}
// ── IMEI STOCK LIST ──
var groupedView = true; // default: grouped by model
var groupedStockMap = {};
var groupOpenState = {};
var initialLoad = true;

function expandAllGroups() {
  Object.keys(groupedStockMap).forEach(uid => groupOpenState[uid] = true);
  renderIMEIStock(true);
}
function collapseAllGroups() {
  Object.keys(groupedStockMap).forEach(uid => groupOpenState[uid] = false);
  renderIMEIStock(true);
}
async function loadIMEIData() {
  const list = $('imeiList');
  if (list && !list.innerHTML.includes('card')) {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3);"><div class="loading-spinner" style="margin:0 auto 10px;"></div>Loading Stock...</div>';
  }
  const sh = activeShop === 'HQ' ? null : activeShop;
  try {
    const all = imeiFilter !== 'in_stock';
    const stock = await api('GET', sh ? `/api/stock?shop=${sh}&all=${all}` : `/api/stock?all=${all}`);
    allIMEIStock = Array.isArray(stock) ? [...stock].reverse() : [];
    const validIds = new Set(allIMEIStock.map(p => p.id));
    selectedPhoneIds.forEach(id => { if (!validIds.has(id)) selectedPhoneIds.delete(id); });
    
    renderIMEIStock();
    updateBulkActions();
    initialLoad = false;
  } catch (err) {
    console.error('loadIMEIData error:', err);
    if (list) list.innerHTML = '<div class="empty">Error loading data. Try refreshing.</div>';
  }
}
function setIMEIFilter(f, el) { imeiFilter = f; document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active')); el.classList.add('active'); renderIMEIStock(); }
function toggleGrouped() { groupedView = !groupedView; $('groupBtn').textContent = groupedView ? 'Flat List' : 'Group by Model'; renderIMEIStock(); }

function renderIMEIStock(force = false) {
  const q = $('imeiSearch').value.toLowerCase();
  let items = allIMEIStock.filter(p => {
    if (imeiFilter !== 'all' && p.status !== imeiFilter) return false;
    if (q) return (p.brand + p.model + p.imei + (p.imei2 || '') + p.color + p.storage).toLowerCase().includes(q);
    return true;
  });
  $('imeiCount').textContent = `${items.length} phone${items.length !== 1 ? 's' : ''}`;
  updateBulkActions();
  const list = $('imeiList');
  if (!list) return;
  if (!items.length) { 
    list.innerHTML = `<div class="empty"><div class="empty-icon">—</div><h3>No phones found</h3></div>`; 
    return; 
  }

  // Optimization: If the content is identical, don't update DOM to prevent flicker
  // (Simple check: compare length and first/last IDs)
  const stateKey = `${items.length}-${groupedView}-${imeiFilter}-${items[0]?.id || items[0]?._id}-${items[items.length-1]?.id || items[items.length-1]?._id}`;
  if (!force && list._stateKey === stateKey) return;
  list._stateKey = stateKey;

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
          <span style="font-family:var(--mono);font-size:.7rem;font-weight:700;background:rgba(22,163,74,.15);color:var(--a1);border:1px solid rgba(22,163,74,.3);padding:2px 9px;border-radius:20px;">${count} unit${count !== 1 ? 's' : ''}</span>
          ${inStockCount ? `<span class="badge badge-green">${inStockCount} in stock</span>` : ''}
          ${soldCount ? `<span class="badge badge-red">${soldCount} sold</span>` : ''}
          <span class="badge badge-blue">${esc((CATS[g.cat]?.label) || titleCase(g.cat || 'Other'))}</span>
          <span class="badge ${isOpen ? 'badge-green' : 'badge-gray'}" id="grp-state-${uid}">${isOpen ? 'Open' : 'Closed'}</span>
          ${(g.colors && g.colors.size === 1) ? `<span class="badge badge-gray">${esc(titleCase([...g.colors][0]))}</span>` : (g.colors && g.colors.size > 1 ? `<span class="badge badge-gray">Multiple Colors</span>` : '')}
          ${storageLabel ? `<span class="badge badge-purple">${storageLabel}</span>` : ''}
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
  const count = selectedPhoneIds.size;
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
  const profitTag = authRole === 'admin' && p.salePrice && p.buyPrice ? `<span class="badge ${p.salePrice - p.buyPrice >= 0 ? 'badge-green' : 'badge-red'}">${p.salePrice - p.buyPrice >= 0 ? '+' : ''}${pkr(p.salePrice - p.buyPrice)}</span>` : '';
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
  ${authRole === 'admin' && p.buyPrice ? `<div style="color:var(--text2);font-size:.62rem">Cost</div><div>${pkr(p.buyPrice)}</div>` : ''}
  ${p.salePrice ? `<div style="color:var(--text2);font-size:.62rem;margin-top:3px">Sold</div><div style="color:var(--success)">${pkr(p.salePrice)}</div>` : ''}
</div>
<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
  ${!IS_PHONE ? `<button class="btn bo" onclick="openEditPhone('${p.id}')" style="font-size:.62rem;padding:.22rem .5rem;">Edit</button>` : ''}
  ${p.status === 'in_stock' ? `<button class="del-btn" onclick="deletePhone('${p.id}')" title="Remove" aria-label="Delete phone">×</button>` : ''}
  ${p.status === 'sold' && authRole === 'admin' ? `<button class="del-btn" onclick="deleteSaleByIMEI('${esc(p.imei)}')" title="Delete sale" aria-label="Delete sale">×</button>` : ''}
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
  const d = await api('PUT', `/api/stock/${id}`, payload);
  if (d.error) { showToast(d.error, 'error'); return; }
  closeModal();
  showToast('Phone updated');
  await loadIMEIData();
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
  if (d.error) { showToast(d.error, 'error'); return; }
  closeModal();
  showToast(`Updated ${d.modified || ids.length} phone${(d.modified || ids.length) !== 1 ? 's' : ''}`);
  clearPhoneSelection();
  await loadIMEIData();
}

async function deletePhone(id) {
  if (!id || id === 'undefined') { showToast('Invalid phone id', 'error'); return; }
  const ok = await confirmModal({
    title: 'Remove Phone',
    message: 'Are you sure you want to remove this phone from stock? If this phone was sold, its sale record will also be removed.',
    confirmText: 'Remove Phone',
    danger: true
  });
  if (!ok) return;
  // Optimistically hide the card immediately for instant feedback
  const card = document.getElementById('card-' + id);
  if (card) card.style.display = 'none';
  selectedPhoneIds.delete(id);
  updateBulkActions();
  const d = await api('DELETE', `/api/stock/${id}`);
  if (d && d.error) {
    // Revert the card visibility on failure
    if (card) card.style.display = '';
    showToast(d.error, 'error'); return;
  }
  showToast('Phone removed', 'warn');
  await loadIMEIData();
  loadSidebarStats();
  if (activePage === 'stock') loadDay();
}
function exportIMEICSV() {
  const h = 'IMEI 1,IMEI 2,Brand,Model,Color,Storage,Buy Price,Sale Price,Profit,Status,Shop,Added,Sold\n';
  const rows = allIMEIStock.map(p => [p.imei, p.imei2 || '', p.brand, p.model, p.color, p.storage, p.buyPrice || '', p.salePrice || '', (p.salePrice && p.buyPrice ? p.salePrice - p.buyPrice : ''), p.status, p.shop || '', fmtDate(p.addedAt), p.soldAt ? fmtDate(p.soldAt) : ''].join(','));
  dlCSV(h + rows.join('\n'), `IMEI_Stock_${today()}.csv`);
}

// ── SALES LOG ──
var allSalesData = [];

async function loadSalesLog() {
  const shop = $('sl-shop').value;
  const url = shop === 'ALL' ? '/api/sales' : `/api/sales?shop=${shop}`;
  const data = await api('GET', url);
  allSalesData = Array.isArray(data) ? data : [];
  renderSalesLog();
}

function renderSalesLog() {
  const from = $('sl-from')?.value, to = $('sl-to')?.value;
  const body = $('sl-body');
  let sales = [...allSalesData];
  if (from) sales = sales.filter(s => s.soldAt && s.soldAt.slice(0, 10) >= from);
  if (to) sales = sales.filter(s => s.soldAt && s.soldAt.slice(0, 10) <= to);
  if (!sales.length) { body.innerHTML = `<div class="empty"><div class="empty-icon">—</div><h3>No sales found</h3><p>Try adjusting the date filters</p></div>`; return; }
  sales.sort((a, b) => (b.soldAt || '').localeCompare(a.soldAt || ''));
  const byDate = {};
  sales.forEach(s => { const d = s.soldAt ? s.soldAt.slice(0, 10) : 'Unknown'; if (!byDate[d]) byDate[d] = []; byDate[d].push(s); });
  const tRev = sales.reduce((s, x) => s + (x.salePrice || 0), 0);
  const tPL = sales.reduce((s, x) => s + (x.profit || 0), 0);
  let html = `<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin:.7rem .7rem .4rem;padding:.55rem .8rem;background:var(--s2);border:1px solid var(--border);border-radius:10px;">
<div style="flex:1;min-width:110px;"><div style="font-size:.55rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px">Total Revenue</div><div style="font-family:var(--mono);font-size:.95rem;color:var(--success)">${pkr(tRev)}</div></div>
<div style="flex:1;min-width:110px;"><div style="font-size:.55rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px">Net Profit</div><div style="font-family:var(--mono);font-size:.95rem;color:${tPL >= 0 ? 'var(--success)' : 'var(--danger)'}">${pkr(tPL)}</div></div>
<div style="flex:1;min-width:90px;"><div style="font-size:.55rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px">Units Sold</div><div style="font-family:var(--mono);font-size:.95rem;color:var(--a1)">${sales.length}</div></div>
  </div><div style="padding:0 .7rem .7rem">`;
  Object.entries(byDate).forEach(([date, daySales]) => {
    const uid = date.replace(/-/g, '');
    const dayRev = daySales.reduce((s, x) => s + (x.salePrice || 0), 0);
    const dayPL = daySales.reduce((s, x) => s + (x.profit || 0), 0);
    html += `<div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;margin-bottom:.5rem;overflow:hidden;">
  <div style="display:flex;align-items:center;gap:.6rem;padding:.5rem .85rem;cursor:pointer;transition:background .15s;"
    onclick="toggleDateGroup('${uid}')" onmouseover="this.style.background='var(--s3)'" onmouseout="this.style.background=''">
    <div style="flex:1;">
      <div style="font-weight:700;font-size:.82rem;color:var(--white);font-family:var(--mono)">${date}</div>
      <div style="font-size:.62rem;color:var(--text2);margin-top:1px">${daySales.length} sale${daySales.length !== 1 ? 's' : ''}</div>
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
        <td style="padding:.3rem .7rem;color:var(--white);font-weight:600">${esc(s.brand || '')} ${esc(s.model || '')}</td>
        <td style="padding:.3rem .7rem;font-family:var(--mono);font-size:.62rem;color:var(--text2)">${s.imei || ''}</td>
        <td style="padding:.3rem .7rem"><span style="background:rgba(${SHOP_RGBA[s.soldByShop || s.shop] || '22,163,74'},.15);color:${SHOP_COLOR[s.soldByShop || s.shop] || 'var(--a5)'};border:1px solid rgba(${SHOP_RGBA[s.soldByShop || s.shop] || '22,163,74'},.3);padding:1px 6px;border-radius:10px;font-size:.6rem;font-weight:600">${s.soldByShop || s.shop || '—'}</span></td>
        <td style="padding:.3rem .7rem;color:var(--text2)">${esc(s.buyerName || '—')}${s.buyerPhone ? `<div style="font-size:.6rem;font-family:var(--mono);color:var(--text3)">${esc(s.buyerPhone)}</div>` : ''}</td>
        <td style="padding:.3rem .7rem;text-align:right;font-family:var(--mono);color:var(--text2)">${s.buyPrice ? pkr(s.buyPrice) : '—'}</td>
        <td style="padding:.3rem .7rem;text-align:right;font-family:var(--mono);color:var(--success)">${pkr(s.salePrice)}</td>
        <td style="padding:.3rem .7rem;text-align:right;font-family:var(--mono);color:${(s.profit || 0) >= 0 ? 'var(--a4)' : 'var(--danger)'}">${s.profit != null ? pkr(s.profit) : '—'}</td>
        <td style="padding:.3rem .4rem;text-align:center"><button class="bx" onclick="deleteSale('${s._id || s.id}')" title="Delete sale">×</button></td>
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
  const ok = await confirmModal({
    title: 'Delete Sale Record',
    message: 'Are you sure you want to delete this sale? The phone will be returned to active in-stock inventory.',
    confirmText: 'Return to Stock',
    danger: true
  });
  if (!ok) return;
  const d = await api('DELETE', `/api/sales/${id}`);
  if (d.error) { showToast(d.error, 'error'); return; }
  showToast('Sale deleted — phone returned to stock', 'warn');
  await loadSalesLog();
  loadSidebarStats();
  loadIMEIData();
  if (activePage === 'stock') loadDay();
}

async function deleteSaleByIMEI(imei) {
  const ok = await confirmModal({
    title: 'Delete Sale Record',
    message: 'Are you sure you want to delete this sale? The phone will be returned to active in-stock inventory.',
    confirmText: 'Return to Stock',
    danger: true
  });
  if (!ok) return;
  const d = await api('DELETE', `/api/sales/by-imei/${encodeURIComponent(imei)}`);
  if (d.error) { showToast(d.error, 'error'); return; }
  showToast('Sale deleted — phone returned to stock', 'warn');
  await loadIMEIData();
  loadSidebarStats();
  if (activePage === 'saleslog') loadSalesLog();
  if (activePage === 'stock') loadDay();
}

function exportSalesLogCSV() {
  const from = $('sl-from')?.value, to = $('sl-to')?.value;
  let sales = [...allSalesData];
  if (from) sales = sales.filter(s => s.soldAt && s.soldAt.slice(0, 10) >= from);
  if (to) sales = sales.filter(s => s.soldAt && s.soldAt.slice(0, 10) <= to);
  sales.sort((a, b) => (b.soldAt || '').localeCompare(a.soldAt || ''));
  const h = 'Date,Shop,Brand,Model,IMEI,Buyer,Cost,Sold For,Profit,Notes\n';
  const rows = sales.map(s => [
    s.soldAt ? s.soldAt.slice(0, 10) : '', s.soldByShop || s.shop || '', s.brand || '', s.model || '',
    s.imei || '', s.buyerName || '', s.buyPrice || '', s.salePrice || '',
    s.profit != null ? s.profit : '', s.notes || ''
  ].join(','));
  dlCSV(h + rows.join('\n'), `Sales_Log_${today()}.csv`);
}

async function clearAllSales() {
  const shop = $('sl-shop').value;
  const scope = shop === 'ALL' ? 'ALL sales' : 'all sales for Shop ' + shop;
  const ok = await confirmModal({
    title: 'Clear Sales Log',
    message: `CRITICAL WARNING: Permanently delete ${scope} from the database? All phones will be returned to in-stock inventory. This cannot be undone.`,
    confirmText: 'Clear All Sales',
    danger: true
  });
  if (!ok) return;
  const url = shop === 'ALL' ? '/api/sales' : `/api/sales?shop=${shop}`;
  const d = await api('DELETE', url);
  if (d.error) { showToast(d.error, 'error'); return; }
  showToast(`${d.deleted || 0} sale(s) cleared — phones returned to stock`, 'warn');
  allSalesData = [];
  renderSalesLog();
  loadSidebarStats();
  loadIMEIData();
}

// ── PRODUCTS (non-IMEI items) ──────────────────────────────────────────────
var allProducts = [];

async function submitProduct() {
  const name = ($('pName')?.value || '').trim();
  const qty = parseInt($('pQty')?.value) || 1;
  const buyPrice = $('pBuyPrice')?.value !== '' ? Number($('pBuyPrice').value) : undefined;
  const notes = ($('pNotes')?.value || '').trim();
  if (!name) { showToast('Product name is required', 'error'); $('pName')?.focus(); return; }

  const shop = activeShop === 'HQ' ? null : activeShop;
  const d = await api('POST', '/api/products', { name, quantity: qty, buyPrice, notes, shop });
  if (d.error) { showToast(d.error, 'error'); return; }

  const mergedMsg = d.merged ? ` (merged — total now ${d.product.quantity})` : '';
  showToast(`${name} ×${qty} added!${mergedMsg}`, 'success');

  // Clear inputs
  $('pName').value = '';
  $('pQty').value = '1';
  $('pBuyPrice').value = '';
  $('pNotes').value = '';
  $('pName')?.focus();
  loadProducts();
}

async function loadProducts() {
  const shop = activeShop === 'HQ' ? '' : activeShop;
  const url = shop ? `/api/products?shop=${shop}` : '/api/products';
  allProducts = await api('GET', url);
  if (!Array.isArray(allProducts)) allProducts = [];
  renderProducts();
}

function renderProducts() {
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
  <button class="btn bo" style="font-size:.58rem;padding:.14rem .4rem;" onclick="editProductQty('${p._id || p.id}','${esc(p.name)}',${p.quantity || 0})">Edit</button>
  <button class="bx" onclick="deleteProduct('${p._id || p.id}','${esc(p.name)}')">✕</button>
</div>`).join('')}`;
}

function editProductQty(id, name, currentQty) {
  showModal(`<h3>Edit ${esc(name)}</h3>
<div class="fc">
  <div class="fi"><label>New Quantity</label><input type="number" id="ep-qty" value="${currentQty}" min="0"></div>
</div>
<div class="mf"><button class="btn bo" onclick="closeModal()">Cancel</button><button class="btn bv" onclick="saveProductQty('${id}')">Save</button></div>`);
  setTimeout(() => $('ep-qty')?.focus(), 100);
}

async function saveProductQty(id) {
  const qty = parseInt($('ep-qty')?.value) || 0;
  const d = await api('PUT', `/api/products/${id}`, { quantity: qty });
  if (d.error) { showToast(d.error, 'error'); return; }
  closeModal();
  showToast('Quantity updated', 'success');
  loadProducts();
}

async function deleteProduct(id, name) {
  const ok = await confirmModal({
    title: 'Delete Product',
    message: `Are you sure you want to delete "${name}" from products / accessories?`,
    confirmText: 'Delete Product',
    danger: true
  });
  if (!ok) return;
  const d = await api('DELETE', `/api/products/${id}`);
  if (d.error) { showToast(d.error, 'error'); return; }
  showToast(`${name} deleted`, 'warn');
  loadProducts();
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
    renderIMEIStock();
  }
}
