const P = require('./policy.cjs');
const V = require('./validation');
const DAY=86400000, KST=9*3600000;
const finished=s=>['COMPLETED','RECOVERED'].includes(s.status);
function validLegEntries(track=[]) {
 const legs=[];
 for(let i=1;i<track.length;i++) {
  const a=track[i-1],b=track[i],from=a.recordedAt??a.t,to=b.recordedAt??b.t,ms=to-from;
  if(![a.lat,a.lng,b.lat,b.lng,a.acc,b.acc,from,to].every(Number.isFinite)||a.segment!==b.segment||a.acc>30||b.acc>30||ms<=0||ms>60000)continue;
  const distanceM=P.distM([a.lat,a.lng],[b.lat,b.lng]);if(distanceM/(ms/1000)>12)continue;
  legs.push({a,b,leg:{from,to,ms,distanceM,segment:b.segment}});
 }
 return legs;
}
function validLegs(track=[]) {return validLegEntries(track).map(x=>x.leg);}
function trackDistance(track){return validLegs(track).reduce((n,l)=>n+l.distanceM,0);}
function elevationMetrics(track=[],entries=[]) {
 const unavailable=reason=>({elevationGainM:null,elevationUnavailableReason:reason});
 // Require ten retained samples and measured, bounded vertical accuracy at every usable endpoint.
 if(track.length<10)return unavailable('INSUFFICIENT_ALTITUDE_DATA');
 if(!entries.length)return unavailable('NO_VALID_SEGMENTS');
 const points=new Set(entries.flatMap(({a,b})=>[a,b]));
 for(const point of points)if(!Number.isFinite(point.altitudeM)||!Number.isFinite(point.altitudeAccuracyM))return unavailable('INSUFFICIENT_ALTITUDE_DATA');
 for(const point of points)if(point.altitudeAccuracyM<0||point.altitudeAccuracyM>15)return unavailable('LOW_ALTITUDE_ACCURACY');
 // Entries preserve original adjacent pairs: never connect across rejected legs or pause boundaries.
 return {elevationGainM:entries.reduce((gain,{a,b})=>gain+Math.max(0,b.altitudeM-a.altitudeM),0),elevationUnavailableReason:null};
}
function runMetrics(s) {
 const entries=validLegEntries(s.track),legs=entries.map(x=>x.leg),splits=[];let distanceM=0,splitM=0,splitMs=0,observedMs=0;
 for(const leg of legs){observedMs+=leg.ms;let left=leg.distanceM;if(left===0){splitMs+=leg.ms;continue;}
  while(left>1e-8){const take=Math.min(left,1000-splitM);splitM+=take;splitMs+=leg.ms*(take/leg.distanceM);distanceM+=take;left-=take;
   if(splitM>=1000-1e-8){splits.push({index:splits.length+1,distanceM:1000,durationMs:splitMs,paceSecPerKm:splitMs/1000,partial:false});splitM=0;splitMs=0;}
  }
 }
 if(splitM>1e-7)splits.push({index:splits.length+1,distanceM:splitM,durationMs:splitMs,paceSecPerKm:splitMs/splitM,partial:true});
 const end=s.endedAt??s.track?.at(-1)?.recordedAt??s.startedAt;
 return {validDistanceM:distanceM,observedMs,activeMs:s.activeMs||0,pauseMs:(s.pauses||[]).reduce((n,p)=>n+Math.max(0,Math.min(p.to??end,end)-p.from),0),averagePaceSecPerKm:s.distanceM>0?(s.activeMs||0)/s.distanceM:null,splits,paceSeries:splits.map(x=>({index:x.index,paceSecPerKm:x.paceSecPerKm})),unavailableReason:!s.track?.length?'NO_TRACK':legs.length===0?'NO_VALID_SEGMENTS':null,...elevationMetrics(s.track,entries)};
}
function workoutStats(sessions,uid,range='week',now=Date.now()) {
 if(!['week','month','year'].includes(range))V.fail('INVALID_ARGUMENT');
 const date=new Date(now+KST),today=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate());
 const empty=()=>({count:0,distanceM:0,activeMs:0,runCount:0,walkCount:0});
 const buckets=Array.from({length:range==='year'?12:range==='month'?30:7},(_,i)=>{
  const t=range==='year'?Date.UTC(date.getUTCFullYear(),date.getUTCMonth()-11+i,1):today-((range==='month'?29:6)-i)*DAY;
  return {key:new Date(t).toISOString().slice(0,range==='year'?7:10),...empty()};
 });
 const byKey=new Map(buckets.map(x=>[x.key,x]));const totals=empty(),period=empty();
 const add=(x,s)=>{x.count++;x.distanceM+=Math.max(0,s.distanceM||0);x.activeMs+=Math.max(0,s.activeMs||0);x[s.mode==='WALK'?'walkCount':'runCount']++;};
 for(const s of Object.values(sessions)){if(s.uid!==uid||!finished(s)||!Number.isFinite(s.startedAt)||s.startedAt>now)continue;add(totals,s);const key=new Date(s.startedAt+KST).toISOString().slice(0,range==='year'?7:10),b=byKey.get(key);if(b){add(b,s);add(period,s);}}
 return {range,timeZone:'Asia/Seoul',buckets,totals,period};
}
module.exports={validLegs,trackDistance,runMetrics,workoutStats,finished};
