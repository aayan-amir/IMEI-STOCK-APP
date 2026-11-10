const {test}=require('node:test');const assert=require('node:assert/strict');const {browserContext}=require('../helpers/browser.cjs');
test('printed receipt shows the recorded Bank method without guessing the refund method', async () => {
  const b = browserContext(); for (const name of ['globals', 'utils', 'imei']) b.load('public/js/' + name + '.js');
  const s = b.context; let html;
  s.api = async () => ({ saleId: 'sale', imei: '001234567890123', amountMinor: 30, paymentMethod: 'bank', status: 'recorded' });
  s.printSection = (title, body) => { html = body; };
  await s.printSaleReceipt('sale');
  assert.match(html, /Payment method<\/th><td>Bank<\/td>/);
  assert.match(html, /does not confirm a refund/);
});
test('sale receipt fetches retained evidence and escapes customer text',async()=>{const b=browserContext();for(const f of ['globals','utils','imei'])b.load('public/js/'+f+'.js');const s=b.context;s.showToast=()=>{};s.api=async()=>({saleId:'sale',imei:'001234567890123',phone:'Phone',sellingShop:'A',businessDate:'2026-11-10',amountMinor:30,buyerName:'<script>',status:'reversed',paymentMethod:'not_recorded'});let html;s.printSection=(_,value)=>{html=value;};await s.printSaleReceipt('sale');assert.match(html,/001234567890123/);assert.match(html,/&lt;script&gt;/);assert.match(html,/not recorded/);assert.match(html,/Reversed/);});

test('IMEI evidence opens a bounded source list with owner context',async()=>{const b=browserContext();for(const f of ['globals','utils','imei'])b.load('public/js/'+f+'.js');const s=b.context;s.authRole='admin';s.showToast=()=>{};s.showModal=()=>{};let url;s.api=async(_,value)=>{url=value;return {items:[],total:0,nextCursor:null,hasMore:false};};await s.openIMEIDetail('001234567890123');assert.match(url,/history\/sales\?limit=50/);assert.match(s.document.getElementById('imei-history-body').innerHTML,/No retained/);});

test('old IMEI source response cannot overwrite a later change away and back',async()=>{const b=browserContext();for(const f of ['globals','utils','imei'])b.load('public/js/'+f+'.js');const s=b.context;s.authRole='admin';s.showToast=()=>{};s.showModal=()=>{};let release;s.api=()=>new Promise(resolve=>{release=resolve;});const old=s.openIMEIDetail('001234567890123');s.api=async()=>({items:[{_id:'new',salePrice:1}],total:1,nextCursor:null,hasMore:false});await s.loadIMEIEvidence('activity');await s.loadIMEIEvidence('sales');release({items:[{_id:'old',salePrice:2}],total:1,nextCursor:null,hasMore:false});await old;assert.doesNotMatch(s.document.getElementById('imei-history-body').innerHTML,/record: old/);});
