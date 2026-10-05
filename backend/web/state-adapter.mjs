export function sessionForHTML(s){
 const points=s.track||[],segs=[];let lastEnd=-1;
 const distance=(a,b)=>{const rad=x=>x*Math.PI/180;const dlat=rad(b.lat-a.lat),dlng=rad(b.lng-a.lng),v=Math.sin(dlat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dlng/2)**2;return 6371000*2*Math.atan2(Math.sqrt(v),Math.sqrt(1-v));};
 for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],from=a.recordedAt??a.t,to=b.recordedAt??b.t,ms=to-from;
  if(![a.lat,a.lng,b.lat,b.lng,a.acc,b.acc,from,to].every(Number.isFinite)||a.segment!==b.segment||a.acc>30||b.acc>30||ms<=0||ms>60000||distance(a,b)/(ms/1000)>12)continue;
  if(lastEnd===i-1)segs.at(-1).push([b.lat,b.lng]);else segs.push([[a.lat,a.lng],[b.lat,b.lng]]);lastEnd=i;
 }
 const samples=points.map((p,i)=>{const at=p.recordedAt??p.t,pause=(s.pauses||[]).reduce((n,q)=>n+Math.max(0,Math.min(at,q.to??at)-q.from),0);return {...p,t:Math.max(0,at-s.startedAt-pause),gap:i>0&&p.segment!==points[i-1].segment};});
 const coveredMs=s.metrics?.observedMs||0;
 return {...s,laps:(s.metrics?.splits||[]).filter(p=>!p.partial||p.distanceM>=10).map(p=>({distM:p.distanceM,sec:p.durationMs/1000,partial:!!p.partial})),quality:{coveredMs,noDistance:(s.distanceM||0)<1,incomplete:!!s.metrics&&(s.distanceM||0)>=1&&(s.activeMs||0)-coveredMs>Math.max(60000,(s.activeMs||0)*.1)},splits:(s.metrics?.splits||[]).filter(p=>!p.partial).map(p=>({km:p.index,sec:p.durationMs/1000})),climb:s.metrics?.elevationGainM??null,samples,segs,track:samples,pauseMs:s.metrics?.pauseMs||(s.pauses||[]).reduce((n,p)=>n+(p.to?p.to-p.from:0),0),sim:false,serverStartedAt:s.startedAt,syncPending:false,localOnly:false,stateSeq:0,alertId:null,progressM:0};
}
export async function allPages(invoke,name,field,cursorField='cursor'){
 const rows=[],seen=new Set();let cursor=null;
 do{const result=await invoke(name,{limit:50,...(cursor?{[cursorField]:cursor}:{})}),page=field?result[field]:result;for(const row of page.items)if(!seen.has(row.id)){seen.add(row.id);rows.push(row);}cursor=page.nextCursor;}while(cursor);return rows;
}
