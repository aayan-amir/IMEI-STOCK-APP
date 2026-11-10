const {test}=require('node:test');const assert=require('node:assert/strict');
const api=()=>require('../../services/intake-evidence');
const item={imei:'001234567890123',brand:'Test',model:'Phone',buyPrice:0,notes:'retain'};
function receipt(){const {normalizeIntake,intakeFingerprint}=api();const intent=normalizeIntake(item,'A',['A','B']);const phone={_id:'a'.repeat(24),...intent.item,shop:'A',status:'in_stock',addedAt:'2026-11-10T06:00:00.000Z'};
 const operation={_id:'intake-key-one',fingerprint:intakeFingerprint(intent),result:{success:true,kind:'stock_intake',phone}};const audit={_id:'b'.repeat(24),action:'stock_add',shop:'A',role:'admin',details:{intakeVersion:1,operationId:operation._id,fingerprint:operation.fingerprint,phoneId:phone._id,imei:phone.imei,buyPrice:phone.buyPrice,intake:structuredClone(phone)}};return {operation,audit};}
test('bulk envelope bounds work and fixes a staff destination to authenticated shop',()=>{const {batchEnvelope}=api();const batch=batchEnvelope({shop:'B',items:[{operationId:'intake-key-one',item}]},{role:'shop',shop:'A'},['A','B']);assert.equal(batch.shop,'A');assert.equal(batch.items.length,1);
 for(const payload of [{shop:'A',items:[]},{shop:'A',items:Array.from({length:26},(_,i)=>({operationId:'intake-key-'+i,item}))},{shop:'A',items:[{operationId:'short',item}]},{shop:'A',items:[{operationId:'same-key',item},{operationId:'same-key',item}]}])assert.throws(()=>batchEnvelope(payload,{role:'admin'},['A']),error=>error.status===400);
});
test('intake normalization preserves exact identifiers and zero cost but rejects lifecycle fields',()=>{const {normalizeIntake}=api();assert.deepEqual(normalizeIntake({...item,brand:' Test '},'A',['A']).item,item);
 for(const changed of [{...item,imei:123456789012345},{...item,buyPrice:-1},{...item,salePrice:100},{...item,status:'sold'},{...item,imei2:'bad'}])assert.throws(()=>normalizeIntake(changed,'A',['A']),error=>error.status===400);
 assert.throws(()=>normalizeIntake(item,'HQ',['A']),error=>error.status===400);
});
test('original intake proof validates without consulting the current phone',()=>{const {operation,audit}=receipt();assert.equal(api().isIntakeOperation(operation,[audit],['A','B']),true);});
test('intake proof rejects changed original snapshot, fingerprint, identity or audit',()=>{const {isIntakeOperation}=api();for(const change of [v=>v.operation.result.phone.buyPrice=1,v=>v.operation.fingerprint='c'.repeat(64),v=>v.operation.result.phone._id='bad',v=>v.audit.details.intake.notes='changed',v=>v.audit.shop='B',v=>v.audit.details.intakeVersion=0,v=>v.operation.result.phone.unexpected=true]){const v=receipt();change(v);assert.equal(isIntakeOperation(v.operation,[v.audit],['A','B']),false);}});
test('one receipt requires exactly one marked matching intake audit',()=>{const {operation,audit}=receipt(),{isIntakeOperation}=api();assert.equal(isIntakeOperation(operation,[],['A']),false);assert.equal(isIntakeOperation(operation,[audit,structuredClone(audit)],['A']),false);});

test('unsupported or conflicting marked audit versions cannot hide beside valid proof',()=>{
 const {operation,audit}=receipt(),{isIntakeOperation}=api();for(const patch of [{action:'other'},{details:{...audit.details,intakeVersion:0}}]){const extra={...structuredClone(audit),...patch};assert.equal(isIntakeOperation(operation,[audit,extra],['A']),false);}
});
