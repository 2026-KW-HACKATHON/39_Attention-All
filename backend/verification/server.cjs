// Only serves the disposable local verifier, never production admin operations.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const root=path.resolve(__dirname,'../..');const origin='http://127.0.0.1:5179';let preparing=false;
const server=http.createServer(async(req,res)=>{
 const send=(code,data,type='application/json')=>{res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(type==='application/json'?JSON.stringify(data):data)};
 try{
  const localOrigin='http://127.0.0.1:'+server.address().port;
  if(req.headers.host!==new URL(localOrigin).host)return send(403,{error:'LOCAL_HOST_REQUIRED'});
  const pathname=new URL(req.url,origin).pathname;
  if(pathname==='/verification/prepare'){
   if(req.method!=='POST'||req.headers.origin!==localOrigin||req.headers['content-type']!=='application/json')return send(403,{error:'LOCAL_ORIGIN_REQUIRED'});
   if(preparing)return send(409,{error:'PREPARATION_IN_PROGRESS'});preparing=true;
   try{await promisify(execFile)(process.execPath,[path.join(__dirname,'prepare.cjs')],{timeout:30000,env:{...process.env,FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',FIREBASE_STORAGE_EMULATOR_HOST:'127.0.0.1:9199'}});return send(200,{ok:true,projectId:'demo-uirun'})}catch{return send(503,{error:'EMULATORS_NOT_READY'})}finally{preparing=false}
  }
  if(req.method!=='GET')return send(405,{error:'METHOD_NOT_ALLOWED'});
  if(pathname==='/'){res.writeHead(302,{Location:'/backend/verification/'});return res.end()}
  const rel=pathname==='/backend/verification/'?'backend/verification/index.html':pathname.slice(1);
  if(!(/^backend\/verification\/[a-z-]+\.(html|mjs)$/.test(rel)||rel==='docs/api/contracts.json'))return send(404,{error:'NOT_FOUND'});
  const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json'}[path.extname(rel)];const bytes=await fs.readFile(path.join(root,rel));send(200,bytes,mime==='application/json'?'application/json; charset=utf-8':mime);
 }catch{send(404,{error:'NOT_FOUND'})}
});
if(require.main===module)server.listen(5179,'127.0.0.1',()=>console.log('API verifier: '+origin+'/backend/verification/'));
module.exports={server};
