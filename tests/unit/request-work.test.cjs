const {test}=require('node:test');const assert=require('node:assert/strict');
test('work tracker waits for handler finally after its response and keeps errors visible',async()=>{
 const {createWorkTracker,trackHandler}=require('../../services/request-work');const tracker=createWorkTracker();let release;const gate=new Promise(resolve=>release=resolve),req={app:{locals:{requestWork:tracker}}};
 const handler=trackHandler(async()=>{try{return 'response';}finally{await gate;}});const work=handler(req,{},()=>{});let idle=false;const drain=tracker.idle().then(()=>idle=true);await new Promise(resolve=>setImmediate(resolve));assert.equal(idle,false);release();assert.equal(await work,'response');await drain;assert.equal(idle,true);
 await assert.rejects(trackHandler(async()=>{throw Error('original error');})(req,{},()=>{}),/original error/);await tracker.idle();
});
test('tracking a router twice does not duplicate handlers or lose recovery markers',()=>{
 const {trackRouterWork}=require('../../services/request-work');const handler=async()=>{};handler.recoveryGuarded=true;const route={stack:[{handle:handler}]},router={stack:[{route}]};trackRouterWork(router);const wrapped=route.stack[0].handle;trackRouterWork(router);assert.equal(route.stack[0].handle,wrapped);assert.equal(wrapped.recoveryGuarded,true);
});

test('a delayed middleware continuation cannot start fresh business work on a closed response',async()=>{
 const {createWorkTracker,trackHandler}=require('../../services/request-work');let writes=0;const tracker=createWorkTracker();
 await trackHandler(async()=>writes++)({app:{locals:{requestWork:tracker}}},{destroyed:true},()=>{});assert.equal(writes,0);await tracker.idle();
});
