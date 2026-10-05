// Emulation only: never used for production signing or production photo delivery.
const {createHmac,timingSafeEqual}=require('node:crypto');
const KEY='demo-uirun-disposable-emulator-photo-signing-v1';
const mac=x=>createHmac('sha256',KEY).update(x).digest('base64url');
function signLocalPhoto(uid,photoId,now=Date.now(),kind){const body=Buffer.from(JSON.stringify({uid,photoId,expiresAt:now+300000,...(kind?{kind}:{})})).toString('base64url');return body+'.'+mac(body)}
function verifyLocalPhoto(token,now=Date.now()){const [body,sig,...rest]=String(token).split('.');const a=Buffer.from(sig||''),b=Buffer.from(mac(body||''));if(rest.length||a.length!==b.length||!timingSafeEqual(a,b))throw Error('INVALID_TOKEN');const x=JSON.parse(Buffer.from(body,'base64url').toString());if(!x.uid||!x.photoId||now>=x.expiresAt)throw Error('EXPIRED_TOKEN');return x}
module.exports={signLocalPhoto,verifyLocalPhoto};
