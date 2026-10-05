const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runMetrics,validLegs}=require('../src/workouts');
const start=Date.parse('2026-10-05T00:00:00Z');
const track=(altitudes=Array(10).fill(100))=>altitudes.map((altitudeM,i)=>({lat:37+i*.0001,lng:127,acc:8,recordedAt:start+i*10000,segment:0,altitudeM,altitudeAccuracyM:2}));
const metrics=points=>runMetrics({track:points,startedAt:start,activeMs:90000,distanceM:100});
const unavailable=(points,reason)=>{const result=metrics(points);assert.equal(result.elevationGainM,null);assert.equal(result.elevationUnavailableReason,reason);};

test('elevation requires at least ten retained GPS points',()=>{
 unavailable(track().slice(0,9),'INSUFFICIENT_ALTITUDE_DATA');
 unavailable([],'INSUFFICIENT_ALTITUDE_DATA');
});
test('missing and nonfinite usable altitude or accuracy never becomes zero elevation',()=>{
 for(const field of ['altitudeM','altitudeAccuracyM'])for(const value of [undefined,null,NaN,Infinity]){
  const points=track();points[4][field]=value;unavailable(points,'INSUFFICIENT_ALTITUDE_DATA');
 }
});
test('altitude accuracy outside the inclusive zero to fifteen meter range is unavailable',()=>{
 for(const value of [-1,15.01]){const points=track();points[4].altitudeAccuracyM=value;unavailable(points,'LOW_ALTITUDE_ACCURACY');}
 for(const value of [0,15]){const points=track();points.forEach(p=>p.altitudeAccuracyM=value);assert.equal(metrics(points).elevationGainM,0);}
});
test('valid climb sums only positive altitude changes and keeps existing leg shape',()=>{
 const points=track([100,105,103,110,108,108,111,109,115,114]);
 const result=metrics(points);assert.equal(result.elevationGainM,21);assert.equal(result.elevationUnavailableReason,null);
 assert.deepEqual(Object.keys(validLegs(points)[0]).sort(),['distanceM','from','ms','segment','to']);
 assert.equal(result.observedMs,90000);assert.equal(result.averagePaceSecPerKm,900);
});
test('a flat or descending usable track reports numeric zero',()=>{
 for(const points of [track(),track([100,99,98,97,96,95,94,93,92,91])]){
  assert.equal(metrics(points).elevationGainM,0);assert.equal(metrics(points).elevationUnavailableReason,null);
 }
});
test('elevation does not count a climb across a pause segment boundary',()=>{
 const points=track([100,100,100,100,100,500,500,500,500,500]);points.slice(5).forEach(p=>p.segment=1);
 assert.equal(metrics(points).elevationGainM,0);
});
test('invalid GPS endpoints neither contribute altitude nor bridge neighboring points',()=>{
 const points=track([100,100,100,100,900,500,500,500,500,500]);points[4].acc=100;points[4].altitudeM=null;points[4].altitudeAccuracyM=null;
 assert.equal(metrics(points).elevationGainM,0);assert.equal(metrics(points).elevationUnavailableReason,null);
});
test('long gaps and impossible GPS speed do not contribute climb',()=>{
 for(const invalid of ['gap','speed']){
  const points=track([100,100,100,100,100,500,500,500,500,500]);
  if(invalid==='gap')points.slice(5).forEach(p=>p.recordedAt+=60001);
  else points.slice(5).forEach(p=>p.lat+=1);
  assert.equal(metrics(points).elevationGainM,0);
 }
});
test('a retained track without any valid legs has no elevation estimate',()=>{
 const points=track();points.forEach((p,i)=>p.segment=i);unavailable(points,'NO_VALID_SEGMENTS');
});
