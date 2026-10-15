import type { ViewerMessage, ViewerSnapshot, ViewerRun, ViewerBook } from '../../electron/viewer-types'
import type { AgentGraph, StepStatus } from '../types'
import type { RecoveryReport } from '../../electron/recovery'
import { viewerNodePath as runNodePath } from '../../electron/viewer-progress'
import { updateViewerHud } from '../../electron/viewer-hud'
function patch(graph:AgentGraph,id:string,value:Record<string,unknown>){for(const n of graph.nodes){if(n.id===id)Object.assign(n,value);if(n.inner)patch(n.inner,id,value)}}
export function applyViewerMessage(current:ViewerSnapshot|null,message:ViewerMessage):ViewerSnapshot{
 if(message.type==='snapshot'){if(message.state.protocol!==1)throw Error('İzleme protokolü uyumsuz.');return message.state}
 if(!current||message.session!==current.session)throw Error('Yeni oturumun güncel durumu gerekli.')
 if(message.type==='heartbeat'){if(message.seq!==current.seq)throw Error('Eksik durum mesajı.');return current}
 if(message.seq!==current.seq+1)throw Error('Eksik durum mesajı.')
 const next={...current,seq:message.seq,at:message.at}
 const hud=updateViewerHud(current.hud,message.channel,message.payload)
 if(hud)next.hud=hud
 if(message.channel==='hud:status'||message.channel==='hud:countdown'||message.channel==='hud:stages'||message.channel==='hud:context'||message.channel==='hud:memory'||message.channel==='hud:loops')return next
 const run=next.run?structuredClone(next.run):null,p=message.payload
 if(message.channel==='book')next.book=p as ViewerBook
 else if(message.channel==='run')next.run=p as ViewerRun
 else if(message.channel==='run:finish'&&run){run.phase=(p as {phase:ViewerRun['phase']}).phase;next.run=run}
 else if(message.channel==='reports')next.reports=p as RecoveryReport[]
 else if(message.channel==='agent:log')next.logs=[...next.logs,{...p as {level:string;message:string},at:message.at}].slice(-300)
 else if(message.channel==='recovery:report'){const r=p as RecoveryReport;next.reports=[...next.reports.filter(v=>v.id!==r.id),r].slice(-100)}
 else if(message.channel==='recovery:removed')next.reports=next.reports.filter(r=>!(p as string[]).includes(r.id))
 else if(run){
  if(message.channel==='agent:step'){const s=p as {id:string;status:StepStatus};run.status[s.id]=s.status;if(s.status==='running'||s.status==='error'){if(s.status!=='error'||!run.nodeId||!runNodePath(run.graph,run.nodeId).includes(s.id))run.nodeId=s.id}if(s.status==='running'&&run.edges.length){const incoming=run.edges[run.edges.length-1]?.to===s.id;const cut=incoming?-1:run.edges.findIndex(e=>runNodePath(run.graph,e.from).includes(s.id));if(cut>=0)run.edges=run.edges.slice(0,cut)}}
  else if(message.channel==='agent:patch'){const s=p as {id:string;patch:Record<string,unknown>};patch(run.graph,s.id,s.patch)}
  else if(message.channel==='agent:edge'){const edge=p as {id:string;from:string;to:string},cut=run.edges.findIndex(e=>runNodePath(run.graph,e.from).includes(edge.to));if(cut>=0)run.edges=run.edges.slice(0,cut);if(!run.edges.some(e=>e.id===edge.id))run.edges.push(edge)}
  else if(message.channel==='hud:loop')run.loop=(p as {text:string}).text
  else if(message.channel==='hud:method')run.method=(p as {text:string}).text
  else if(message.channel==='recovery:status')run.recovery=p as ViewerRun['recovery']
  next.run=run
 }
 return next
}
