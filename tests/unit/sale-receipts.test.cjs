const {test}=require('node:test');
const assert=require('node:assert/strict');
const {saleReceipt}=require('../../services/sale-receipt');
const sale={_id:'123456789012345678901234',imei:'001234567890123',shop:'B',soldByShop:'A',soldAt:'2026-11-09T00:00:00.000Z',salePrice:0.3,buyPrice:0.1,profit:0.2};

test('receipt shows actual full payment evidence and rejects inconsistent payment amounts', () => {
  const paid = { ...sale, paymentVersion: 1, paymentMethod: 'bank', paidAmountMinor: 30 };
  assert.equal(saleReceipt(paid).paymentMethod, 'bank');
  assert.equal(saleReceipt(paid).paidAmountMinor, 30);
  assert.throws(() => saleReceipt({ ...paid, paidAmountMinor: 29 }), /payment/i);
});
test('receipt uses retained sale identity and exact amounts without inventing payment method',()=>{const receipt=saleReceipt(sale);assert.equal(receipt.imei,sale.imei);assert.equal(receipt.amountMinor,30);assert.equal(receipt.paymentMethod,'not_recorded');assert.equal(receipt.sellingShop,'A');assert.equal(receipt.ownerShop,'B');assert.equal('buyPrice' in receipt,false);});
test('reprint preserves original sale and marks a reversed record without recording refund proof',()=>{const original=JSON.stringify(sale);const receipt=saleReceipt({...sale,reversedAt:'2026-11-10T00:00:00.000Z',reversalBusinessDate:'2026-11-10'});assert.equal(receipt.status,'reversed');assert.equal(receipt.refundConfirmed,false);assert.equal(JSON.stringify(sale),original);});
