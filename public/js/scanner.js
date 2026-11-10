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

var cameraGeneration = 0, cameraOpening = false, activeCameraOwner = '';
var barcodeFallbackPromise = null;
var scanTimer = 0, scanFrame = 0, focusResetTimer = 0, scannerWaitCleanup = null;
function cancelScannerTasks() {
  clearTimeout(scanTimer); scanTimer = 0;
  if (scanFrame) cancelAnimationFrame(scanFrame); scanFrame = 0;
  if (scannerWaitCleanup) scannerWaitCleanup(); scannerWaitCleanup = null;
}
const pendingCameraStreams = new Set();
function cameraOwner() { return JSON.stringify([localStorage.getItem('clientId'), localStorage.getItem('authToken'), authRole, authShop, activeShop, activePage]); }
function stopCameraStream(stream) { if (!stream) return; stream.getTracks().forEach(track => track.stop()); pendingCameraStreams.delete(stream); }
function cameraCapabilities(track) { try { return track?.getCapabilities?.() || {}; } catch { return {}; } }
function loadBarcodeFallback() {
  if (window.ZXing?.BrowserMultiFormatReader) return Promise.resolve();
  if (barcodeFallbackPromise) return barcodeFallbackPromise;
  let script;
  try { script = document.createElement('script'); script.src = '/js/zxing.min.js'; script.async = true; }
  catch { return Promise.reject(Error('Barcode decoder could not load. Retry or enter the IMEI manually.')); }
  const loading = new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(Error('Barcode decoder load timed out. Retry or enter the IMEI manually.')), 10000);
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); script.onload = null; script.onerror = null;
      if (error) { script.remove(); reject(error); } else resolve();
    };
    script.onload = () => finish(window.ZXing?.BrowserMultiFormatReader ? null : Error('Barcode decoder is unavailable. Retry or enter the IMEI manually.'));
    script.onerror = () => finish(Error('Barcode decoder could not load. Retry or enter the IMEI manually.'));
    try { document.head.appendChild(script); }
    catch { finish(Error('Barcode decoder could not load. Retry or enter the IMEI manually.')); }
  });
  barcodeFallbackPromise = loading;
  loading.catch(() => { if (barcodeFallbackPromise === loading) barcodeFallbackPromise = null; });
  return loading;
}
async function prepareBarcodeDecoder() {
  if (detectorInstance || zxingReader) return;
  if ('BarcodeDetector' in window) {
    try {
      const formats = await BarcodeDetector.getSupportedFormats();
      if (formats.length) detectorInstance = new BarcodeDetector({ formats });
    } catch { /* The bundled decoder remains available when native detection fails. */ }
  }
  if (!detectorInstance) {
    await loadBarcodeFallback();
    if (!zxingReader) zxingReader = new ZXing.BrowserMultiFormatReader();
  }
  if (!detectorCanvas) {
    detectorCanvas = document.createElement('canvas'); detectorCtx = detectorCanvas.getContext('2d', { willReadFrequently: true });
    if (!detectorCtx) throw Error('Barcode scanning is unavailable. Enter the IMEI manually.');
  }
}
async function openCamera(mode = 'imei1') {
  const owner = cameraOwner();
  if (camStream && !cameraOpening && activeCameraOwner === owner) {
    camMode = mode; $('camLabel').textContent = camLabels[mode] || 'Scanning…'; clearScanResult(); return;
  }
  closeCamera();
  const generation = cameraGeneration;
  const current = () => generation === cameraGeneration && owner === cameraOwner() && !document.hidden;
  activeCameraOwner = owner; cameraOpening = true; camMode = mode; lastScanResult = '';
  $('camLabel').textContent = camLabels[mode] || 'Scanning…';
  $('camUseImei1').style.display = ''; $('camUseImei2').style.display = '';
  $('camModal').style.display = 'flex';
  let stream;
  const abandon = () => { stopCameraStream(stream); if (generation === cameraGeneration) closeCamera(); };
  try {
    stream = await getBestCameraStream(current);
    if (!current()) { abandon(); return; }
    camStream = stream; pendingCameraStreams.delete(stream); torchTrack = stream.getVideoTracks()[0];
    const caps = cameraCapabilities(torchTrack);
    $('torchBtn').style.opacity = caps?.torch ? '1' : '0.3'; $('focusBtn').style.opacity = caps?.focusMode?.length ? '1' : '0.3';
    const video = $('camVideo'); video.srcObject = null; video.srcObject = stream;
    await video.play().catch(() => {});
    if (!current()) { abandon(); return; }
    await prepareBarcodeDecoder();
    if (!current()) { abandon(); return; }
    scanActive = true; startScanning();
  } catch (error) {
    const owned = current(); abandon();
    if (owned) {
      const message = error.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access or enter the IMEI manually.'
        : error.name === 'NotFoundError' ? 'No camera was found. Enter the IMEI manually.'
        : error.message?.includes('decoder') ? error.message : 'Camera unavailable. Use a secure connection or enter the IMEI manually.';
      showToast(message, 'error');
    }
  } finally { if (current()) cameraOpening = false; }
}

async function openCameraForImei2() { openCamera('imei2'); }

// Returns a MediaStream using the best available rear camera for barcode scanning.
// On phones with multiple rear cameras (ultra-wide, main, telephoto) it prefers the
// main 1× camera — the one most likely to autofocus on close-up IMEI labels.
// Compatible with iOS 16 / 17 / 18 (iPhone 16+) and modern Android multi-camera setups.
async function getBestCameraStream(current = () => true) {
  // Step 1 — get an initial stream to trigger the permission prompt.
  // facingMode ideal (not exact) gracefully falls back on iOS.
  const base = { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } };
  let stream = await navigator.mediaDevices.getUserMedia(base);
  pendingCameraStreams.add(stream);
  const check = () => { if (!current()) { stopCameraStream(stream); throw Error('Camera opening canceled'); } };
  check();
  try {
    // Step 2 — camera labels are only populated AFTER permission is granted, so
    // enumerate now and check whether a better rear camera exists.
    const devices = await navigator.mediaDevices.enumerateDevices();
    check();
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
          if (alt) {
            pendingCameraStreams.add(alt);
            if (!current()) { stopCameraStream(alt); check(); }
            stopCameraStream(stream); stream = alt;
          }
        }
      }
    }
    // Step 3 — enable continuous autofocus so close-up IMEI labels stay sharp.
    const track = stream.getVideoTracks()[0];
    const caps = cameraCapabilities(track);
    if (caps?.focusMode?.includes('continuous')) {
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => { });
    }
  } catch (e) { }
  check();
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
  cameraGeneration++; cameraOpening = false;
  scanActive = false;
  scanLoopId++; cancelScannerTasks(); clearTimeout(focusResetTimer); focusResetTimer = 0;
  for (const stream of new Set([...pendingCameraStreams, camStream].filter(Boolean))) stopCameraStream(stream);
  camStream = null; torchTrack = null;
  $('camVideo').pause?.(); $('camVideo').srcObject = null;
  if (detectorCanvas) { detectorCanvas.width = 0; detectorCanvas.height = 0; }
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
  const track = torchTrack, generation = cameraGeneration;
  const current = () => generation === cameraGeneration && track === torchTrack;
  if (!track) return;
  try {
    await track.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] });
    if (!current()) return;
    showToast('Focusing…'); clearTimeout(focusResetTimer);
    focusResetTimer = setTimeout(async () => {
      if (!current()) return;
      try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch {}
    }, 800);
  } catch {
    if (!current()) return;
    try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); if (current()) showToast('Focusing…'); }
    catch { if (current()) showToast('Focus not supported on this device', 'warn'); }
  }
}

async function startScanning() {
  if (!detectorInstance && !zxingReader) {
    $('camHint').innerHTML = '<span style="color:var(--warn)">⚠ Barcode scanning is not supported in this browser. Please use Chrome, Edge, or Safari.</span>';
    return;
  }
  const vid = $('camVideo');
  cancelScannerTasks();
  const myLoopId = ++scanLoopId;
  const current = () => scanActive && camStream && scanLoopId === myLoopId && activeCameraOwner === cameraOwner() && !document.hidden;
  const checkCurrent = () => {
    if (current()) return true;
    if (scanLoopId === myLoopId && (activeCameraOwner !== cameraOwner() || document.hidden)) closeCamera();
    return false;
  };
  const scan = async () => {
    if (!checkCurrent()) return;
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
          if (checkCurrent() && codes.length > 0) onBarcodeDetected(codes[0].rawValue, codes[0].format);
        } else {
          const result = zxingReader.decodeFromCanvas(detectorCanvas);
          if (checkCurrent() && result) onBarcodeDetected(result.getText(), result.getBarcodeFormat().toString());
        }
      } catch (e) { }
    }
    // Reschedule only if still active (onBarcodeDetected may have set scanActive=false)
    if (checkCurrent()) scanTimer = setTimeout(() => { if (checkCurrent()) scanFrame = requestAnimationFrame(scan); }, 66);
  };
  if (vid.readyState >= 2 && vid.videoWidth > 0) scanFrame = requestAnimationFrame(scan);
  else {
    // 'playing' fires reliably on iOS Safari; 'canplay' may not
    let fired = false;
    const go = () => {
      if (!fired && checkCurrent()) {
        fired = true; if (scannerWaitCleanup) scannerWaitCleanup(); scannerWaitCleanup = null;
        scanFrame = requestAnimationFrame(scan);
      }
    };
    scannerWaitCleanup = () => { vid.removeEventListener('playing', go); vid.removeEventListener('loadeddata', go); clearTimeout(scanTimer); };
    vid.addEventListener('playing', go, { once: true });
    vid.addEventListener('loadeddata', go, { once: true });
    scanTimer = setTimeout(go, 2000); // safety fallback in case neither event fires
  }
}

document.addEventListener('visibilitychange', () => { if (document.hidden && (camStream || cameraOpening)) closeCamera(); });
