import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'
import type { ViewerState } from './viewer-state'

/** Loopback only. Tailscale Serve supplies HTTPS/WSS and tailnet-only access. No tool/write routes. */
export async function startViewerServer(state:ViewerState,directory:string,token:string,port=31389){
 const root=path.resolve(directory)
 const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer')
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
  if(req.method!=='GET'){res.writeHead(405);res.end();return}
  let name:string;try{name=decodeURIComponent(new URL(req.url??'/', 'http://localhost').pathname)}catch{res.writeHead(400);res.end();return}
  if(name==='/'||name==='/index.html'){res.writeHead(302,{Location:'/viewer'});res.end();return}
  if(name==='/viewer')name='/index.html'
  if(name!=='/index.html'&&!/^\/assets\/[\w.-]+$/.test(name)){res.writeHead(404);res.end();return}
  const file=path.resolve(root,'.'+name)
  if(!file.startsWith(root+path.sep)){res.writeHead(404);res.end();return}
  const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'}
  fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);res.end();return}res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream'});res.end(data)})
 })
 const sockets=new WebSocketServer({noServer:true,maxPayload:2048,perMessageDeflate:false})
 server.on('upgrade',(req,socket,head)=>{
  // Tarayıcı sayfaları yalnız kendi Origin'iyle bağlanır; başka bir site 12 yuvayı tutup gerçek
  // tablet izleyicisini kapıdan çeviremesin (Origin yoksa yerel istemci sayılır).
  const origin=req.headers.origin
  if(origin&&!/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(String(origin))){socket.destroy();return}
  if(req.url!=='/viewer/events'||sockets.clients.size>=12){socket.destroy();return}
  sockets.handleUpgrade(req,socket,head,ws=>sockets.emit('connection',ws))
 })
 sockets.on('connection',ws=>{
  let off:(()=>void)|undefined
  const timeout=setTimeout(()=>ws.close(1008,'Eşleştirme gerekli'),5000)
  ws.once('message',data=>{
   let p:{type?:string;token?:string;protocol?:number};try{p=JSON.parse(data.toString());if(!p||typeof p!=='object'||Array.isArray(p))throw Error('Invalid subscription')}catch{ws.close(1008);return}
   const got=Buffer.from(typeof p.token==='string'?p.token:''),expected=Buffer.from(token)
   if(p.type!=='subscribe'||p.protocol!==1||got.length!==expected.length||!timingSafeEqual(got,expected)){ws.close(1008,'Eşleştirme veya sürüm geçersiz');return}
   clearTimeout(timeout)
   ;(ws as WebSocket&{authenticated?:boolean}).authenticated=true
   ws.send(JSON.stringify({type:'snapshot',state:state.snapshot()}))
   off=state.subscribe(message=>{if(ws.readyState!==WebSocket.OPEN)return;if(ws.bufferedAmount>2*1024*1024){ws.close(1013,'Yeniden bağlan');return}ws.send(JSON.stringify(message))})
   // A monitor never invokes commands, even if someone modifies its UI.
   ws.on('message',()=>ws.close(1008,'Yalnız izleme'))
  })
  ws.on('error',()=>{})
  ws.on('close',()=>{clearTimeout(timeout);off?.()})
 })
 const heartbeat=setInterval(()=>{const message=JSON.stringify({type:'heartbeat',session:state.state.session,seq:state.state.seq,at:Date.now()});for(const ws of sockets.clients)if(ws.readyState===WebSocket.OPEN&&(ws as WebSocket&{authenticated?:boolean}).authenticated){if(ws.bufferedAmount>2*1024*1024){ws.terminate();continue}ws.send(message)}},5000)
 try{await new Promise<void>((resolve,reject)=>{const onStart=(error:Error)=>reject(error);server.once('error',onStart);server.listen(port,'127.0.0.1',()=>{server.off('error',onStart);server.on('error',()=>{});resolve()})})}catch(e){clearInterval(heartbeat);sockets.close();throw e}
 return {port:(server.address() as {port:number}).port,server,close:async()=>{clearInterval(heartbeat);for(const ws of sockets.clients)ws.terminate();sockets.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}}
}
