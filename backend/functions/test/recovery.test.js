const {test}=require('node:test');
const assert=require('node:assert/strict');
const {initialState,readModel}=require('../src/service');

test('active run detail includes elapsed time since resume without mutating stored counters',()=>{
 const d=initialState();d.sessions.s={id:'s',uid:'u',status:'ACTIVE',startedAt:1000,lastResumeAt:5000,activeMs:2000,distanceM:0,track:[],pauses:[{from:3000,to:5000}],exposureIds:[]};
 const before=structuredClone(d.sessions.s),detail=readModel(d,{uid:'u'},'getRunDetail',{sessionId:'s'},9000);
 assert.equal(detail.activeMs,6000);assert.equal(detail.metrics.activeMs,6000);assert.deepEqual(d.sessions.s,before);
 assert.equal(readModel(d,{uid:'u'},'getRunDetail',{sessionId:'s'},10000).activeMs,7000);
});
test('paused and completed run queries never add idle time',()=>{
 const d=initialState();for(const status of ['PAUSED','COMPLETED','RECOVERED']){d.sessions.s={id:'s',uid:'u',status,startedAt:1000,lastResumeAt:5000,activeMs:2000,distanceM:0,track:[],pauses:[],exposureIds:[]};assert.equal(readModel(d,{uid:'u'},'getRunDetail',{sessionId:'s'},9000).activeMs,2000);}
});
test('account switch during a committed operation refresh rejects the stale completion',async()=>{
 const {commit}=await import('../../web/operations.mjs');let current=true,warnings=0;
 await assert.rejects(()=>commit(async()=>({ok:true}),new Map(),'updateProfile',{},async()=>{current=false;},()=>warnings++,null,()=>current),/ACCOUNT_CHANGED/);
 assert.equal(warnings,0);
});
test('account switch plus failed refresh never publishes a stale warning or result',async()=>{
 const {commit}=await import('../../web/operations.mjs');let current=true,warnings=0;
 await assert.rejects(()=>commit(async()=>({ok:true}),new Map(),'updateProfile',{},async()=>{current=false;throw Error('offline');},()=>warnings++,null,()=>current),/ACCOUNT_CHANGED/);
 assert.equal(warnings,0);
});
test('blocked browser storage keeps the GPS operation retryable without duplicating it',async()=>{
 const {MutationQueue}=await import('../../web/queue.mjs');let unavailable=true,calls=0;const storage={getItem:()=>null,setItem:()=>{if(unavailable)throw Error('QuotaExceededError');},removeItem:()=>{if(unavailable)throw Error('SecurityError');}};
 const q=new MutationQueue(async()=>{calls++;return{ok:true};},'u',storage);
 const op=q.add('appendTrack',{sessionId:'s',points:[{lat:37,lng:127}]});assert.equal(q.pending.length,1);assert.equal(q.pending[0].id,op.id);assert.equal(q.persistenceFailed,true);
 await q.flush();assert.equal(calls,1);assert.equal(q.pending.length,0);
 unavailable=false;q.persist();assert.equal(q.persistenceFailed,false);
});
test('operator news form preserves omitted dates and clears dates only when explicitly requested',async()=>{
 const {newsPayload}=await import('../../web/contract-adapter.mjs');
 const a=newsPayload([['id','n'],['title','t'],['body','b'],['pub',''],['checked',''],['pubKind','']]);assert.equal('pub' in a,false);assert.equal('checked' in a,false);
 const b=newsPayload([['id','n'],['title','t'],['body','b'],['pub','2026-10-01'],['checked','2026-10-05'],['pubKind','기사 발행']]);assert.equal(b.pub,'2026-10-01');assert.equal(b.checked,'2026-10-05');
 const c=newsPayload([['id','n'],['title','t'],['body','b'],['pub','2026-10-01'],['clearPub','on'],['clearChecked','on']]);assert.equal(c.pub,null);assert.equal(c.checked,null);assert.equal('clearPub' in c,false);
});
test('editing news dates without sourceUrl preserves the source; explicit null clears it',()=>{
 const {mutate}=require('../src/admin'),d=initialState(),a={uid:'a',admin:true};
 mutate(d,a,'upsertNews',{id:'n',title:'제목',body:'본문',sourceUrl:'https://example.com/news'},1000);
 mutate(d,a,'upsertNews',{id:'n',title:'수정',body:'본문',checked:'2026-10-05'},2000);assert.equal(d.news.n.sourceUrl,'https://example.com/news');
 mutate(d,a,'upsertNews',{id:'n',title:'수정',body:'본문',sourceUrl:null},3000);assert.equal(d.news.n.sourceUrl,null);
});
