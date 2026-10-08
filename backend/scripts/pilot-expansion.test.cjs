const {test}=require('node:test');const assert=require('node:assert/strict');
const {extendPaths}=require('./pilot-expansion.cjs');
const extension=require('../data/wolgye2-extension.json');const seed=require('../prototype.seed.json');
const V=require('../functions/src/validation');
test('월계2동 확장은 기존 경로 ID·좌표와 다른 구간을 그대로 보존하고 재적용해도 중복되지 않는다',()=>{
 const extra={id:'OTHER',corridorId:'OTHER',points:[[37,127],[37.001,127]]};const before=[...seed.paths,extra];const after=extendPaths(before,extension);
 for(const old of before){const row=after.find(p=>p.id===old.id);assert.equal(row.corridorId,old.corridorId);assert.deepEqual(row.points.slice(-old.points.length),old.points);}
 assert.deepEqual(extendPaths(after,extension),after);assert.deepEqual(before,[...seed.paths,extra]);
});
test('월계2동 북쪽 둑은 100m 참여 가능하며 기존 월계1동과 밖 제한을 유지한다',()=>{
 const paths=extendPaths(seed.paths,extension);const at=extension.paths[0].points[5];const db={geometry:{paths}};
 assert.equal(V.match(db,{lat:at[0],lng:at[1]}).id,'W1-L');
 const old=seed.paths[0].points[35];assert.equal(V.match(db,{lat:old[0],lng:old[1]}).id,'W1-L');
 assert.throws(()=>V.match(db,{lat:at[0]+0.002,lng:at[1]+0.003}),e=>e.code==='OUTSIDE_PILOT');
 assert.throws(()=>V.match({geometry:{paths:seed.paths}},{lat:at[0],lng:at[1]}),e=>e.code==='OUTSIDE_PILOT');
});
test('예상 기존 접점과 다르면 잘못된 구간을 이어 붙이지 않는다',()=>{
 const paths=structuredClone(seed.paths);paths[0].points[0]=[37,127];assert.throws(()=>extendPaths(paths,extension),/JOIN_MISMATCH/);
 assert.throws(()=>extendPaths([],extension),/PATH_NOT_FOUND/);
});
test('Firestore의 맵 필드 순서 변경은 성공으로 확인하고 좌표·기존 메타 변경은 거부한다',()=>{
 const {encode,verifyApplied}=require('./expand-wolgye2.cjs');const paths=extendPaths(seed.paths,extension);
 const doc={fields:{seq:{integerValue:'7'},geometry:{mapValue:{fields:{note:{stringValue:'preserved'},paths:encode(paths)}}}}};
 const reorder=x=>Array.isArray(x)?x.map(reorder):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).reverse().map(([k,v])=>[k,reorder(v)])):x;
 const response=reorder(doc);assert.doesNotThrow(()=>verifyApplied(doc,response,paths));
 const bad=structuredClone(response);bad.fields.seq.integerValue='8';assert.throws(()=>verifyApplied(doc,bad,paths),/OTHER_FIELD_CHANGED/);
 const wrong=structuredClone(paths);wrong[0].points[0][0]+=1;assert.throws(()=>verifyApplied(doc,response,wrong),/GEOMETRY_VERIFY_FAILED/);
});
