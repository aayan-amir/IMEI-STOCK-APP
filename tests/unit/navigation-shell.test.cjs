const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
test('simple navigation preserves every legacy destination within six clear sections',()=>{
const html=fs.readFileSync('public/index.html','utf8');
const sidebar=html.slice(html.indexOf('<div id="sb">'),html.indexOf('<div class="sb-stats">'));
for(const label of ['Overview','Inventory','Sales','Daily Close','Reports','Administration']) assert.ok(sidebar.includes('>'+label+'</div>'),label);
for(const id of ['scan','imeistock','saleslog','stock','expenses','history','ceo','warehouse','shipments','monthly','analytics','contacts','reports','logs','backup']) assert.equal((sidebar.match(new RegExp('id="ni-'+id+'"','g'))||[]).length,1,id);
assert.ok(!sidebar.includes('>Invoices<'));assert.ok(!sidebar.includes('>CEO Dashboard<'));
});
test('shop mode hides grouped owner sections without depending on their labels',()=>{assert.match(fs.readFileSync('public/js/ceo.js','utf8'),/dataset\?\.adminOnly/);assert.match(fs.readFileSync('public/index.html','utf8'),/data-admin-only="true"/);});
test('overview omits duplicate insights and printed summaries are reports',()=>{const source=fs.readFileSync('public/js/ceo.js','utf8');assert.equal(source.includes('Quick Insights'),false);assert.equal(source.includes('Invoice —'),false);});
