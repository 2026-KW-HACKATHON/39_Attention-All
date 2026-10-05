import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,connectAuthEmulator,GoogleAuthProvider,signInWithPopup,signInAnonymously,signOut,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {getFunctions,connectFunctionsEmulator,httpsCallable} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js';
import {getStorage,connectStorageEmulator,ref,uploadBytes} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js';
import {initializeAppCheck,ReCaptchaEnterpriseProvider} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app-check.js';
export async function createClient(){
 const local=/^(localhost|127\.0\.0\.1)$/.test(location.hostname),emulator=local&&new URLSearchParams(location.search).get('emulator')==='1';
 const config=emulator?{projectId:'demo-uirun',apiKey:'demo-key',authDomain:'demo-uirun.firebaseapp.com',storageBucket:'demo-uirun.appspot.com'}:await fetch('./firebase-config.json').then(r=>{if(!r.ok)throw Error('CONFIG_MISSING');return r.json()});
 const app=initializeApp(config),auth=getAuth(app),functions=getFunctions(app,'asia-northeast3'),storage=getStorage(app);
 if(emulator){connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});connectFunctionsEmulator(functions,'127.0.0.1',5001);connectStorageEmulator(storage,'127.0.0.1',9199);}else{const c=await fetch('./appcheck-config.json').then(r=>r.json());initializeAppCheck(app,{provider:new ReCaptchaEnterpriseProvider(c.siteKey),isTokenAutoRefreshEnabled:true});}
 const invoke=async(name,payload={})=>(await httpsCallable(functions,name)(payload)).data;
 return {auth,emulator,config,invoke,login:()=>emulator?signInAnonymously(auth):signInWithPopup(auth,new GoogleAuthProvider()),logout:()=>signOut(auth),onUser:fn=>onAuthStateChanged(auth,fn),upload:(path,blob)=>uploadBytes(ref(storage,path),blob,{contentType:'image/jpeg'})};
}
