/* ── Daily Sheet, Expenses, History, Monthly ── */
/* Auto-split from index.html — 2026-04-25T15:26:28.698Z */

// ── DAILY SHEET ──
let loadedDayContext = null;
let dayLoadGeneration = 0, dayActionReview = null;
const pendingDayRequests = {}, dayDraftMemory = new Map();
function dayOwner() { return JSON.stringify([localStorage.getItem('clientId'), authRole, authShop]); }
function selectedDay() { return { shop: activeShop === 'HQ' ? (SHOPS[0] || '') : activeShop, date: $('work-date').value || today() }; }
function dayManual() {
  return JSON.parse(JSON.stringify({ cats: { EXTRA: { rows: (dayState.cats?.EXTRA?.rows || []).filter(row => !row.saleAdjustmentId && !row.cashEntryId) } },
    expenses: (dayState.expenses || []).filter(row => !row.cashEntryId), purchases: (dayState.purchases || []).filter(row => !row.cashEntryId), transfers: (dayState.transfers || []).filter(row => !row.cashEntryId),
    carryForward: Number($('cf-carry')?.value ?? dayState.carryForward ?? 0) }));
}
function draftKey(context) { return 'stockly:day-draft:' + JSON.stringify([context.owner, context.shop, context.date]); }
function readDayDraft(context = loadedDayContext) {
  if (!context) return null;
  const key = draftKey(context);
  let draft = dayDraftMemory.get(key);
  try { draft = JSON.parse(sessionStorage.getItem(key) || 'null') || draft; } catch {}
  if (!draft || draft.expiresAt <= Date.now()) { dayDraftMemory.delete(key); try { sessionStorage.removeItem(key); } catch {} return null; }
  return draft;
}
function discardDayDraft() {
  if (!loadedDayContext) return;
  const key = draftKey(loadedDayContext); dayDraftMemory.delete(key);
  try { sessionStorage.removeItem(key); } catch {}
  renderDayStatus();
}
function persistDayDraft() {
  const context = loadedDayContext;
  if (!context || dayState.status === 'closed') return;
  const manual = dayManual();
  if (JSON.stringify(manual) === context.baseline) return;
  const draft = { baseRevision: context.revision, manual, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
  const key = draftKey(context); dayDraftMemory.set(key, draft);
  while (dayDraftMemory.size > 20) dayDraftMemory.delete(dayDraftMemory.keys().next().value);
  try {
    const encoded = JSON.stringify(draft);
    if (encoded.length > 256 * 1024) throw Error('Draft exceeds reload-recovery limit');
    sessionStorage.setItem(key, encoded);
    const keys = Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i)).filter(key => key?.startsWith('stockly:day-draft:'));
    keys.map(key => ({ key, expiresAt: JSON.parse(sessionStorage.getItem(key)).expiresAt })).sort((a, b) => a.expiresAt - b.expiresAt).slice(0, Math.max(0, keys.length - 20)).forEach(({ key }) => sessionStorage.removeItem(key));
  } catch { $('day-draft-banner').textContent = 'Unsaved draft stays in this tab; reload recovery is unavailable.'; }
}
function restoreDayDraft() {
  const draft = readDayDraft(), context = loadedDayContext;
  if (!draft || !context || context.owner !== dayOwner() || context.revision !== draft.baseRevision || dayState.status === 'closed') { showToast('This draft is from a different revision. Keep it for reference; reload and review changes.', 'error'); return false; }
  const { cats, ...manual } = draft.manual;
  const corrections = (dayState.cats.EXTRA?.rows || []).filter(row => row.saleAdjustmentId || row.cashEntryId);
  const recorded = Object.fromEntries(['expenses', 'purchases', 'transfers'].map(field => [field, (dayState[field] || []).filter(row => row.cashEntryId)]));
  Object.assign(dayState, manual);
  for (const field of Object.keys(recorded)) dayState[field] = [...(dayState[field] || []), ...recorded[field]];
  dayState.cats.EXTRA = { rows: [...cats.EXTRA.rows, ...corrections] };
  $('cf-carry').value = dayState.carryForward;
  renderStock(); renderExpenses(); renderPurchases(); renderTransfers(); recalc();
  renderDayStatus(); return true;
}
function downloadDayDraft() {
  const draft = readDayDraft();
  if (!draft || !loadedDayContext || loadedDayContext.owner !== dayOwner()) return;
  const payload = { format: 'stockly-daily-draft', shop: loadedDayContext.shop, date: loadedDayContext.date, ...draft };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `stockly-day-draft-${loadedDayContext.date}.json`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
function clearDailyDrafts() {
  const owner = dayOwner();
  for (const key of [...dayDraftMemory.keys()]) if (key.includes(JSON.stringify(owner))) dayDraftMemory.delete(key);
  try { const keys = Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i)); for (const key of keys) if (key?.startsWith('stockly:day-draft:') && key.includes(JSON.stringify(owner))) sessionStorage.removeItem(key); } catch {}
}
function renderDayStatus() {
  if (!loadedDayContext) return;
  const closed = dayState.status === 'closed';
  $('day-state-banner').textContent = closed ? `Closed revision ${dayState.revision}. Values come from the retained snapshot.` : 'Open sheet. Current owned stock is shown separately; historical opening and inbound quantities are unavailable without a close snapshot.';
  $('day-save').disabled = closed; $('day-close').disabled = closed; $('day-reopen').disabled = !closed;
  for (const id of ['stock-wrap', 'exp-list', 'purchase-list', 'transfer-list']) $(id)?.querySelectorAll('input,textarea,button').forEach(node => { node.disabled = closed; });
  $('cf-carry').disabled = closed;
  const draft = readDayDraft();
  $('day-draft-banner').innerHTML = !draft ? '' : `<span>Unsaved draft retained for up to 24 hours${draft.baseRevision !== loadedDayContext.revision ? '; server revision changed' : ''}.</span> <button class="btn bo" onclick="restoreDayDraft()" ${closed || draft.baseRevision !== loadedDayContext.revision ? 'disabled' : ''}>Restore draft</button> <button class="btn bo" onclick="downloadDayDraft()">Download draft</button> <button class="btn bo" onclick="discardDayDraft()">Discard draft</button>`;
}
function makeEmptyDay(shop, date) { const cats = {}; Object.keys(CATS).forEach(k => cats[k] = { rows: [] }); return { shop, date, cats, expenses: [], purchases: [], transfers: [], carryForward: 0 }; }

// Map brand name → CATS key
function guessCat(brand, model, cat) {
  if (cat && CATS[cat] && !CATS[cat].isExtra) return cat;
  const b = (brand || '').toLowerCase(), m = (model || '').toLowerCase();
  if (b.includes('apple') || b.includes('iphone') || m.includes('iphone')) return 'IPHONE';
  if (b.includes('samsung') || m.includes('samsung') || m.includes('galaxy')) return 'SAMSUNG';
  if (b.includes('google') || m.includes('pixel')) return 'GOOGLE';
  return 'OTHER';
}

function autoSelectCat(brandVal, selectId) {
  const sel = $(selectId); if (!sel) return;
  if (sel.value === 'BOX' || sel.value === 'EXTRA') return;
  const cat = guessCat(brandVal, '', null);
  if (cat) sel.value = cat;
}

var CAT_BRANDS = { IPHONE: 'Apple', SAMSUNG: 'Samsung', GOOGLE: 'Google', BOX: '', OTHER: '', EXTRA: '' };
function autoBrandFromCat(catId, brandId) {
  const cat = $(catId)?.value, brandEl = $(brandId);
  if (!brandEl) return;
  const fill = CAT_BRANDS[cat];
  if (fill !== undefined) brandEl.value = fill;
}

async function loadDay() {
  persistDayDraft();
  const generation = ++dayLoadGeneration, owner = dayOwner();
  try {
    const shop = activeShop === 'HQ' ? (SHOPS[0] || '') : activeShop;
    const date = $('work-date').value || today();

    const stockUrl = shop ? `/api/stock?shop=${encodeURIComponent(shop)}&all=true` : '/api/stock?all=true';
    const saved = await api('GET', `/api/days/${shop}/${date}`);
    const current = () => generation === dayLoadGeneration && owner === dayOwner() && selectedDay().shop === shop && selectedDay().date === date;
    if (!current()) return;
    if (saved.status === 'closed' && saved.closedSnapshot) {
      dayState = { ...makeEmptyDay(shop, date), ...saved, cats: saved.closedSnapshot.cats };
      loadedDayContext = { shop, date, owner, revision: saved.revision ?? 0, baseline: '' };
      $('cf-carry').value = dayState.carryForward || '';
      renderStock(); renderExpenses(); renderPurchases(); renderTransfers(); recalc(); renderDayStatus();
      return;
    }
    const [stockItems, summary] = await Promise.all([api('GET', stockUrl), api('GET', `/api/financial-summary?type=daily&shop=${encodeURIComponent(shop)}&period=${date}`)]);
    if (!current()) return;
    const events = summary.ledger;
    if ((summary.sources[0]?.revision ?? 0) !== (saved.revision ?? 0)) throw Error('This day changed during loading. Reload before editing.');
    const grouped = {};
    function group(item) {
      const cat = guessCat(item.brand, item.model, item.cat);
      const name = [item.brand, item.model].filter(Boolean).join(' ') || 'Unknown';
      const key = JSON.stringify([cat, name, item.storage || '']);
      if (!grouped[key]) grouped[key] = { cat, name, storage: item.storage || '',
        costPerUnit: item.buyPrice || 0, inStockCount: 0, inventoryCost: 0, out: 0, soldFor: 0, soldCost: 0 };
      if (grouped[key].costPerUnit !== (item.buyPrice || 0)) grouped[key].costPerUnit = null;
      return grouped[key];
    }
    stockItems.forEach(phone => {
      if (phone.status === 'in_stock') { const row = group(phone); row.inStockCount++; row.inventoryCost = StocklyBusinessRules.sumMoney([row.inventoryCost, phone.buyPrice || 0]); }
    });
    events.filter(event => event.kind === 'sale').forEach(event => {
      const row = group(event);
      row.out++;
      row.soldFor = StocklyBusinessRules.sumMoney([row.soldFor, event.salePrice]);
      row.soldCost = StocklyBusinessRules.sumMoney([row.soldCost, event.buyPrice]);
    });

    dayState = makeEmptyDay(shop, date);
    if (saved && saved.cats) {
      // Preserve non-stock fields, but rebuild stock rows from live IMEI stock.
      dayState = { ...dayState, ...saved };
      Object.keys(CATS).forEach(k => { if (!dayState.cats[k]) dayState.cats[k] = { rows: [] }; });
    }

    // Rebuild all non-EXTRA stock rows from live IMEI stock so prices/qty stay in sync.
    Object.entries(CATS).forEach(([ck, cv]) => { if (!cv.isExtra) dayState.cats[ck] = { rows: [] }; });
    Object.values(grouped).forEach(g => {
      const ck = g.cat;
      if (!dayState.cats[ck]) dayState.cats[ck] = { rows: [] };
      dayState.cats[ck].rows.push({
        name: g.name + (g.storage ? ` ${g.storage}` : ''),
        op: null, // No historical opening is invented from current stock.
        inQty: null,
        currentInStock: g.inStockCount,
        currentStockCost: g.inventoryCost,
        out: g.out,
        soldFor: g.soldFor,
        soldCost: g.soldCost,
        costPerUnit: g.costPerUnit,
        boughtFor: 0,
      });
    });

    // Derived corrections are rebuilt from retained history on every load.
    dayState.cats.EXTRA.rows = dayState.cats.EXTRA.rows.filter(row => !row.saleAdjustmentId);
    events.filter(event => event.kind === 'reversal').forEach(event => {
      dayState.cats.EXTRA.rows.push({ name: `Sale reversal: ${event.brand || ''} ${event.model || ''} (${event.imei || ''})`.trim(),
        boughtFor: event.buyPrice, soldFor: event.salePrice, unitsDelta: -1, saleAdjustmentId: event._id });
    });

    dayState.standaloneExpenses = summary.expenseBreakdown.filter(row => row.source === 'shop');
    dayState.cashFormatVersion = saved.cashFormatVersion;
    for (const entry of summary.cashEntries || []) {
      const base = { cashEntryId: entry._id, desc: entry.description, amt: entry.amountMinor / 100 };
      if (entry.kind === 'income') dayState.cats.EXTRA.rows.push({ cashEntryId: entry._id, name: entry.description, boughtFor: (entry.costMinor || 0) / 100, soldFor: entry.amountMinor / 100 });
      else if (entry.kind === 'purchase') dayState.purchases.push(base);
      else if (entry.kind === 'transfer') dayState.transfers.push(base);
    }
    dayState.revision = saved.revision ?? 0; dayState.status = saved.status || 'open';
    loadedDayContext = { shop, date, owner, revision: dayState.revision, baseline: '' };
    renderStock(); renderExpenses(); renderPurchases(); renderTransfers();
    $('cf-carry').value = dayState.carryForward || '';
    loadedDayContext.baseline = JSON.stringify(dayManual()); recalc(); renderDayStatus();
  } catch (error) {
    return handleApiError(error);
  }
}

function rowBalance(row) {
  if (row.currentInStock !== undefined) return row.currentInStock;
  return row.op == null || row.inQty == null ? null : row.op + row.inQty - (row.out || 0);
}
function renderStock() {
  const wrap = $('stock-wrap'); let html = '';
  const val = (s) => String(s || '').replace(/"/g, '&quot;');
  Object.entries(CATS).forEach(([ck, cv]) => {
    const rows = dayState.cats[ck]?.rows || []; const isExtra = cv.isExtra;
    html += `<div class="cb ${cv.cls}"><div class="ch"><div class="cl">${cv.label}</div><div class="cts" id="cts-${ck}"></div></div>`;
    if (isExtra) {
      html += `<table class="t"><thead><tr><th class="l">DESCRIPTION</th><th>BOUGHT FOR</th><th>SOLD FOR</th><th>P/L</th><th></th></tr></thead><tbody>`;
      if (!rows.length) html += `<tr><td colspan="5" style="color:var(--text3);font-size:.65rem;padding:.5rem">No items</td></tr>`;
      rows.forEach((r, i) => {
        const pl = StocklyBusinessRules.sumMoney([r.soldFor || 0, -(r.boughtFor || 0)]);
        if (r.saleAdjustmentId || r.cashEntryId) {
          html += `<tr><td class="l">${esc(r.name)}</td><td>${pkr(r.boughtFor)}</td><td>${pkr(r.soldFor)}</td><td>${pkr(pl)}</td><td>${r.cashEntryId ? 'Recorded payment' : 'Correction'}</td></tr>`;
          return;
        }
        html += `<tr>
    <td class="l"><input type="text" value="${val(r.name)}" oninput="onRC('${ck}',${i},'name',this.value)"></td>
    <td><input type="number" value="${r.boughtFor || 0}" min="0" oninput="onRC('${ck}',${i},'boughtFor',+this.value)"></td>
    <td><input type="number" value="${r.soldFor || 0}" min="0" oninput="onRC('${ck}',${i},'soldFor',+this.value)"></td>
    <td class="${pl > 0 ? 'ng' : pl < 0 ? 'nr' : 'nz'}">${pl || '-'}</td>
    <td><button class="bx" onclick="removeRow('${ck}',${i})">✕</button></td></tr>`;
      });
      html += `<tr><td><b>TOTAL</b></td><td>${rows.reduce((s, r) => s + (r.boughtFor || 0), 0)}</td><td>${rows.reduce((s, r) => s + (r.soldFor || 0), 0)}</td><td class="ng">${rows.reduce((s, r) => s + (r.soldFor || 0) - (r.boughtFor || 0), 0)}</td><td></td></tr>`;
      html += `</tbody></table>`;
    } else {
      html += `<table class="t"><thead><tr><th class="l">DESCRIPTION</th><th>OP</th><th>IN</th><th>OUT</th><th>BAL</th><th>COST/UNIT</th><th>COST(SOLD)</th><th>SOLD FOR</th><th>SALE AMT</th><th>P/L</th><th></th></tr></thead><tbody>`;
      if (!rows.length) html += `<tr><td colspan="11" style="color:var(--text3);font-size:.65rem;padding:.5rem">No items</td></tr>`;
      let tOP = 0, tIN = 0, tOUT = 0, tBAL = 0, tTC = 0, tSA = 0, tPL = 0;
      rows.forEach((r, i) => {
        const op = r.op || 0, inQ = r.inQty || 0, out = r.out || 0, bal = rowBalance(r);
        if (!op && !inQ && !out && !r.currentInStock) return;
        const tc = StocklyBusinessRules.dayRowCost(r, false), sa = r.soldFor || 0, pl = sa - tc;
        tOP += op; tIN += inQ; tOUT += out; tBAL += bal; tTC += tc; tSA += sa; tPL += pl;
        html += `<tr class="${out > 0 ? 'sold' : ''}">
      <td class="l">${esc(r.name || '(none)')}</td>
      <td class="op-cell">${r.op ?? '—'}</td>
      <td>${r.inQty ?? '—'}</td>
      <td>${out}</td>
      <td class="${bal === 0 ? 'nz' : ''}" id="d-${ck}-${i}-b">${bal ?? '—'}</td>
      <td>${r.costPerUnit == null ? 'Varies / unavailable' : r.costPerUnit.toLocaleString()}</td>
      <td class="ngd" id="d-${ck}-${i}-tc">${tc ? tc.toLocaleString() : '-'}</td>
      <td>(none)</td>
      <td class="${sa ? 'nb' : 'nz'}" id="d-${ck}-${i}-sa">${sa ? sa.toLocaleString() : '0'}</td>
      <td class="${pl > 0 ? 'ng' : pl < 0 ? 'nr' : 'nz'}" id="d-${ck}-${i}-pl">${pl ? pl.toLocaleString() : '-'}</td>
      <td></td></tr>`;
      });
      html += `<tr><td><b>TOTAL</b></td><td>${rows.some(row => row.op == null) ? '—' : tOP}</td><td>${rows.some(row => row.inQty == null) ? '—' : tIN}</td><td>${tOUT}</td><td>${rows.some(row => rowBalance(row) == null) ? '—' : tBAL}</td><td>—</td><td>${tTC.toLocaleString()}</td><td>—</td><td>${tSA.toLocaleString()}</td><td class="${tPL > 0 ? 'ng' : 'nr'}">${tPL.toLocaleString()}</td><td></td></tr>`;
      html += `</tbody></table>`;
    }
    html += `${isExtra ? `<button class="add-row" onclick="addRow('${ck}')">+ ADD ROW</button>` : ''}</div>`;
  });
  wrap.innerHTML = html; updateCatTotals();
}

function onRC(cat, i, field, val) {
  if (dayState.status === 'closed') return;
  if (dayState.cats[cat]?.rows[i]?.saleAdjustmentId || dayState.cats[cat]?.rows[i]?.cashEntryId) return;
  if (!dayState.cats[cat]?.rows[i]) return;
  dayState.cats[cat].rows[i][field] = val;
  if (!CATS[cat].isExtra) {
    const r = dayState.cats[cat].rows[i];
    const op = r.op || 0, inQ = r.inQty || 0, out = r.out || 0, bal = rowBalance(r);
    const tc = StocklyBusinessRules.dayRowCost(r, false), sa = r.soldFor || 0, pl = sa - tc;
    const bEl = $(`d-${cat}-${i}-b`); if (bEl) { bEl.textContent = bal; bEl.className = bal === 0 ? 'nz' : ''; }
    const tcEl = $(`d-${cat}-${i}-tc`); if (tcEl) tcEl.textContent = tc ? tc.toLocaleString() : '-';
    const saEl = $(`d-${cat}-${i}-sa`); if (saEl) { saEl.textContent = sa ? sa.toLocaleString() : '0'; saEl.className = sa ? 'nb' : 'nz'; }
    const plEl = $(`d-${cat}-${i}-pl`); if (plEl) { plEl.textContent = pl ? pl.toLocaleString() : '-'; plEl.className = pl > 0 ? 'ng' : pl < 0 ? 'nr' : 'nz'; }
  }
  updateCatTotals(); recalc();
}
function updateCatTotals() {
  Object.entries(CATS).forEach(([ck, cv]) => {
    const el = $(`cts-${ck}`); if (!el) return;
    const rows = dayState.cats[ck]?.rows || [];
    if (cv.isExtra) { const pl = rows.reduce((s, r) => s + (r.soldFor || 0) - (r.boughtFor || 0), 0); el.innerHTML = `<span>P/L: <b class="${pl >= 0 ? 'ng' : 'nr'}">${pl.toLocaleString()}</b></span>`; }
    else { const bal = rows.reduce((s, r) => s + (r.op || 0) + (r.inQty || 0) - (r.out || 0), 0); const sold = rows.reduce((s, r) => s + (r.out || 0), 0); const rev = rows.reduce((s, r) => s + (r.soldFor || 0), 0); const pl = rows.reduce((s, r) => s + (r.soldFor || 0) - StocklyBusinessRules.dayRowCost(r, false), 0); el.innerHTML = `<span>Bal:<b>${bal}</b></span><span>Sold:<b>${sold}</b></span><span>Rev:<b>${rev.toLocaleString()}</b></span><span>P/L:<b class="${pl >= 0 ? 'ng' : 'nr'}">${pl.toLocaleString()}</b></span>`; }
  });
}
function routeCashPayment(kind) {
  if (typeof hasBusinessCapability === 'function' && hasBusinessCapability('verifiedCashClose')) { openCashPayment(kind); return true; }
  if (dayState.cashFormatVersion === 1) { showToast('Payment recording is unavailable. Reload the current app before recording an actual payment.', 'error'); return true; }
  return false;
}
function addRow(cat) { if (cat === 'EXTRA' && routeCashPayment('income')) return; if (dayState.status === 'closed') return; if (!dayState.cats[cat]) dayState.cats[cat] = { rows: [] }; dayState.cats[cat].rows.push({ name: '', op: 0, costPerUnit: 0, inQty: 0, out: 0, soldFor: 0, boughtFor: 0 }); renderStock(); }
function removeRow(cat, i) { if (dayState.status === 'closed') return; if (dayState.cats[cat]?.rows[i]?.saleAdjustmentId || dayState.cats[cat]?.rows[i]?.cashEntryId) return; dayState.cats[cat].rows.splice(i, 1); renderStock(); }

function renderExpenses() { const list = $('exp-list'); list.innerHTML = ''; (dayState.expenses || []).forEach((e, i) => { const div = document.createElement('div'); div.className = 'ec'; div.innerHTML = `<input class="ed" value="${esc(e.desc || '')}" placeholder="Description" oninput="dayState.expenses[${i}].desc=this.value;recalc()">:<input class="ea" type="number" value="${e.amt || 0}" min="0" oninput="dayState.expenses[${i}].amt=+this.value;recalc()"><button class="bx" onclick="delExp(${i})">✕</button>`; list.appendChild(div); }); }
function addExp() { if (routeCashPayment('expense')) return; if (dayState.status === 'closed') return; dayState.expenses.push({ desc: '', amt: 0 }); renderExpenses(); recalc(); }
function delExp(i) { if (dayState.status === 'closed') return; dayState.expenses.splice(i, 1); renderExpenses(); recalc(); }
function renderMoneyRows(field, id, label, deleteHandler) {
  const list = $(id); list.innerHTML = '';
  (dayState[field] || []).forEach((row, index) => {
    const div = document.createElement('div'); div.className = 'ec';
    div.innerHTML = row.cashEntryId
      ? '<span>' + esc(row.desc) + '</span>:<strong>' + pkr(row.amt) + '</strong><span>Recorded payment</span>'
      : '<input class="ed" value="' + escAttr(row.desc || '') + '" placeholder="' + label + '" oninput="dayState.' + field + '[' + index + '].desc=this.value;recalc()">:<input class="ea" type="number" value="' + (row.amt || 0) + '" min="0" oninput="dayState.' + field + '[' + index + '].amt=+this.value;recalc()"><button class="bx" onclick="' + deleteHandler + '(' + index + ')">✕</button>';
    list.appendChild(div);
  });
}
function renderPurchases() { renderMoneyRows('purchases', 'purchase-list', 'Item', 'delPurchase'); }
function addPurchase() { if (routeCashPayment('purchase')) return; if (dayState.status === 'closed') return; dayState.purchases.push({ desc: '', amt: 0 }); renderPurchases(); recalc(); }
function delPurchase(i) { if (dayState.status === 'closed' || dayState.purchases[i]?.cashEntryId) return; dayState.purchases.splice(i, 1); renderPurchases(); recalc(); }
function renderTransfers() { renderMoneyRows('transfers', 'transfer-list', 'Transfer', 'delTransfer'); }
function addTransfer() { if (routeCashPayment('transfer')) return; if (dayState.status === 'closed') return; dayState.transfers.push({ desc: '', amt: 0 }); renderTransfers(); recalc(); }
function delTransfer(i) { if (dayState.status === 'closed' || dayState.transfers[i]?.cashEntryId) return; dayState.transfers.splice(i, 1); renderTransfers(); recalc(); }

function dailyFinancial() {
  if (dayState.status === 'closed') return dayState.closedSnapshot.financial;
  const totals = StocklyBusinessRules.sumDayRows(dayState.cats, CATS), sum = StocklyBusinessRules.sumMoney;
  const dailyExpenses = sum((dayState.expenses || []).map(row => row.amt || 0));
  const shopExpenses = sum((dayState.standaloneExpenses || []).map(row => row.amount || 0));
  const expenses = sum([dailyExpenses, shopExpenses]);
  const purchases = sum((dayState.purchases || []).map(row => row.amt || 0));
  const transfers = sum((dayState.transfers || []).map(row => row.amt || 0));
  const carryForward = Number($('cf-carry')?.value || 0);
  const cashMovement = sum([totals.revenue, -expenses, -purchases, -transfers]);
  return { ...totals, grossProfit: totals.profit, dailyExpenses, shopExpenses, expenses, purchases, transfers, carryForward,
    cashMovement, cashOnHand: sum([cashMovement, carryForward]), netProfit: sum([totals.profit, -expenses]) };
}
function recalc() {
  if (dayState.status !== 'closed') persistDayDraft();
  const f = dailyFinancial(), totals = StocklyBusinessRules.sumDayRows(dayState.cats, CATS);
  const { revenue: tSales, cost: tCost, expenses: tExp, purchases: tPur, transfers: tTr, carryForward: carry, cashMovement: sub, cashOnHand: coh, netProfit: pl } = f;
  dayState.carryForward = carry;
  $('cf-sa').textContent = pkr(tSales); $('cf-ex').textContent = pkr(tExp);
  $('cf-pu').textContent = pkr(tPur); $('cf-tr').textContent = pkr(tTr);
  $('cf-sub').textContent = pkr(sub); $('cf-fc').textContent = pkr(coh);
  const physical = dayState.status === 'closed' ? dayState.closedSnapshot?.inventory : null;
  const inStock = physical ? (physical.available ? physical.units : null) : Object.entries(CATS).reduce((sum, [cat, config]) => config.isExtra ? sum : sum + (dayState.cats[cat]?.rows || []).reduce((s, row) => s + (row.currentInStock || 0), 0), 0);
  const stVal = physical ? (physical.available ? physical.value : null) : StocklyBusinessRules.sumMoney(Object.entries(CATS).flatMap(([cat, config]) => config.isExtra ? [] : (dayState.cats[cat]?.rows || []).map(row => row.currentStockCost || 0)));
  const sold = totals.units;
  $('scards').innerHTML = `
<div class="sc g"><div class="sc-lbl">${physical ? 'At-close stock' : 'Current owned stock'}</div><div class="sc-val g">${stVal == null ? 'Unavailable' : pkr(stVal)}</div><div class="sc-sub">${inStock == null ? 'No historical stock reconstruction' : inStock + ' units'}</div></div>
<div class="sc gr"><div class="sc-lbl">Total Sales</div><div class="sc-val gr">${pkr(tSales)}</div><div class="sc-sub">${sold} sold today</div></div>
<div class="sc gr"><div class="sc-lbl">Net P/L</div><div class="sc-val ${pl >= 0 ? 'gr' : 'rd'}">${pkr(pl)}</div><div class="sc-sub">after expenses</div></div>
<div class="sc rd"><div class="sc-lbl">Expenses</div><div class="sc-val rd">${pkr(tExp)}</div><div class="sc-sub">${(dayState.expenses || []).length} items</div></div>
<div class="sc bl"><div class="sc-lbl">Purchased</div><div class="sc-val bl">${pkr(tPur)}</div><div class="sc-sub">recorded supplier payments</div></div>
<div class="sc g"><div class="sc-lbl">Sheet balance</div><div class="sc-val g">${pkr(coh)}</div><div class="sc-sub">unverified · includes all payment methods</div></div>`;
}

function currentDayContext() {
  const selected = selectedDay();
  return loadedDayContext && loadedDayContext.owner === dayOwner() && loadedDayContext.shop === selected.shop && loadedDayContext.date === selected.date;
}
async function saveDay(btn) {
  const button = btn || $('day-save');
  try {
    if (!currentDayContext()) throw Error('Load this shop and date successfully before saving');
    if (dayState.status === 'closed') throw Error('This day is closed. Reopen it before making a correction.');
    persistDayDraft();
    const context = loadedDayContext, manual = dayManual();
    const payload = { shop: context.shop, date: context.date, expectedRevision: context.revision, ...manual,
      ...(dayState.cashFormatVersion === 1 ? { cashFinancialOnly: true } : {}) };
    const action = keyedRequest(pendingDayRequests, 'save', JSON.stringify([context.owner, context.shop, context.date]), 'PUT', `/api/days/${context.shop}/${context.date}`, payload, { manualVersion: '2' });
    if (button) button.disabled = true;
    const { result, current } = await action.send();
    if (!currentDayContext() || loadedDayContext !== context) return;
    context.revision = result.day.revision; dayState.revision = result.day.revision; context.baseline = JSON.stringify(manual);
    if (current && JSON.stringify(dayManual()) === JSON.stringify(manual)) discardDayDraft();
    else persistDayDraft();
    showToast(`Day saved — ${context.shop} / ${context.date}`, 'success'); renderDayStatus();
  } catch (error) { return handleApiError(error); }
  finally { if (button) button.disabled = dayState.status === 'closed'; }
}
function openDayAction(action) {
  if (!currentDayContext()) { showToast('Load this day before changing its status', 'error'); return; }
  if (action === 'close' && JSON.stringify(dayManual()) !== loadedDayContext.baseline) { showToast('Save your draft before closing this day', 'error'); return; }
  dayActionReview = { action, context: loadedDayContext, expectedRevision: loadedDayContext.revision, key: newRequestKey() };
  showModal(`<h3>${action === 'close' ? 'Close' : 'Reopen'} ${esc(loadedDayContext.shop)} / ${esc(loadedDayContext.date)}</h3><p>${action === 'close' ? 'Capture the authoritative financial snapshot. Later sales and corrections post to the next open period.' : 'Keep the previous close in history and open a new revision for an authorized correction. Posting dates are not rewound.'}</p>${action === 'reopen' ? '<label for="day-reopen-reason">Reason for reopening</label><textarea id="day-reopen-reason" maxlength="500"></textarea>' : ''}<div class="mf"><button class="btn bo" onclick="closeModal()">Cancel</button><button class="btn bv" onclick="applyDayAction()">${action === 'close' ? 'Close day' : 'Reopen for correction'}</button></div>`);
}
async function applyDayAction() {
  try {
    const review = dayActionReview;
    if (!review || !currentDayContext() || loadedDayContext !== review.context) throw Error('Day context changed. Review it again.');
    const reason = review.action === 'reopen' ? $('day-reopen-reason')?.value || '' : undefined;
    await api('POST', `/api/days/${review.context.shop}/${review.context.date}/${review.action}`, { expectedRevision: review.expectedRevision, reason }, { operationId: review.key, manualVersion: '2' });
    if (dayActionReview !== review || loadedDayContext !== review.context) return;
    dayActionReview = null; discardDayDraft(); closeModal(); await loadDay();
    showToast('Day status updated', 'success');
  } catch (error) { return handleApiError(error); }
}
function exportDayCSV() {
  const lines = [`${dayState.shop} — ${dayState.date}`, 'DESCRIPTION,OP,IN,OUT,BAL,COST/UNIT,COST(SOLD),SOLD FOR,P/L'];
  Object.entries(CATS).forEach(([ck, cv]) => {
    const rows = dayState.cats[ck]?.rows || [];
    if (!rows.length) return;
    lines.push('', cv.label);
    rows.forEach(r => {
      const out = r.out || 0, bal = rowBalance(r), tc = StocklyBusinessRules.dayRowCost(r, cv.isExtra), sa = r.soldFor || 0;
      lines.push(`${r.name},${r.op ?? ''},${r.inQty ?? ''},${out},${bal ?? ''},${r.costPerUnit ?? ''},${tc},${sa},${StocklyBusinessRules.sumMoney([sa, -tc])}`);
    });
  });
  const f = dailyFinancial();
  lines.push('', `Revenue,${f.revenue}`, `Cost of Sales,${f.cost}`, `Expenses,${f.expenses}`, `Net Profit,${f.netProfit}`, `Purchases,${f.purchases}`, `Transfers,${f.transfers}`, `Cash movement,${f.cashMovement}`, `Cash on Hand,${f.cashOnHand}`);
  dlCSV(lines.join('\n'), `${dayState.shop}_${dayState.date}.csv`);
}

function printDaySheet() {
  const shop = dayState.shop || '—', date = dayState.date || '—';
  let rows = '';
  Object.entries(CATS).forEach(([ck, cv]) => {
    const catRows = dayState.cats[ck]?.rows || [];
    if (!catRows.length) return;
    rows += `<tr><td colspan="${cv.isExtra ? 5 : 10}" style="background:#f0f0f0;font-weight:700;font-size:9pt;padding:4px 8px">${cv.label}</td></tr>`;
    if (cv.isExtra) {
      catRows.forEach(r => { const pl = (r.soldFor || 0) - (r.boughtFor || 0); rows += `<tr><td>${esc(r.name || '—')}</td><td class="right num">${pkr(r.boughtFor || 0)}</td><td class="right num success">${pkr(r.soldFor || 0)}</td><td class="right num ${pl >= 0 ? 'success' : 'danger'}">${pkr(pl)}</td></tr>`; });
    } else {
      catRows.forEach(r => { const op = r.op || 0, inQ = r.inQty || 0, out = r.out || 0, bal = rowBalance(r), tc = StocklyBusinessRules.dayRowCost(r, false), sa = r.soldFor || 0, pl = sa - tc; rows += `<tr><td>${esc(r.name || '—')}</td><td class="right">${r.op ?? '—'}</td><td class="right">${r.inQty ?? '—'}</td><td class="right">${out}</td><td class="right">${bal ?? '—'}</td><td class="right num">${r.costPerUnit == null ? 'Varies / unavailable' : pkr(r.costPerUnit)}</td><td class="right num">${pkr(tc)}</td><td class="right num success">${pkr(sa)}</td><td class="right num ${pl >= 0 ? 'success' : 'danger'}">${pkr(pl)}</td></tr>`; });
    }
  });
  const f = dailyFinancial();
  const external = dayState.status === 'closed' ? dayState.closedSnapshot.shopExpenses : dayState.standaloneExpenses || [];
  const exRows = [...(dayState.expenses || []).map(row => ({ description: row.desc, amount: row.amt })), ...external].map(e => `<tr><td>${esc(e.description || '')}</td><td class="right num danger">${pkr(e.amount || 0)}</td></tr>`).join('');
  const html = `<h1>Daily Stock Sheet — Shop ${shop} — ${date}</h1><p>Revenue: ${pkr(f.revenue)} · Cost of Sales: ${pkr(f.cost)} · Expenses: ${pkr(f.expenses)} · Net Profit: ${pkr(f.netProfit)} · Cash movement: ${pkr(f.cashMovement)} · Cash on Hand: ${pkr(f.cashOnHand)}</p><p>Opening and inbound quantities are unavailable unless explicitly recorded. Balance shows current owned stock or an at-close snapshot, not reconstructed historical opening.</p>
  <table>
<thead><tr><th>Description</th><th class="right">OP</th><th class="right">IN</th><th class="right">OUT</th><th class="right">BAL</th><th class="right">Cost/Unit</th><th class="right">Cost(Sold)</th><th class="right">Sold For</th><th class="right">P/L</th></tr></thead>
<tbody>${rows}</tbody>
  </table>
  ${exRows ? `<h2>Expenses</h2><table><thead><tr><th>Description</th><th class="right">Amount</th></tr></thead><tbody>${exRows}</tbody></table>` : ''}`;
  printSection(`Daily Sheet — Shop ${shop} — ${date}`, html);
}

async function printSalesLog() {
  try {
  const from = $('sl-from').value, to = $('sl-to').value, shop = $('sl-shop').value || 'ALL';
  const kind = $('sl-kind').value || 'all', search = $('sl-search').value.trim();
  const sales = await completeSalesExport(); if (!sales) return;
  const totals = StocklyBusinessRules.sumSaleEvents(sales);
  const tRev = totals.revenue, tPL = totals.profit;
  const rows = sales.map(s => `<tr>
<td class="num">${s.soldAt ? (s.businessDate || StocklyBusinessRules.businessDate(s.soldAt)) : ''}</td>
<td>${esc((s.brand || '') + ' ' + (s.model || ''))}${s.kind === 'reversal' ? ' — Correction' : s.reversedAt ? ' — Reversed' : ''}</td>
<td class="num">${s.imei || ''}</td>
<td><span class="badge">${s.soldByShop || s.shop || '—'}</span></td>
<td>${esc(s.buyerName || '—')}</td>
<td class="right num">${s.buyPrice != null ? pkr(s.buyPrice) : '—'}</td>
<td class="right num success">${pkr(s.salePrice)}</td>
<td class="right num ${(s.profit || 0) >= 0 ? 'success' : 'danger'}">${s.profit != null ? pkr(s.profit) : '—'}</td>
  </tr>`).join('');
  const html = `<h1>Sales Log${shop !== 'ALL' ? ' — Shop ' + shop : ''}</h1>
  <div class="meta">${esc(from || 'All')} → ${esc(to || 'All')} · Type: ${esc(kind)}${search ? ' · Search: ' + esc(search) : ''} · All matching events · ${totals.units} net units · Revenue: ${pkr(tRev)} · P/L: ${pkr(tPL)}</div>
  <table>
<thead><tr><th>Date</th><th>Phone</th><th>IMEI</th><th>Shop</th><th>Buyer</th><th class="right">Cost</th><th class="right">Sold For</th><th class="right">Profit</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr style="font-weight:700"><td colspan="5">TOTAL</td><td></td><td class="right num success">${pkr(tRev)}</td><td class="right num ${tPL >= 0 ? 'success' : 'danger'}">${pkr(tPL)}</td></tr></tfoot>
  </table>`;
  printSection('Sales Log', html);
  } catch (error) { return handleApiError(error); }
}

async function printShipments() {
  try {
    const records = await movementPager.exportAll(); if (!records) return;
    printSection('Movements', '<h1>Retained stock movements</h1>' + movementHTML(records, true));
  } catch (error) { return handleApiError(error); }
}

async function printIMEIStock() {
  try {
  const scope = stockListScope();
  const searchLabel = $('imeiSearch').value.trim();
  const shopLabel = activeShop === 'HQ' ? 'All Shops' : 'Shop ' + activeShop;
  const filterLabel = imeiFilter === 'all' ? 'All' : imeiFilter === 'in_stock' ? 'In Stock' : 'Sold';
  const items = await completeStockExport(); if (!items || scope !== stockListScope()) return;
  const isAdmin = authRole === 'admin';
  const adminCols = isAdmin ? '<th class="right">Cost</th><th class="right">Sold For</th>' : '';
  const rows = items.map(p => `<tr>
<td>${fmtPhoneName(p.brand, p.model)}</td>
<td class="num">${esc(p.imei || '')}</td>
<td class="num">${esc(p.imei2 || '—')}</td>
<td>${esc(p.color || '—')}</td>
<td>${esc(p.storage || '—')}</td>
<td><span class="badge">${p.status === 'in_stock' ? 'In Stock' : 'Sold'}</span></td>
<td>${esc(p.shop || '—')}</td>
${isAdmin ? `<td class="right num">${p.buyPrice != null ? pkr(p.buyPrice) : '—'}</td><td class="right num ${p.salePrice != null ? 'success' : ''}">${p.salePrice != null ? pkr(p.salePrice) : '—'}</td>` : ''}
<td class="num">${p.addedAt ? p.addedAt.slice(0, 10) : ''}</td>
  </tr>`).join('');
  const html = `<h1>IMEI Stock — ${esc(shopLabel)}</h1>
  <div class="meta">Status: ${filterLabel}${searchLabel ? ' · Search: ' + esc(searchLabel) : ''} · ${items.length} phone${items.length !== 1 ? 's' : ''} · All matching records · Printed: ${new Date().toLocaleDateString('en-GB')}</div>
  <table>
<thead><tr><th>Phone</th><th>IMEI 1</th><th>IMEI 2</th><th>Color</th><th>Storage</th><th>Status</th><th>Shop</th>${adminCols}<th>Added</th></tr></thead>
<tbody>${rows}</tbody>
  </table>`;
  printSection('IMEI Stock', html);
  } catch (error) { return handleApiError(error); }
}

function printExpenses() {
  if (expenseDataScope !== expenseReadScope()) { showToast('Load the selected expenses before printing', 'warn'); return; }
  const shop = $('exp-shop-filter')?.value || 'ALL';
  const month = $('exp-month-filter')?.value || '';
  if (!allShopExp.length) { showToast('No expenses to print', 'warn'); return; }
  const byShop = {}; allShopExp.forEach(e => { if (!byShop[e.shop]) byShop[e.shop] = []; byShop[e.shop].push(e); });
  const grandTotal = allShopExp.reduce((a, e) => a + (e.amount || 0), 0);
  let shopSummary = Object.entries(byShop).map(([s, rows]) => `<div class="stat"><div class="stat-lbl">Shop ${esc(s)}</div><div class="stat-val danger">${pkr(rows.reduce((a, e) => a + (e.amount || 0), 0))}</div></div>`).join('');
  shopSummary += `<div class="stat"><div class="stat-lbl">Grand Total</div><div class="stat-val danger">${pkr(grandTotal)}</div></div>`;
  let tables = Object.entries(byShop).map(([s, rows]) => {
    const tot = rows.reduce((a, e) => a + (e.amount || 0), 0);
    const trows = rows.map(e => `<tr><td class="num">${esc(e.date || '')}</td><td>${esc(e.category || '')}</td><td>${esc(e.description || '')}</td><td class="right num danger">${pkr(e.amount)}</td></tr>`).join('');
    return `<h2>Shop ${esc(s)} — ${pkr(tot)}</h2><table>
  <thead><tr><th>Date</th><th>Category</th><th>Description</th><th class="right">Amount</th></tr></thead>
  <tbody>${trows}</tbody>
  <tfoot><tr style="font-weight:700"><td colspan="3">Total</td><td class="right num danger">${pkr(tot)}</td></tr></tfoot>
</table>`;
  }).join('');
  const title = `Shop Expenses${shop !== 'ALL' ? ' — Shop ' + shop : ''}${month ? ' — ' + month : ''}`;
  const html = `<h1>${title}</h1>
  <div class="meta">${allShopExp.length} expense${allShopExp.length !== 1 ? 's' : ''} · Printed: ${new Date().toLocaleDateString('en-GB')}</div>
  <div class="summary">${shopSummary}</div>
  ${tables}`;
  printSection(title, html);
}

async function printHistory() {
  try {
    const filters = historyPager.query().toString(), days = await historyPager.exportAll(); if (!days) return;
    const rows = days.map(day => { const f = historyTotals(day); return `<tr><td>${esc(day.shop)}</td><td>${esc(day.date)}</td><td>${esc(day.status || 'open')}</td><td>${day.revision ?? 0}</td><td>${f ? pkr(f.revenue) : 'Open full day'}</td><td>${f ? pkr(f.expenses) : 'Unavailable'}</td><td>${f ? pkr(f.netProfit) : 'Unavailable'}</td></tr>`; }).join('');
    printSection('Saved daily history', `<h1>Saved daily history</h1><p>All matching saved days · ${days.length} records · ${esc(filters)}. Closed figures are retained snapshots; open drafts require the current ledger. This index does not total draft financial rows.</p><table><thead><tr><th>Shop</th><th>Date</th><th>Status</th><th>Revision</th><th>Closed revenue</th><th>Closed expenses</th><th>Closed net profit</th></tr></thead><tbody>${rows}</tbody></table>`);
  } catch (error) { return handleApiError(error); }
}

function printWarehouse() {
  const q = ($('wh-search')?.value || '').toLowerCase();
  const items = (hqStock.items || []).filter(it => { const label = (it.name || [it.brand, it.model, it.storage].filter(Boolean).join(' ')); return !q || (label + String(it.cat || '') + String(it.imei || '')).toLowerCase().includes(q); });
  if (!items.length) { showToast('Warehouse is empty', 'warn'); return; }
  const byCat = {}; items.forEach(it => { const cat = it.cat || guessCat(it.brand, it.model, it.cat); if (!byCat[cat]) byCat[cat] = []; byCat[cat].push(it); });
  const totalUnits = items.length;
  const totalValue = items.reduce((s, it) => s + (Number(it.costPerUnit || it.buyPrice) || 0), 0);
  let tables = Object.entries(byCat).map(([cat, rows]) => {
    const catUnits = rows.length;
    const catVal = rows.reduce((s, it) => s + (Number(it.costPerUnit || it.buyPrice) || 0), 0);
    const trows = rows.map(it => { const name = [it.brand, it.model, it.storage].filter(Boolean).join(' ') || it.name || ''; const unit = (Number(it.costPerUnit || it.buyPrice) || 0); return `<tr><td>${esc(name)}</td><td class="num">${esc(it.imei || '—')}</td><td>${esc(it.cat || cat)}</td><td class="right num">${unit ? pkr(unit) : '—'}</td></tr>`; }).join('');
    return `<h2>${esc(cat)} — ${catUnits} unit${catUnits !== 1 ? 's' : ''}${catVal ? ` · ${pkr(catVal)}` : ''}</h2><table>
  <thead><tr><th>Phone</th><th>IMEI</th><th>Category</th><th class="right">Buy Price</th></tr></thead>
  <tbody>${trows}</tbody>
</table>`;
  }).join('');
  const html = `<h1>HQ Warehouse Stock</h1>
  <div class="meta">${items.length} item type${items.length !== 1 ? 's' : ''} · ${totalUnits} total units · Printed: ${new Date().toLocaleDateString('en-GB')}</div>
  <div class="summary">
<div class="stat"><div class="stat-lbl">Item Types</div><div class="stat-val">${items.length}</div></div>
<div class="stat"><div class="stat-lbl">Total Units</div><div class="stat-val">${totalUnits}</div></div>
${totalValue ? `<div class="stat"><div class="stat-lbl">Total Value</div><div class="stat-val">${pkr(totalValue)}</div></div>` : ''}
  </div>
  ${tables}`;
  printSection('HQ Warehouse', html);
}

async function printMonthly() {
  try {
  const month = $('monthly-month')?.value;
  const shopF = $('monthly-shop')?.value || 'ALL';
  if (!month) { showToast('Select a month first', 'warn'); return; }
  const owner = dayOwner();
  const summary = await api('GET', `/api/financial-summary?type=monthly&period=${month}&shop=${encodeURIComponent(shopF)}`);
  if (owner !== dayOwner() || month !== $('monthly-month').value || shopF !== ($('monthly-shop').value || 'ALL')) return;
  const shops = Object.keys(summary.shopStats);
  let rows = '', grandRev = summary.financial.revenue, grandNet = summary.financial.netProfit;
  shops.forEach(sh => {
    if (!summary.sources.some(row => row.shop === sh)) return;
    const { revenue: tSales, cost: tCost, grossProfit: gPL, units: sold, expenses: expT, netProfit: netPL } = summary.shopStats[sh];
    rows += `<tr><td style="font-weight:700">Shop ${esc(sh)}</td><td class="right num success">${pkr(tSales)}</td><td class="right num">${pkr(tCost)}</td><td class="right num ${gPL >= 0 ? 'success' : 'danger'}">${pkr(gPL)}</td><td class="right num danger">${pkr(expT)}</td><td class="right num ${netPL >= 0 ? 'success' : 'danger'}" style="font-weight:700">${pkr(netPL)}</td><td class="right">${sold}</td></tr>`;
  });
  if (!rows) { showToast('No data for selected month/shop', 'warn'); return; }
  const title = `Monthly P&L — ${month}${shopF !== 'ALL' ? ' — Shop ' + shopF : ''}`;
  const html = `<h1>${title}</h1>
  <div class="meta">Printed: ${new Date().toLocaleDateString('en-GB')}</div>
  <div class="summary">
<div class="stat"><div class="stat-lbl">Total Revenue</div><div class="stat-val success">${pkr(grandRev)}</div></div><div class="stat"><div class="stat-lbl">Cash movement</div><div class="stat-val">${pkr(summary.financial.cashMovement)}</div></div>
<div class="stat"><div class="stat-lbl">Net Profit / Loss</div><div class="stat-val ${grandNet >= 0 ? 'success' : 'danger'}">${pkr(grandNet)}</div></div>
  </div>
  <table>
<thead><tr><th>Shop</th><th class="right">Total Sales</th><th class="right">Cost of Sales</th><th class="right">Gross P/L</th><th class="right">Expenses</th><th class="right">Net P/L</th><th class="right">Units</th></tr></thead>
<tbody>${rows}</tbody>
  </table>`;
  printSection(title, html);
  } catch (error) { return handleApiError(error); }
}

function printCEO() {
  if (!lastCEOSummary || lastCEOSummary.month !== ($('ceo-month').value || ym(today())) || lastCEOSummary.owner !== dayOwner()) { showToast('Load the selected CEO Dashboard before printing', 'warn'); return; }
  const d = lastCEOSummary;
  const month = d.month || '';
  const net = d.current.netProfit;
  const VALID_SH = SHOPS;
  const shopRows = VALID_SH.map(sh => {
    const v = d.shopStats[sh] || { revenue: 0, profit: 0, units: 0, expenses: 0, cost: 0 };
    const n = v.netProfit ?? StocklyBusinessRules.sumMoney([v.profit, -v.expenses]);
    const sObj = currentClientShops.find(x => x.id === sh) || { name: sh };
    return `<tr><td style="font-weight:700">${esc(sObj.name || sh)}</td><td class="right num success">${pkr(v.revenue)}</td><td class="right num">${pkr(v.cost)}</td><td class="right num ${v.profit >= 0 ? 'success' : 'danger'}">${pkr(v.profit)}</td><td class="right num danger">${pkr(v.expenses)}</td><td class="right num ${n >= 0 ? 'success' : 'danger'}" style="font-weight:700">${pkr(n)}</td><td class="right">${v.units}</td></tr>`;
  }).join('');
  const topModels = d.topModels?.length ? `<h2>Top Selling Models</h2><table>
<thead><tr><th>#</th><th>Model</th><th class="right">Units</th></tr></thead>
<tbody>${d.topModels.map((m, i) => `<tr><td>${i + 1}</td><td>${esc(m.model)}</td><td class="right">${m.count}</td></tr>`).join('')}</tbody>
  </table>`: '';
  const bestShop = VALID_SH.reduce((b, sh) => (d.shopStats[sh]?.revenue || 0) > (d.shopStats[b]?.revenue || 0) ? sh : b, VALID_SH[0]);
  const html = `<h1>CEO Dashboard — ${month}</h1>
  <div class="meta">Printed: ${new Date().toLocaleDateString('en-GB')}</div>
  <div class="summary">
<div class="stat"><div class="stat-lbl">Monthly Revenue</div><div class="stat-val success">${pkr(d.current.revenue)}</div></div>
<div class="stat"><div class="stat-lbl">Net Profit / Loss</div><div class="stat-val ${net >= 0 ? 'success' : 'danger'}">${pkr(net)}</div></div>
<div class="stat"><div class="stat-lbl">Gross Profit</div><div class="stat-val ${d.current.profit >= 0 ? 'success' : 'danger'}">${pkr(d.current.profit)}</div></div>
<div class="stat"><div class="stat-lbl">Total Expenses</div><div class="stat-val danger">${pkr(d.current.expenses)}</div></div>
<div class="stat"><div class="stat-lbl">Units Sold</div><div class="stat-val">${d.current.units}</div></div>
<div class="stat"><div class="stat-lbl">Current inventory (in stock)</div><div class="stat-val">${d.inventoryCount}</div></div>
  </div>
  <h2>Shop Performance</h2>
  <table>
<thead><tr><th>Shop</th><th class="right">Revenue</th><th class="right">Cost of Sales</th><th class="right">Gross Profit</th><th class="right">Expenses</th><th class="right">Net P/L</th><th class="right">Units</th></tr></thead>
<tbody>${shopRows}</tbody>
  </table>
  ${topModels}
  <p style="margin-top:12px;font-size:9pt;color:#555">Best shop: <b>Shop ${esc(bestShop)}</b> · Current inventory value: <b>${pkr(d.inventoryValue)}</b></p>`;
  printSection(`CEO Dashboard — ${month}`, html);
}

async function printContacts() {
  try {
  const search = $('contact-search').value.trim();
  const contacts = await contactPager.exportAll(); if (!contacts) return;
  const rows = contacts.map(c => `<tr>
<td style="font-weight:600">${esc(c.name || '')}</td>
<td class="num">${esc(c.phone || '—')}</td>
<td>${esc(c.email || '—')}</td>
<td style="max-width:200px">${esc(c.notes || '')}</td>
<td class="num">${fmtDate(c.addedAt)}</td>
  </tr>`).join('');
  const html = `<h1>Customer Contacts</h1>
  <div class="meta">${contacts.length} contact${contacts.length !== 1 ? 's' : ''} · All matching contacts${search ? ' · Search: ' + esc(search) : ''} · Printed: ${new Date().toLocaleDateString('en-GB')}</div>
  <table>
<thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Notes</th><th>Added</th></tr></thead>
<tbody>${rows}</tbody>
  </table>`;
  printSection('Customer Contacts', html);
  } catch (error) { return handleApiError(error); }
}

function printAnalytics() {
  if (!lastAnalyticsData || lastAnalyticsData.readScope !== analyticsReadScope()) { showToast('Load the selected Analytics before printing', 'warn'); return; }
  const d = lastAnalyticsData;
  const soldRows = d.topSold.length ? d.topSold.map((m, i) => `<tr><td>${i + 1}</td><td style="font-weight:600">${esc(m.model)}</td><td class="right">${m.count}</td><td class="right num success">${pkr(m.revenue)}</td><td class="right num ${m.profit >= 0 ? 'success' : 'danger'}">${pkr(m.profit)}</td></tr>`).join('') : `<tr><td colspan="5" style="text-align:center;color:#999">No sales in this period</td></tr>`;
  const staleRows = d.stagnating.length ? d.stagnating.map((m, i) => `<tr><td>${i + 1}</td><td style="font-weight:600">${esc(m.model)}</td><td class="right">${m.count}</td><td class="right num danger">${pkr(m.totalCost)}</td><td class="right">${m.oldestDays}d</td><td>${esc(m.shops || '')}</td></tr>`).join('') : `<tr><td colspan="6" style="text-align:center;color:#16a34a">✓ No stagnating stock</td></tr>`;
  const html = `<h1>Model Analytics — Last ${d.days} days</h1>
  <div class="meta">Printed: ${new Date().toLocaleDateString('en-GB')}</div>
  <h2>Top Selling Models</h2>
  <table>
<thead><tr><th>#</th><th>Model</th><th class="right">Units Sold</th><th class="right">Revenue</th><th class="right">Profit</th></tr></thead>
<tbody>${soldRows}</tbody>
  </table>
  <h2>Stagnating Stock (in stock &gt;30 days)</h2>
  <table>
<thead><tr><th>#</th><th>Model</th><th class="right">Units</th><th class="right">Cost Tied Up</th><th class="right">Oldest</th><th>Shops</th></tr></thead>
<tbody>${staleRows}</tbody>
  </table>`;
  printSection(`Analytics — Last ${d.days} days`, html);
}

async function printLogs() {
  try {
    const filters = logPager.query().toString(), logs = await logPager.exportAll(); if (!logs) return;
    const rows = logs.map(log => `<tr><td>${esc(log.ts)}</td><td>${esc(LOG_LABELS[log.action] || log.action)}</td><td>${esc(log.shop || 'Account')}</td><td>${esc(_buildLogDetail(log) || JSON.stringify(log.details || {}))}</td></tr>`).join('');
    printSection('Activity log', `<h1>Activity log</h1><p>All matching events · ${logs.length} records · ${esc(filters)}</p><table><thead><tr><th>Timestamp (recorded)</th><th>Action</th><th>Shop</th><th>Details</th></tr></thead><tbody>${rows}</tbody></table>`);
  } catch (error) { return handleApiError(error); }
}

function openNewDayModal() {
  showModal(`<h3>Start New Day</h3>
  <div class="fc">
<div class="f2">
  <div class="fi"><label>Shop</label><select id="nd-shop">${SHOPS.map(s => `<option value="${s}" ${s === activeShop ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
  <div class="fi"><label>Date</label><input type="date" id="nd-date" value="${today()}"></div>
</div>
<div class="fi"><label>Carry-forward Cash (PKR)</label><input type="number" id="nd-carry" placeholder="0" min="0"></div>
  </div>
  <div class="mf"><button class="btn bo" onclick="closeModal()">Cancel</button><button class="btn bg" onclick="startNewDay()">Start Day</button></div>`);
}

async function startNewDay() {
  const shop = $('nd-shop').value, date = $('nd-date').value, carry = parseFloat($('nd-carry').value) || 0;
  if (!date) { showToast('Select a date', 'error'); return; }
  activeShop = shop; dayState = makeEmptyDay(shop, date); dayState.carryForward = carry;
  switchShop(shop); $('work-date').value = date; nav('stock'); await loadDay();
  $('cf-carry').value = carry || ''; recalc(); closeModal(); showToast(`New day: Shop ${shop} — ${date}`);
}

// ── EXPENSES ──
var expenseLoadGeneration = 0, expenseDataScope = null;
function expenseReadScope() { return JSON.stringify([listOwner(), localStorage.getItem('authToken'), $('exp-shop-filter').value, $('exp-month-filter').value]); }
async function renderShopExpenses() {
  const generation = ++expenseLoadGeneration, scope = expenseReadScope();
  const current = () => generation === expenseLoadGeneration && scope === expenseReadScope();
  expenseDataScope = null; allShopExp = [];
  $('exp-body').innerHTML = '<div class="empty"><h3>Loading…</h3></div>';
  try {
    const shop = $('exp-shop-filter').value, month = $('exp-month-filter').value;
    const params = []; if (shop !== 'ALL') params.push(`shop=${shop}`); if (month) params.push(`month=${month}`);
    const result = await api('GET', `/api/shopexpenses${params.length ? '?' + params.join('&') : ''}`);
    if (!current()) return;
    allShopExp = result; expenseDataScope = scope;
    const body = $('exp-body');
    if (!allShopExp.length) { body.innerHTML = `<div class="empty"><div class="empty-icon">—</div><h3>No expenses found</h3></div>`; return; }
    const totals = {}; allShopExp.forEach(e => totals[e.shop] = (totals[e.shop] || 0) + (e.amount || 0));
    let html = `<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.9rem;">${Object.entries(totals).map(([s, amt]) => `<div style="background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:.45rem .8rem;min-width:120px;"><div style="font-size:.62rem;font-weight:700;color:${SHOP_COLOR[s] || 'var(--text2)'};margin-bottom:2px">Shop ${esc(s)}</div><div style="font-family:var(--mono);font-size:.9rem;color:var(--danger)">${pkr(amt)}</div></div>`).join('')}</div>`;
    const byShop = {}; allShopExp.forEach(e => { if (!byShop[e.shop]) byShop[e.shop] = []; byShop[e.shop].push(e); });
    Object.entries(byShop).forEach(([s, rows]) => {
      const tot = rows.reduce((a, e) => a + (e.amount || 0), 0); const c = SHOP_COLOR[s] || 'var(--a5)'; const r = SHOP_RGBA[s] || '22,163,74';
      html += `<div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;margin-bottom:.65rem;overflow:hidden;">
    <div style="display:flex;justify-content:space-between;padding:.45rem .85rem;background:rgba(${r},.06);border-bottom:1px solid var(--border);">
      <span style="font-size:.82rem;font-weight:700;color:${c}">Shop ${esc(s)}</span>
      <span style="font-family:var(--mono);font-size:.72rem;color:var(--danger)">${pkr(tot)}</span>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:.65rem;">
      <thead><tr style="background:var(--s3)"><th style="text-align:left;padding:.3rem .7rem;color:var(--text3);font-size:.57rem;font-weight:600;letter-spacing:.06em">DATE</th><th style="text-align:left;padding:.3rem .7rem;color:var(--text3);font-size:.57rem;font-weight:600">CAT</th><th style="text-align:left;padding:.3rem .7rem;color:var(--text3);font-size:.57rem;font-weight:600">DESCRIPTION</th><th style="text-align:right;padding:.3rem .7rem;color:var(--text3);font-size:.57rem;font-weight:600">AMOUNT</th><th style="width:24px"></th></tr></thead>
      <tbody>${rows.map(e => `<tr style="border-top:1px solid var(--border2)">
        <td style="padding:.3rem .7rem;color:var(--text2);font-family:var(--mono)">${esc(e.date || '')}</td>
        <td style="padding:.3rem .7rem"><span style="background:rgba(244,63,94,.08);border:1px solid rgba(244,63,94,.2);color:var(--danger);border-radius:5px;padding:.06rem .38rem;font-size:.57rem;font-weight:600">${esc(e.category || '')}</span></td>
        <td style="padding:.3rem .7rem;color:var(--white)">${esc(e.description || '')}</td>
        <td style="padding:.3rem .7rem;text-align:right;font-family:var(--mono);color:var(--danger)">${pkr(e.amount)}</td>
        <td style="padding:.3rem .4rem"><button class="bx" aria-label="Delete expense" onclick="deleteShopExp(${escAttr(JSON.stringify(e._key))})">✕</button></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
    });
    body.innerHTML = html;
  } catch (error) {
    if (current()) {
      $('exp-body').innerHTML = '<div class="empty"><h3>Expenses unavailable</h3><button class="btn bo" onclick="renderShopExpenses()">Retry</button></div>';
      return handleApiError(error);
    }
  }
}
async function deleteShopExp(key) {
  const scope = destructiveScope(), dataScope = expenseReadScope();
  const current = () => scope === destructiveScope() && dataScope === expenseReadScope();
  if (expenseDataScope !== dataScope || !allShopExp.some(e => e._key === key)) return;
  if (!await confirmModal({ title: 'Delete expense?', message: 'Delete this expense from the shop records?', confirmText: 'Delete expense' }) || !current()) return;
  try {
    await api('DELETE', '/api/shopexpenses/' + encodeURIComponent(key));
    if (!current()) return;
    renderShopExpenses(); showToast('Expense deleted', 'warn');
  } catch (error) {
    if (current()) return handleApiError(error);
  }
}
function openAddExpenseModal() {
  if (routeCashPayment('expense')) return;
  showModal(`<h3>+ Add Shop Expense</h3>
  <div class="fc">
<div class="f2">
  <div class="fi"><label>Shop</label><select id="se-shop">${SHOPS.map(s => `<option value="${s}">${s}</option>`).join('')}</select></div>
  <div class="fi"><label>Date</label><input type="date" id="se-date" value="${today()}"></div>
</div>
<div class="f2">
  <div class="fi"><label>Category</label><select id="se-cat">${EXP_CATS.map(c => `<option>${c}</option>`).join('')}</select></div>
  <div class="fi"><label>Amount (PKR)</label><input type="number" id="se-amt" placeholder="e.g. 25000" min="0"></div>
</div>
<div class="fi"><label>Description</label><input type="text" id="se-desc" placeholder="e.g. Ahmed salary March"></div>
  </div>
  <div class="mf"><button class="btn bo" onclick="closeModal()">Cancel</button><button class="btn bv" onclick="saveShopExp()">Save</button></div>`);
  setTimeout(() => $('se-amt')?.focus(), 100);
}
let shopExpenseSaving = false;
async function saveShopExp() {
  if (shopExpenseSaving) return;
  const scope = destructiveScope(), form = $('se-amt');
  const ids = ['se-shop', 'se-date', 'se-cat', 'se-amt', 'se-desc'];
  if (!form || ids.some(id => !$(id))) return;
  const values = ids.map(id => $(id).value);
  const current = () => scope === destructiveScope();
  const unchanged = () => current() && $('se-amt') === form && ids.every((id, i) => $(id)?.value === values[i]);
  shopExpenseSaving = true;
  try {
    const [shop, date, cat, rawAmount, rawDesc] = values;
    const minor = StocklyBusinessRules.parseMinorUnits(rawAmount);
    if (!shop || !date || minor <= 0) throw Error('Fill shop, date and a positive amount.');
    await api('POST', '/api/shopexpenses', { shop, date, month: ym(date), category: cat, amount: minor / 100, description: rawDesc.trim() });
    if (!current()) return;
    if (unchanged()) closeModal();
    if (activePage === 'expenses') renderShopExpenses();
    showToast('Expense saved: ' + pkrMinor(minor));
  } catch (error) {
    if (current()) return handleApiError(error);
  } finally {
    shopExpenseSaving = false;
  }
}

// ── HISTORY ──
var historyPager = createRecordPager('days', 'history', 'hist-body', [['shop', 'hist-shop'], ['month', 'hist-month'], ['status', 'hist-status']], items => { allDays = items; }, renderHistory);
function loadAllDays() { return historyPager.load(); }
function historyTotals(day) { return day.status === 'closed' ? day.closedSnapshot?.financial : null; }
function renderHistory() {
  const body = $('hist-body');
  if (historyPager.page && !historyPager.isCurrent()) { body.innerHTML = '<div class="empty">Load the selected history before viewing days.</div>'; return; }
  if (!allDays.length) { body.innerHTML = '<div class="empty">No saved days match these filters.</div>'; return; }
  body.innerHTML = allDays.map(day => {
    const f = historyTotals(day);
    return `<div class="shop-card"><div class="shop-card-body"><strong>Shop ${esc(day.shop)} · ${esc(day.date)}</strong><p>${esc(day.status || 'open')} · Revision ${day.revision ?? 0}</p>${f ? `<p>Closed revenue: ${pkr(f.revenue)} · Expenses: ${pkr(f.expenses)} · Net profit: ${pkr(f.netProfit)} · Net units: ${f.units}</p>` : '<p>Draft totals require the current ledger. Open full day to review.</p>'}<button class="btn bo" onclick="openHistoryDay('${day._id}')">Open full day</button></div></div>`;
  }).join('');
}
function openHistoryDay(id) {
  if (!historyPager.isCurrent()) { showToast('Reload this history page first', 'error'); return; }
  const day = allDays.find(day => String(day._id) === id);
  if (!day || !SHOPS.includes(day.shop)) return;
  try { StocklyBusinessRules.periodBounds(day.date, 'daily'); } catch { showToast('Stored date needs reconciliation', 'error'); return; }
  loadHistDay(day.shop, day.date);
}
function loadHistDay(shop, date) { activeShop = shop; switchShop(shop); $('work-date').value = date; nav('stock'); }

// ── HQ OVERVIEW ──
// ── MONTHLY P&L ──
var monthlyLoadGeneration = 0;
async function renderMonthly() {
  const generation = ++monthlyLoadGeneration, owner = dayOwner();
  try {
  const month = $('monthly-month').value, shopF = $('monthly-shop').value;
  if (!month) { $('monthly-body').innerHTML = `<div class="empty"><div class="empty-icon">—</div><h3>Select a month</h3></div>`; return; }
  const summary = await api('GET', `/api/financial-summary?type=monthly&period=${month}&shop=${encodeURIComponent(shopF)}`);
  if (generation !== monthlyLoadGeneration || owner !== dayOwner() || month !== $('monthly-month').value || shopF !== $('monthly-shop').value) return;
  const shops = Object.keys(summary.shopStats); let html = '';
  shops.forEach(sh => {
    const shD = summary.sources.filter(row => row.shop === sh);
    if (!shD.length) return;
    const { revenue: tSales, cost: tCost, grossProfit: gPL, units: sold, expenses: expT, netProfit: netPL } = summary.shopStats[sh];
    const c = SHOP_COLOR[sh] || 'var(--a5)'; const r = SHOP_RGBA[sh] || '22,163,74';
    html += `<div class="shop-card"><div class="shop-card-hd" style="border-left:3px solid ${c}"><div class="shop-card-name" style="color:${c}">Shop ${esc(sh)}</div><div style="font-size:.6rem;color:var(--text2)">${shD.length} days</div></div><div class="shop-card-body"><div class="shop-stat"><span>Total Sales</span><span style="color:var(--success);font-family:var(--mono)">${pkr(tSales)}</span></div><div class="shop-stat"><span>Cost of Sold</span><span style="color:var(--danger);font-family:var(--mono)">${pkr(tCost)}</span></div><div class="shop-stat"><span>Gross P/L</span><span style="color:${gPL >= 0 ? 'var(--success)' : 'var(--danger)'};font-family:var(--mono)">${pkr(gPL)}</span></div><div class="shop-stat"><span>Total Expenses</span><span style="color:var(--danger);font-family:var(--mono)">${pkr(expT)}</span></div><div class="shop-stat" style="border-top:1px solid var(--border);margin-top:3px;padding-top:4px"><span style="font-weight:700">Net P/L</span><span style="color:${netPL >= 0 ? 'var(--success)' : 'var(--danger)'};font-family:var(--mono);font-weight:700">${pkr(netPL)}</span></div><div class="shop-stat"><span>Units Sold</span><span style="color:var(--a1)">${sold}</span></div></div></div>`;

  });
  if (!html) html = `<div class="empty"><div class="empty-icon">—</div><h3>No data for ${month}</h3></div>`;
  $('monthly-body').innerHTML = html;
  } catch (error) { return handleApiError(error); }
}
