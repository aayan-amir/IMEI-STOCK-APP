'use strict';

const { saleEvents } = require('./sales-ledger');
const { HttpError } = require('../utils/http-error');
function saleReceipt(sale) {
  const original = saleEvents(sale)[0];
  const paid = ['paymentVersion', 'paymentMethod', 'paidAmountMinor'].some(field => sale[field] !== undefined);
  if (paid && (sale.paymentVersion !== 1 || !['cash', 'bank'].includes(sale.paymentMethod) || sale.paidAmountMinor !== original.salePriceMinor)) throw new HttpError(409, 'Stored payment evidence needs review', 'INVALID_PAYMENT_HISTORY');
  return { format: 'stockly-sale-receipt', version: 1, saleId: original._id,
    imei: original.imei, phone: [original.brand, original.model, original.storage].filter(Boolean).join(' '),
    sellingShop: original.soldByShop || original.shop, ownerShop: original.shop,
    occurredAt: original.occurredAt, businessDate: original.businessDate,
    amountMinor: original.salePriceMinor, currency: 'PKR', buyerName: original.buyerName || '',
    paymentMethod: paid ? sale.paymentMethod : 'not_recorded', ...(paid ? { paidAmountMinor: sale.paidAmountMinor } : {}),
    status: sale.reversedAt ? 'reversed' : 'recorded', refundConfirmed: false };
}
module.exports = { saleReceipt };
