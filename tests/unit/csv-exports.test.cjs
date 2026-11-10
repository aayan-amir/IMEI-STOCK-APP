const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browserContext}=require('../helpers/browser.cjs');
function screen(){const b=browserContext();for(const name of ['globals','utils','imei','daily'])b.load('public/js/'+name+'.js');const s=b.context;s.showToast=()=>{};return s;}
test('inventory export neutralizes formula-like metadata and retains zero and exact IMEI text',async()=>{
 const s=screen();s.completeStockExport=async()=>[{imei:'001234567890123',imei2:'001234567890124',brand:'=1+1',model:'Phone, "A"\nکراچی',color:'  @formula',storage:'-name',buyPrice:0,salePrice:0,status:'in_stock',shop:'A'}];let csv;s.dlCSV=value=>csv=value;await s.exportIMEICSV();
 assert.match(csv,/"'=1\+1"/);assert.match(csv,/"'  @formula"/);assert.match(csv,/"'-name"/);assert.match(csv,/"001234567890123","001234567890124"/);assert.match(csv,/Phone, ""A""\nکراچی/);assert.match(csv,/"0","0","0"/);
});
test('sales export neutralizes customer notes without turning negative numeric reversals into text',async()=>{
 const s=screen();s.completeSalesExport=async()=>[{businessDate:'2026-11-10',imei:'001234567890123',buyerName:'\t=HYPERLINK("bad")',notes:' +SUM(1,1)',brand:'@brand',buyPrice:-1,salePrice:-2,profit:-1,kind:'reversal',saleId:'id'}];let csv;s.dlCSV=value=>csv=value;await s.exportSalesLogCSV();
 assert.match(csv,/"'\t=HYPERLINK/);assert.match(csv,/"' \+SUM/);assert.match(csv,/"'@brand"/);assert.match(csv,/"-1","-2","-1"/);assert.match(csv,/"001234567890123"/);
});
