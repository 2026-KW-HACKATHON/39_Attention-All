// Emulation only: never used for production signing or production photo delivery.
const {createHmac,timingSafeEqual}=require('node:crypto');
const KEY='demo-uirun-disposable-emulator-photo-signing-v1';
const mac=x=>createHmac('sha256',KEY).update(x).digest('base64url');
function signLocalPhoto(uid,photoId,now=Date.now(),kind){const body=Buffer.from(JSON.stringify({uid,photoId,expiresAt:now+300000,...(kind?{kind}:{})})).toString('base64url');return body+'.'+mac(body)}
function verifyLocalPhoto(token,now=Date.now()){const [body,sig,...rest]=String(token).split('.');const a=Buffer.from(sig||''),b=Buffer.from(mac(body||''));if(rest.length||a.length!==b.length||!timingSafeEqual(a,b))throw Error('INVALID_TOKEN');const x=JSON.parse(Buffer.from(body,'base64url').toString());if(!x.uid||!x.photoId||now>=x.expiresAt)throw Error('EXPIRED_TOKEN');return x}
// Emulator 사진 URL의 호스트: 요청이 들어온 Host(Android Emulator는 10.0.2.2:5001, 실기기는 PC의 LAN 주소)를 쓴다.
// 형식이 이상하면 기존 기본값. demo-uirun Emulator 분기에서만 부른다(운영 signed URL과 무관).
function localPhotoBase(req){const h=String(req?.rawRequest?.headers?.host||'');return 'http://'+(/^[A-Za-z0-9.-]{1,253}:\d{2,5}$/.test(h)?h:'127.0.0.1:5001')}
module.exports={signLocalPhoto,verifyLocalPhoto,localPhotoBase};
