import {createServer} from 'node:http';
import {createReadStream,existsSync,statSync} from 'node:fs';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ManagerBridge} from './manager-bridge.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const root=dirname(fileURLToPath(import.meta.url));
const three=resolve(root,'../skill-holo-3d/web/node_modules/three/build');
const bridge=new ManagerBridge();
const execute=promisify(execFile);
const port=Number(process.env.PORT||4185);
async function multicaStatus(){try{const r=await execute('/usr/bin/plutil',['-extract','CFBundleShortVersionString','raw','-o','-','/Applications/Multica.app/Contents/Info.plist'],{timeout:3000,maxBuffer:4096});return{installed:true,version:r.stdout.trim(),connected:false,agentIdentityVerified:false,taskDispatchEnabled:false}}catch{return{installed:false,connected:false,taskDispatchEnabled:false}}}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.md':'text/plain; charset=utf-8'};
const server=createServer(async(req,res)=>{
 let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname)}catch{res.writeHead(400);res.end();return}
 if(pathname.startsWith('/api/')){
  const hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);const origins=new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`]);
  if(!hosts.has(req.headers.host)||(req.headers.origin&&!origins.has(req.headers.origin))||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end('Local inventory only');return}
  if(req.method!=='GET'){res.writeHead(405,{'Allow':'GET'});res.end('Read only');return}
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
  if(pathname!=='/api/inventory'){res.writeHead(404);res.end(JSON.stringify({error:'Unknown endpoint'}));return}
  try{const refresh=new URL(req.url,'http://localhost').searchParams.get('refresh')==='1';const data=await bridge.inventory(refresh);res.end(JSON.stringify({...data,multica:await multicaStatus()}))}catch{res.writeHead(503);res.end(JSON.stringify({error:'暂时无法读取卡牌大师。请确认本机 Manager 桥接可用，然后重试。'}))}return;
 }
 if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return}
 let base=root,relative=pathname==='/'?'index.html':pathname.slice(1);
 if(pathname.startsWith('/vendor/')){base=three;relative=pathname.slice(8);if(!['three.module.js','three.core.js'].includes(relative)){res.writeHead(404);res.end();return}}
 const file=resolve(base,relative);
 if(!file.startsWith(base+sep)||!existsSync(file)||!statSync(file).isFile()){res.writeHead(404);res.end('Not found');return}
 res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});createReadStream(file).pipe(res);
});
server.listen(port,'127.0.0.1',()=>console.log(`Toy Wilds: http://127.0.0.1:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{bridge.close();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1000).unref()});
