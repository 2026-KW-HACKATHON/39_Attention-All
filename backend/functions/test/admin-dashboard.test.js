const {test}=require('node:test');
const assert=require('node:assert/strict');
const {initialState,readModel}=require('../src/service');
test('dashboard enforces administrator authorization',()=>{
 const d=initialState();assert.throws(()=>readModel(d,{uid:'user'},'getAdminDashboard'),e=>e.code==='PERMISSION_DENIED');
});
test('dashboard counts all issued coupons and excludes deleted accounts',()=>{
 const d=initialState();d.users.a={};d.users.b={};d.deletionJobs.b={};
 d.coupons=[{id:'1',uid:'a',status:'ISSUED',expiresAt:5000},{id:'2',uid:'a',status:'USED',expiresAt:5000},{id:'3',uid:'b',status:'ISSUED'}];
 d.photos.p={id:'p',uid:'a',status:'READY'};d.issues.i={id:'i',creatorUid:'a',visibility:'PUBLIC',verificationLevel:'NONE'};
 const r=readModel(d,{uid:'admin',admin:true},'getAdminDashboard',{},1000);
 assert.equal(r.stats.coupons,2);assert.equal(r.stats.usedCoupons,1);assert.equal(r.stats.pendingIssues,1);assert.equal(r.stats.photos,1);assert.equal(r.coupons.items.length,2);
});
test('fixed login accepts only the exact requested account',()=>{
 const {validAdminCredentials}=require('../src/admin-login');
 process.env.UIRUN_ADMIN_ID='test-operator';process.env.UIRUN_ADMIN_PASSWORD='test-password';
 assert.equal(validAdminCredentials({id:'test-operator',password:'test-password'}),true);
 for(const x of [{id:'other',password:'test-password'},{id:'test-operator',password:'wrong'},{},{id:' test-operator',password:'test-password'}])assert.equal(validAdminCredentials(x),false);
 delete process.env.UIRUN_ADMIN_ID;delete process.env.UIRUN_ADMIN_PASSWORD;assert.equal(validAdminCredentials({id:'test-operator',password:'test-password'}),false);
});
