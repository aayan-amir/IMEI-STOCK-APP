/* ── Boot sequence and app initialization ── */
/* Auto-split from index.html — 2026-04-25T15:26:28.702Z */

// ── BOOT ──
async function bootApp() {
  $('topbar').style.display = 'flex';
  $('wrap').style.display = 'flex';
  nav('scan');
  applyPhoneMode();
  const shop = (authRole === 'shop') ? authShop : activeShop;
  activeShop = shop;
  switchShop(shop);                       // switchShop(shop) already calls loadIMEIData if activePage is scan/imeistock
  if (authRole === 'shop') applyShopMode(shop);
  syncWorkspaceNavigation(activePage);
  loadBusinessCapabilities();
  $('work-date').value = today();
  $('monthly-month').value = ym(today()); $('exp-month-filter').value = ym(today()); $('ship-month-filter').value = ym(today());
  await loadSidebarStats({ dedupe: true });
  // Only call loadIMEIData if switchShop didn't already trigger it
  if (!['scan', 'imeistock'].includes(activePage)) await loadIMEIData();
  $('imeiInput')?.focus();
}

var nativeBackRegistration = null;
function initNativeBack() {
  const bridge = window.Capacitor;
  if (nativeBackRegistration || !bridge?.isNativePlatform?.() || typeof bridge.registerPlugin !== 'function') return;
  nativeBackRegistration = Promise.resolve().then(() => {
    const native = bridge.registerPlugin('App');
    return native.addListener('backButton', event => {
      if (typeof cameraOpening !== 'undefined' && (cameraOpening || camStream)) { closeCamera(); return; }
      if ($('modal-bg')?.classList.contains('open')) { closeModal(); return; }
      if ($('sb')?.classList.contains('sb-open')) { closeSidebar(); return; }
      if (['addForm', 'sellForm', 'batchForm', 'productForm'].some(id => $(id)?.getClientRects().length)) { setMode('add'); return; }
      if (authRole && activePage !== 'scan') { nav('scan'); return; }
      if (event.canGoBack) window.history.back();
      else native.exitApp().catch(() => {});
    });
  }).catch(() => { nativeBackRegistration = null; console.warn('Native back navigation could not initialize'); });
}
initNativeBack();

// ── INITIALIZE ──
// Override auth check to show Client ID box first if not set
async function initializeApp() {
  $('topbar').style.display = 'none';
  $('wrap').style.display = 'none';
  $('auth-overlay').classList.remove('hidden');
  const token = localStorage.getItem('authToken');
  const role = localStorage.getItem('authRole');
  const shop = localStorage.getItem('authShop');
  const clientId = localStorage.getItem('clientId');

  if (token && ['admin', 'shop'].includes(role) && clientId) {
    authRole = role; authShop = shop || null;
    const current = () => token === localStorage.getItem('authToken') && clientId === localStorage.getItem('clientId') && role === authRole && shop === localStorage.getItem('authShop');
    try {
      await api('GET', '/api/capabilities');
    } catch (error) {
      if (current()) {
        authRole = null; authShop = null;
        $('auth-client-input').value = clientId;
        $('auth-client-err').textContent = 'Could not verify your session. Please sign in again.';
        $('auth-client-err').style.display = 'block';
      }
      return;
    }
    if (!current()) return;
    currentClientId = clientId;
    currentClientShops = JSON.parse(localStorage.getItem('clientShops') || '[]');
    renderDynamicShops();
    authRole = role; authShop = shop || null;
    $('auth-overlay').classList.add('hidden');
    await bootApp();
  } else {
    // If we have clientId, prefill sign-in and focus password
    if (clientId) {
      currentClientId = clientId;
      currentClientShops = JSON.parse(localStorage.getItem('clientShops') || '[]');
      renderDynamicShops();
      $('auth-client').style.display = '';
      $('auth-role').style.display = 'none';
      $('auth-client-input').value = clientId;
      setTimeout(() => $('auth-gate-input-combined')?.focus(), 80);
    } else {
      setTimeout(() => $('auth-client-input')?.focus(), 80);
    }
  }
}
var startupPromise = initializeApp();
