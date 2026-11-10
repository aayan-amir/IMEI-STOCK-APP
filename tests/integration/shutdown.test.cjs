const {test}=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');const {once,EventEmitter}=require('node:events');
const {installShutdown}=require('../../services/server-lifecycle');const {withApp}=require('../helpers/http.cjs');
test('a shutdown signal drains an accepted HTTP response before disconnecting the database',async()=>{
 let entered,release;const accepted=new Promise(resolve=>entered=resolve),pending=new Promise(resolve=>release=resolve),order=[];
 const server=http.createServer(async(req,res)=>{entered();await pending;res.end('accepted work completed');order.push('response');});
 server.listen(0,'127.0.0.1');await once(server,'listening');const app={locals:{}},signals=new EventEmitter();
 const lifecycle=installShutdown({server,app,signals,graceMs:2000,stopConnecting:()=>order.push('stop'),disconnect:async()=>order.push('disconnect'),onError:error=>order.push(error.code)});
 try {const request=fetch('http://127.0.0.1:'+server.address().port);await accepted;signals.emit('SIGTERM');assert.equal(app.locals.draining,true);assert.deepEqual(order,['stop']);
 release();const response=await request;assert.equal(await response.text(),'accepted work completed');await lifecycle.shutdown();assert.deepEqual(order,['stop','response','disconnect']);}
 finally{release();server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));}
});
test('draining readiness and API reject new work while liveness remains available',async()=>{
 const {createApp}=require('../../app');const app=createApp({config:{nodeEnv:'test',port:3000,trustProxy:false,allowedOrigins:[]},database:{mongoose:{connection:{readyState:1}}}});
 await withApp(app,async request=>{assert.equal((await request('/health/ready')).status,200);app.locals.draining=true;
 assert.equal((await request('/health/ready')).status,503);const response=await request('/api/stock');assert.equal(response.status,503);assert.equal((await response.json()).code,'SERVER_DRAINING');assert.equal((await request('/health/live')).status,200);});
});

test('deadline aborts a hung HTTP response instead of leaving a live connection',async()=>{
 let entered;const accepted=new Promise(resolve=>entered=resolve);const server=http.createServer((req,res)=>entered());server.listen(0,'127.0.0.1');await once(server,'listening');
 const lifecycle=installShutdown({server,app:{locals:{}},signals:new EventEmitter(),graceMs:50,stopConnecting(){},disconnect:async()=>{},onError(){}});
 const outcome=fetch('http://127.0.0.1:'+server.address().port).then(()=>false,()=>true);await accepted;
 await assert.rejects(lifecycle.shutdown(),{code:'SHUTDOWN_TIMEOUT'});assert.equal(await outcome,true);assert.equal(server.listening,false);
});

test('shutdown waits for accepted work after its client aborts',async()=>{
 const express=require('express'),{createWorkTracker,trackHandler}=require('../../services/request-work');let entered,release;const accepted=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve),order=[];
 const app=express();app.locals.requestWork=createWorkTracker();app.get('/work',trackHandler(async(req,res)=>{entered();await gate;order.push('work');if(!res.destroyed)res.end('done');}));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const lifecycle=installShutdown({server,app,signals:new EventEmitter(),graceMs:1000,stopConnecting(){},disconnect:async()=>order.push('disconnect'),onError(){}});
 const request=http.get('http://127.0.0.1:'+server.address().port+'/work');request.on('error',()=>{});await accepted;request.destroy();const shutdown=lifecycle.shutdown();await new Promise(resolve=>setTimeout(resolve,20));assert.deepEqual(order,[]);release();await shutdown;assert.deepEqual(order,['work','disconnect']);
});
test('shutdown waits for post-response cleanup such as the recovery lease finally',async()=>{
 const express=require('express'),{createWorkTracker,trackHandler}=require('../../services/request-work');let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve),order=[];
 const app=express();app.locals.requestWork=createWorkTracker();app.get('/work',trackHandler(async(req,res)=>{try{res.end('done');}finally{entered();await gate;order.push('released');}}));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const lifecycle=installShutdown({server,app,signals:new EventEmitter(),graceMs:1000,stopConnecting(){},disconnect:async()=>order.push('disconnect'),onError(){}});
 const response=await fetch('http://127.0.0.1:'+server.address().port+'/work');await response.text();await started;const shutdown=lifecycle.shutdown();await new Promise(resolve=>setTimeout(resolve,20));assert.deepEqual(order,[]);release();await shutdown;assert.deepEqual(order,['released','disconnect']);
});

test('the actual recovery wrapper keeps its lease release tracked through shutdown',async()=>{
 const express=require('express'),{createWorkTracker,trackRouterWork}=require('../../services/request-work'),{protectRouter}=require('../../services/recovery-control');let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve),order=[];
 const state={updateOne:async(filter,update)=>{if(update.$pull){entered();await gate;order.push('lease released');}},findOneAndUpdate:async()=>({})};const connection={model:()=>state};
 const app=express();app.locals.requestWork=createWorkTracker();app.use((req,res,next)=>{req.tenantDb=connection;next();});const router=express.Router();router.post('/write',async(req,res)=>res.json({success:true}));app.use(trackRouterWork(protectRouter(router)));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const lifecycle=installShutdown({server,app,signals:new EventEmitter(),graceMs:1000,stopConnecting(){},disconnect:async()=>order.push('disconnect'),onError(){}});
 const response=await fetch('http://127.0.0.1:'+server.address().port+'/write',{method:'POST'});assert.equal((await response.json()).success,true);await started;const shutdown=lifecycle.shutdown();await new Promise(resolve=>setTimeout(resolve,20));assert.deepEqual(order,[]);release();await shutdown;assert.deepEqual(order,['lease released','disconnect']);
});
