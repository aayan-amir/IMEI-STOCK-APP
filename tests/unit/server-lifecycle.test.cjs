const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
function fixture(graceMs=1000){const {installShutdown}=require('../../services/server-lifecycle');const server=new EventEmitter(),signals=new EventEmitter(),app={locals:{}},order=[];let finish;
server.close=fn=>{order.push('close');finish=()=>{server.emit('close');fn();};};server.closeAllConnections=()=>order.push('force');
const lifecycle=installShutdown({server,app,signals,graceMs,stopConnecting:()=>order.push('stop'),disconnect:async()=>order.push('disconnect'),onError:()=>order.push('error')});return {server,signals,app,order,lifecycle,finish:()=>finish()};}
test('shutdown marks draining, stops retries and waits for HTTP before disconnect',async()=>{const v=fixture();const pending=v.lifecycle.shutdown();assert.equal(v.app.locals.draining,true);assert.deepEqual(v.order,['stop','close']);v.finish();await pending;assert.deepEqual(v.order,['stop','close','disconnect']);assert.equal(v.signals.listenerCount('SIGTERM'),0);});
test('repeated shutdown calls and signals share one drain and disconnect',async()=>{const v=fixture();const a=v.lifecycle.shutdown(),b=v.lifecycle.shutdown();v.signals.emit('SIGTERM');v.signals.emit('SIGINT');v.finish();await Promise.all([a,b]);assert.equal(v.order.filter(x=>x==='close').length,1);assert.equal(v.order.filter(x=>x==='disconnect').length,1);});
test('deadline closes remaining sockets, rejects and removes signal listeners',async()=>{const v=fixture(10);const pending=v.lifecycle.shutdown();await assert.rejects(pending,{code:'SHUTDOWN_TIMEOUT'});assert.ok(v.order.includes('force'));assert.equal(v.signals.listenerCount('SIGINT'),0);v.finish();});
test('external close stops retry scheduling and disconnects only once',async()=>{const v=fixture();v.server.emit('close');await new Promise(resolve=>setImmediate(resolve));assert.equal(v.order.filter(x=>x==='disconnect').length,1);assert.equal(v.signals.listenerCount('SIGTERM'),0);});

test('database disconnect is covered by the same shutdown deadline',async()=>{
 const {installShutdown}=require('../../services/server-lifecycle');const server=new EventEmitter(),signals=new EventEmitter();let forced=false;
 server.close=done=>{server.emit('close');done();};server.closeAllConnections=()=>forced=true;
 const lifecycle=installShutdown({server,app:{locals:{}},signals,graceMs:10,stopConnecting(){},disconnect:()=>new Promise(()=>{}),onError(){}});
 await assert.rejects(lifecycle.shutdown(),{code:'SHUTDOWN_TIMEOUT'});assert.equal(forced,true);assert.equal(signals.listenerCount('SIGTERM'),0);
});

function startupFixture(){
 const vm=require('node:vm'),fs=require('node:fs'),server=new EventEmitter(),signals=new EventEmitter(),timers=[],cleared=[];let resolve,reject,connections=0,disconnections=0;
 const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});const db={connectMongo:()=>{connections++;return pending;},mongoose:{disconnect:async()=>disconnections++}};
 server.close=done=>{server.emit('close');done();};server.closeAllConnections=()=>{};server.closeIdleConnections=()=>{};
 const app={locals:{},listen:()=>server},mod={exports:{}};
 const requireStub=name=> name==='./config/runtime'?require('../../config/runtime'):name==='./db'?db:name==='./app'?{createApp:()=>app}:name==='./services/server-lifecycle'?{installShutdown:options=>require('../../services/server-lifecycle').installShutdown({...options,signals,graceMs:1000,onError(){}})}:(()=>{throw Error('Unexpected dependency');})();
 vm.runInNewContext(fs.readFileSync(require.resolve('../../server'),'utf8'),{require:requireStub,module:mod,exports:mod.exports,process:{env:{}},console:{log(){},error(){}},setTimeout:(fn,delay)=>{const timer={fn,delay,unref(){}};timers.push(timer);return timer;},clearTimeout:timer=>cleared.push(timer)});
 mod.exports.startServer({env:{NODE_ENV:'test',PORT:'3001',MONGO_URI:'mongodb://127.0.0.1/stockly_test_shutdown'}});
 return {server,resolve,reject,timers,cleared,get connections(){return connections;},get disconnections(){return disconnections;}};
}
test('startup shutdown waits for an in-flight connection before disconnecting',async()=>{
 const v=startupFixture(),pending=v.server.shutdown();await new Promise(resolve=>setImmediate(resolve));assert.equal(v.disconnections,0);v.resolve();await pending;assert.equal(v.disconnections,1);assert.equal(v.connections,1);
});
test('shutdown cancels startup retry and a queued retry callback cannot reconnect',async()=>{
 const v=startupFixture();v.reject(Error('Database unavailable'));await new Promise(resolve=>setImmediate(resolve));assert.equal(v.timers.length,1);
 await v.server.shutdown();assert.ok(v.cleared.includes(v.timers[0]));v.timers[0].fn();assert.equal(v.connections,1);assert.equal(v.disconnections,1);
});
