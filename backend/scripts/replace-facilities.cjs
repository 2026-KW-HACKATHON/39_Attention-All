// 시설 컬렉션만 원자적으로 교체한다. --apply 전 백업과 문서별 변경 충돌 검사를 한다.
const fs=require('node:fs');const path=require('node:path');const {isDeepStrictEqual}=require('node:util');
const {connect,project}=require('./cloud-client.cjs');const {decode,encode}=require('./expand-wolgye2.cjs');
const rows=require('../data/uicheon-facilities.json');const {execute,initialState}=require('../functions/src/service');
async function main(){
 const client=(await connect())('https://firestore.googleapis.com','v1');const base=`/projects/${project}/databases/(default)/documents`;
 const meta=(await client.get(base+'/internal/meta')).body;
 execute(initialState(),{uid:'facility-admin',admin:true},'configurePilot',{paths:decode(meta.fields.geometry).paths,facilities:rows,clientRequestId:'validate-survey-facilities'},Date.now());
 async function list(){let docs=[],token;do{const b=(await client.get(base+'/internalTables/facilities/entries',{queryParams:{pageSize:300,...(token?{pageToken:token}:{})}})).body;docs.push(...(b.documents||[]));token=b.nextPageToken;}while(token);return docs;}
 const before=await list();const desired=Object.fromEntries(rows.map(r=>[r.id,r]));
 const unpack=docs=>Object.fromEntries(docs.map(d=>[decode(d.fields.key),decode(d.fields.value)]));
 console.log(JSON.stringify({oldCount:before.length,newCount:rows.length}));
 if(isDeepStrictEqual(unpack(before),desired)){console.log('Already applied');return;}
 if(!process.argv.includes('--apply')){console.log('Preview only');return;}
 const backup=process.env.UIRUN_FACILITIES_BACKUP;if(!backup||!path.isAbsolute(backup))throw Error('Absolute UIRUN_FACILITIES_BACKUP required');
 fs.writeFileSync(backup,JSON.stringify({meta,documents:before},null,2),{flag:'wx',mode:0o600});
 const old=new Map(before.map(d=>[decode(d.fields.key),d]));const writes=[];
 for(const row of rows){const prior=old.get(row.id);writes.push({update:{name:`projects/${project}/databases/(default)/documents/internalTables/facilities/entries/${Buffer.from(row.id).toString('base64url')}`,fields:{key:encode(row.id),value:encode(row)}},currentDocument:prior?{updateTime:prior.updateTime}:{exists:false}});old.delete(row.id);}
 for(const d of old.values())writes.push({delete:d.name,currentDocument:{updateTime:d.updateTime}});
 if(writes.length>450)throw Error('TOO_MANY_WRITES');
 await client.post(base+':commit',{writes});
 if(!isDeepStrictEqual(unpack(await list()),desired))throw Error('FACILITIES_VERIFY_FAILED');
 const afterMeta=(await client.get(base+'/internal/meta')).body;
 if(!isDeepStrictEqual(meta.fields,afterMeta.fields))console.log('Meta changed concurrently; this script only wrote facilities');
 console.log('Verified: facilities collection replaced');
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
