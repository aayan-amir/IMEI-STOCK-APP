let cashReviewContext = null, cashCommand = null, cashScreenGeneration = 0;
const pendingCashCommands = new Map();
function cashCommandScope(context) { return JSON.stringify([context.owner, context.shop]); }
function cashJournalKey(shop) { return 'stockly:cash-request:' + JSON.stringify([localStorage.getItem('clientId'), authRole, authShop, shop]); }
function saveCashJournal(command) {
  command.journalKey = command.journalKey || cashJournalKey(command.shop);
  const value = JSON.stringify({ version: 1, key: command.key, url: command.url, body: command.body, uncertain: true });
  try {
    localStorage.setItem(command.journalKey, value);
    if (localStorage.getItem(command.journalKey) !== value) throw Error();
  } catch { throw Error('The payment retry record could not be saved on this device. No new request was sent.'); }
}
function clearCashJournal(command) {
  if (command.journalKey) localStorage.removeItem(command.journalKey);
  pendingCashCommands.delete(cashCommandScope(command));
}
function readCashJournal(shop) {
  const journalKey = cashJournalKey(shop), text = localStorage.getItem(journalKey);
  if (!text) return null;
  if (text.length > 8192) throw Error('Invalid saved request');
  const value = JSON.parse(text);
  if (value.version !== 1 || value.uncertain !== true ||
      typeof value.key !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value.key) ||
      !['/api/cash/checkpoints', '/api/cash/entries'].includes(value.url) || value.body?.shop !== shop || value.body?.confirmed !== true ||
      !['opening', 'close', 'income', 'expense', 'purchase', 'transfer'].includes(value.body.kind)) throw Error('Invalid saved request');
  return { owner: cashScreenOwner(), shop, key: value.key, url: value.url, body: value.body, journalKey, uncertain: true };
}
function cashScreenOwner() { return businessCapabilityOwner(); }
function cashCurrent(context) {
  return context && context.owner === cashScreenOwner() && context.shop === selectedDay().shop && hasBusinessCapability('verifiedCashClose');
}
function cashFailure(error) {
  const node = $('cash-message');
  if (node) { node.textContent = error.message || 'This request could not be completed.'; node.setAttribute('role', 'alert'); }
}
function cashResumePending() {
  cashCommand = pendingCashCommands.get(cashCommandScope({ owner: cashScreenOwner(), shop: selectedDay().shop })) || null;
  if (!cashCommand) {
    try {
      cashCommand = readCashJournal(selectedDay().shop);
      if (cashCommand) pendingCashCommands.set(cashCommandScope(cashCommand), cashCommand);
    } catch {
      showModal('<h3>Saved cash request needs review</h3><p role="alert">This device has an unreadable pending cash request. No new payment was submitted. Keep its saved evidence for owner recovery.</p><button class="btn bo" onclick="closeModal()">Close</button>');
      return true;
    }
  }
  if (!cashCommand || !cashCurrent(cashCommand)) return false;
  showModal(`<h3>Check the previous cash request</h3><p>The result is uncertain. Retry this same recorded request to retrieve its result.</p><p>${esc(cashCommand.shop)} · ${esc(cashCommand.body.kind)} · ${esc(cashCommand.body.amount)} PKR</p><p id="cash-message" role="status"></p><div class="mf"><button class="btn bo" onclick="closeModal()">Close</button><button class="btn bv" id="cash-submit" onclick="sendCashCommand()">Retry same request</button></div>`);
  return true;
}
async function openCashClose() {
  if (!hasBusinessCapability('verifiedCashClose')) return;
  if (cashResumePending()) return;
  const context = { owner: cashScreenOwner(), shop: selectedDay().shop, generation: ++cashScreenGeneration };
  cashReviewContext = context;
  showModal('<h3>Count cash</h3><p role="status">Loading payment records…</p>');
  try {
    const review = await api('GET', '/api/cash/' + encodeURIComponent(context.shop) + '/review');
    if (!cashCurrent(context) || cashReviewContext !== context) return;
    context.review = review;
    const opening = review.needsOpening, incomplete = !opening && !review.calculation?.complete;
    const issues = (review.calculation?.issues || []).slice(0, 12).map(issue => `<li>${esc(issue.id)}: ${esc(issue.code.replaceAll('_', ' ').toLowerCase())}</li>`).join('');
    showModal(`<h3>${opening ? 'Count opening cash' : 'Count and close cash'} · ${esc(context.shop)}</h3><p>${opening ? 'Count the cash physically in this till now. This creates a new baseline; older payments keep their original history.' : esc(review.date)}</p>
      ${incomplete ? `<p role="alert">Cash records incomplete. Resolve these records before closing.</p><ul>${issues}</ul>` : ''}
      <div class="business-form">
      ${opening ? '' : `<div class="business-summary"><span>Expected cash</span><strong>${incomplete ? 'Unavailable' : pkrMinor(review.calculation.expectedMinor)}</strong></div>`}
      <label for="cash-counted">${opening ? 'Opening cash counted (PKR)' : 'Cash counted (PKR)'}</label><input id="cash-counted" inputmode="decimal" autocomplete="off" oninput="updateCashDifference()">
      ${opening ? '' : '<div class="business-summary"><span>Difference</span><strong id="cash-difference">—</strong></div>'}
      <label for="cash-reason">${opening ? 'Reason for this opening count' : 'Reason if the count differs'}</label><textarea id="cash-reason" maxlength="500"></textarea>
      <label class="business-confirm"><input type="checkbox" id="cash-confirmed">I have just counted the cash in this till.</label>
      <p id="cash-message" role="status"></p><div class="mf"><button class="btn bo" onclick="closeModal()">Cancel</button><button class="btn bo" onclick="openCashClose()">Refresh records</button><button class="btn bv" id="cash-submit" onclick="submitCashCount()" ${incomplete ? 'disabled' : ''}>${opening ? 'Save counted opening' : 'Save count and close'}</button></div></div>`);
    $('cash-counted').focus();
  } catch (error) { if (cashCurrent(context) && cashReviewContext === context) showModal(`<h3>Cash count unavailable</h3><p role="alert">${esc(error.message)}</p>`); }
}
function updateCashDifference() {
  if (!cashCurrent(cashReviewContext) || !cashReviewContext.review?.calculation?.complete) return;
  try {
    const counted = StocklyBusinessRules.parseMinorUnits($('cash-counted').value);
    $('cash-difference').textContent = pkrMinor(counted - cashReviewContext.review.calculation.expectedMinor);
  } catch { $('cash-difference').textContent = '—'; }
}
async function submitCashCount() {
  if (cashCommand && cashCurrent(cashCommand)) return sendCashCommand();
  try {
    const context = cashReviewContext, review = context?.review;
    if (!cashCurrent(context) || !review || (!review.needsOpening && !review.calculation?.complete)) throw Error('Refresh complete cash records before submitting a count.');
    if (!$('cash-confirmed').checked) throw Error('Confirm that you have just counted the till.');
    StocklyBusinessRules.parseMinorUnits($('cash-counted').value);
    cashCommand = { owner: context.owner, shop: context.shop, key: newRequestKey(), url: '/api/cash/checkpoints', body: {
      shop: context.shop, kind: review.needsOpening ? 'opening' : 'close', amount: $('cash-counted').value.trim(),
      confirmed: true, reason: $('cash-reason').value.trim(), reviewFingerprint: review.reviewFingerprint } };
    pendingCashCommands.set(cashCommandScope(cashCommand), cashCommand);
    await sendCashCommand();
  } catch (error) { cashFailure(error); }
}
function openCashPayment(kind = 'expense') {
  if (!hasBusinessCapability('verifiedCashClose')) return;
  if (cashResumePending()) return;
  if (!['income', 'expense', 'purchase', 'transfer'].includes(kind)) return;
  cashReviewContext = { owner: cashScreenOwner(), shop: selectedDay().shop, kind, generation: ++cashScreenGeneration };
  const names = { income: 'Other income received', expense: 'Expense paid', purchase: 'Supplier payment made', transfer: 'Transfer completed' };
  showModal(`<h3>${names[kind]} · ${esc(cashReviewContext.shop)}</h3><div class="business-form"><label for="cash-payment-kind">Payment type</label>
    <select id="cash-payment-kind" onchange="openCashPayment(this.value)">${Object.entries(names).map(([value, label]) => `<option value="${value}" ${value === kind ? 'selected' : ''}>${label}</option>`).join('')}</select>
    <label for="cash-payment-amount">Amount (PKR)</label><input id="cash-payment-amount" inputmode="decimal" autocomplete="off">
    <label for="cash-payment-method">Paid by</label><select id="cash-payment-method"><option value="">Choose Cash or Bank</option><option value="cash">Cash</option><option value="bank">Bank</option></select>
    <label for="cash-payment-description">Description</label><input id="cash-payment-description" maxlength="500">
    ${kind === 'income' ? '<label for="cash-payment-cost">Cost for profit calculation (PKR, optional)</label><input id="cash-payment-cost" inputmode="decimal"><p>This cost does not record a supplier payment.</p>' : ''}
    ${kind === 'transfer' ? `<label for="cash-payment-to">Received by shop</label><select id="cash-payment-to"><option value="">Choose receiving shop</option>${SHOPS.filter(shop => shop !== cashReviewContext.shop).map(shop => `<option value="${escAttr(shop)}">${esc(currentClientShops.find(item => item.id === shop)?.name || shop)}</option>`).join('')}</select>` : ''}
    <label class="business-confirm"><input id="cash-payment-confirmed" type="checkbox">This payment has just been completed in full.</label><p>Saving records the payment; it does not send money.</p><p id="cash-message" role="status"></p>
    <div class="mf"><button class="btn bo" onclick="closeModal()">Cancel</button><button class="btn bv" id="cash-submit" onclick="submitCashPayment()">Record completed payment</button></div></div>`);
  $('cash-payment-amount').focus();
}
async function submitCashPayment() {
  if (cashCommand && cashCurrent(cashCommand)) return sendCashCommand();
  try {
    const context = cashReviewContext, method = $('cash-payment-method').value;
    if (!cashCurrent(context) || !context.kind) throw Error('Open this payment again for the current shop.');
    if (!['cash', 'bank'].includes(method) || !$('cash-payment-confirmed').checked) throw Error('Choose Cash or Bank and confirm the completed payment.');
    if (StocklyBusinessRules.parseMinorUnits($('cash-payment-amount').value) <= 0) throw Error('Enter a positive amount.');
    const body = { shop: context.shop, kind: context.kind, amount: $('cash-payment-amount').value.trim(), method,
      description: $('cash-payment-description').value.trim(), confirmed: true,
      ...(context.kind === 'income' ? { cost: $('cash-payment-cost').value.trim() || '0' } : {}),
      ...(context.kind === 'transfer' ? { toShop: $('cash-payment-to').value } : {}) };
    if (!body.description) throw Error('Describe the completed payment.');
    cashCommand = { owner: context.owner, shop: context.shop, key: newRequestKey(), url: '/api/cash/entries', body };
    pendingCashCommands.set(cashCommandScope(cashCommand), cashCommand);
    await sendCashCommand();
  } catch (error) { cashFailure(error); }
}
async function sendCashCommand() {
  const command = cashCommand;
  if (!cashCurrent(command) || command.sending) return;
  const wasUncertain = command.uncertain === true;
  try { saveCashJournal(command); } catch (error) { cashFailure(error); return; }
  command.uncertain = true;
  command.sending = true; $('cash-submit').disabled = true;
  try {
    const result = await api('POST', command.url, command.body, { operationId: command.key });
    if (!cashCurrent(command) || cashCommand !== command) return;
    clearCashJournal(command);
    cashCommand = null; cashReviewContext = null;
    const payment = command.url.endsWith('entries');
    const values = payment
      ? `<p>${pkrMinor(result.amountMinor ?? StocklyBusinessRules.parseMinorUnits(command.body.amount))} · ${command.body.method === 'cash' ? 'Cash' : 'Bank'}</p>`
      : `<dl class="business-summary"><dt>Expected cash</dt><dd>${pkrMinor(result.expectedMinor)}</dd><dt>Cash counted</dt><dd>${pkrMinor(result.countedMinor)}</dd><dt>Difference</dt><dd>${pkrMinor(result.differenceMinor)}</dd></dl>`;
    showModal(`<div class="business-form"><h3>${payment ? 'Payment recorded' : 'Cash count saved'}</h3><p>${esc(command.shop)} · ${esc(fmtBusinessInstant(result.at || result.occurredAt))}</p>${values}<details><summary>Record details</summary><p>${esc(result.checkpointId || result.entryId)}</p></details><div class="mf"><button class="btn bo" onclick="closeModal()">Close</button><button class="btn bv" onclick="openCashClose()">View cash records</button></div></div>`);
    if (typeof loadDay === 'function') await loadDay();
  } catch (error) {
    if (!cashCurrent(command) || cashCommand !== command) return;
    if (!wasUncertain && [400, 403, 409, 428, 503].includes(error.status)) {
      try { clearCashJournal(command); cashCommand = null; } catch { /* Retain the exact request when local cleanup fails. */ }
    }
    cashFailure(error);
    $('cash-submit').textContent = cashCommand ? 'Retry same request' : 'Review again';
    if (!cashCommand) $('cash-submit').onclick = () => command.url.endsWith('entries') ? openCashPayment(command.body.kind) : openCashClose();
  } finally {
    command.sending = false;
    if (cashCurrent(command)) $('cash-submit').disabled = false;
  }
}
