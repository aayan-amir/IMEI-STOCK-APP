const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browserContext}=require('../helpers/browser.cjs');
function screen() {
  const b=browserContext(); for(const name of ['globals','utils','imei','daily','ceo']) b.load('public/js/'+name+'.js');
  const s=b.context, frames=[], events=new Map(); let printed=0;
  s.showToast=()=>{}; s.addEventListener=(name,fn)=>events.set(name,fn); s.removeEventListener=(name)=>events.delete(name);
  const create=s.document.createElement.bind(s.document);
  s.document.createElement=type=> {
    if(type!=='iframe')return create(type);
    const handlers=new Map(), doc={readyState:'complete', write(html){this.html=html;},close(){},fonts:{ready:Promise.resolve()}};
    const frame={style:{},setAttribute(){},addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:(name)=>handlers.delete(name),remove(){this.removed=true;},
      contentWindow:{document:doc,focus(){},print(){printed++;},addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:(name)=>handlers.delete(name)}};
    frame.handlers=handlers; frames.push(frame); return frame;
  };
  s.document.body={appendChild(frame){frame.isConnected=true;},removeChild(frame){frame.removed=true;}};
  return {s,frames,events,get printed(){return printed;}};
}
test('print waits for document fonts and escapes the window title', async()=>{
  const v=screen(); let ready; const original=v.s.document.createElement;
  v.s.document.createElement=type=>{const frame=original(type); if(type==='iframe')frame.contentWindow.document.fonts.ready=new Promise(resolve=>{ready=resolve;});return frame;};
  const pending=v.s.printSection('<bad title>','<h1>Receipt</h1>'); await Promise.resolve(); assert.equal(v.printed,0);
  ready(); await pending; assert.equal(v.printed,1); assert.match(v.frames[0].contentWindow.document.html,/&lt;bad title&gt;/);
});
test('afterprint cleans the frame and allows another print without fixed timers',async()=>{
  const v=screen(); await v.s.printSection('Receipt','<h1>Receipt</h1>'); assert.equal(v.printed,1);
  v.frames[0].handlers.get('afterprint')(); assert.equal(v.frames[0].removed,true);
  await v.s.printSection('Second','<h1>Second</h1>'); assert.equal(v.printed,2);
});
test('a second click does not create a competing print frame',async()=>{
  const v=screen(); await v.s.printSection('One','<h1>One</h1>'); await v.s.printSection('Two','<h1>Two</h1>'); assert.equal(v.frames.length,1);
});
test('a changed authenticated owner cancels a print still waiting for fonts',async()=>{
  const v=screen(); let ready; const original=v.s.document.createElement;
  v.s.document.createElement=type=>{const frame=original(type);if(type==='iframe')frame.contentWindow.document.fonts.ready=new Promise(resolve=>{ready=resolve;});return frame;};
  const pending=v.s.printSection('Private','<h1>Private</h1>'); v.s.localStorage.setItem('clientId','another-owner'); ready(); await pending;
  assert.equal(v.printed,0); assert.equal(v.frames[0].removed,true);
});
test('print failure cleans the frame and returns a handled failure',async()=>{
  const v=screen(),original=v.s.document.createElement;
  v.s.document.createElement=type=>{const frame=original(type);if(type==='iframe')frame.contentWindow.print=()=>{throw Error('Unavailable');};return frame;};
  assert.equal(await v.s.printSection('Receipt','<h1>Receipt</h1>'),false); assert.equal(v.frames[0].removed,true);
});

test('session expiry cancels a font-pending print immediately and leaves no private frame',async()=>{
  const v=screen(),original=v.s.document.createElement; v.s.authRole='admin';v.s.localStorage.setItem('authToken','old');
  v.s.document.createElement=type=>{const frame=original(type);if(type==='iframe')frame.contentWindow.document.fonts.ready=new Promise(()=>{});return frame;};
  const pending=v.s.printSection('Private','<h1>Private</h1>'); await Promise.resolve(); v.s.expireSession('old');
  const outcome=await Promise.race([pending,new Promise(resolve=>setImmediate(()=>resolve('unsettled')))]);
  assert.equal(outcome,false);assert.equal(v.frames[0].removed,true);assert.equal(v.printed,0);
});

test('a load event while the written document is still loading does not start printing',async()=>{
  const v=screen(),original=v.s.document.createElement;
  v.s.document.createElement=type=>{const frame=original(type);if(type==='iframe')frame.contentWindow.document.readyState='loading';return frame;};
  const pending=v.s.printSection('Receipt','<h1>Receipt</h1>'); const frame=v.frames[0]; frame.handlers.get('load')(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(v.printed,0); frame.contentWindow.document.readyState='complete';frame.handlers.get('load')();await pending;assert.equal(v.printed,1);
});

test('print also waits for image decoding after document readiness',async()=>{
  const v=screen(),original=v.s.document.createElement;let decoded;
  v.s.document.createElement=type=>{const frame=original(type);if(type==='iframe')frame.contentWindow.document.images=[{decode:()=>new Promise(resolve=>{decoded=resolve;})}];return frame;};
  const pending=v.s.printSection('Receipt','<h1>Receipt</h1>');await new Promise(resolve=>setImmediate(resolve));assert.equal(v.printed,0);decoded();await pending;assert.equal(v.printed,1);
});
test('an image load failure prevents incomplete printing and cleans the frame',async()=>{
  const v=screen(),original=v.s.document.createElement;
  v.s.document.createElement=type=>{const frame=original(type);if(type==='iframe')frame.contentWindow.document.images=[{decode:async()=>{throw Error('Image unavailable');}}];return frame;};
  assert.equal(await v.s.printSection('Receipt','<h1>Receipt</h1>'),false);assert.equal(v.printed,0);assert.equal(v.frames[0].removed,true);
});
