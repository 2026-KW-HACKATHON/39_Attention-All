const test=require('node:test'),assert=require('node:assert/strict');
const {signLocalPhoto,verifyLocalPhoto}=require('../src/local-photo');
test('local photo token expires and rejects tampering',()=>{const t=signLocalPhoto('u','p',1000);assert.deepEqual(verifyLocalPhoto(t,1001),{uid:'u',photoId:'p',expiresAt:301000});assert.throws(()=>verifyLocalPhoto(t,301000));assert.throws(()=>verifyLocalPhoto(t+'x',1001));});
