/* ── Shared global state and constants ── */
/* Auto-split from index.html — 2026-04-25T15:26:28.690Z */

var BASE = (window.location.origin.includes('localhost') || window.location.origin.includes('capacitor'))
               ? "https://www.stock-ly.app"
               : window.location.origin;
function today() { return new Date().toISOString().slice(0, 10); }
function ym(d) { return d ? d.slice(0, 7) : ''; }
var SHOPS = [];
var SHOP_COLOR = { 'HQ': 'var(--chq)' };
var SHOP_RGBA = { 'HQ': '2,132,199' };
var CATS = {
  GOOGLE: { label: 'Google Pixel', cls: 'cpx' },
  IPHONE: { label: 'iPhone', cls: 'cip' },
  SAMSUNG: { label: 'Samsung', cls: 'csm' },
  OTHER: { label: 'Other', cls: 'cot' },
  BOX: { label: 'Box / Sealed', cls: 'cbx' },
  EXTRA: { label: 'Extra / Misc', cls: 'cex', isExtra: true },
};
var EXP_CATS = ['General', 'Salary', 'Rent', 'Utilities', 'Transport', 'Repairs', 'Marketing', 'Other'];

// ── DEVICE ROLE ──────────────────────────────────────────────────
// Phone = scan/add/sell only. Desktop = full access.
// Override by adding ?mode=desktop or ?mode=phone to the URL.
function getRole() {
  var p = new URLSearchParams(location.search);
  if (p.get('mode') === 'desktop') return 'desktop';
  if (p.get('mode') === 'phone') return 'phone';
  // Auto-detect: phone if touch device AND narrow screen
  var isPhone = (window.innerWidth <= 768) && ('ontouchstart' in window);
  return isPhone ? 'phone' : 'desktop';
}
var ROLE = getRole();
var IS_PHONE = ROLE === 'phone';

// Phone mode: hide desktop-only nav items and show a phone banner
function applyPhoneMode() {
  if (!IS_PHONE) return;
  // Admins keep full access even on phone
  if (typeof authRole !== 'undefined' && authRole === 'admin') return;
  // Hide pages phones shouldn't access
  ADMIN_ONLY_PAGES.map(p => 'ni-' + p)
    .forEach(id => { var el = document.getElementById(id); if (el) el.style.display = 'none'; });
  // Hide HQ section label and divider
  // Hide Head Office section and its preceding divider
  document.querySelectorAll('.sb-lbl').forEach(el => {
    if (el.textContent.trim() === 'Head Office') {
      var sec = el.closest('.sb-sec');
      if (sec) {
        sec.style.display = 'none';
        var prev = sec.previousElementSibling;
        if (prev && prev.classList.contains('sdiv')) prev.style.display = 'none';
      }
    }
  });
  // Add phone mode banner
  var banner = document.createElement('div');
  banner.style.cssText = 'background:rgba(22,163,74,.08);border-bottom:1px solid rgba(22,163,74,.2);padding:5px 12px;font-size:.65rem;color:var(--a1);font-weight:600;text-align:center;flex-shrink:0;';
  banner.textContent = 'Phone Mode — Scan & Add only';
  document.getElementById('main').prepend(banner);
}

var activeShop = '', activePage = 'scan', scanMode = 'add', pendingIMEI = '', camStream = null;
var shopModeActive = false;
var dayState = { shop: '', date: (typeof today === 'function' ? today() : ''), cats: {}, expenses: [], purchases: [], transfers: [], carryForward: 0 };
var allIMEIStock = [], allIMEISales = [], imeiFilter = 'in_stock';
var selectedPhoneIds = new Set();
var allDays = [], allShopExp = [], allDispatches = [], allShipments = [], hqStock = { items: [] };
var allLogsData = [], lastCEOSummary = null, lastAnalyticsData = null;

// Pages hidden on phone/shop mode (admin-only desktop pages)
var ADMIN_ONLY_PAGES = ['stock', 'expenses', 'history', 'warehouse', 'shipments', 'monthly', 'backup', 'saleslog', 'ceo', 'contacts', 'analytics', 'logs', 'reports'];

var authRole = null, authShop = null, _pendingGatePassword = '';
