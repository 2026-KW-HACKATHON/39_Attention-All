import {newsForHTML,participationPayload} from './contract-adapter.mjs?v=20261005-r3';
import {ensureSealed} from './capture.mjs?v=20261005-r3';
import {RefreshGate} from './refresh-gate.mjs?v=20261005-r3';
import {createClient} from './firebase-client.mjs?v=20261005-r3';
import {commit} from './operations.mjs?v=20261005-r3';
import {MutationQueue} from './queue.mjs?v=20261005-r3';
import {sessionForHTML,allPages} from './state-adapter.mjs?v=20261005-r3';
const U=window.U,S=U.S(),D=window.UIRUN_DATA,P=window.Policy,A=U.act,nav=U.nav;
let gpsStorage=null;try{gpsStorage=localStorage;}catch{}
const client=await createClient(),queue=new MutationQueue(client.invoke,null,gpsStorage),originalRender=U.render;
let controlling=false,generation=0,busy=false,watch=null,lastFix=null,buffer=[],storedCount=0,pauseStarted=null,lastEpoch=0,flushing=null,lastExposure=0,loginInProgress=false;
const refreshGate=new RefreshGate();
const requests=new Map(),routineStates=new Map(),snapshots={my:null,stats:null};
const localRoutineState=P.routineState;P.routineState=(db,uid,id,t)=>{const cached=routineStates.get(id);if(!db.routines[id])return {round:{id:'LOADING',start:0,end:0},mine:null,accounts:0,slotsLeft:0,welcomeToday:false,loading:true};return cached&&t<cached.round.end?cached:localRoutineState(db,uid,id,t);};
const err=e=>({ok:false,errorCode:e.message?.match(/^[A-Z_]+$/)?e.message:(e.details?.errorCode||e.message||'NETWORK'),details:e.details||{},retryable:/unavailable|internal|network|offline|deadline|fetch/i.test(e.code+' '+e.message)});
const attempt=async fn=>{try{return await fn();}catch(e){U.toast(U.errText(err(e)),'err');return null;}};
function clearPersonal(){refreshGate.invalidate();snapshots.stats=null;S.signedIn=false;S.consentAt=null;S.session=null;S.runs=[];S.localPhotos=[];S.db=P.emptyDb();S.db.users.me={displayName:'',uiMode:'DEFAULT',repeatObservationNotifications:false,welcomeStatus:'LOCKED'};S.db.catalog.WELCOME_500={title:'준비 중',condition:'혜택 운영 준비 중',stock:0,isDemo:true,validDays:30};S.demo={...S.demo,locSource:'real',speed:1,offline:false,timeShift:0};buffer=[];storedCount=0;pauseStarted=null;lastEpoch=0;lastExposure=0;snapshots.my=null;requests.clear();routineStates.clear();if(watch!==null){navigator.geolocation.clearWatch(watch);watch=null;}lastFix=null;}
clearPersonal();U.now=()=>Date.now();U.save=()=>{};U.saveNow=()=>true;U.reset=()=>{throw Error('REMOTE_RESET_DISABLED');};
P.balance=()=>snapshots.my?.pointsBalance||0;P.pendingSum=()=>snapshots.my?.pointsPending||0;P.welcomeCount=()=>snapshots.my?.welcomeCount||0;P.budget=()=>snapshots.my?.budget||{base:0,quick:0};P.expirePending=()=>false;
U.issueOld=(i,t)=>i.lifecycleStatus!=='OPEN'||!!(i.eventEndsAt&&t>=i.eventEndsAt)||t-(i.lastPhotoObservedAt||i.createdAt)>P.CAT[i.categoryCode].staleH*P.H;
U.render=()=>{originalRender();document.querySelectorAll('.rd-my-profile p,.profile-row .pr-main span').forEach(el=>{if(S.signedIn)el.textContent='Firebase 계정 · 서버에 기록 중';});document.querySelectorAll('.rd-my-footnote').forEach(el=>el.textContent='우이런 · 서버 연결 버전');document.querySelectorAll('.t-micro').forEach(el=>{if(el.textContent==='최대 20자 · 이 기기에 저장돼요')el.textContent='최대 20자 · 계정에 저장돼요';});document.querySelectorAll('[data-act="demo"],[data-act^="demo-"]').forEach(el=>el.hidden=true);};
async function refresh(){const latest=refreshGate.start(),gen=generation,uid=client.auth.currentUser?.uid;
 const [home,mapIssues,map,pilot,news]=await Promise.all([client.invoke('getHome'),allPages(client.invoke,'getMapData','issues'),client.invoke('getMapData'),client.invoke('getPilotData'),allPages(client.invoke,'getRiverFeed','news','newsCursor')]);
 let privateData=null;if(uid){const [my,settings,runs,obs,ownIssues,ledger,benefits,stats]=await Promise.all([client.invoke('getMy'),client.invoke('getSettings'),allPages(client.invoke,'getRecords','runs','runsCursor'),allPages(client.invoke,'getRecords','participations','participationsCursor'),allPages(client.invoke,'getRecords','issues','issuesCursor'),allPages(client.invoke,'getLedger'),client.invoke('getBenefits'),client.invoke('getWorkoutStats',{range:S.recRange||'week'})]);privateData={my,settings,runs,obs,ownIssues,ledger,benefits,stats};}
 if(gen!==generation||!latest())return;
 for(const i of mapIssues){if(i.publicPhoto?.id){try{const p=await client.invoke('getPublicPhotoAccess',{photoId:i.publicPhoto.id});i.publicPhoto={...i.publicPhoto,src:p.url};}catch{i.publicPhoto=null;}}}if(gen!==generation||!latest())return;
 S.db.issues=Object.fromEntries(mapIssues.map(i=>[i.id,{...i,creatorUid:null,photoAccounts:[],observationAnchors:i.observationAnchors||[i.anchor]}]));
 for(const [key,rows]of [['COURSES',home.courses],['FACILITIES',map.facilities],['ROUTINES',map.routines],['NEWS',news.map(newsForHTML)]]){D[key].splice(0,D[key].length,...rows);}
 for(const c of D.COURSES){c.photo=c.photo||(D.PHOTOS?.[c.id]?c.id:'hero');c.cum=[0];for(let i=1;i<c.out.length;i++)c.cum.push(c.cum.at(-1)+P.distM(c.out[i-1],c.out[i]));c.len=c.cum.at(-1);}
 if(D.COURSES.length&&!D.COURSES.some(c=>c.id===S.courseId))S.courseId=D.COURSES[0].id;
 S.db.routines=Object.fromEntries(map.routines.map(r=>[r.id,{...r,rounds:{}}]));
 if(privateData){const states=await Promise.all(map.routines.map(r=>client.invoke('getRoutineDetail',{missionId:r.id})));if(gen!==generation||!latest())return;for(const r of states)if(r.state)routineStates.set(r.id,r.state);const v=privateData;await reconcilePending(v,gen);if(gen!==generation||!latest())return;snapshots.my=v.my;snapshots.stats=v.stats;S.signedIn=true;S.consentAt=v.settings.consent?.version==='v2-2026-10'?v.settings.consent.acceptedAt:null;S.db.users.me={...v.my};S.uiMode=v.my.uiMode;
  for(const i of v.ownIssues)S.db.issues[i.id]={...i,creatorUid:'me',photoAccounts:[],observationAnchors:i.observationAnchors||[i.anchor]};
  for(const o of v.obs){if(o.photo?.id){try{o.photo=(await client.invoke('getPhotoAccess',{photoId:o.photo.id})).url;}catch{o.photo=null;}}}if(gen!==generation||!latest())return;S.db.obs=Object.fromEntries(v.obs.map(o=>[o.id,{...o,uid:'me'}]));S.db.ledger=v.ledger.map(l=>({...l,uid:'me'}));S.db.contributions=Object.fromEntries(v.benefits.contributions.map((c,i)=>[c.id||i,{...c,uid:'me'}]));S.db.routineWelcomeDays=Object.fromEntries(v.benefits.routineDays.map(day=>['me|'+day,true]));S.db.merchants=Object.fromEntries(v.benefits.merchants.map(m=>[m.id,m]));S.db.coupons=v.benefits.coupons.map(c=>({...c,uid:'me'}));S.db.catalog=Object.fromEntries(v.benefits.catalog.map(c=>[c.id||'WELCOME_500',c]));S.db.catalog.WELCOME_500={title:'준비 중',condition:'혜택 운영 준비 중',stock:0,isDemo:true,validDays:30,...S.db.catalog.WELCOME_500};
  S.runs=v.runs.map(r=>{const old=S.runs.find(x=>x.id===r.id);return old?.samples?.length?{...old,...r}:sessionForHTML(r)});
  S.db.quickMarkers={};S.db.photoGuards={};for(const o of v.obs){if(o.visibility==='HIDDEN')continue;if(o.modality==='QUICK')S.db.quickMarkers['me|'+o.issueId+'|'+P.kstDay(o.observedAt)]=o.id;else if(o.issueId)S.db.photoGuards['me|'+o.issueId]=Math.max(S.db.photoGuards['me|'+o.issueId]||0,o.observedAt);}
  if(v.my.activeSession&&!S.session){const detail=await client.invoke('getRunDetail',{sessionId:v.my.activeSession});if(gen!==generation||!latest())return;S.session=sessionForHTML(detail);for(const ex of detail.exposures||[])S.db.exposures[ex.id]=ex;storedCount=detail.track.length;const last=detail.track.at(-1)?.recordedAt??detail.startedAt-1;const pending=queue.pending.filter(o=>o.name==='appendTrack'&&o.payload.sessionId===detail.id).flatMap(o=>o.payload.points).filter(p=>p.recordedAt>last).map(p=>({...p,acc:p.accuracyM,t:p.recordedAt,segment:detail.pauses.filter(a=>a.to!=null&&p.recordedAt>=a.to).length}));const points=[...detail.track,...pending].sort((a,b)=>a.recordedAt-b.recordedAt);S.session=sessionForHTML({...detail,track:points});S.session.syncPending=queue.pending.some(o=>o.payload.sessionId===detail.id);S.session.saveFailed=!!pending.length&&(!queue.storage||queue.persistenceFailed);lastEpoch=points.at(-1)?.recordedAt??detail.startedAt-1;pauseStarted=detail.status==='ACTIVE'?Date.now():null;}
 }
 U.render();return home;
}
async function reconcilePending(v,gen){
 if(!queue.pending.length||queue.running)return;
 const closed=new Set(v.runs.filter(r=>['COMPLETED','RECOVERED'].includes(r.status)).map(r=>r.id));
 const ids=new Set(queue.pending.filter(o=>o.name==='appendTrack').map(o=>o.payload.sessionId));
 for(const id of ids){
  if(id===v.my.activeSession||closed.has(id))continue;
  try{const detail=await client.invoke('getRunDetail',{sessionId:id});if(['COMPLETED','RECOVERED','DISCARDED'].includes(detail.status))closed.add(id);}
  catch(e){if(e.details?.errorCode==='NOT_FOUND'||e.message==='NOT_FOUND')closed.add(id);}
  if(gen!==generation)return;
 }
 if(gen!==generation||queue.running)return;
 const previous=queue.pending.length;queue.remove(o=>o.name==='appendTrack'&&closed.has(o.payload.sessionId));
 if(previous!==queue.pending.length)U.toast('서버에서 종료된 운동의 전송 대기 위치를 정리했어요');
}
async function mutation(name,data={},key){if(!client.auth.currentUser)throw Error('UNAUTHENTICATED');const gen=generation;return commit(client.invoke,requests,name,data,refresh,()=>U.toast('저장했지만 화면 갱신이 지연돼요. 다시 불러와 주세요'),key,()=>gen===generation);}
U.api=async(name,payload)=>{try{const data=['createIssue','submitQuick','submitPhotoRecheck','addDiscoveryPhoto','submitRoutine'].includes(name)?participationPayload(payload,S.session?.id):{...payload};if(data.ticket){data.ticketId=data.ticket.id;delete data.ticket;}delete data.photo;for(const k of Object.keys(data))if(data[k]===undefined||data[k]===null)delete data[k];if(payload.photo&&payload.ticket)await uploadPhoto(payload.ticket,payload.photo);return await mutation(name,data);}catch(e){return err(e);}};
U.loadWeather=async()=>{try{const w=await client.invoke('getWeather');Object.assign(U.WX,{forecast:{status:w.status,data:w.forecast,fetchedAt:w.fetchedAt},air:{status:w.status,data:w.air,fetchedAt:w.fetchedAt},loading:{forecast:false,air:false}});U.render();}catch{}};
U.sheets.login=()=>U.sheetHead('로그인')+'<div class="sheet-body"><p class="t-body">운동과 참여 기록을 계정에 저장해요.</p><button class="btn btn-line btn-google" data-act="google">'+(client.emulator?'로컬 테스트 계정으로 계속':'Google 계정으로 계속')+'</button><button class="link-btn" data-act="back">둘러보기 계속</button></div>';
A.google=()=>attempt(async()=>{if(loginInProgress)return;const then=nav.top()?.p.then;loginInProgress=true;try{await client.login();const uid=client.auth.currentUser?.uid,gen=generation;if(!uid)return;const updated=await refresh();if(gen!==generation||client.auth.currentUser?.uid!==uid||!updated)return;if(!S.consentAt)nav.replace('screen','consent',{then,agree:{},title:'약관 동의'});else nav.back(()=>then?.());}finally{loginInProgress=false;}});
A['consent-ok']=()=>attempt(async()=>{const top=nav.top();if(!['tos','privacy','lbs'].every(k=>top.p.agree[k]))return;await mutation('recordConsent',{version:'v2-2026-10',accepted:true});nav.back(()=>top.p.then?.());});
A['profile-save']=async()=>{const e=nav.top();if(e.p.busy)return;const value=(document.getElementById('profile-name')||document.querySelector('[data-input="value"]')).value;e.p.value=value;e.p.busy=true;e.p.err=null;U.render();const r=await U.api('updateProfile',{displayName:value});e.p.busy=false;if(!r.ok){e.p.err=U.errText(r);return U.render();}nav.back(()=>U.toast(r.displayName?'이름을 저장했어요':'이름을 비웠어요','ok'));};
A.toggle=el=>attempt(async()=>{if(!S.signedIn)return A.login();await mutation('updateSettings',el.dataset.v==='simple'?{uiMode:el.checked?'SIMPLE':'DEFAULT'}:{repeatObservationNotifications:el.checked});});A['ui-mode']=el=>attempt(()=>mutation('updateSettings',{uiMode:el.dataset.v}));A['simple-off']=()=>attempt(()=>mutation('updateSettings',{uiMode:'DEFAULT'}));
A['delete-account']=()=>attempt(async()=>{const result=await U.sys('<h2>계정과 데이터를 삭제할까요?</h2><p>서버에 삭제를 요청하며 처리 중에는 계정 이용이 제한돼요.</p><div class="sys-actions"><button data-sys="no">취소</button><button data-sys="yes">삭제 요청</button></div>');if(result.v!=='yes')return;await client.invoke('deleteMyAccountData',{confirm:true,clientRequestId:crypto.randomUUID()});await client.logout();clearPersonal();nav.clear(()=>U.toast('서버에서 계정 삭제를 처리 중이에요'));});
const oldTab=A.tab;A.tab=el=>{oldTab(el);return attempt(refresh);};A['record-range']=el=>attempt(async()=>{S.recRange=el.dataset.v;await refresh();});
const oldScreen=A.screen;A.screen=el=>attempt(async()=>{if(['record','summary'].includes(el.dataset.v))await hydrateRun(el.dataset.id);else if(['ledger','welcome','coupon','privacy'].includes(el.dataset.v)&&S.signedIn)await refresh();oldScreen(el);});
async function hydrateRun(id){const gen=generation,uid=client.auth.currentUser?.uid;const r=await client.invoke('getRunDetail',{sessionId:id});const linked=await allPages(data=>client.invoke('getRunDetail',{sessionId:id,...data}),'getRunDetail','participations');if(gen!==generation||uid!==client.auth.currentUser?.uid)throw Error('SESSION_CHANGED');const linkedIds=new Set(linked.map(o=>o.id));for(const [key,o] of Object.entries(S.db.obs))if(o.sessionId===id&&!linkedIds.has(o.id))delete S.db.obs[key];for(const o of linked)S.db.obs[o.id]={...S.db.obs[o.id],...o,uid:'me',photo:S.db.obs[o.id]?.photo||null};for(const ex of r.exposures||[])S.db.exposures[ex.id]=ex;const mapped=sessionForHTML(r);const i=S.runs.findIndex(x=>x.id===id);i<0?S.runs.push(mapped):S.runs.splice(i,1,mapped);return mapped;}
A.record=el=>attempt(async()=>{await hydrateRun(el.dataset.id);nav.push('screen','record',{id:el.dataset.id});});
A['record-open']=el=>attempt(async()=>{await hydrateRun(el.dataset.id);nav.replace('screen','record',{id:el.dataset.id});});
U.openIssue=id=>attempt(async()=>{const gen=generation;const data=await client.invoke('getIssueDetail',{issueId:id});if(data.issue.publicPhoto?.id){try{const p=await client.invoke('getPublicPhotoAccess',{photoId:data.issue.publicPhoto.id});data.issue.publicPhoto={...data.issue.publicPhoto,src:p.url};}catch{data.issue.publicPhoto=null;}}if(gen!==generation)return;S.db.issues[id]={...data.issue,creatorUid:data.own?'me':null,photoAccounts:[]};nav.push('sheet','issue',{id,tall:true});});
A.routine=el=>attempt(async()=>{const gen=generation;const v=await client.invoke('getRoutineDetail',{missionId:el.dataset.id});if(gen!==generation)return;S.db.routines[v.id]={...S.db.routines[v.id],...v};if(v.state)routineStates.set(v.id,v.state);nav.push('sheet','routine',{id:v.id,tall:true});});
function position(p){lastFix={lat:p.coords.latitude,lng:p.coords.longitude,accuracyM:p.coords.accuracy,measuredAt:p.timestamp,precise:true};S.perms.location=lastFix.accuracyM<=30?'precise':'approx';S.sim.pos=[lastFix.lat,lastFix.lng];const s=S.session;if(s?.status==='ACTIVE'&&!controlling&&lastFix.measuredAt>lastEpoch){if(s.track.length>=5000){if(!s.trackLimit){s.trackLimit=true;U.toast('위치 기록 한도에 도달했어요. 운동을 저장하고 종료해주세요');attempt(()=>control('pauseRun'));}return;}lastEpoch=lastFix.measuredAt;queue.add('appendTrack',{sessionId:s.id,points:[{...lastFix,recordedAt:lastFix.measuredAt,altitudeM:p.coords.altitude,altitudeAccuracyM:p.coords.altitudeAccuracy}]});const pausedMs=(s.pauses||[]).reduce((n,p)=>n+Math.max(0,Math.min(lastFix.measuredAt,p.to??lastFix.measuredAt)-p.from),0);s.track.push({lat:lastFix.lat,lng:lastFix.lng,acc:lastFix.accuracyM,recordedAt:lastFix.measuredAt,segment:(s.pauses||[]).filter(p=>p.to!=null&&lastFix.measuredAt>=p.to).length,t:lastFix.measuredAt-s.startedAt-pausedMs,gap:s.gapNext});s.saveFailed=!queue.storage||queue.persistenceFailed;s.syncPending=true;s.gapNext=false;if(queue.pending.length>=10)flushTrack().catch(e=>{s.syncPending=true;U.toast(U.errText(err(e)),'err')});}}
U.loc=()=>lastFix;U.askLocation=async()=>{await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(p=>{position(p);resolve();},reject,{enableHighAccuracy:true,maximumAge:0,timeout:15000}));if(watch===null)watch=navigator.geolocation.watchPosition(position,()=>{lastFix=null;},{enableHighAccuracy:true,maximumAge:0,timeout:15000});return S.perms.location;};U.watchReal=()=>{};
U.askNotif=async()=>{S.perms.notif='denied';return 'denied';};
U.startWorkout=modeOverride=>attempt(async()=>{if(['RUN','WALK'].includes(modeOverride))S.mode=modeOverride;if(!S.signedIn)return nav.push('sheet','login',{then:U.startWorkout});if(!S.consentAt)return nav.push('screen','consent',{agree:{},then:U.startWorkout});if(S.session)return nav.push('sheet','resume',{});await U.askLocation();const r=await mutation('startRun',{mode:S.mode,courseId:S.courseId,loc:U.loc()});if(!S.session)S.session=sessionForHTML({id:r.sessionId,mode:S.mode,courseId:S.courseId,status:'ACTIVE',startedAt:r.startedAt,activeMs:0,track:[],pauses:[],exposureIds:[],distanceM:0});storedCount=S.session.track.length;buffer=[];pauseStarted=null;lastEpoch=r.startedAt-1;nav.push('screen','run',{dark:S.mode==='RUN',title:'운동 중'});});
function flushTrack(){if(flushing)return flushing;if(!S.session)return Promise.resolve();const sessionId=S.session.id;flushing=(async()=>{while(buffer.length){const points=buffer.slice(0,100);queue.add('appendTrack',{sessionId,points});buffer.splice(0,points.length);}await queue.flush();const r=await client.invoke('getRunDetail',{sessionId});if(S.session?.id!==sessionId)return;storedCount=r.track.length;S.session.distanceM=r.distanceM;S.session.syncPending=queue.pending.some(o=>o.payload.sessionId===sessionId);S.session.saveFailed=S.session.syncPending&&(!queue.storage||queue.persistenceFailed);})().finally(()=>{flushing=null;});return flushing;}
async function control(name){
 if(controlling)throw Error('REQUEST_IN_PROGRESS');
 controlling=true;const gen=generation;
 const valid=()=>{if(gen!==generation)throw Error('ACCOUNT_CHANGED');};
 try{
  if(flushing){try{await flushing;}catch{}}valid();
  const s=S.session;if(!s)throw Error('INVALID_STATE');
  if(name==='discardRun')queue.remove(o=>o.payload.sessionId===s.id);
  else if(name==='finishRun'&&P.sessionAgeRule(s.startedAt,Date.now())!=='RESUME'&&queue.pending.some(o=>o.payload.sessionId===s.id)){
   const answer=await U.sys('<h2>저장되지 않은 경로가 있어요</h2><p>기록 재개 가능 시간이 지나 대기 중인 위치를 전송할 수 없어요. 서버에 저장된 부분만 종료할까요?</p><div class="sys-actions"><button data-sys="no">돌아가기</button><button data-sys="yes">저장된 기록만 종료</button></div>');valid();
   if(answer.v!=='yes')return;queue.remove(o=>o.payload.sessionId===s.id);await flushTrack();
  }else await flushTrack();
  valid();const result=await mutation(name,{sessionId:s.id,...(name==='finishRun'?{expectedTrackCount:storedCount}:{})});valid();
  if(name==='pauseRun')S.session.status='PAUSED';
  if(name==='resumeRun'){S.session.status='ACTIVE';S.session.gapNext=true;}
  let detail;try{detail=await client.invoke('getRunDetail',{sessionId:s.id});}catch(e){
   valid();
   if(['COMPLETED','RECOVERED','DISCARDED'].includes(result.status)){S.session=null;nav.clear(()=>U.toast('서버에서 운동을 종료했어요. 기록 탭에서 다시 확인해주세요'));return result;}
   if(['pauseRun','resumeRun'].includes(name)){S.session.syncPending=true;U.render();U.toast('운동 상태는 저장됐어요. 상세 갱신을 다시 확인해주세요');return result;}
   throw e;
  }
  valid();
  if(['COMPLETED','RECOVERED','DISCARDED'].includes(detail.status)){
   S.session=null;buffer=[];pauseStarted=null;
   if(name==='finishRun'){
    try{await hydrateRun(s.id);}catch{valid();S.runs.push(sessionForHTML(detail));}valid();
    nav.clear(()=>nav.push('screen','summary',{id:s.id,title:'운동 완료'}));
   }else nav.clear(()=>U.toast('운동 기록을 폐기했어요'));
  }else{S.session=sessionForHTML(detail);pauseStarted=detail.status==='ACTIVE'?Date.now():null;U.render();}
  return result;
 }finally{controlling=false;}
}
A['run-pause']=()=>attempt(()=>control('pauseRun'));A['run-resume']=()=>attempt(()=>control('resumeRun'));A['run-finish']=()=>attempt(()=>control('finishRun'));A['run-discard']=()=>attempt(()=>control('discardRun'));A['run-cancel']=A['run-discard'];A['resume-save']=A['run-finish'];A['resume-recover']=A['run-finish'];A['resume-discard']=A['run-discard'];A['resume-go']=()=>attempt(async()=>{await U.askLocation();if(S.session?.status==='PAUSED')await control('resumeRun');nav.replace('screen','run',{dark:S.session?.mode==='RUN',title:'운동 중'});});A['run-force']=()=>U.toast('실제 위치가 확인된 뒤 시작할 수 있어요');
U.tick=()=>{const s=S.session;if(s?.status==='ACTIVE'){const now=Date.now();if(!pauseStarted)pauseStarted=now;s.activeMs+=Math.max(0,now-pauseStarted);pauseStarted=now;for(const [id,text]of [['r-time',U.fmt.dur(s.activeMs)],['r-mini',U.fmt.dur(s.activeMs)],['r-dist',U.fmt.km(s.distanceM)],['r-pace',U.fmt.pace(s.activeMs,s.distanceM)]]){const el=document.getElementById(id);if(el)el.textContent=text;}if(queue.pending.length&&now-lastExposure>10000&&!flushing){lastExposure=now;const gen=generation;const current=()=>gen===generation&&S.session===s&&s.status==='ACTIVE';flushTrack().then(()=>current()?client.invoke('recordMissionExposure',{sessionId:s.id,loc:U.loc(),clientRequestId:crypto.randomUUID()}):null).then(r=>{if(current()&&r?.exposure){S.db.exposures[r.exposure.id]=r.exposure;s.alertId=r.exposure.id;U.render();}}).catch(()=>{if(current())s.syncPending=true;});}}else pauseStarted=null;const runView=nav.stack.find(e=>e.name==='run');if(runView&&S.session)U.after.run(runView);U.liveTick();};
async function uploadPhoto(ticket,dataUrl){if(ticket.uploaded)return;await ensureSealed(ticket,data=>mutation('sealCapture',data));let status=await client.invoke('getPhotoStatus',{ticketId:ticket.id});if(status.status==='READY'){ticket.uploaded=true;return;}if(status.status==='FAILED')throw Error('UPLOAD_FAILED');if(!ticket.uploadStarted){ticket.uploadStarted=true;try{const blob=await fetch(dataUrl).then(r=>r.blob());await client.upload(ticket.uploadPath,blob);}catch(e){ticket.uploadStarted=false;throw e;}}for(let i=0;i<40;i++){const r=await client.invoke('getPhotoStatus',{ticketId:ticket.id});if(r.status==='READY'){ticket.uploaded=true;return;}if(r.status==='FAILED')throw Error('UPLOAD_FAILED');await new Promise(r=>setTimeout(r,750));}throw Error('PHOTO_PROCESSING');}
const oldCameraAfter=U.after.camera,oldShoot=A['cam-shoot'],oldRetake=A['cam-retake'];
async function ticketFor(e){const p=e.p;try{await U.askLocation();const r=await mutation('issueCaptureTicket',{purpose:p.purpose,...(p.targetId?{targetId:p.targetId}:{}),...(p.cat?{categoryCode:p.cat}:{}),loc:U.loc()});p.ticket={id:r.ticketId,issuedAt:r.expiresAt-15*P.MIN,uploadPath:r.uploadPath,purpose:p.purpose,targetId:p.targetId};p.ticketErr=false;}catch{p.ticket=null;p.ticketErr=true;}p.renewing=false;U.render();}
U.after.camera=oldCameraAfter;
A['cam-ticket']=()=>ticketFor(nav.top());A['cam-demo']=()=>U.toast('서버 연결 버전에서는 실제 카메라로 촬영해주세요');
A['cam-shoot']=()=>attempt(async()=>{const e=nav.top();if(e.p.phase!=='live'||!e.p.ticket||!e.p.ticket.uploadPath)throw Error('PHOTO_REQUIRED');oldShoot();if(!e.p.photo)return;const ticket=e.p.ticket;ticket.sealData={ticketId:ticket.id,loc:structuredClone(ticket.shutterLoc)};await ensureSealed(ticket,data=>mutation('sealCapture',data));});
A['cam-retake']=()=>{const e=nav.top();e.p.ticket=null;oldRetake();};
// All receipt-backed operations use the same ticket, captured image and request ID on network retry.
A.logout=()=>attempt(()=>client.logout());
window.UIRUN_REMOTE={client,refresh,queue,snapshots,ticketFor};
client.onUser(async user=>{const gen=++generation;queue.setUser(user?.uid||null);clearPersonal();nav.stack.splice(0);history.replaceState({d:0},'');try{await refresh();if(gen!==generation)return;if(user&&!S.consentAt&&!loginInProgress)nav.push('screen','consent',{agree:{},title:'약관 동의'});}catch(e){if(gen!==generation)return;U.render();U.toast(U.errText(err(e)),'err');}});
U.boot();
