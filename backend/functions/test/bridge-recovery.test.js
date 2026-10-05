const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {initialState,readModel,execute}=require('../src/service'),Policy=require('../src/policy.cjs');
async function harness({saved=[],failReads=false}={}){
 let clock=10000,watchCallback,mapTicks=0;const d=initialState();d.consents.u={version:'v2-2026-10',acceptedAt:1000};d.sessions.s={id:'s',uid:'u',status:'ACTIVE',mode:'WALK',startedAt:1000,lastResumeAt:5000,activeMs:2000,distanceM:0,track:[{lat:37,lng:127,acc:5,recordedAt:9000,t:9000,segment:1}],pauses:[{from:3000,to:5000}],exposureIds:[]};
 const memory=new Map(saved.length?[['uirun:pending:u',JSON.stringify(saved)]]:[]),localStorage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
 const S={db:initialState(),demo:{},perms:{},sim:{},runs:[],mode:'WALK',tab:'home'};
 const nav={stack:[],top(){return this.stack.at(-1)},find(name){return this.stack.find(e=>e.name===name)},push(kind,name,p={}){this.stack.push({kind,name,p})},replace(kind,name,p={}){this.stack.pop();this.push(kind,name,p)},back(fn){this.stack.pop();fn?.()},clear(fn){this.stack=[];fn?.()}};
 const U={S:()=>S,act:{tab:el=>{S.tab=el.dataset.v},screen:()=>{}},nav,render(){},sheets:{},after:{run:()=>mapTicks++,camera:()=>{}},WX:{},fmt:{dur:String,km:String,pace:String},liveTick(){},boot(){},toast(){},errText:r=>r.errorCode,sheetHead:()=>'',sys:async()=>({v:'no'})};
 const client={auth:{currentUser:{uid:'u'}},invoke:async(n,x={})=>{if(failReads)throw Error('offline');if(n==='getWeather')return{};return readModel(d,{uid:client.auth.currentUser?.uid},n,x,clock)},onUser(fn){this.authListener=fn},logout:async()=>{},login:async()=>{},upload:async()=>{}};
 const imports={...await import('../../web/contract-adapter.mjs'),...await import('../../web/capture.mjs'),...await import('../../web/refresh-gate.mjs'),...await import('../../web/operations.mjs'),...await import('../../web/queue.mjs'),...await import('../../web/state-adapter.mjs'),createClient:async()=>client};
 const context=vm.createContext({...imports,window:{U,UIRUN_DATA:{COURSES:[],FACILITIES:[],ROUTINES:[],NEWS:[]},Policy:{...Policy,emptyDb:initialState}},document:{getElementById:()=>null,querySelectorAll:()=>[]},navigator:{geolocation:{clearWatch(){},getCurrentPosition(fn){fn({coords:{latitude:37,longitude:127,accuracy:5},timestamp:9500})},watchPosition(fn){watchCallback=fn;return 1}}},Date:class extends Date{static now(){return clock}},crypto,structuredClone,localStorage,sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},history:{replaceState(){}},console,setTimeout});
 const source=fs.readFileSync(path.join(__dirname,'../../web/bridge.mjs'),'utf8').replace(/^import .*;\n/gm,'');await new vm.Script('(async()=>{'+source+'})()').runInContext(context);
 return {U,S,nav,client,d,remote:context.window.UIRUN_REMOTE,memory,login:()=>client.authListener({uid:'u'}),setClock:t=>clock=t,ticks:()=>mapTicks,position:p=>watchCallback(p)};
}
test('reload restores durable pending GPS and avoids recording the same cached timestamp twice',async()=>{
 const pending={id:'offline-id',name:'appendTrack',uid:'u',payload:{clientRequestId:'offline-id',sessionId:'s',points:[{lat:37.0001,lng:127,accuracyM:5,recordedAt:9500}]}};
 const h=await harness({saved:[pending]});await h.login();assert.equal(h.remote.queue.pending.length,1);assert.equal(h.S.session.track.length,2);assert.equal(h.S.session.syncPending,true);
 await h.U.askLocation();assert.equal(h.remote.queue.pending.length,1,'cached position must not duplicate restored GPS');
});
test('exercise tick updates GPS map and note without rebuilding the page',async()=>{
 const h=await harness();await h.login();h.nav.push('screen','run',{});h.U.tick();assert.equal(h.ticks(),1);
});
test('navigation stays usable when the server refresh is offline',async()=>{
 const h=await harness({failReads:true});await h.U.act.tab({dataset:{v:'my'}});assert.equal(h.S.tab,'my');
});
test('account change during public issue lookup cannot reopen old owner detail',async()=>{
 const h=await harness();await h.login();let deliver;h.client.invoke=(n)=>n==='getIssueDetail'?new Promise(r=>deliver=r):Promise.reject(Error('offline'));
 const opening=h.U.openIssue('old');h.client.auth.currentUser=null;await h.client.authListener(null);deliver({issue:{id:'old'},own:true});await opening;
 assert.equal(h.nav.stack.length,0);assert.equal(h.S.db.issues.old,undefined);
});
test('late failed control detail cannot clear the next account session or screen',async()=>{
 const h=await harness();await h.login();const base=h.client.invoke;let reject,notify;const waiting=new Promise(r=>notify=r);
 h.client.invoke=(n,x)=>n==='discardRun'?Promise.resolve({ok:true,status:'DISCARDED'}):n==='getRunDetail'?new Promise((r,j)=>{reject=j;notify();}):base(n,x);
 const stopping=h.U.act['run-discard']();await waiting;h.client.auth.currentUser=null;await h.client.authListener(null);h.S.session={id:'next',status:'ACTIVE'};h.nav.push('screen','next',{});reject(Error('offline'));await stopping;
 assert.equal(h.S.session.id,'next');assert.equal(h.nav.top().name,'next');
});
test('late failed record hydration cannot insert previous owner record after logout',async()=>{
 const h=await harness();await h.login();const base=h.client.invoke;let reject,notify,count=0;const waiting=new Promise(r=>notify=r);
 h.client.invoke=(n,x)=>n==='finishRun'?Promise.resolve({ok:true,status:'COMPLETED'}):n==='getRunDetail'?(++count===1?Promise.resolve({...h.d.sessions.s,status:'COMPLETED'}):new Promise((r,j)=>{reject=j;notify();})):base(n,x);
 const stopping=h.U.act['run-finish']();await waiting;h.client.auth.currentUser=null;await h.client.authListener(null);h.nav.push('screen','next',{});reject(Error('offline'));await stopping;
 assert.equal(h.S.runs.length,0);assert.equal(h.nav.top().name,'next');
});
test('restored server time is not incremented again by the previous account clock anchor',async()=>{
 const h=await harness();await h.login();h.U.tick();h.setClock(30000);h.client.auth.currentUser=null;await h.client.authListener(null);h.client.auth.currentUser={uid:'u'};await h.login();assert.equal(h.S.session.activeMs,27000);h.U.tick();assert.equal(h.S.session.activeMs,27000);
});
test('GPS arriving during detail refresh remains marked as awaiting sync',async()=>{
 const h=await harness();await h.login();await h.U.askLocation();h.remote.queue.invoke=async()=>({ok:true});const base=h.client.invoke;let resolve,notify;const waiting=new Promise(r=>notify=r);
 h.client.invoke=(n,x)=>n==='getRunDetail'?new Promise(r=>{resolve=r;notify();}):n==='recordMissionExposure'?Promise.resolve({}):base(n,x);
 h.setClock(11000);h.U.tick();await waiting;h.position({coords:{latitude:37.0002,longitude:127,accuracy:5},timestamp:10500});resolve(h.d.sessions.s);await new Promise(setImmediate);
 assert.equal(h.remote.queue.pending.length,1);assert.equal(h.S.session.syncPending,true);
});
test('late exercise exposure response cannot enter the next account snapshot',async()=>{
 const h=await harness();await h.login();await h.U.askLocation();h.remote.queue.invoke=async()=>({ok:true});const base=h.client.invoke;let resolve,notify;const waiting=new Promise(r=>notify=r);
 h.client.invoke=(n,x)=>n==='recordMissionExposure'?new Promise(r=>{resolve=r;notify();}):base(n,x);
 h.setClock(11000);h.U.tick();await waiting;h.client.auth.currentUser=null;await h.client.authListener(null);resolve({exposure:{id:'old',sessionId:'s'}});await new Promise(setImmediate);
 assert.equal(h.S.db.exposures.old,undefined);
});
test('restored GPS for confirmed completed sessions cannot block a later workout',async()=>{
 const saved={id:'old-op',name:'appendTrack',uid:'u',payload:{clientRequestId:'old-op',sessionId:'s',points:[{lat:37,lng:127,accuracyM:5,recordedAt:9500}]}};
 const h=await harness({saved:[saved]});h.d.sessions.s.status='COMPLETED';await h.login();assert.equal(h.remote.queue.pending.length,0);
});
test('offline session reconciliation preserves all pending GPS instead of discarding it',async()=>{
 const saved={id:'old-op',name:'appendTrack',uid:'u',payload:{clientRequestId:'old-op',sessionId:'s',points:[{lat:37,lng:127,accuracyM:5,recordedAt:9500}]}};
 const h=await harness({saved:[saved],failReads:true});await h.login();assert.equal(h.remote.queue.pending.length,1);
});
test('logout during Google login refresh cannot reopen consent for the previous account',async()=>{
 const h=await harness();await h.login();h.nav.push('sheet','login',{});const base=h.client.invoke;let resolve,notify;const waiting=new Promise(r=>notify=r);
 h.client.invoke=async(n,x)=>{if(n==='getWorkoutStats'){const result=await base(n,x);return new Promise(r=>{resolve=()=>r(result);notify();});}return base(n,x);};
 const loggingIn=h.U.act.google();await waiting;h.client.auth.currentUser=null;await h.client.authListener(null);resolve();await loggingIn;
 assert.equal(h.S.signedIn,false);assert.equal(h.nav.stack.length,0);
});
