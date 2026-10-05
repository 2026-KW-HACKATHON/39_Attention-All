const {test}=require('node:test');
const assert=require('node:assert/strict');
const {checkConnection}=require('../../client/connection-check');
const values={getHome:{courses:[]},getMapData:{facilities:[]},getMy:{activeSession:null},getSettings:{consent:null}};
test('public connection probe works without a login and never calls mutations',async()=>{
 const names=[];const result=await checkConnection(async(name,payload)=>{names.push(name);assert.deepEqual(payload,{});return values[name];});
 assert.deepEqual(names,['getHome','getMapData']);assert.equal(result.ok,true);assert.equal(result.authenticated,false);
});
test('authenticated probe checks personal APIs without accepting consent or starting exercise',async()=>{
 const names=[];const result=await checkConnection(async(name)=>{names.push(name);return values[name];},{authenticated:true});
 assert.deepEqual(names,['getHome','getMapData','getMy','getSettings']);assert.equal(result.ok,true);
});
test('App Check denial is reported and no response payload or token is logged',async()=>{
 const result=await checkConnection(async()=>{throw Object.assign(new Error('secret token'),{code:'functions/unauthenticated',details:{token:'private'}});});
 assert.equal(result.ok,false);assert.equal(result.checks.length,2);assert.equal(result.checks[0].code,'functions/unauthenticated');assert.equal(JSON.stringify(result).includes('secret'),false);assert.equal(JSON.stringify(result).includes('private'),false);
});
test('domain rejection inside a successful callable is a failed connection check',async()=>{
 const result=await checkConnection(async()=>({ok:false,errorCode:'ACCOUNT_DELETING'}));
 assert.equal(result.ok,false);assert.equal(result.checks[0].code,'ACCOUNT_DELETING');
});
test('wrong response shape does not produce a false successful connection',async()=>{
 const result=await checkConnection(async()=>null);assert.equal(result.ok,false);assert.equal(result.checks[0].code,'INVALID_RESPONSE');
});
test('connection probe accepts real backend read models without changing state',async()=>{
 const {initialState,readModel}=require('../src/service');const state=initialState(),before=structuredClone(state);
 const report=await checkConnection(async(name,payload)=>readModel(state,{uid:'mobile-test'},name,payload,1791150000000),{authenticated:true});
 assert.equal(report.ok,true);assert.deepEqual(state,before);
});
