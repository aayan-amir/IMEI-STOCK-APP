/* ── UI: navigation, sidebar, modal, clock, switchShop ── */
/* Auto-split from index.html — 2026-04-25T15:26:28.693Z */

function nav(page) {
  // Block desktop-only pages on phone (non-admin only)
  if (IS_PHONE && authRole !== 'admin' && ADMIN_ONLY_PAGES.includes(page)) { showToast('Not available on phone mode', 'warn'); return; }
  closeSidebar(); // close mobile sidebar overlay on navigation
  activePage = page;
  document.querySelectorAll('.pg').forEach(p => {
    p.classList.remove('on');
    p.style.opacity = ''; // Clear inline opacity from any previous 'switchShop' loading states
  });
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('on'));
  $('pg-' + page)?.classList.add('on');
  $('ni-' + page)?.classList.add('on');
  ({
    scan: () => $('imeiInput')?.focus(),
    imeistock: () => loadIMEIData(),
    saleslog: () => { $('sl-from').value = today(); $('sl-to').value = today(); loadSalesLog(); },
    stock: () => { $('work-date').value = $('work-date').value || today(); loadDay(); },
    expenses: () => { $('exp-month-filter').value = ym(today()); renderShopExpenses(); },
    history: () => loadAllDays(),
    warehouse: () => loadWarehouse(),
    shipments: () => loadShipments(),
    monthly: () => { $('monthly-month').value = ym(today()); renderMonthly(); },
    backup: () => { },
    ceo: () => { $('ceo-month').value = ym(today()); renderCEO(); },
    contacts: () => loadContacts(),
    analytics: () => renderAnalytics(),
    logs: () => loadLogs(),
    reports: () => { const t = $('rpt-type')?.value || 'daily'; $('rpt-period').value = t === 'monthly' ? ym(today()) : today(); loadReports(); },
  }[page] || function () { })();
}

function switchShop(s) {
  if (shopModeActive) return; // locked in shop mode
  activeShop = s;
  clearPhoneSelection();
  document.querySelectorAll('.stab').forEach(t => t.classList.toggle('on', t.dataset.s === s));
  var c = SHOP_COLOR[s] || 'var(--a5)'; var r = SHOP_RGBA[s] || '22,163,74';
  var sObj = currentClientShops.find(x => x.id === s) || { name: s };
  var label = s === 'HQ' ? 'Head Office' : (sObj.name || s);
  ['scan-shop-badge', 'imei-shop-badge', 'stock-badge'].forEach(id => {
    var el = $(id); if (!el) return;
    el.textContent = label;
    el.style.cssText = `background:rgba(${r},.1);border:1px solid rgba(${r},.3);color:${c};border-radius:20px;padding:2px 10px;`;
  });
  var lbl = $('sb-lbl2');
  if (lbl) lbl.textContent = label.toUpperCase();

  // Update shop-specific filters if they exist on the current page
  var filters = {
    expenses: 'exp-shop-filter',
    saleslog: 'sl-shop',
    history: 'hist-shop',
    shipments: 'ship-shop-filter',
    monthly: 'monthly-shop',
    logs: 'log-shop',
    reports: 'rpt-shop'
  };
  var filterId = filters[activePage];
  if (filterId) {
    var el = $(filterId);
    if (el) {
      if (s === 'HQ') {
        // If clicking HQ, try to set to 'All' or empty if it's the first option
        if (el.options[0] && (el.options[0].value === '' || el.options[0].value === 'ALL')) {
          el.value = el.options[0].value;
        } else {
          el.value = s;
        }
      } else {
        el.value = s;
      }
    }
  }

  // Refresh logic for the active page
  if (['scan', 'imeistock', 'stock', 'expenses', 'saleslog', 'history', 'shipments', 'monthly', 'ceo', 'analytics', 'logs', 'reports'].includes(activePage)) {
    var pg = $('pg-' + activePage);
    if (pg) pg.style.opacity = '0.5'; // Visual feedback
  }

  if (['scan', 'imeistock'].includes(activePage)) loadIMEIData().finally(() => { var pg = $('pg-' + activePage); if (pg) pg.style.opacity = '1'; });
  else if (activePage === 'stock') { dayState.shop = s; loadDay().finally(() => { var pg = $('pg-stock'); if (pg) pg.style.opacity = '1'; }); }
  else if (activePage === 'expenses') renderShopExpenses().finally(() => { var pg = $('pg-expenses'); if (pg) pg.style.opacity = '1'; });
  else if (activePage === 'saleslog') loadSalesLog().finally(() => { var pg = $('pg-saleslog'); if (pg) pg.style.opacity = '1'; });
  else if (activePage === 'history') loadAllDays().finally(() => { var pg = $('pg-history'); if (pg) pg.style.opacity = '1'; });
  else if (activePage === 'shipments') loadShipments().finally(() => { var pg = $('pg-shipments'); if (pg) pg.style.opacity = '1'; });
  else if (activePage === 'monthly') renderMonthly().finally(() => { var pg = $('pg-monthly'); if (pg) pg.style.opacity = '1'; });
  else if (activePage === 'ceo') renderCEO().finally(() => { var pg = $('pg-ceo'); if (pg) pg.style.opacity = '1'; });
  else if (activePage === 'analytics') renderAnalytics().finally(() => { var pg = $('pg-analytics'); if (pg) pg.style.opacity = '1'; });
  else if (activePage === 'logs') loadLogs().finally(() => { var pg = $('pg-logs'); if (pg) pg.style.opacity = '1'; });
  else if (activePage === 'reports') loadReports().finally(() => { var pg = $('pg-reports'); if (pg) pg.style.opacity = '1'; });
  else if (activePage === 'contacts') loadContacts().finally(() => { var pg = $('pg-contacts'); if (pg) pg.style.opacity = '1'; });
  else if (activePage === 'warehouse') loadWarehouse().finally(() => { var pg = $('pg-warehouse'); if (pg) pg.style.opacity = '1'; });

  loadSidebarStats();
}

async function loadSidebarStats() {
  try {
    var sh = activeShop === 'HQ' ? null : activeShop;
    var s = await api('GET', sh ? `/api/stats?shop=${sh}` : '/api/stats');
    $('sb-is').textContent = s.inStock;
    $('sb-sa').textContent = s.sold;
    $('sb-rv').textContent = s.totalRevenue > 0 ? pkr(s.totalRevenue) : '—';
    var p = $('connPill'); p.classList.add('online'); $('connText').textContent = 'online';
  } catch (e) {
    var p = $('connPill'); p.classList.remove('online'); $('connText').textContent = 'offline';
  }
}
setInterval(() => { if (authRole) loadSidebarStats(); }, 12000);