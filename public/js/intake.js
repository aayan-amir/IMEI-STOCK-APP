var intakeState = null, intakeOwnerScope = null, intakeRecoveryError = '';
function intakeScope() { return JSON.stringify([listOwner(), authRole === 'shop' ? authShop : activeShop]); }
function intakePrefix() { return 'stockly.intake.job.v1:' + encodeURIComponent(intakeScope()) + ':'; }
function intakePointer() { return 'stockly.intake.active.v1:' + encodeURIComponent(intakeScope()); }
function intakeTerminal(state) { return state.job.items.every(row => ['saved', 'failed'].includes(state.results.get(row.operationId)?.status)); }
function intakeQueueLocked() { return Boolean(intakeRecoveryError || (intakeState?.job.scope === intakeScope() && (!intakeTerminal(intakeState) || intakeState.running))); }
function intakeShopChanged() {
  const scope = intakeScope();
  if (intakeOwnerScope === scope) return;
  if (intakeOwnerScope !== null) {
    batchQueue = []; batchQueueVersion++;
    for (const id of ['bBrand', 'bModel', 'bColor', 'bStorage', 'bBuyPrice']) $(id).value = '';
  }
  intakeOwnerScope = scope; intakeState = null; intakeRecoveryError = '';
  renderIntakeState();
}
function readIntakeJob(id) {
  if (!/^[a-f0-9-]{32,36}$/.test(id)) throw Error('The saved batch needs recovery. No new save was sent.');
  const key = intakePrefix() + id, serialized = localStorage.getItem(key);
  if (!serialized || serialized.length > 2000000) throw Error('The saved batch changed or is unavailable. Reopen Batch to check unfinished saves.');
  let job;
  try { job = JSON.parse(serialized); } catch { throw Error('The saved batch needs recovery. No new save was sent.'); }
  const fields = ['imei', 'imei2', 'cat', 'brand', 'model', 'color', 'storage', 'buyPrice'];
  if (!job || Array.isArray(job) || job.version !== 1 || job.id !== id || job.scope !== intakeScope() || job.shop !== (authRole === 'shop' ? authShop : activeShop) ||
      Object.keys(job).some(field => !['version', 'id', 'scope', 'shop', 'createdAt', 'items'].includes(field)) ||
      typeof job.createdAt !== 'string' || new Date(job.createdAt).toISOString() !== job.createdAt ||
      !Array.isArray(job.items) || !job.items.length || job.items.length > 500) throw Error('The saved batch needs recovery. No new save was sent.');
  const keys = new Set();
  for (const row of job.items) {
    if (!row || Object.keys(row).some(field => !['operationId', 'item'].includes(field)) ||
        !/^[a-f0-9-]{32,36}$/.test(row.operationId) || keys.has(row.operationId) || !row.item ||
        Object.keys(row.item).some(field => !fields.includes(field)) || typeof row.item.imei !== 'string' || !/^\d{15}$/.test(row.item.imei) ||
        (row.item.imei2 && (typeof row.item.imei2 !== 'string' || !/^\d{15}$/.test(row.item.imei2))) ||
        fields.filter(field => !['buyPrice', 'imei', 'imei2'].includes(field)).some(field => typeof row.item[field] !== 'string' || row.item[field].length > 2000)) throw Error('The saved batch needs recovery. No new save was sent.');
    StocklyBusinessRules.parseMinorUnits(row.item.buyPrice); keys.add(row.operationId);
  }
  return { job, key, serialized, results: new Map(), running: false };
}
function removeIntakeJob(state) {
  if (localStorage.getItem(state.key) === state.serialized) localStorage.removeItem(state.key);
  const pointer = 'stockly.intake.active.v1:' + encodeURIComponent(state.job.scope);
  if (sessionStorage.getItem(pointer) === state.job.id) sessionStorage.removeItem(pointer);
}
function discardResolvedIntake() {
  if (intakeQueueLocked()) { showToast('Retry the saved batch before clearing its phones', 'warn'); return false; }
  try {
    if (intakeState?.job.scope === intakeScope()) { removeIntakeJob(intakeState); intakeState = null; }
    renderIntakeState(); return true;
  } catch { showToast('Could not clear the saved draft. Its requests have been kept.', 'error'); return false; }
}
function restoreIntakeBatch(id) {
  intakeShopChanged();
  try {
    const selected = id || sessionStorage.getItem(intakePointer());
    if (selected) {
      if (!intakeState || intakeState.job.id !== selected) {
        const state = readIntakeJob(selected);
        sessionStorage.setItem(intakePointer(), selected);
        if (sessionStorage.getItem(intakePointer()) !== selected) throw Error('Could not preserve this tab’s saved batch.');
        intakeState = state;
      }
      const state = intakeState;
      batchQueue = state.job.items.filter(row => state.results.get(row.operationId)?.status !== 'saved').map(row => ({
        imei1: row.item.imei, imei2: row.item.imei2, color: row.item.color, error: state.results.get(row.operationId)?.error || ''
      }));
      const first = state.job.items.find(row => state.results.get(row.operationId)?.status !== 'saved')?.item;
      if (first) for (const [id, field] of Object.entries({ bBrand: 'brand', bModel: 'model', bColor: 'color', bStorage: 'storage', bBuyPrice: 'buyPrice', bCat: 'cat' })) $(id).value = first[field];
      if (intakeTerminal(state) && !batchQueue.length) { removeIntakeJob(state); intakeState = null; }
      renderBatchQueue(); renderIntakeState(); return true;
    }
    const candidates = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(intakePrefix())) candidates.push(readIntakeJob(key.slice(intakePrefix().length)).job);
    }
    renderIntakeState();
    if (candidates.length) $('batch-status').innerHTML = '<p>Unfinished saves are available. Resume one to check its recorded results.</p>' + candidates.map(job => `<button class="btn bo" onclick="restoreIntakeBatch('${job.id}')">Resume ${job.items.length} phones · ${esc(job.createdAt.slice(0, 10))}</button>`).join('');
    return false;
  } catch (error) { intakeRecoveryError = error.message || 'Saved batch needs recovery.'; renderIntakeState(); return false; }
}
function renderIntakeState() {
  const locked = intakeQueueLocked(), state = intakeState?.job.scope === intakeScope() ? intakeState : null;
  for (const id of ['bBrand', 'bModel', 'bColor', 'bStorage', 'bBuyPrice', 'bCat', 'bImei1', 'bImei2', 'bEntryColor']) $(id).disabled = locked;
  const button = $('batchSaveBtn'); button.disabled = Boolean(state?.running || intakeRecoveryError || !batchQueue.length);
  button.textContent = state && !intakeTerminal(state) ? 'Retry saved batch' : 'Save All to Stock';
  const status = $('batch-status'); if (!status) return;
  if (intakeRecoveryError) { status.textContent = intakeRecoveryError; return; }
  if (!state) { status.textContent = ''; return; }
  const outcomes = [...state.results.values()], saved = outcomes.filter(row => row.status === 'saved').length, failed = outcomes.filter(row => row.status === 'failed').length;
  status.innerHTML = `<p>${saved} saved · ${failed} failed · ${state.job.items.length - saved - failed} pending</p>` +
    (!intakeTerminal(state) ? '<p>This save is kept on this device. Retry uses the original phone details.</p>' : '<p>Failed phones remain in the queue. Correct their details and save again.</p>') +
    state.job.items.filter(row => state.results.get(row.operationId)?.error).slice(0, 12).map(row => `<p>${esc(row.item.imei)}: ${esc(state.results.get(row.operationId).error)}</p>`).join('');
}
function makeIntakeJob() {
  if (!authRole || !localStorage.getItem('clientId')) throw Error('Sign in before saving stock.');
  if (!batchQueue.length || batchQueue.length > 500) throw Error('Queue between 1 and 500 phones.');
  const shop = authRole === 'shop' ? authShop : activeShop;
  if (!shop || shop === 'HQ') throw Error('Choose a shop. Use Receive Stock for the warehouse.');
  const brand = $('bBrand').value.trim(), model = $('bModel').value.trim();
  if (!brand && !model) throw Error('Enter at least Brand or Model');
  const buyPrice = $('bBuyPrice').value || '0'; StocklyBusinessRules.parseMinorUnits(buyPrice);
  const job = { version: 1, id: newRequestKey(), scope: intakeScope(), shop, createdAt: new Date().toISOString(),
    items: batchQueue.map(row => ({ operationId: newRequestKey(), item: { imei: row.imei1, imei2: row.imei2 || '', brand, model,
      color: (row.color || $('bColor').value || '').trim(), cat: $('bCat').value, storage: $('bStorage').value, buyPrice } })) };
  const key = intakePrefix() + job.id, serialized = JSON.stringify(job);
  localStorage.setItem(key, serialized);
  const state = readIntakeJob(job.id);
  if (state.serialized !== serialized) throw Error('Could not preserve the complete batch. No save was sent.');
  intakeState = state;
  sessionStorage.setItem(intakePointer(), job.id);
  if (sessionStorage.getItem(intakePointer()) !== job.id) throw Error('Could not preserve this tab’s batch. No save was sent.');
  return state;
}
function checkIntakeOutcomes(result, packet, shop) {
  if (result?.success !== true || !Array.isArray(result.outcomes) || result.outcomes.length !== packet.length) throw Error('Result not confirmed. Retry the saved batch.');
  const expected = new Map(packet.map(row => [row.operationId, row])), seen = new Set();
  for (const outcome of result.outcomes) {
    const row = expected.get(outcome.operationId);
    if (!row || seen.has(outcome.operationId) || !['saved', 'failed', 'unknown', 'pending'].includes(outcome.status)) throw Error('Result not confirmed. Retry the saved batch.');
    if (outcome.status === 'saved' && (!/^[a-f0-9]{24}$/.test(outcome.phone?._id) || outcome.phone.imei !== row.item.imei || outcome.phone.shop !== shop ||
        outcome.phone.status !== 'in_stock' ||
        ['imei2', 'brand', 'model', 'cat', 'storage', 'color'].some(field => (outcome.phone[field] ?? '') !== row.item[field].trim()) ||
        StocklyBusinessRules.parseMinorUnits(outcome.phone.buyPrice) !== StocklyBusinessRules.parseMinorUnits(row.item.buyPrice))) throw Error('Phone acknowledgement needs review. Retry the saved batch.');
    if (outcome.status === 'failed' && (!['INVALID_INPUT', 'INVALID_IMEI', 'INVALID_AMOUNT', 'INVALID_SHOP', 'INVENTORY_CONFLICT'].includes(outcome.code) || outcome.reviewRequired)) throw Error('Original request needs review. Keep this saved batch.');
    seen.add(outcome.operationId);
  }
  return result.outcomes;
}
async function submitBatch() {
  intakeShopChanged();
  if (intakeState?.running) return false;
  let state, sameView;
  try {
    if (intakeRecoveryError) throw Error(intakeRecoveryError);
    if (!intakeState) {
      const pending = sessionStorage.getItem(intakePointer());
      if (pending) { if (!restoreIntakeBatch(pending)) return false; }
    }
    const previous = intakeState;
    state = previous && !intakeTerminal(previous) ? previous : makeIntakeJob();
    intakeState = state;
    sessionStorage.setItem(intakePointer(), state.job.id);
    if (sessionStorage.getItem(intakePointer()) !== state.job.id) throw Error('Could not preserve this tab’s batch. No save was sent.');
    if (previous && previous !== state) removeIntakeJob(previous);
    state.running = true; renderIntakeState();
    const token = localStorage.getItem('authToken'), navigation = navigationVersion, version = batchQueueVersion;
    const current = () => intakeState === state && state.job.scope === intakeScope() && token === localStorage.getItem('authToken');
    sameView = () => current() && navigation === navigationVersion && version === batchQueueVersion;
    const remaining = state.job.items.filter(row => !['saved', 'failed'].includes(state.results.get(row.operationId)?.status));
    for (let offset = 0; offset < remaining.length; offset += 25) {
      if (!sameView()) return false;
      if (localStorage.getItem(state.key) !== state.serialized) throw Error('This saved batch changed in another tab. Reopen Batch before continuing.');
      const packet = remaining.slice(offset, offset + 25), result = await api('POST', '/api/v2/stock/intake', { shop: state.job.shop, items: packet });
      const outcomes = checkIntakeOutcomes(result, packet, state.job.shop);
      for (const outcome of outcomes) state.results.set(outcome.operationId, outcome);
      if (!sameView()) return false;
      if (outcomes.some(row => ['unknown', 'pending'].includes(row.status))) break;
    }
    if (!sameView()) return false;
    restoreIntakeBatch();
    if (!intakeState) showToast('All phones saved to stock', 'success');
    else if (intakeTerminal(state)) showToast('Some phones failed. Their details remain in the queue.', 'warn');
    else showToast('Some results are pending. Retry the saved batch.', 'warn');
    loadSidebarStats();
    return !intakeState;
  } catch (error) { if (!sameView || sameView()) showToast(error.message || 'Save not confirmed. Retry the saved batch.', 'error'); return false; }
  finally {
    if (state) state.running = false;
    if (intakeState === state && state?.job.scope === intakeScope()) { if (scanMode === 'batch') restoreIntakeBatch(); else renderIntakeState(); }
    else if (!state) renderIntakeState();
  }
}
