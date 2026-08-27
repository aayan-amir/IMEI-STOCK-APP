/* ── Boot sequence and app initialization ── */
/* Auto-split from index.html — 2026-04-25T15:26:28.702Z */

// ── BOOT ──
async function bootApp() {
  $('topbar').style.display = 'flex';
  $('wrap').style.display = 'flex';
  applyPhoneMode();
  const shop = (authRole === 'shop') ? authShop : activeShop;
  activeShop = shop;
  switchShop(shop);                       // switchShop(shop) already calls loadIMEIData if activePage is scan/imeistock
  if (authRole === 'shop') applyShopMode(shop);
  $('work-date').value = today();
  $('monthly-month').value = ym(today()); $('exp-month-filter').value = ym(today()); $('ship-month-filter').value = ym(today());
  await loadSidebarStats();
  // Only call loadIMEIData if switchShop didn't already trigger it
  if (!['scan', 'imeistock'].includes(activePage)) await loadIMEIData();
  $('imeiInput')?.focus();
}

// ── INITIALIZE ──
// Override auth check to show Client ID box first if not set
(async () => {
  const token = localStorage.getItem('authToken');
  const role = localStorage.getItem('authRole');
  const shop = localStorage.getItem('authShop');
  const clientId = localStorage.getItem('clientId');

  if (token && role && clientId) {
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
      $('auth-superadmin').style.display = 'none';
      $('auth-client-input').value = clientId;
      setTimeout(() => $('auth-gate-input-combined')?.focus(), 80);
    } else {
      setTimeout(() => $('auth-client-input')?.focus(), 80);
    }
  }
})();
