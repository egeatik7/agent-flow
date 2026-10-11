import { useEffect,useRef,useState } from 'react'
import { version } from '../../package.json'
import type { ViewerMessage,ViewerSnapshot } from '../../electron/viewer-types'
import { applyViewerMessage } from './model'
export function useViewer(){
 const [state,setState]=useState<ViewerSnapshot|null>(null),[connected,setConnected]=useState(false),[error,setError]=useState('Bağlanıyor…')
 const current=useRef<ViewerSnapshot|null>(null)
 useEffect(()=>{
  const hash=new URLSearchParams(location.hash.slice(1)),supplied=hash.get('token'),key='nubbo-viewer-token'
  if(supplied&&/^[a-f0-9]{64}$/.test(supplied)){localStorage.setItem(key,supplied);history.replaceState(null,'',location.pathname)}
  const token=localStorage.getItem(key)
  if(!token){setError('PC’de Tablet İzleme’yi açıp eşleştirme bağlantısını kullan.');return}
  let disposed=false,socket:WebSocket|null=null,retry:ReturnType<typeof setTimeout>|undefined,delay=1000,last=0
  const connect=()=>{
   if(disposed)return;setConnected(false);setError('Bağlanıyor…')
   socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/viewer/events`)
   socket.onopen=()=>{last=Date.now();socket?.send(JSON.stringify({type:'subscribe',protocol:1,token}))}
   socket.onmessage=e=>{try{const message=JSON.parse(e.data) as ViewerMessage;if(message.type==='snapshot'&&message.state.version!==version){location.reload();return}const next=applyViewerMessage(current.current,message);current.current=next;setState(next);last=Date.now();delay=1000;setConnected(true);setError('')}catch{setError('Güncel durum yeniden alınıyor…');socket?.close()}}
   socket.onerror=()=>setError('PC’ye ulaşılamıyor. Tailscale ve Nubbo açık olmalı.')
   socket.onclose=e=>{setConnected(false);if(disposed)return;if(e.code===1008){setError('Eşleştirme geçersiz veya yenilendi. PC’deki yeni bağlantıyla aç.');return}setError('Bağlantı kesildi — son alınan durum gösteriliyor.');retry=setTimeout(connect,delay);delay=Math.min(15000,delay*2)}
  }
  const visible=()=>{if(document.hidden)return;if(!socket||socket.readyState===WebSocket.CLOSED){clearTimeout(retry);connect()}else if(Date.now()-last>15000)socket.close()}
  const heartbeat=setInterval(()=>{if(!document.hidden&&socket?.readyState===WebSocket.OPEN&&Date.now()-last>15000)socket.close()},5000)
  window.addEventListener('online',visible);document.addEventListener('visibilitychange',visible);connect()
  return()=>{disposed=true;clearTimeout(retry);clearInterval(heartbeat);window.removeEventListener('online',visible);document.removeEventListener('visibilitychange',visible);socket?.close()}
 },[])
 return {state,connected,error}
}
