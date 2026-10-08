// 기존 데이터는 보존하고 geometry.paths만 조건부 갱신한다. 기본은 미리보기이며 --apply로 적용한다.
const fs=require('node:fs');const path=require('node:path');const {isDeepStrictEqual}=require('node:util');
const {connect,project}=require('./cloud-client.cjs');const {extendPaths}=require('./pilot-expansion.cjs');
const extension=require('../data/wolgye2-extension.json');const {execute,initialState}=require('../functions/src/service');
function decode(v){
 if(v.mapValue){const x=Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)]));return Object.keys(x).length===1&&Array.isArray(x.__uirunArray)?x.__uirunArray:x;}
 if(v.arrayValue)return(v.arrayValue.values||[]).map(decode);
 return v.doubleValue??(v.integerValue!=null?Number(v.integerValue):v.stringValue??v.booleanValue??null);
}
function encode(x,inArray=false){
 if(Array.isArray(x)){const arr={arrayValue:{values:x.map(v=>encode(v,true))}};return inArray?{mapValue:{fields:{__uirunArray:arr}}}:arr;}
 if(x&&typeof x==='object')return{mapValue:{fields:Object.fromEntries(Object.entries(x).map(([k,v])=>[k,encode(v)]))}};
 if(typeof x==='number')return{doubleValue:x};if(typeof x==='boolean')return{booleanValue:x};if(x===null)return{nullValue:null};return{stringValue:x};
}
function verifyApplied(before,verified,expected){
 if(!isDeepStrictEqual(decode(verified.fields.geometry).paths,expected))throw Error('GEOMETRY_VERIFY_FAILED');
 for(const[k,v]of Object.entries(before.fields))if(k!=='geometry'&&!isDeepStrictEqual(v,verified.fields[k]))throw Error(`OTHER_FIELD_CHANGED:${k}`);
 for(const[k,v]of Object.entries(before.fields.geometry.mapValue.fields))if(k!=='paths'&&!isDeepStrictEqual(v,verified.fields.geometry.mapValue.fields[k]))throw Error(`OTHER_GEOMETRY_FIELD_CHANGED:${k}`);
}
async function main(){
 const client=(await connect())('https://firestore.googleapis.com','v1');const doc=`/projects/${project}/databases/(default)/documents/internal/meta`;
 const before=(await client.get(doc)).body;const paths=decode(before.fields.geometry).paths;const after=extendPaths(paths,extension);
 execute(initialState(),{uid:'geometry-admin',admin:true},'configurePilot',{paths:after,clientRequestId:'validate-wolgye2-extension'},Date.now());
 console.log(JSON.stringify(after.map(p=>({id:p.id,pointsBefore:paths.find(x=>x.id===p.id).points.length,pointsAfter:p.points.length,north:p.points[0]}))));
 if(isDeepStrictEqual(paths,after)){console.log('Already applied');return;}
 if(!process.argv.includes('--apply')){console.log('Preview only; use --apply to update geometry.paths');return;}
 const backup=process.env.UIRUN_GEOMETRY_BACKUP;if(!backup||!path.isAbsolute(backup))throw Error('Set absolute UIRUN_GEOMETRY_BACKUP before applying');
 fs.writeFileSync(backup,JSON.stringify(before,null,2)+'\n',{flag:'wx',mode:0o600});
 await client.patch(doc,{fields:{geometry:{mapValue:{fields:{paths:encode(after)}}}}},{queryParams:{'updateMask.fieldPaths':'geometry.paths','currentDocument.updateTime':before.updateTime}});
 const verified=(await client.get(doc)).body;
 verifyApplied(before,verified,after);
 console.log('Applied and verified geometry.paths only; backup saved.');
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={decode,encode,verifyApplied};
