var customerReturnState = null;
function customerReturnButton(sale) {
  const id = String(sale.saleId || sale._id || sale.id || '');
  if (authRole !== 'admin' || !hasBusinessCapability('customerReturns') || !/^[a-f0-9]{24}$/.test(id)) return '';
  return `<button class="btn bo" onclick="openCustomerReturn('${id}')">${sale.reversedAt || sale.kind === 'reversal' ? 'Return / refund' : 'Customer return'}</button>`;
}
function currentCustomerReturnState() {
  if (authRole !== 'admin' || !hasBusinessCapability('customerReturns')) return null;
  const owner = businessCapabilityOwner();
  if (!customerReturnState || customerReturnState.owner !== owner) customerReturnState = { owner, generation: 0, review: null, command: null, busy: false };
  return customerReturnState;
}
async function openCustomerReturn(id) {
  const state = currentCustomerReturnState();
  if (!state || !/^[a-f0-9]{24}$/.test(String(id))) return;
  if (state.command && state.command.saleId !== id) { $('customer-return-status').textContent = 'Retry the pending record before opening another return.'; return; }
  const generation = ++state.generation;
  try {
    const review = await api('GET', '/api/customer-returns/review/' + id);
    if (state !== currentCustomerReturnState() || generation !== state.generation || activePage !== 'saleslog') return;
    if (review.saleId !== id || !/^\d{15}$/.test(review.imei) || !Number.isSafeInteger(review.amountMinor) || review.amountMinor <= 0 ||
        !currentClientShops.some(shop => shop.id === review.receivingShop) || typeof review.alreadyReturned !== 'boolean') throw Error('Return review is incomplete. Refresh before continuing.');
    state.review = review;
    renderCustomerReturn();
    $('customer-return-heading')?.focus();
    $('customer-return-panel')?.scrollIntoView({ block: 'nearest' });
    return review;
  } catch (error) { if (state === currentCustomerReturnState() && generation === state.generation) return handleApiError(error); }
}
function renderCustomerReturn() {
  const state = currentCustomerReturnState(), review = state?.review;
  if (!review) return;
  const amount = pkr(review.amountMinor / 100);
  const shopName = id => currentClientShops.find(shop => shop.id === id)?.name || id;
  const action = !review.alreadyReturned ? `<label class="business-confirm"><input id="customer-return-received" type="checkbox" data-return-command> I have received this phone at ${esc(shopName(review.receivingShop))}.</label><button class="btn bv" data-return-command onclick="acceptCustomerReturnUI()">Accept return and restore stock</button>` :
    `<p>Return recorded. The phone was restored to ${esc(shopName(review.receivingShop))} when accepted.</p>${review.refund ? `<h3>Refund recorded</h3><p>${amount} · ${review.refund.method === 'cash' ? 'Cash' : 'Bank'} · ${esc(shopName(review.refund.paidByShop))}</p><p>${esc(fmtBusinessInstant(review.refund.occurredAt))}</p>` :
      `<h3>Refund not recorded</h3><p>Record the full refund you have already paid.</p><div class="form-group"><label for="customer-refund-method">Refund paid by</label><select id="customer-refund-method" data-return-command><option value="">Choose Cash or Bank</option><option value="cash">Cash</option><option value="bank">Bank</option></select></div><div class="form-group"><label for="customer-refund-shop">Paid from shop</label><select id="customer-refund-shop" data-return-command>${currentClientShops.map(shop => `<option value="${escAttr(shop.id)}"${shop.id === review.receivingShop ? ' selected' : ''}>${esc(shop.name || shop.id)}</option>`).join('')}</select></div><label class="business-confirm"><input type="checkbox" id="customer-refund-confirmed" data-return-command> I have already paid the full ${amount} refund using this method and shop.</label><button class="btn bv" data-return-command onclick="recordCustomerRefundUI()">Record refund already paid</button>`}`;
  const panel = $('customer-return-panel'); panel.hidden = false;
  panel.innerHTML = `<h2 id="customer-return-heading" tabindex="-1">Customer return</h2><dl class="business-summary"><dt>Phone</dt><dd>${esc(review.phone)}</dd><dt>IMEI</dt><dd style="font-family:var(--mono);overflow-wrap:anywhere">${esc(review.imei)}</dd><dt>Full sale amount</dt><dd>${amount}</dd><dt>Selling shop</dt><dd>${esc(shopName(review.sellingShop))}</dd><dt>Receive at</dt><dd>${esc(shopName(review.receivingShop))}</dd></dl>${action}<p id="customer-return-status" role="status" aria-live="polite"></p><button class="btn bo" id="customer-return-retry"${state.command ? '' : ' hidden'} onclick="retryCustomerReturnCommand()">Retry pending record</button><button class="btn bo" onclick="closeCustomerReturn()">Close details</button>`;
}
async function customerReturnCommand(kind, url, payload) {
  const state = currentCustomerReturnState(), review = state?.review;
  if (!state || !review || state.busy) return;
  const fingerprint = JSON.stringify([kind, url, payload]);
  if (state.command && state.command.fingerprint !== fingerprint) { $('customer-return-status').textContent = 'Retry the pending record before changing its details.'; return; }
  const command = state.command || { kind, url, payload, fingerprint, saleId: review.saleId, key: newRequestKey() };
  state.command = command; state.busy = true;
  document.querySelectorAll('[data-return-command]').forEach(control => { control.disabled = true; });
  $('customer-return-status').textContent = 'Recording…'; $('customer-return-retry').hidden = true;
  try {
    const result = await api('POST', url, payload, { operationId: command.key });
    if (result.success !== true || result.saleId !== review.saleId || result.returnId !== review.saleId || result.amountMinor !== review.amountMinor ||
        (kind === 'accept' ? result.stockRestored !== true : result.confirmed !== true || result.method !== payload.method || result.paidByShop !== payload.paidByShop)) throw Error('The record outcome is uncertain. Retry this same record.');
    state.command = null;
    if (state !== currentCustomerReturnState() || activePage !== 'saleslog') return;
    state.review = kind === 'accept' ? { ...review, alreadyReturned: true, return: result } : { ...review, refund: result };
    renderCustomerReturn();
    const fresh = await openCustomerReturn(review.saleId);
    if (state !== currentCustomerReturnState() || activePage !== 'saleslog') return;
    $('customer-return-status').textContent = fresh ? 'Recorded.' : 'Recorded. Refresh to check the latest details.';
    loadSalesLog(); loadSidebarStats();
  } catch (error) {
    if ([400, 403, 404, 409].includes(error.status)) state.command = null;
    if (state !== currentCustomerReturnState()) return;
    $('customer-return-status').textContent = `${error.message || 'Could not record.'}${state.command ? ' Retry this same record; do not repeat an external refund.' : ' Review the current details before continuing.'}`;
  } finally {
    state.busy = false;
    if (state === currentCustomerReturnState()) {
      $('customer-return-retry').hidden = !state.command;
      document.querySelectorAll('[data-return-command]').forEach(control => { control.disabled = false; });
    }
  }
}
function acceptCustomerReturnUI() {
  const review = currentCustomerReturnState()?.review;
  if (!review || review.alreadyReturned) return;
  if ($('customer-return-received').checked !== true) { $('customer-return-status').textContent = 'Confirm that you have received this phone at the shown shop.'; return; }
  return customerReturnCommand('accept', '/api/customer-returns', { saleId: review.saleId, receivingShop: review.receivingShop, reviewFingerprint: review.reviewFingerprint });
}
function recordCustomerRefundUI() {
  const review = currentCustomerReturnState()?.review;
  if (!review?.alreadyReturned || review.refund) return;
  const method = $('customer-refund-method').value, paidByShop = $('customer-refund-shop').value;
  if (!['cash', 'bank'].includes(method) || !currentClientShops.some(shop => shop.id === paidByShop) || $('customer-refund-confirmed').checked !== true) {
    $('customer-return-status').textContent = 'Choose the actual method and paying shop, then confirm the full refund was paid.'; return;
  }
  return customerReturnCommand('refund', `/api/customer-returns/${review.saleId}/refund`, { method, paidByShop, confirmed: true });
}
function retryCustomerReturnCommand() {
  const command = currentCustomerReturnState()?.command;
  if (command) return customerReturnCommand(command.kind, command.url, command.payload);
}
function closeCustomerReturn() { $('customer-return-panel').hidden = true; }
