const V=require('./validation');const {randomUUID}=require('node:crypto');
const MUTATIONS=['upsertNews','setNewsPublished'];
const NEWS_METADATA={topic:20,status:80,kind:20,source:160,date:10,dateKind:40,pub:10,pubKind:40,checked:10,event:200,summary:2000};
function newsMetadata(x,old){
 const metadata={};
 for(const [key,max] of Object.entries(NEWS_METADATA)){
  if(!Object.hasOwn(x,key)){if(old&&Object.hasOwn(old,key))metadata[key]=old[key];continue;}
  if(x[key]===null){metadata[key]=null;continue;}
  const value=V.text(x[key],max);
  if(key==='topic'&&!['eco','proposal','plan'].includes(value))V.fail('INVALID_ARGUMENT');
  if(key==='kind'&&!['official','council','press','citizen'].includes(value))V.fail('INVALID_ARGUMENT');
  if(['date','pub','checked'].includes(key)){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(x[key]))V.fail('INVALID_ARGUMENT');
   const time=Date.parse(value+'T00:00:00Z');
   if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==value)V.fail('INVALID_ARGUMENT');
  }
  metadata[key]=value;
 }
 return metadata;
}
function mutate(d,auth,name,x,now){
 if(!auth.admin)V.fail('PERMISSION_DENIED');const id=V.text(x.id,80);
 if(name==='upsertNews'){
  const old=d.news[id],title=V.text(x.title,160),body=V.text(x.body,10000);let sourceUrl=Object.hasOwn(x,'sourceUrl')?null:(old?.sourceUrl??null);
  if(x.sourceUrl){try{const u=new URL(x.sourceUrl);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error();sourceUrl=u.href;}catch{V.fail('INVALID_ARGUMENT');}}
  const metadata=newsMetadata(x,old);d.news[id]={id,title,body,sourceUrl,type:V.text(x.type||'NOTICE',40),...metadata,published:old?.published??false,publishedAt:old?.publishedAt??null,createdAt:old?.createdAt??now,updatedAt:now};
 }else{if(typeof x.published!=='boolean')V.fail('INVALID_ARGUMENT');if(!d.news[id])V.fail('NOT_FOUND');d.news[id].published=x.published;if(x.published&&!d.news[id].publishedAt)d.news[id].publishedAt=now;d.news[id].updatedAt=now;}
 const auditId=randomUUID();d.adminAudits[auditId]={id:auditId,uid:auth.uid,action:name,targetId:id,at:now};return {ok:true,id};
}
module.exports={MUTATIONS,mutate};
