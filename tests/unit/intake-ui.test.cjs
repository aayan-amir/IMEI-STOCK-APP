const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserContext } = require('../helpers/browser.cjs');
function storage(map) { return { get length() { return map.size; }, key: i => [...map.keys()][i] ?? null, getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,String(v)), removeItem: k => map.delete(k) }; }
function screen(shared = new Map(), tab = new Map()) {
  const b = browserContext({ localStorage: storage(shared), sessionStorage: storage(tab) });
  for (const file of ['globals','utils','imei','intake']) b.load('public/js/' + file + '.js');
  const s = b.context; s.localStorage.setItem('clientId','owner'); s.localStorage.setItem('authToken','token');
  s.authRole = 'admin'; s.activeShop = 'A'; s.scanMode = 'batch'; s.showToast = () => {}; s.loadSidebarStats = () => {};
  for (const id of ['modeAdd','modeBatch','modeSell','modeProduct']) s.document.getElementById(id).classList.toggle = () => {};
  s.intakeShopChanged();
  for (const [id,value] of Object.entries({ bBrand:'Test', bModel:'Phone', bColor:'Black', bCat:'OTHER', bStorage:'128GB', bBuyPrice:'0' })) s.document.getElementById(id).value = value;
  return { s, shared, tab };
}
function queue(s,n=2) { s.batchQueue = Array.from({length:n},(_,i)=>({imei1:String(830000000000000+i),imei2:'',color:'Black'})); }
function reply(body, failed = false) { return { success:true, outcomes:body.items.map((row,i)=>failed && i===0 ? {operationId:row.operationId,status:'failed',code:'INVALID_AMOUNT',error:'Fix cost'} : {operationId:row.operationId,status:'saved',phone:{_id:row.item.imei.padStart(24,'0'),...row.item,buyPrice:Number(row.item.buyPrice),shop:body.shop,status:'in_stock',addedAt:'2026-11-10T00:00:00.000Z'}}) }; }
function jobs(map) { return [...map.entries()].filter(([key])=>key.startsWith('stockly.intake.job.v1:')); }

test('a complete job is durable before the first bounded request',async()=>{
  const {s,shared}=screen(); queue(s,26); const packets=[];
  s.api=async(method,url,body)=>{assert.equal(url,'/api/v2/stock/intake');assert.equal(JSON.parse(jobs(shared)[0][1]).items.length,26);packets.push(body);return reply(body);};
  await s.submitBatch(); assert.deepEqual(packets.map(x=>x.items.length),[25,1]);assert.equal(s.batchQueue.length,0);assert.equal(jobs(shared).length,0);
});
test('reload retries the immutable complete job including the unattempted remainder',async()=>{
  const first=screen();queue(first.s,26);const packets=[];
  first.s.api=async(m,u,body)=>{packets.push(JSON.stringify(body));if(packets.length===2)throw Error('Lost acknowledgement');return reply(body);};
  await first.s.submitBatch();assert.equal(jobs(first.shared).length,1);
  const second=screen(first.shared,first.tab);second.s.restoreIntakeBatch();second.s.document.getElementById('bBrand').value='Later edit';const retried=[];
  second.s.api=async(m,u,body)=>{retried.push(JSON.stringify(body));return reply(body);};await second.s.submitBatch();
  assert.deepEqual(retried,packets);assert.equal(jobs(first.shared).length,0);
});
test('definite failures remain editable and a corrected save gets fresh keys',async()=>{
  const {s,shared}=screen();queue(s);let original;
  s.api=async(m,u,body)=>{original=body;return reply(body,true);};await s.submitBatch();
  assert.equal(s.batchQueue.length,1);assert.equal(s.intakeQueueLocked(),false);assert.match(s.batchQueue[0].error,/Fix cost/);
  s.document.getElementById('bBuyPrice').value='1';let corrected;s.api=async(m,u,body)=>{corrected=body;return reply(body);};await s.submitBatch();
  assert.equal(corrected.items.length,1);assert.notEqual(corrected.items[0].operationId,original.items[0].operationId);assert.equal(jobs(shared).length,0);
});
test('unavailable storage prevents submission without clearing the queue',async()=>{
  const {s}=screen();queue(s);s.localStorage.setItem=()=>{throw Error('Storage unavailable');};s.api=()=>assert.fail('must persist before POST');
  await s.submitBatch();assert.equal(s.batchQueue.length,2);
});
test('a stale completion cannot clear another shop queue or start the next packet',async()=>{
  const {s,shared}=screen();queue(s,26);let release,calls=0;s.api=(m,u,body)=>{calls++;return new Promise(resolve=>release=()=>resolve(reply(body)));};
  const pending=s.submitBatch();await Promise.resolve();s.activeShop='B';s.intakeShopChanged();s.batchQueue=[{imei1:'840000000000000',color:'Blue'}];release();await pending;
  assert.equal(calls,1);assert.equal(s.batchQueue[0].imei1,'840000000000000');assert.equal(jobs(shared).length,1);
});
test('two tabs preserve separate unresolved jobs and clean only their own job',async()=>{
  const shared=new Map(),a=screen(shared),b=screen(shared);queue(a.s);queue(b.s);
  for(const s of [a.s,b.s])s.api=async()=>{throw Error('Unknown');};await a.s.submitBatch();await b.s.submitBatch();assert.equal(jobs(shared).length,2);
  const bPointer=[...b.tab.entries()];a.s.api=async(m,u,body)=>reply(body);await a.s.submitBatch();
  assert.equal(jobs(shared).length,1);assert.deepEqual([...b.tab.entries()],bPointer);assert.equal(b.s.intakeQueueLocked(),true);
});
test('malformed acknowledgements preserve the exact pending job',async()=>{
  const {s,shared}=screen();queue(s);s.api=async(m,u,body)=>({success:true,outcomes:[reply(body).outcomes[0]]});await s.submitBatch();
  const before=jobs(shared)[0][1];assert.equal(s.intakeQueueLocked(),true);s.api=async()=>({success:true,outcomes:[]});await s.submitBatch();assert.equal(jobs(shared)[0][1],before);
});
test('a duplicate click shares the active command instead of posting twice',async()=>{
  const {s}=screen();queue(s);let release,calls=0;s.api=(m,u,body)=>{calls++;return new Promise(resolve=>release=()=>resolve(reply(body)));};
  const first=s.submitBatch();await Promise.resolve();await s.submitBatch();assert.equal(calls,1);release();await first;
});
test('a failed tab-pointer write preserves the same keys for a later retry',async()=>{
  const {s,shared,tab}=screen();queue(s);s.sessionStorage.setItem=()=>{throw Error('Storage unavailable');};s.api=()=>assert.fail('must preserve pointer');
  await s.submitBatch();const original=JSON.parse(jobs(shared)[0][1]);s.sessionStorage.setItem=(k,v)=>tab.set(k,String(v));let sent;
  s.api=async(m,u,body)=>{sent=body;return reply(body);};await s.submitBatch();assert.deepEqual(Array.from(sent.items,x=>x.operationId),original.items.map(x=>x.operationId));assert.equal(jobs(shared).length,0);
});
test('returning to batch after cancellation leaves the remaining packet retryable',async()=>{
  const {s}=screen();queue(s,26);let release,calls=0;s.api=(m,u,body)=>{calls++;return new Promise(resolve=>release=()=>resolve(reply(body)));};
  const pending=s.submitBatch();await Promise.resolve();s.cancelForm();s.setMode('batch');release();await pending;
  assert.equal(calls,1);assert.equal(s.batchQueue.length,1);assert.equal(s.document.getElementById('batchSaveBtn').disabled,false);
  s.api=async(m,u,body)=>{assert.equal(body.items.length,1);return reply(body);};await s.submitBatch();assert.equal(s.batchQueue.length,0);
});
test('clear refuses unresolved commands but discards a definitively failed draft',async()=>{
  const {s,shared}=screen();queue(s);s.api=async()=>{throw Error('Unknown');};await s.submitBatch();s.clearBatchQueue();assert.equal(jobs(shared).length,1);assert.equal(s.batchQueue.length,2);
  s.api=async(m,u,body)=>reply(body,true);await s.submitBatch();s.clearBatchQueue();assert.equal(s.batchQueue.length,0);assert.equal(jobs(shared).length,0);
});
