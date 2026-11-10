var businessCapabilities = null;
var businessCapabilityGeneration = 0;
function businessCapabilityOwner() { return JSON.stringify([listOwner(), localStorage.getItem('authToken')]); }
function hasBusinessCapability(name) { return businessCapabilities?.owner === businessCapabilityOwner() && businessCapabilities[name] === true; }
async function loadBusinessCapabilities() {
  const owner = businessCapabilityOwner(), generation = ++businessCapabilityGeneration;
  if (businessCapabilities?.owner !== owner) {
    $('stocktake-detail').innerHTML = '';
    $('customer-return-panel').innerHTML = '';
    $('customer-return-panel').hidden = true;
  }
  businessCapabilities = { owner, stocktake: false, fullyPaidTender: false, customerReturns: false, verifiedCashClose: false };
  $('day-cash-count').hidden = true;
  $('day-cash-payment').hidden = true;
  $('ni-stocktakes').style.display = 'none';
  $('sale-payment-group').hidden = true;
  $('fPaymentMethod').required = false;
  if (!['admin', 'shop'].includes(authRole)) return;
  try {
    const result = await api('GET', '/api/capabilities');
    if (owner !== businessCapabilityOwner() || generation !== businessCapabilityGeneration) return;
    businessCapabilities = { owner, stocktake: authRole === 'admin' && result.features?.stocktake === true,
      fullyPaidTender: result.features?.fullyPaidTender === true, customerReturns: authRole === 'admin' && result.features?.customerReturns === true,
      verifiedCashClose: authRole === 'admin' && result.features?.verifiedCashClose === true };
    $('day-cash-count').hidden = !businessCapabilities.verifiedCashClose;
    $('day-cash-payment').hidden = !businessCapabilities.verifiedCashClose;
    $('ni-stocktakes').style.display = businessCapabilities.stocktake ? '' : 'none';
    $('sale-payment-group').hidden = !businessCapabilities.fullyPaidTender;
    $('fPaymentMethod').required = businessCapabilities.fullyPaidTender;
  } catch { /* Unavailable or older servers leave new commands disabled. */ }
}
