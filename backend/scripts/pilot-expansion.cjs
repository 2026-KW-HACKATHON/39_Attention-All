const {lineDistance}=require('../functions/src/validation');
function extendPaths(paths,extension){
 const out=structuredClone(paths);
 for(const add of extension.paths){
  const current=out.find(p=>p.id===add.id);
  if(!current)throw Error(`PATH_NOT_FOUND:${add.id}`);
  if(current.corridorId!==add.corridorId)throw Error(`CORRIDOR_MISMATCH:${add.id}`);
  const prefix=add.points.slice(0,-1);
  if(JSON.stringify(current.points.slice(0,prefix.length))===JSON.stringify(prefix))continue;
  if(lineDistance(current.points[0],[add.points.at(-1),add.points.at(-1)])>5)throw Error(`JOIN_MISMATCH:${add.id}`);
  current.points=[...prefix,...current.points];
  if(current.points.length>2000)throw Error('TOO_MANY_POINTS');
 }
 return out;
}
module.exports={extendPaths};
