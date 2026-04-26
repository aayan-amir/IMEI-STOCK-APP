/* ── Daily Sheet, Expenses, History, Monthly ── */
/* Auto-split from index.html — 2026-04-25T15:26:28.698Z */

    // ── DAILY SHEET ──
    function makeEmptyDay(shop, date) { const cats = {}; Object.keys(CATS).forEach(k => cats[k] = { rows: [] }); return { shop, date, cats, expenses: [], purchases: [], transfers: [], carryForward: 0 }; }

    // Map brand name → CATS key
    function guessCat(brand, model, cat) {
      if (cat && CATS[cat]) return cat;
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
      const shop = activeShop === 'HQ' ? (SHOPS[0] || '') : activeShop;
      const date = $('work-date').value || today();
      dayState = makeEmptyDay(shop, date);

      // Always fetch fresh stock to recalculate OUT/OP (so sold phones reflect immediately)
      const stockUrl = shop ? `/api/stock?shop=${shop}&all=true` : '/api/stock?all=true';
      // Also fetch phones from other shops' stock sold by this shop (cross-shop sales)
      const crossShopUrl = `/api/stock?soldByShop=${shop}&all=true`;
      const [saved, stockItems, crossShopItems] = await Promise.all([
        api('GET', `/api/days/${shop}/${date}`),
        api('GET', stockUrl),
        api('GET', crossShopUrl)
      ]);

      // Group IMEI stock by category → model, computing OP, sold today, IN
      // OP = phones in stock at start of day (in_stock + sold today BY this shop)
      // OUT = phones sold BY this shop today (from own stock or other shops' stock)
      const todayStr = date;
      const grouped = {}; // key: cat|model|color|storage

      stockItems.forEach(p => {
        const cat = guessCat(p.brand, p.model, p.cat);
        const name = [p.brand, p.model].filter(Boolean).join(' ') || 'Unknown';
        const key = `${cat}|${name}|${p.storage || ''}`;
        if (!grouped[key]) grouped[key] = { cat, name, storage: p.storage || '', costPerUnit: p.buyPrice || 0, inStockCount: 0, out: 0, soldFor: 0, imeis: [] };
        const g = grouped[key];
        // Only count as OUT if this shop sold the phone.
        // Backward compat: records created before soldByShop was introduced have no soldByShop field,
        // meaning the sale was always made by the stock-owning shop (cross-shop sales weren't possible then).
        const soldToday = p.status === 'sold' && p.soldAt && p.soldAt.slice(0, 10) === todayStr
          && (!p.soldByShop || p.soldByShop === shop);
        if (p.status === 'in_stock') g.inStockCount++; // count only phones currently in stock
        g.imeis.push(p.imei);
        if (soldToday) {
          g.out++;
          g.soldFor += p.salePrice || 0;
        }
      });

      // Add cross-shop sales: phones from other shops' stock sold by this shop today
      (Array.isArray(crossShopItems) ? crossShopItems : []).forEach(p => {
        // The API query returns phones where soldByShop===shop across all stock owners.
        // Skip any that belong to this shop's own stock — they're already counted in stockItems above.
        if (p.shop === shop) return;
        if (!(p.status === 'sold' && p.soldAt && p.soldAt.slice(0, 10) === todayStr)) return;
        const cat = guessCat(p.brand, p.model, p.cat);
        const name = [p.brand, p.model].filter(Boolean).join(' ') || 'Unknown';
        const key = `${cat}|${name}|${p.storage || ''}`;
        if (!grouped[key]) grouped[key] = { cat, name, storage: p.storage || '', costPerUnit: p.buyPrice || 0, inStockCount: 0, out: 0, soldFor: 0, imeis: [] };
        const g = grouped[key];
        g.out++;
        g.soldFor += p.salePrice || 0;
      });

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
          op: g.inStockCount + g.out, // opening = current in-stock + sold today = phones at start of day
          inQty: 0,
          out: g.out,
          soldFor: g.soldFor,
          costPerUnit: g.costPerUnit,
          boughtFor: 0,
        });
      });

      renderStock(); renderExpenses(); renderPurchases(); renderTransfers();
      $('cf-carry').value = dayState.carryForward || ''; recalc();
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
            const pl = (r.soldFor || 0) - (r.boughtFor || 0); html += `<tr>
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
            const op = r.op || 0, inQ = r.inQty || 0, out = r.out || 0, bal = op + inQ - out;
            if (!op && !inQ && !out) return;
            const tc = (r.costPerUnit || 0) * out, sa = r.soldFor || 0, pl = sa - tc;
            tOP += op; tIN += inQ; tOUT += out; tBAL += bal; tTC += tc; tSA += sa; tPL += pl;
            html += `<tr class="${out > 0 ? 'sold' : ''}">
          <td class="l">${esc(r.name || '(none)')}</td>
          <td class="op-cell">${op}</td>
          <td>${inQ}</td>
          <td>${out}</td>
          <td class="${bal === 0 ? 'nz' : ''}" id="d-${ck}-${i}-b">${bal}</td>
          <td>${(r.costPerUnit || 0).toLocaleString()}</td>
          <td class="ngd" id="d-${ck}-${i}-tc">${tc ? tc.toLocaleString() : '-'}</td>
          <td>(none)</td>
          <td class="${sa ? 'nb' : 'nz'}" id="d-${ck}-${i}-sa">${sa ? sa.toLocaleString() : '0'}</td>
          <td class="${pl > 0 ? 'ng' : pl < 0 ? 'nr' : 'nz'}" id="d-${ck}-${i}-pl">${pl ? pl.toLocaleString() : '-'}</td>
          <td></td></tr>`;
          });
          html += `<tr><td><b>TOTAL</b></td><td>${tOP}</td><td>${tIN}</td><td>${tOUT}</td><td>${tBAL}</td><td>—</td><td>${tTC.toLocaleString()}</td><td>—</td><td>${tSA.toLocaleString()}</td><td class="${tPL > 0 ? 'ng' : 'nr'}">${tPL.toLocaleString()}</td><td></td></tr>`;
          html += `</tbody></table>`;
        }
        html += `${isExtra ? `<button class="add-row" onclick="addRow('${ck}')">+ ADD ROW</button>` : ''}</div>`;
      });
      wrap.innerHTML = html; updateCatTotals();
    }

    function onRC(cat, i, field, val) {
      if (!dayState.cats[cat]?.rows[i]) return;
      dayState.cats[cat].rows[i][field] = val;
      if (!CATS[cat].isExtra) {
        const r = dayState.cats[cat].rows[i];
        const op = r.op || 0, inQ = r.inQty || 0, out = r.out || 0, bal = op + inQ - out;
        const tc = (r.costPerUnit || 0) * out, sa = r.soldFor || 0, pl = sa - tc;
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
        else { const bal = rows.reduce((s, r) => s + (r.op || 0) + (r.inQty || 0) - (r.out || 0), 0); const sold = rows.reduce((s, r) => s + (r.out || 0), 0); const rev = rows.reduce((s, r) => s + (r.soldFor || 0), 0); const pl = rows.reduce((s, r) => s + (r.soldFor || 0) - (r.costPerUnit || 0) * (r.out || 0), 0); el.innerHTML = `<span>Bal:<b>${bal}</b></span><span>Sold:<b>${sold}</b></span><span>Rev:<b>${rev.toLocaleString()}</b></span><span>P/L:<b class="${pl >= 0 ? 'ng' : 'nr'}">${pl.toLocaleString()}</b></span>`; }
      });
    }
    function addRow(cat) { if (!dayState.cats[cat]) dayState.cats[cat] = { rows: [] }; dayState.cats[cat].rows.push({ name: '', op: 0, costPerUnit: 0, inQty: 0, out: 0, soldFor: 0, boughtFor: 0 }); renderStock(); }
    function removeRow(cat, i) { dayState.cats[cat].rows.splice(i, 1); renderStock(); }

    function renderExpenses() { const list = $('exp-list'); list.innerHTML = ''; (dayState.expenses || []).forEach((e, i) => { const div = document.createElement('div'); div.className = 'ec'; div.innerHTML = `<input class="ed" value="${esc(e.desc || '')}" placeholder="Description" oninput="dayState.expenses[${i}].desc=this.value;recalc()">:<input class="ea" type="number" value="${e.amt || 0}" min="0" oninput="dayState.expenses[${i}].amt=+this.value;recalc()"><button class="bx" onclick="delExp(${i})">✕</button>`; list.appendChild(div); }); }
    function addExp() { dayState.expenses.push({ desc: '', amt: 0 }); renderExpenses(); recalc(); }
    function delExp(i) { dayState.expenses.splice(i, 1); renderExpenses(); recalc(); }
    function renderPurchases() { const list = $('purchase-list'); list.innerHTML = ''; (dayState.purchases || []).forEach((p, i) => { const div = document.createElement('div'); div.className = 'ec'; div.innerHTML = `<input class="ed" value="${esc(p.desc || '')}" placeholder="Item" oninput="dayState.purchases[${i}].desc=this.value;recalc()">:<input class="ea" type="number" value="${p.amt || 0}" min="0" oninput="dayState.purchases[${i}].amt=+this.value;recalc()"><button class="bx" onclick="delPurchase(${i})">✕</button>`; list.appendChild(div); }); }
    function addPurchase() { dayState.purchases.push({ desc: '', amt: 0 }); renderPurchases(); recalc(); }
    function delPurchase(i) { dayState.purchases.splice(i, 1); renderPurchases(); recalc(); }
    function renderTransfers() { const list = $('transfer-list'); list.innerHTML = ''; (dayState.transfers || []).forEach((t, i) => { const div = document.createElement('div'); div.className = 'ec'; div.innerHTML = `<input class="ed" value="${esc(t.desc || '')}" placeholder="Transfer…" oninput="dayState.transfers[${i}].desc=this.value;recalc()">:<input class="ea" type="number" value="${t.amt || 0}" min="0" oninput="dayState.transfers[${i}].amt=+this.value;recalc()"><button class="bx" onclick="delTransfer(${i})">✕</button>`; list.appendChild(div); }); }
    function addTransfer() { dayState.transfers.push({ desc: '', amt: 0 }); renderTransfers(); recalc(); }
    function delTransfer(i) { dayState.transfers.splice(i, 1); renderTransfers(); recalc(); }

    function recalc() {
      const tSales = Object.entries(CATS).reduce((s, [ck]) => s + (dayState.cats[ck]?.rows || []).reduce((a, r) => a + (r.soldFor || 0), 0), 0);
      const tCost = Object.entries(CATS).reduce((s, [ck, cv]) => { if (cv.isExtra) return s + (dayState.cats[ck]?.rows || []).reduce((a, r) => a + (r.boughtFor || 0), 0); return s + (dayState.cats[ck]?.rows || []).reduce((a, r) => a + (r.costPerUnit || 0) * (r.out || 0), 0); }, 0);
      const tExp = (dayState.expenses || []).reduce((s, e) => s + (e.amt || 0), 0);
      const tPur = (dayState.purchases || []).reduce((s, p) => s + (p.amt || 0), 0);
      const tTr = (dayState.transfers || []).reduce((s, t) => s + (t.amt || 0), 0);
      const carry = parseFloat($('cf-carry')?.value) || 0;
      dayState.carryForward = carry;
      const sub = tSales - tExp - tPur - tTr; const coh = sub + carry; const pl = tSales - tCost - tExp;
      $('cf-sa').textContent = pkr(tSales); $('cf-ex').textContent = pkr(tExp);
      $('cf-pu').textContent = pkr(tPur); $('cf-tr').textContent = pkr(tTr);
      $('cf-sub').textContent = pkr(sub); $('cf-fc').textContent = pkr(coh);
      const inStock = Object.entries(CATS).reduce((s, [ck, cv]) => { if (cv.isExtra) return s; return s + (dayState.cats[ck]?.rows || []).reduce((a, r) => a + (r.op || 0) + (r.inQty || 0) - (r.out || 0), 0); }, 0);
      const stVal = Object.entries(CATS).reduce((s, [ck, cv]) => { if (cv.isExtra) return s; return s + (dayState.cats[ck]?.rows || []).reduce((a, r) => a + ((r.op || 0) + (r.inQty || 0) - (r.out || 0)) * (r.costPerUnit || 0), 0); }, 0);
      const sold = Object.entries(CATS).reduce((s, [ck, cv]) => { if (cv.isExtra) return s; return s + (dayState.cats[ck]?.rows || []).reduce((a, r) => a + (r.out || 0), 0); }, 0);
      $('scards').innerHTML = `
    <div class="sc g"><div class="sc-lbl">Stock Value</div><div class="sc-val g">${pkr(stVal)}</div><div class="sc-sub">${inStock} units</div></div>
    <div class="sc gr"><div class="sc-lbl">Total Sales</div><div class="sc-val gr">${pkr(tSales)}</div><div class="sc-sub">${sold} sold today</div></div>
    <div class="sc gr"><div class="sc-lbl">Net P/L</div><div class="sc-val ${pl >= 0 ? 'gr' : 'rd'}">${pkr(pl)}</div><div class="sc-sub">after expenses</div></div>
    <div class="sc rd"><div class="sc-lbl">Expenses</div><div class="sc-val rd">${pkr(tExp)}</div><div class="sc-sub">${(dayState.expenses || []).length} items</div></div>
    <div class="sc bl"><div class="sc-lbl">Purchased</div><div class="sc-val bl">${pkr(tPur)}</div><div class="sc-sub">cash paid</div></div>
    <div class="sc g"><div class="sc-lbl">Cash on Hand</div><div class="sc-val g">${pkr(coh)}</div><div class="sc-sub">after transfers</div></div>`;
    }

    async function saveDay() {
      const shop = activeShop === 'HQ' ? (SHOPS[0] || '') : activeShop; const date = $('work-date').value || today();
      await api('PUT', `/api/days/${shop}/${date}`, dayState);
      showToast(`Day saved — ${shop} / ${date}`, 'success');
    }
    function exportDayCSV() {
      let csv = `${dayState.shop} — ${dayState.date}\nDESCRIPTION,OP,IN,OUT,BAL,COST,SOLD FOR,P/L\n`;
      Object.entries(CATS).forEach(([ck, cv]) => { const rows = dayState.cats[ck]?.rows || []; if (!rows.length) return; csv += `\n${cv.label}\n`; rows.forEach(r => { const op = r.op || 0, inQ = r.inQty || 0, out = r.out || 0, bal = op + inQ - out, tc = (r.costPerUnit || 0) * out, sa = r.soldFor || 0; csv += `${r.name},${op},${inQ},${out},${bal},${r.costPerUnit || 0},${sa},${sa - tc}\n`; }); });
      dlCSV(csv, `${dayState.shop}_${dayState.date}.csv`);
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
          catRows.forEach(r => { const op = r.op || 0, inQ = r.inQty || 0, out = r.out || 0, bal = op + inQ - out, tc = (r.costPerUnit || 0) * out, sa = r.soldFor || 0, pl = sa - tc; rows += `<tr><td>${esc(r.name || '—')}</td><td class="right">${op}</td><td class="right">${inQ}</td><td class="right">${out}</td><td class="right">${bal}</td><td class="right num">${pkr(r.costPerUnit || 0)}</td><td class="right num">${pkr(tc)}</td><td class="right num success">${pkr(sa)}</td><td class="right num ${pl >= 0 ? 'success' : 'danger'}">${pkr(pl)}</td></tr>`; });
        }
      });
      const exRows = (dayState.expenses || []).map(e => `<tr><td>${esc(e.desc || '')}</td><td class="right num danger">${pkr(e.amt || 0)}</td></tr>`).join('');
      const html = `<h1>Daily Stock Sheet — Shop ${shop} — ${date}</h1>
  <table>
    <thead><tr><th>Description</th><th class="right">OP</th><th class="right">IN</th><th class="right">OUT</th><th class="right">BAL</th><th class="right">Cost/Unit</th><th class="right">Cost(Sold)</th><th class="right">Sold For</th><th class="right">P/L</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${exRows ? `<h2>Expenses</h2><table><thead><tr><th>Description</th><th class="right">Amount</th></tr></thead><tbody>${exRows}</tbody></table>` : ''}`;
      printSection(`Daily Sheet — Shop ${shop} — ${date}`, html);
    }

    function printSalesLog() {
      const from = $('sl-from')?.value, to = $('sl-to')?.value, shop = $('sl-shop')?.value || 'ALL';
      let sales = [...allSalesData];
      if (from) sales = sales.filter(s => s.soldAt && s.soldAt.slice(0, 10) >= from);
      if (to) sales = sales.filter(s => s.soldAt && s.soldAt.slice(0, 10) <= to);
      sales.sort((a, b) => (b.soldAt || '').localeCompare(a.soldAt || ''));
      const tRev = sales.reduce((s, x) => s + (x.salePrice || 0), 0);
      const tPL = sales.reduce((s, x) => s + (x.profit || 0), 0);
      const rows = sales.map(s => `<tr>
    <td class="num">${s.soldAt ? s.soldAt.slice(0, 10) : ''}</td>
    <td>${esc((s.brand || '') + ' ' + (s.model || ''))}</td>
    <td class="num">${s.imei || ''}</td>
    <td><span class="badge">${s.soldByShop || s.shop || '—'}</span></td>
    <td>${esc(s.buyerName || '—')}</td>
    <td class="right num">${s.buyPrice ? pkr(s.buyPrice) : '—'}</td>
    <td class="right num success">${pkr(s.salePrice)}</td>
    <td class="right num ${(s.profit || 0) >= 0 ? 'success' : 'danger'}">${s.profit != null ? pkr(s.profit) : '—'}</td>
  </tr>`).join('');
      const html = `<h1>Sales Log${shop !== 'ALL' ? ' — Shop ' + shop : ''}</h1>
  <div class="meta">${from || 'All'} → ${to || 'All'} · ${sales.length} sales · Revenue: ${pkr(tRev)} · P/L: ${pkr(tPL)}</div>
  <table>
    <thead><tr><th>Date</th><th>Phone</th><th>IMEI</th><th>Shop</th><th>Buyer</th><th class="right">Cost</th><th class="right">Sold For</th><th class="right">Profit</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr style="font-weight:700"><td colspan="5">TOTAL</td><td></td><td class="right num success">${pkr(tRev)}</td><td class="right num ${tPL >= 0 ? 'success' : 'danger'}">${pkr(tPL)}</td></tr></tfoot>
  </table>`;
      printSection('Sales Log', html);
    }

    function printShipments() {
      const body = $('ship-body');
      if (!body) return;
      const html = `<h1>Shipments / Dispatches</h1>${body.innerHTML}`;
      printSection('Shipments', html);
    }

    function printIMEIStock() {
      const q = ($('imeiSearch')?.value || '').toLowerCase();
      const shopLabel = activeShop === 'HQ' ? 'All Shops' : 'Shop ' + activeShop;
      const filterLabel = imeiFilter === 'all' ? 'All' : imeiFilter === 'in_stock' ? 'In Stock' : 'Sold';
      let items = allIMEIStock.filter(p => {
        if (imeiFilter !== 'all' && p.status !== imeiFilter) return false;
        if (q) return (p.brand + p.model + p.imei + (p.imei2 || '') + p.color + p.storage).toLowerCase().includes(q);
        return true;
      });
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
    ${isAdmin ? `<td class="right num">${p.buyPrice ? pkr(p.buyPrice) : '—'}</td><td class="right num ${p.salePrice ? 'success' : ''}">${p.salePrice ? pkr(p.salePrice) : '—'}</td>` : ''}
    <td class="num">${p.addedAt ? p.addedAt.slice(0, 10) : ''}</td>
  </tr>`).join('');
      const html = `<h1>IMEI Stock — ${shopLabel}</h1>
  <div class="meta">Filter: ${filterLabel} · ${items.length} phone${items.length !== 1 ? 's' : ''} · Printed: ${new Date().toLocaleDateString('en-GB')}</div>
  <table>
    <thead><tr><th>Phone</th><th>IMEI 1</th><th>IMEI 2</th><th>Color</th><th>Storage</th><th>Status</th><th>Shop</th>${adminCols}<th>Added</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
      printSection('IMEI Stock', html);
    }

    function printExpenses() {
      const shop = $('exp-shop-filter')?.value || 'ALL';
      const month = $('exp-month-filter')?.value || '';
      if (!allShopExp.length) { showToast('No expenses to print', 'warn'); return; }
      const byShop = {}; allShopExp.forEach(e => { if (!byShop[e.shop]) byShop[e.shop] = []; byShop[e.shop].push(e); });
      const grandTotal = allShopExp.reduce((a, e) => a + (e.amount || 0), 0);
      let shopSummary = Object.entries(byShop).map(([s, rows]) => `<div class="stat"><div class="stat-lbl">Shop ${s}</div><div class="stat-val danger">${pkr(rows.reduce((a, e) => a + (e.amount || 0), 0))}</div></div>`).join('');
      shopSummary += `<div class="stat"><div class="stat-lbl">Grand Total</div><div class="stat-val danger">${pkr(grandTotal)}</div></div>`;
      let tables = Object.entries(byShop).map(([s, rows]) => {
        const tot = rows.reduce((a, e) => a + (e.amount || 0), 0);
        const trows = rows.map(e => `<tr><td class="num">${e.date || ''}</td><td>${esc(e.category || '')}</td><td>${esc(e.description || '')}</td><td class="right num danger">${pkr(e.amount)}</td></tr>`).join('');
        return `<h2>Shop ${s} — ${pkr(tot)}</h2><table>
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

    function printHistory() {
      const shopF = $('hist-shop')?.value || 'ALL';
      if (!allDays.length) { showToast('No history to print', 'warn'); return; }
      const rows = allDays.map(d => {
        const tSales = Object.entries(d.cats || {}).reduce((s, [, cv]) => (cv.rows || []).reduce((a, r) => a + (r.soldFor || 0), s), 0);
        const sold = Object.entries(d.cats || {}).reduce((s, [ck, cv]) => CATS[ck]?.isExtra ? s : (cv.rows || []).reduce((a, r) => a + (r.out || 0), s), 0);
        const expTotal = (d.expenses || []).reduce((a, e) => a + (e.amt || 0), 0);
        return `<tr><td>${esc(d.shop || '')}</td><td class="num">${d.date || ''}</td><td class="right num success">${pkr(tSales)}</td><td class="right">${sold}</td><td class="right num danger">${expTotal ? pkr(expTotal) : '—'}</td></tr>`;
      }).join('');
      const tRev = allDays.reduce((s, d) => s + Object.entries(d.cats || {}).reduce((a, [, cv]) => a + (cv.rows || []).reduce((b, r) => b + (r.soldFor || 0), 0), 0), 0);
      const tExp = allDays.reduce((s, d) => s + (d.expenses || []).reduce((a, e) => a + (e.amt || 0), 0), 0);
      const title = `Daily History${shopF !== 'ALL' ? ' — Shop ' + shopF : ''}`;
      const html = `<h1>${title}</h1>
  <div class="meta">${allDays.length} day${allDays.length !== 1 ? 's' : ''} · Printed: ${new Date().toLocaleDateString('en-GB')}</div>
  <table>
    <thead><tr><th>Shop</th><th>Date</th><th class="right">Sales</th><th class="right">Units Sold</th><th class="right">Expenses</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr style="font-weight:700"><td colspan="2">TOTAL</td><td class="right num success">${pkr(tRev)}</td><td></td><td class="right num danger">${pkr(tExp)}</td></tr></tfoot>
  </table>`;
      printSection(title, html);
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
      const month = $('monthly-month')?.value;
      const shopF = $('monthly-shop')?.value || 'ALL';
      if (!month) { showToast('Select a month first', 'warn'); return; }
      const [days, expenses] = await Promise.all([api('GET', `/api/days?month=${month}`), api('GET', `/api/shopexpenses?month=${month}`)]);
      const shops = shopF === 'ALL' ? SHOPS : [shopF];
      let rows = '', grandRev = 0, grandNet = 0;
      shops.forEach(sh => {
        const shD = days.filter(d => d.shop === sh), shE = expenses.filter(e => e.shop === sh);
        if (!shD.length && !shE.length) return;
        let tSales = 0, tCost = 0, gPL = 0, expT = 0, sold = 0;
        shD.forEach(d => { Object.entries(d.cats || {}).forEach(([ck, cv]) => { const r2 = cv.rows || []; if (CATS[ck]?.isExtra) { tSales += r2.reduce((a, r) => a + (r.soldFor || 0), 0); gPL += r2.reduce((a, r) => a + (r.soldFor || 0) - (r.boughtFor || 0), 0); } else { tSales += r2.reduce((a, r) => a + (r.soldFor || 0), 0); const tc = r2.reduce((a, r) => a + (r.costPerUnit || 0) * (r.out || 0), 0); tCost += tc; gPL += r2.reduce((a, r) => a + (r.soldFor || 0), 0) - tc; sold += r2.reduce((a, r) => a + (r.out || 0), 0); } }); expT += (d.expenses || []).reduce((a, e) => a + (e.amt || 0), 0); });
        expT += shE.reduce((a, e) => a + (e.amount || 0), 0);
        const netPL = gPL - expT;
        grandRev += tSales; grandNet += netPL;
        rows += `<tr><td style="font-weight:700">Shop ${esc(sh)}</td><td class="right num success">${pkr(tSales)}</td><td class="right num">${pkr(tCost)}</td><td class="right num ${gPL >= 0 ? 'success' : 'danger'}">${pkr(gPL)}</td><td class="right num danger">${pkr(expT)}</td><td class="right num ${netPL >= 0 ? 'success' : 'danger'}" style="font-weight:700">${pkr(netPL)}</td><td class="right">${sold}</td></tr>`;
      });
      if (!rows) { showToast('No data for selected month/shop', 'warn'); return; }
      const title = `Monthly P&L — ${month}${shopF !== 'ALL' ? ' — Shop ' + shopF : ''}`;
      const html = `<h1>${title}</h1>
  <div class="meta">Printed: ${new Date().toLocaleDateString('en-GB')}</div>
  <div class="summary">
    <div class="stat"><div class="stat-lbl">Total Revenue</div><div class="stat-val success">${pkr(grandRev)}</div></div>
    <div class="stat"><div class="stat-lbl">Net Profit / Loss</div><div class="stat-val ${grandNet >= 0 ? 'success' : 'danger'}">${pkr(grandNet)}</div></div>
  </div>
  <table>
    <thead><tr><th>Shop</th><th class="right">Total Sales</th><th class="right">Cost of Sales</th><th class="right">Gross P/L</th><th class="right">Expenses</th><th class="right">Net P/L</th><th class="right">Units</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
      printSection(title, html);
    }

    function printCEO() {
      if (!lastCEOSummary) { showToast('Load the CEO Dashboard first', 'warn'); return; }
      const d = lastCEOSummary;
      const month = d.month || '';
      const net = d.current.netProfit;
      const VALID_SH = SHOPS;
      const shopRows = VALID_SH.map(sh => {
        const v = d.shopStats[sh] || { revenue: 0, profit: 0, units: 0, expenses: 0, cost: 0 };
        const n = v.profit - v.expenses;
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
    <div class="stat"><div class="stat-lbl">Inventory (in stock)</div><div class="stat-val">${d.inventoryCount}</div></div>
  </div>
  <h2>Shop Performance</h2>
  <table>
    <thead><tr><th>Shop</th><th class="right">Revenue</th><th class="right">Cost of Sales</th><th class="right">Gross Profit</th><th class="right">Expenses</th><th class="right">Net P/L</th><th class="right">Units</th></tr></thead>
    <tbody>${shopRows}</tbody>
  </table>
  ${topModels}
  <p style="margin-top:12px;font-size:9pt;color:#555">Best shop: <b>Shop ${esc(bestShop)}</b> · Inventory value: <b>${pkr(d.inventoryValue)}</b></p>`;
      printSection(`CEO Dashboard — ${month}`, html);
    }

    function printContacts() {
      if (!allContacts.length) { showToast('No contacts to print', 'warn'); return; }
      const rows = allContacts.map(c => `<tr>
    <td style="font-weight:600">${esc(c.name || '')}</td>
    <td class="num">${esc(c.phone || '—')}</td>
    <td>${esc(c.email || '—')}</td>
    <td style="max-width:200px">${esc(c.notes || '')}</td>
    <td class="num">${fmtDate(c.addedAt)}</td>
  </tr>`).join('');
      const html = `<h1>Customer Contacts</h1>
  <div class="meta">${allContacts.length} contact${allContacts.length !== 1 ? 's' : ''} · Printed: ${new Date().toLocaleDateString('en-GB')}</div>
  <table>
    <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Notes</th><th>Added</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
      printSection('Customer Contacts', html);
    }

    function printAnalytics() {
      if (!lastAnalyticsData) { showToast('Load Analytics first', 'warn'); return; }
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

    function printLogs() {
      const shop = $('log-shop')?.value || '';
      if (!allLogsData.length) { showToast('No activity logs to print', 'warn'); return; }
      const rows = allLogsData.map(l => {
        const label = LOG_LABELS[l.action] || l.action;
        const det = l.details || {};
        let detail = '';
        if (l.action === 'stock_add') detail = `${det.brand || ''} ${det.model || ''} · IMEI ${det.imei || ''}${det.buyPrice ? ' · ' + pkr(det.buyPrice) : ''}`;
        else if (l.action === 'stock_sell') detail = `${det.brand || ''} ${det.model || ''} · IMEI ${det.imei || ''} · Sold ${det.salePrice ? pkr(det.salePrice) : ''} · Profit ${det.profit != null ? pkr(det.profit) : '—'}${det.buyerName ? ' · ' + esc(det.buyerName) : ''}`;
        else if (l.action === 'stock_delete') detail = esc(det.brand || '') + ' ' + esc(det.model || '');
        const d = new Date(l.ts);
        const ts = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        return `<tr><td class="num">${ts}</td><td>${esc(label)}</td><td>${l.shop ? `<span class="badge">Shop ${esc(l.shop)}</span>` : ''}</td><td style="color:#555;font-size:8.5pt">${detail}</td></tr>`;
      }).join('');
      const title = `Activity Log${shop ? ' — Shop ' + shop : ''}`;
      const html = `<h1>${title}</h1>
  <div class="meta">${allLogsData.length} event${allLogsData.length !== 1 ? 's' : ''} · Printed: ${new Date().toLocaleDateString('en-GB')}</div>
  <table>
    <thead><tr><th>Date / Time</th><th>Action</th><th>Shop</th><th>Details</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
      printSection(title, html);
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
    async function renderShopExpenses() {
      const shop = $('exp-shop-filter').value, month = $('exp-month-filter').value;
      const params = []; if (shop !== 'ALL') params.push(`shop=${shop}`); if (month) params.push(`month=${month}`);
      allShopExp = await api('GET', `/api/shopexpenses${params.length ? '?' + params.join('&') : ''}`);
      const body = $('exp-body');
      if (!allShopExp.length) { body.innerHTML = `<div class="empty"><div class="empty-icon">—</div><h3>No expenses found</h3></div>`; return; }
      const totals = {}; allShopExp.forEach(e => totals[e.shop] = (totals[e.shop] || 0) + (e.amount || 0));
      let html = `<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.9rem;">${Object.entries(totals).map(([s, amt]) => `<div style="background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:.45rem .8rem;min-width:120px;"><div style="font-size:.62rem;font-weight:700;color:${SHOP_COLOR[s] || 'var(--text2)'};margin-bottom:2px">Shop ${s}</div><div style="font-family:var(--mono);font-size:.9rem;color:var(--danger)">${pkr(amt)}</div></div>`).join('')}</div>`;
      const byShop = {}; allShopExp.forEach(e => { if (!byShop[e.shop]) byShop[e.shop] = []; byShop[e.shop].push(e); });
      Object.entries(byShop).forEach(([s, rows]) => {
        const tot = rows.reduce((a, e) => a + (e.amount || 0), 0); const c = SHOP_COLOR[s] || 'var(--a5)'; const r = SHOP_RGBA[s] || '22,163,74';
        html += `<div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;margin-bottom:.65rem;overflow:hidden;">
      <div style="display:flex;justify-content:space-between;padding:.45rem .85rem;background:rgba(${r},.06);border-bottom:1px solid var(--border);">
        <span style="font-size:.82rem;font-weight:700;color:${c}">Shop ${s}</span>
        <span style="font-family:var(--mono);font-size:.72rem;color:var(--danger)">${pkr(tot)}</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:.65rem;">
        <thead><tr style="background:var(--s3)"><th style="text-align:left;padding:.3rem .7rem;color:var(--text3);font-size:.57rem;font-weight:600;letter-spacing:.06em">DATE</th><th style="text-align:left;padding:.3rem .7rem;color:var(--text3);font-size:.57rem;font-weight:600">CAT</th><th style="text-align:left;padding:.3rem .7rem;color:var(--text3);font-size:.57rem;font-weight:600">DESCRIPTION</th><th style="text-align:right;padding:.3rem .7rem;color:var(--text3);font-size:.57rem;font-weight:600">AMOUNT</th><th style="width:24px"></th></tr></thead>
        <tbody>${rows.map(e => `<tr style="border-top:1px solid var(--border2)">
          <td style="padding:.3rem .7rem;color:var(--text2);font-family:var(--mono)">${e.date || ''}</td>
          <td style="padding:.3rem .7rem"><span style="background:rgba(244,63,94,.08);border:1px solid rgba(244,63,94,.2);color:var(--danger);border-radius:5px;padding:.06rem .38rem;font-size:.57rem;font-weight:600">${e.category || ''}</span></td>
          <td style="padding:.3rem .7rem;color:var(--white)">${esc(e.description || '')}</td>
          <td style="padding:.3rem .7rem;text-align:right;font-family:var(--mono);color:var(--danger)">${pkr(e.amount)}</td>
          <td style="padding:.3rem .4rem"><button class="bx" onclick="deleteShopExp('${e._key}')">✕</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`;
      });
      body.innerHTML = html;
    }
    async function deleteShopExp(key) { await api('DELETE', `/api/shopexpenses/${key}`); renderShopExpenses(); showToast('Expense deleted', 'warn'); }
    function openAddExpenseModal() {
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
    async function saveShopExp() {
      const shop = $('se-shop').value, date = $('se-date').value, cat = $('se-cat').value, amt = parseFloat($('se-amt').value) || 0, desc = $('se-desc').value.trim();
      if (!shop || !date || !amt) { showToast('Fill shop, date and amount', 'error'); return; }
      await api('POST', '/api/shopexpenses', { shop, date, month: ym(date), category: cat, amount: amt, description: desc });
      closeModal(); renderShopExpenses(); showToast(`✓ ${pkr(amt)} expense saved`);
    }

    // ── HISTORY ──
    async function loadAllDays() {
      const sh = $('hist-shop').value;
      allDays = await api('GET', sh === 'ALL' ? '/api/days' : `/api/days?shop=${sh}`);
      renderHistory();
    }
    function renderHistory() {
      const body = $('hist-body');
      if (!allDays.length) { body.innerHTML = `<div class="empty"><div class="empty-icon">—</div><h3>No history yet</h3><p>Save daily sheets to see them here</p></div>`; return; }
      body.innerHTML = allDays.map(d => {
        const tSales = Object.entries(d.cats || {}).reduce((s, [, cv]) => (cv.rows || []).reduce((a, r) => a + (r.soldFor || 0), s), 0);
        const sold = Object.entries(d.cats || {}).reduce((s, [ck, cv]) => CATS[ck]?.isExtra ? s : (cv.rows || []).reduce((a, r) => a + (r.out || 0), s), 0);
        const c = SHOP_COLOR[d.shop] || 'var(--a5)'; const r = SHOP_RGBA[d.shop] || '22,163,74';
        // Build sold-items list for the expanded view
        const soldItems = Object.entries(d.cats || {}).flatMap(([ck, cv]) => {
          if (CATS[ck]?.isExtra) return [];
          return (cv.rows || []).filter(r => r.out > 0).map(r => `<div style="display:flex;gap:.6rem;padding:2px 0;border-bottom:1px solid rgba(255,255,255,.05)"><span style="flex:1;color:var(--white)">${r.name || '—'}</span><span style="color:var(--text2)">×${r.out}</span>${r.soldFor ? `<span style="color:var(--success)">${pkr(r.soldFor)}</span>` : ''}</div>`);
        });
        const extraItems = Object.entries(d.cats || {}).flatMap(([ck, cv]) => {
          if (!CATS[ck]?.isExtra) return [];
          return (cv.rows || []).filter(r => r.soldFor > 0).map(r => `<div style="display:flex;gap:.6rem;padding:2px 0;border-bottom:1px solid rgba(255,255,255,.05)"><span style="flex:1;color:var(--white)">${r.name || '—'}</span><span style="color:var(--success)">${pkr(r.soldFor)}</span></div>`);
        });
        const allSoldItems = [...soldItems, ...extraItems];
        return `<div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;margin-bottom:.5rem;overflow:hidden;">
      <div style="padding:.5rem .85rem;display:flex;align-items:center;gap:.6rem;cursor:pointer;transition:background .15s;" onclick="toggleHistCard(this)" onmouseover="this.style.background='var(--s3)'" onmouseout="this.style.background=''">
        <span style="font-size:.82rem;font-weight:700;color:${c}">Shop ${d.shop}</span>
        <span style="font-family:var(--mono);font-size:.68rem;color:var(--text2)">${d.date}</span>
        <span style="margin-left:auto;font-family:var(--mono);font-size:.72rem;color:var(--success)">${pkr(tSales)}</span>
        <span style="font-size:.62rem;color:var(--text2);margin-right:4px">${sold} sold</span>
        <span class="hist-arr" style="color:var(--text2);font-size:.75rem">▶</span>
      </div>
      <div class="hist-body" style="display:none;padding:.5rem .85rem .7rem;font-size:.65rem;color:var(--text2)" onclick="event.stopPropagation()">
        ${allSoldItems.length
            ? `<div style="color:var(--text2);font-size:.58rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Items Sold</div>${allSoldItems.join('')}`
            : `<div style="color:var(--text3);font-style:italic;padding:4px 0">No sales recorded this day</div>`
          }
        ${(d.expenses || []).length ? `<div style="margin-top:6px;padding-top:5px;border-top:1px solid var(--border);color:var(--danger)">Expenses: ${pkr((d.expenses || []).reduce((s, e) => s + (e.amt || 0), 0))}</div>` : ''}
        <div style="margin-top:8px;display:flex;gap:.4rem;align-items:center"><button class="btn bo" style="font-size:.6rem;padding:.2rem .5rem" onclick="loadHistDay('${d.shop}','${d.date}')">Open Full Day</button><button class="btn" style="font-size:.6rem;padding:.2rem .5rem;background:var(--danger);color:#fff;border-color:var(--danger)" onclick="deleteHistDay('${d.shop}','${d.date}')">Delete</button></div>
      </div>
    </div>`;
      }).join('');
    }
    function toggleHistCard(hdr) {
      const body = hdr.parentElement.querySelector('.hist-body');
      const arr = hdr.querySelector('.hist-arr');
      if (!body) return;
      const open = body.style.display !== 'none' && body.style.display !== '';
      body.style.display = open ? 'none' : 'block';
      if (arr) arr.textContent = open ? '▶' : '▼';
    }
    function loadHistDay(shop, date) { activeShop = shop; switchShop(shop); $('work-date').value = date; nav('stock'); }
    async function deleteHistDay(shop, date) {
      if (!confirm(`Delete history for Shop ${shop} on ${date}? This cannot be undone.`)) return;
      const r = await api('DELETE', `/api/days/${shop}/${date}`);
      if (r.success) { allDays = allDays.filter(d => !(d.shop === shop && d.date === date)); renderHistory(); }
      else alert('Failed to delete day.');
    }

    // ── HQ OVERVIEW ──
    // ── MONTHLY P&L ──
    async function renderMonthly() {
      const month = $('monthly-month').value, shopF = $('monthly-shop').value;
      if (!month) { $('monthly-body').innerHTML = `<div class="empty"><div class="empty-icon">—</div><h3>Select a month</h3></div>`; return; }
      let [days, expenses] = await Promise.all([api('GET', `/api/days?month=${month}`), api('GET', `/api/shopexpenses?month=${month}`)]);
      if (!Array.isArray(days)) days = [];
      if (!Array.isArray(expenses)) expenses = [];

      const shops = shopF === 'ALL' ? SHOPS : [shopF]; let html = '';
      shops.forEach(sh => {
        const shD = days.filter(d => d.shop === sh), shE = expenses.filter(e => e.shop === sh);
        if (!shD.length && !shE.length) return;
        let tSales = 0, tCost = 0, gPL = 0, expT = 0, sold = 0;
        shD.forEach(d => { Object.entries(d.cats || {}).forEach(([ck, cv]) => { const rows = cv.rows || []; if (CATS[ck]?.isExtra) { tSales += rows.reduce((a, r) => a + (r.soldFor || 0), 0); gPL += rows.reduce((a, r) => a + (r.soldFor || 0) - (r.boughtFor || 0), 0); } else { tSales += rows.reduce((a, r) => a + (r.soldFor || 0), 0); const tc = rows.reduce((a, r) => a + (r.costPerUnit || 0) * (r.out || 0), 0); tCost += tc; gPL += rows.reduce((a, r) => a + (r.soldFor || 0), 0) - tc; sold += rows.reduce((a, r) => a + (r.out || 0), 0); } }); expT += (d.expenses || []).reduce((a, e) => a + (e.amt || 0), 0); });
        expT += shE.reduce((a, e) => a + (e.amount || 0), 0);
        const netPL = gPL - expT; const c = SHOP_COLOR[sh] || 'var(--a5)'; const r = SHOP_RGBA[sh] || '22,163,74';
        html += `<div class="shop-card"><div class="shop-card-hd" style="border-left:3px solid ${c}"><div class="shop-card-name" style="color:${c}">Shop ${sh}</div><div style="font-size:.6rem;color:var(--text2)">${shD.length} days</div></div><div class="shop-card-body"><div class="shop-stat"><span>Total Sales</span><span style="color:var(--success);font-family:var(--mono)">${pkr(tSales)}</span></div><div class="shop-stat"><span>Cost of Sold</span><span style="color:var(--danger);font-family:var(--mono)">${pkr(tCost)}</span></div><div class="shop-stat"><span>Gross P/L</span><span style="color:${gPL >= 0 ? 'var(--success)' : 'var(--danger)'};font-family:var(--mono)">${pkr(gPL)}</span></div><div class="shop-stat"><span>Total Expenses</span><span style="color:var(--danger);font-family:var(--mono)">${pkr(expT)}</span></div><div class="shop-stat" style="border-top:1px solid var(--border);margin-top:3px;padding-top:4px"><span style="font-weight:700">Net P/L</span><span style="color:${netPL >= 0 ? 'var(--success)' : 'var(--danger)'};font-family:var(--mono);font-weight:700">${pkr(netPL)}</span></div><div class="shop-stat"><span>Units Sold</span><span style="color:var(--a1)">${sold}</span></div></div></div>`;
      });
      if (!html) html = `<div class="empty"><div class="empty-icon">—</div><h3>No data for ${month}</h3></div>`;
      $('monthly-body').innerHTML = html;
    }
