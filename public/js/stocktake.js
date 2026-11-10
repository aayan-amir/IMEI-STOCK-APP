var stocktakeState = null;
var stocktakePager = null;
function stocktakeOwner() { return businessCapabilityOwner(); }
function currentStocktakeState() {
  if (authRole !== 'admin' || !hasBusinessCapability('stocktake')) return null;
  const owner = stocktakeOwner();
  if (!stocktakeState || stocktakeState.owner !== owner) stocktakeState = { owner, generation: 0, listGeneration: 0, command: null, current: null, busy: false };
  return stocktakeState;
}
async function loadStocktakes() {
  const state = currentStocktakeState();
  if (!state) { $('stocktake-status').textContent = 'Stock checks are not available.'; return; }
  $('stocktake-retry').hidden = !state.command;
  $('stocktake-shop').innerHTML = currentClientShops.map(shop => `<option value="${escAttr(shop.id)}">${esc(shop.name || shop.id)}</option>`).join('');
  if (currentClientShops.some(shop => shop.id === activeShop)) $('stocktake-shop').value = activeShop;
  const generation = ++state.listGeneration;
  stocktakePager = createListPager({ endpoint: '/api/stocktakes', prefix: 'stocktake-list', body: 'stocktake-list-body', query: () => new URLSearchParams(),
    scope: () => JSON.stringify([stocktakeOwner(), stocktakeState === state, state.listGeneration === generation, activePage === 'stocktakes']),
    onPage: items => { state.items = items; }, render: () => {
      $('stocktake-list-body').innerHTML = state.items.length ? state.items.map(item => /^[a-f0-9]{24}$/.test(String(item._id)) ? `<div class="shop-card"><div class="shop-card-body"><strong>${esc(item.shop)} · ${esc(item.status)}</strong><p>${esc(item.businessDate)}</p><button class="btn bo" onclick="openStocktake('${item._id}')">Open count</button></div></div>` : '').join('') : '<p>No stock checks yet.</p>';
    } });
  await stocktakePager.load();
  if (state.current && state === currentStocktakeState()) await openStocktake(state.current.stocktakeId);
}
async function openStocktake(id) {
  const state = currentStocktakeState();
  if (!state || !/^[a-f0-9]{24}$/.test(String(id))) return;
  const generation = ++state.generation;
  try {
    const count = await api('GET', '/api/stocktakes/' + id);
    if (state !== currentStocktakeState() || generation !== state.generation || activePage !== 'stocktakes') return;
    if (count.stocktakeId !== id || !Number.isSafeInteger(count.revision) || !['open', 'reviewed', 'cancelled'].includes(count.status)) throw Error('Count response is incomplete. Refresh before continuing.');
    state.current = count;
    renderStocktake(count);
  } catch (error) { if (state === currentStocktakeState() && generation === state.generation) return handleApiError(error); }
}
function renderStocktake(count) {
  const differences = count.differences;
  const labels = { matched: 'Seen', missing: 'Not seen', unexpected: 'Unexpected scans', wrongShop: 'Recorded at another shop', duplicates: 'Scanned more than once', changed: 'Changed during counting', newArrivals: 'Arrived during counting' };
  const groups = differences ? Object.entries(labels).map(([key, label]) => {
    const values = differences[key] || [];
    return `<details${values.length ? ' open' : ''}><summary>${label}: ${values.length}</summary>${values.length ? `<ul>${values.map(value => `<li style="font-family:var(--mono);overflow-wrap:anywhere">${esc(value)}</li>`).join('')}</ul>` : '<p>None.</p>'}</details>`;
  }).join('') : '<p>This count was cancelled. Its observations are retained.</p>';
  $('stocktake-detail').innerHTML = `<h2>Count at ${esc(count.shop)}</h2><p>${esc(count.status)} · ${Number(count.baselineCount)} phones at start · ${Number(count.observationCount)} scans saved</p>
    ${count.status === 'open' ? `<div class="form-group"><label for="stocktake-imei">Scan or enter IMEI</label><input id="stocktake-imei" inputmode="numeric" maxlength="15" autocomplete="off" data-stocktake-command onkeydown="if(event.key==='Enter'){event.preventDefault();scanStocktake();}"></div><button class="btn bv" data-stocktake-command onclick="scanStocktake()">Save scan</button>` : ''}
    <h3>Review differences</h3>${differences?.recheckRequired ? '<p role="status">Trading or account details changed. Cancel this count and start a fresh check.</p>' : ''}${groups}
    ${count.status === 'open' ? `<div class="mf"><button class="btn bo" data-stocktake-command onclick="finishStocktakeUI('cancelled')">Cancel count</button><button class="btn bv" data-stocktake-command onclick="finishStocktakeUI('reviewed')"${differences?.recheckRequired ? ' disabled data-stocktake-blocked="true"' : ''}>Mark review complete</button></div>` : ''}
    <p>Stock checks record what you saw. Stock and money are not adjusted.</p>`;
  if (count.status === 'open') $('stocktake-imei')?.focus();
}
async function stocktakeCommand(slot, url, payload) {
  const state = currentStocktakeState();
  if (!state || state.busy) return;
  const fingerprint = JSON.stringify([slot, url, payload]);
  if (state.command && state.command.fingerprint !== fingerprint) { $('stocktake-status').textContent = 'Retry the pending action before making another change.'; return; }
  const command = state.command || { fingerprint, slot, url, payload, key: newRequestKey() };
  state.command = command; state.busy = true;
  $('stocktake-retry').hidden = true;
  document.querySelectorAll('[data-stocktake-command]').forEach(button => { button.disabled = true; });
  $('stocktake-status').textContent = 'Saving…';
  try {
    const result = await api('POST', url, payload, { operationId: command.key });
    if (result.success !== true || !/^[a-f0-9]{24}$/.test(String(result.stocktakeId)) || (state.current && slot !== 'start' && result.stocktakeId !== state.current.stocktakeId)) throw Error('The result is uncertain. Retry the same action.');
    state.command = null;
    if (state !== currentStocktakeState() || activePage !== 'stocktakes') return;
    await openStocktake(result.stocktakeId);
    await stocktakePager?.load();
    $('stocktake-status').textContent = 'Saved.';
  } catch (error) {
    if ([400, 403, 404, 409].includes(error.status)) state.command = null;
    if (state !== currentStocktakeState()) return;
    $('stocktake-status').textContent = `${error.message || 'Could not save.'}${state.command ? ' Retry the same action; its request is retained.' : ' Refresh the count before continuing.'}`;
  } finally {
    state.busy = false;
    if (state === currentStocktakeState()) {
      $('stocktake-retry').hidden = !state.command;
      document.querySelectorAll('[data-stocktake-command]').forEach(button => { button.disabled = button.dataset?.stocktakeBlocked === 'true'; });
    }
  }
}
function retryStocktakeCommand() {
  const command = currentStocktakeState()?.command;
  if (command) return stocktakeCommand(command.slot, command.url, command.payload);
}
function startStocktake() {
  if (!currentStocktakeState()) return;
  return stocktakeCommand('start', '/api/stocktakes', { shop: $('stocktake-shop').value });
}
function scanStocktake() {
  const count = currentStocktakeState()?.current, imei = $('stocktake-imei').value.trim();
  if (!count || count.status !== 'open') return;
  if (!/^\d{15}$/.test(imei)) { $('stocktake-status').textContent = 'Enter exactly 15 IMEI digits.'; return; }
  return stocktakeCommand('scan', `/api/stocktakes/${count.stocktakeId}/observations`, { imei, expectedRevision: count.revision });
}
function finishStocktakeUI(status) {
  const count = currentStocktakeState()?.current;
  if (!count || count.status !== 'open' || !['reviewed', 'cancelled'].includes(status)) return;
  return stocktakeCommand('finish', `/api/stocktakes/${count.stocktakeId}/finish`, { status, expectedRevision: count.revision });
}
