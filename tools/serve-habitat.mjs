import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'};
const server=http.createServer((req,res)=>{
  let decoded;
  try{decoded=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);}catch{res.writeHead(400).end();return;}
  const target=path.resolve(root,'.'+(decoded==='/'?'/index.html':decoded));
  if(!target.startsWith(root)||!['GET','HEAD'].includes(req.method)){res.writeHead(403).end();return;}
  fs.stat(target,(error,stat)=>{
    if(error||!stat.isFile()){res.writeHead(404).end('Not found');return;}
    res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    if(req.method==='HEAD'){res.end();return;}
    const stream=fs.createReadStream(target);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
  });
});
const PORT=Number(process.env.PORT||4173);server.listen(PORT,'127.0.0.1',()=>console.log(JSON.stringify({owner:'FruitFly / connectome-house habitat preview',pid:process.pid,url:`http://127.0.0.1:${PORT}/`,started:new Date().toISOString(),expires:new Date(Date.now()+2*60*60*1000).toISOString()})));
server.on('error',error=>{console.error(error);process.exit(1);});
setTimeout(()=>{server.close();server.closeAllConnections();},2*60*60*1000);
