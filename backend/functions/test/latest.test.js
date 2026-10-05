const {test}=require('node:test');const assert=require('node:assert/strict');
const {initialState,readModel,execute,trackDistance}=require('../src/service');
const now=Date.parse('2026-01-01T15:00:00Z');
const saved=(id,startedAt,extra={})=>({id,uid:'u',mode:'RUN',status:'COMPLETED',distanceM:1000,activeMs:300000,startedAt,track:[],...extra});
test('stats use KST dates and all completed records independent of pagination',()=>{
 const d=initialState();for(let i=0;i<65;i++)d.sessions['r'+i]=saved('r'+i,now);
 d.sessions.old=saved('old',now-40*86400000);d.sessions.other=saved('other',now,{uid:'other'});d.sessions.active=saved('active',now,{status:'ACTIVE'});d.sessions.discard=saved('discard',now,{status:'DISCARDED'});
 const r=readModel(d,{uid:'u'},'getWorkoutStats',{range:'week'},now);
 assert.equal(r.buckets.length,7);assert.equal(r.buckets.at(-1).key,'2026-01-02');assert.equal(r.buckets.at(-1).count,65);assert.equal(r.totals.count,66);assert.equal(r.period.count,65);assert.equal(r.totals.distanceM,66000);
 assert.equal(readModel(d,{uid:'u'},'getWorkoutStats',{range:'month'},now).buckets.length,30);
 const y=readModel(d,{uid:'u'},'getWorkoutStats',{range:'year'},now);assert.equal(y.buckets.length,12);assert.equal(y.buckets[0].key,'2025-02');assert.equal(y.buckets.at(-1).key,'2026-01');
 assert.throws(()=>readModel(d,{uid:'u'},'getWorkoutStats',{range:'bad'},now),/INVALID_ARGUMENT/);assert.throws(()=>readModel(d,{},'getWorkoutStats',{},now),/UNAUTHENTICATED/);
});
test('run details share valid distance and interpolate km plus final partial split',()=>{
 const d=initialState(),track=[];for(let i=0;i<13;i++)track.push({lat:37+i*.0009,lng:127,acc:8,t:now+i*30000,recordedAt:now+i*30000,segment:0});
 d.sessions.x=saved('x',now,{track,endedAt:now+380000,activeMs:360000,pauses:[{from:now+360000,to:now+380000}],distanceM:trackDistance(track)});
 const r=readModel(d,{uid:'u'},'getRunDetail',{sessionId:'x'},now+380000);
 assert.equal(r.metrics.pauseMs,20000);assert.equal(r.metrics.splits.length,2);assert.equal(r.metrics.splits[0].distanceM,1000);assert.ok(r.metrics.splits[1].distanceM>200);assert.ok(Math.abs(r.metrics.validDistanceM-r.distanceM)<1e-7);assert.equal(r.metrics.splits[0].partial,false);assert.equal(r.metrics.splits[1].partial,true);
 assert.throws(()=>readModel(d,{uid:'other'},'getRunDetail',{sessionId:'x'},now),/NOT_FOUND/);
});
test('bad GPS both endpoints, paused segments and long gaps never create splits',()=>{
 const d=initialState();d.sessions.x=saved('x',now,{track:[{lat:37,lng:127,acc:100,t:now,segment:0},{lat:37.001,lng:127,acc:8,t:now+30000,segment:0},{lat:37.002,lng:127,acc:8,t:now+60000,segment:1},{lat:37.003,lng:127,acc:8,t:now+180000,segment:1}]});
 const r=readModel(d,{uid:'u'},'getRunDetail',{sessionId:'x'},now);assert.equal(r.metrics.validDistanceM,0);assert.equal(r.metrics.splits.length,0);
 d.sessions.x.track=[];assert.equal(readModel(d,{uid:'u'},'getRunDetail',{sessionId:'x'},now).metrics.unavailableReason,'NO_TRACK');
});
test('public whitelist hides private unknown statuses and every photo storage path',()=>{
 const d=initialState();for(const [id,visibility] of [['public','PUBLIC'],['private','PRIVATE'],['bad','INVALID']])d.issues[id]={id,categoryCode:'LITTER',visibility,lifecycleStatus:'OPEN',anchor:[37,127],createdAt:now,creatorUid:'secret'};
 d.photos.p={id:'p',issueId:'public',status:'READY',publicApproved:true,thumbnailPath:'secret-path',uid:'secret'};
 const r=readModel(d,{},'getMapData',{},now);assert.deepEqual(r.issues.items.map(x=>x.id),['public']);assert.equal(r.issues.items[0].photos.length,0);assert.ok(!JSON.stringify(r).includes('secret'));
});
test('home and river agree about current and past, my includes activity and usable coupons',()=>{
 const d=initialState();d.issues.x={id:'x',categoryCode:'LITTER',visibility:'PUBLIC',lifecycleStatus:'OPEN',createdAt:now,anchor:[37,127]};d.issues.old={...d.issues.x,id:'old',createdAt:now-100*3600000};d.issues.end={...d.issues.x,id:'end',categoryCode:'FOAM',eventEndsAt:now-1};d.sessions.x=saved('x',now);d.coupons.push({id:'c',uid:'u',status:'ISSUED',expiresAt:now+86400000});
 const home=readModel(d,{},'getHome',{},now),river=readModel(d,{},'getRiverFeed',{},now);assert.equal(home.riverSummary.currentCount,1);assert.deepEqual(home.riverSummary,river.summary);assert.equal(river.current.items.length,1);assert.equal(river.past.items.length,2);
 const my=readModel(d,{uid:'u'},'getMy',{},now);assert.equal(my.activity.count,1);assert.equal(my.couponCount,1);
});
test('admin news validates ownership, publication and records idempotent audit',()=>{
 const d=initialState();const call=(admin,name,x)=>execute(d,{uid:'a',admin},name,{clientRequestId:name,...x},now);
 assert.throws(()=>call(false,'upsertNews',{id:'n',title:'소식',body:'본문',sourceUrl:'https://example.com'}),/PERMISSION_DENIED/);
 call(true,'upsertNews',{id:'n',title:'소식',body:'본문',sourceUrl:'https://example.com'});assert.equal(readModel(d,{},'getRiverFeed',{},now).news.items.length,0);
 call(true,'setNewsPublished',{id:'n',published:true});call(true,'setNewsPublished',{id:'n',published:true});assert.equal(readModel(d,{},'getRiverFeed',{},now).news.items.length,1);assert.equal(Object.keys(d.adminAudits).length,2);
 assert.throws(()=>readModel(d,{uid:'u'},'getAdminQueue',{},now),/PERMISSION_DENIED/);
 assert.equal(readModel(d,{uid:'a',admin:true},'getAdminQueue',{},now).issues.items.length,0);
 assert.throws(()=>execute(d,{uid:'a',admin:true},'upsertNews',{clientRequestId:'bad',id:'bad',title:'x',body:'x',sourceUrl:'javascript:alert(1)'},now),/INVALID_ARGUMENT/);
});
test('deleting user can only query their deletion status; profile maximum is 30',()=>{
 const d=initialState();d.deletionJobs.u={uid:'u',status:'PENDING',dataCleaned:false,createdAt:now};assert.equal(readModel(d,{uid:'u'},'getDeletionJob',{},now).status,'PENDING');assert.throws(()=>readModel(d,{uid:'u'},'getMy',{},now),/ACCOUNT_DELETING/);
 const clean=initialState();assert.throws(()=>execute(clean,{uid:'u'},'updateProfile',{clientRequestId:'profile',displayName:'가'.repeat(31)},now),/INVALID_ARGUMENT/);
});
test('public issue detail gives safe geometry and current-window fields without identities',()=>{const d=initialState();d.issues.i={id:'i',visibility:'PUBLIC',lifecycleStatus:'OPEN',categoryCode:'FOAM',creatorUid:'u',anchor:[37,127],observationAnchors:[[37,127],[37,127.001]],pathSegmentId:'L',corridorSegmentId:'W1',eventEndsAt:now+60000,availablePhotoCount:2,createdAt:now};const r=readModel(d,{uid:'u'},'getIssueDetail',{issueId:'i'},now);assert.equal(r.issue.eventEndsAt,now+60000);assert.equal(r.issue.observationAnchors.length,2);assert.equal(r.own,true);assert.ok(!Object.hasOwn(r.issue,'creatorUid'));});
test('outdated consent version cannot mutate workout state',()=>{const d=initialState();d.consents.u={version:'old'};assert.throws(()=>execute(d,{uid:'u'},'claimWelcome',{clientRequestId:'new'},now),/CONSENT_REQUIRED/);});

test('coupon use window still counts as an available benefit',()=>{const d=initialState();d.coupons.push({id:'c',uid:'u',status:'USE_REQUESTED',expiresAt:now+60000,window:{endsAt:now+30000}});assert.equal(readModel(d,{uid:'u'},'getMy',{},now).couponCount,1);});
test('owned run returns only owned exposure details and benefits contain safe merchant names',()=>{const d=initialState();d.sessions.r=saved('r',now,{exposureIds:['a','b']});d.exposures.a={id:'a',uid:'u',targetId:'x'};d.exposures.b={id:'b',uid:'other'};d.merchants.m={id:'m',name:'카페',pinHash:'secret',pinSalt:'salt',pin:'123456'};const r=readModel(d,{uid:'u'},'getRunDetail',{sessionId:'r'},now);assert.deepEqual(r.exposures.map(e=>e.id),['a']);const b=readModel(d,{uid:'u'},'getBenefits',{},now);assert.deepEqual(b.merchants,[{id:'m',name:'카페',isDemo:false}]);});
test('admin welcome queue uses collection owner key and benefits carry own contribution history',()=>{const d=initialState();d.users.u={welcomeStatus:'PENDING_ADMIN',displayName:'u'};d.contributions.c={id:'c',uid:'u',source:'RECHECK',acceptedAt:now};d.contributions.other={id:'other',uid:'other'};assert.equal(readModel(d,{uid:'a',admin:true},'getAdminQueue',{},now).welcome[0].uid,'u');assert.equal(readModel(d,{uid:'u'},'getBenefits',{},now).contributions.length,1);});
test('pilot rejects malformed course/facility data and RUN cannot select walk-only course',()=>{const d=initialState();d.consents.u={version:'v2-2026-10'};d.geometry.paths=[{id:'L',corridorId:'W',points:[[37.62,127.05],[37.622,127.05]]}];const admin=(data,id)=>execute(d,{uid:'a',admin:true},'configurePilot',{clientRequestId:id,paths:d.geometry.paths,...data},now);assert.throws(()=>admin({courses:[{id:'broken',name:'x',out:[],modes:['WALK']}]},'bad-course'),/INVALID_ARGUMENT/);assert.throws(()=>admin({facilities:[{id:'bad',name:'x',type:'bench',lat:999,lng:127}]},'bad-facility'),/INVALID_ARGUMENT/);d.courses.walk={id:'walk',modes:['WALK']};assert.throws(()=>execute(d,{uid:'u'},'startRun',{clientRequestId:'bad-mode',mode:'RUN',courseId:'walk',loc:{lat:37.62,lng:127.05,accuracyM:8,measuredAt:now,precise:true}},now),/COURSE_MODE_NOT_SUPPORTED/);});
test('frontend API inventory covers every callable and all literal HTML/server bridge calls',()=>{const fs=require('node:fs'),path=require('node:path'),spec=require('../../../docs/api/contracts.json'),{READS,MUTATIONS}=require('../src/service');const expected=[...READS,...MUTATIONS,'getPhotoStatus','getPhotoAccess','getPublicPhotoAccess','getWeather'].sort();assert.deepEqual(spec.apis.map(a=>a.name).sort(),expected);const doc=fs.readFileSync(path.resolve(__dirname,'../../../docs/api/FRONTEND.md'),'utf8');for(const api of spec.apis){assert.ok(doc.includes(api.name),api.name+' absent from handover');if(api.kind==='mutation')assert.ok(api.required.includes('clientRequestId'));}for(const file of ['../../web/bridge.mjs','../../web/retouch/js/app.js','../../web/retouch/js/flows.js']){const source=fs.readFileSync(path.resolve(__dirname,file),'utf8');for(const match of source.matchAll(/(?:invoke|mutation|U\.api)\('([^']+)'/g))assert.ok(expected.includes(match[1]),'undocumented API '+match[1]);}});
