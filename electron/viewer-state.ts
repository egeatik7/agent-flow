import { randomUUID } from 'node:crypto'
import type { AgentGraph, CanvasBook, StepStatus } from './graph-types'
import type { ViewerMessage, ViewerSnapshot, ViewerBook, ViewerRun } from './viewer-types'
import type { RecoveryReport } from './recovery'
import { viewerNodePath } from './viewer-progress'
import { emptyViewerHud, updateViewerHud } from './viewer-hud'
export function viewerBook(book:CanvasBook):ViewerBook {
 return structuredClone({zipLibrary:book.zipLibrary??{directory:'',groups:[]},tabs:book.tabs.map(({id,savedId,name,graph})=>({id,savedId,name,graph}))})
}
export function patchViewerGraph(graph:AgentGraph,id:string,patch:Record<string,unknown>):void {
 for(const node of graph.nodes){if(node.id===id)Object.assign(node,patch);if(node.inner)patchViewerGraph(node.inner,id,patch)}
}
export class ViewerState {
 private listeners=new Set<(message:ViewerMessage)=>void>()
 private bookJSON=''
 state:ViewerSnapshot
 constructor(version:string){this.state={protocol:1,version,session:randomUUID(),seq:0,at:Date.now(),book:{zipLibrary:{directory:'',groups:[]},tabs:[]},run:null,hud:emptyViewerHud(),logs:[],reports:[]}}
 snapshot():ViewerSnapshot{return structuredClone(this.state)}
 subscribe(fn:(message:ViewerMessage)=>void){this.listeners.add(fn);return()=>this.listeners.delete(fn)}
 private emit(channel:string,payload:unknown){this.state.seq++;this.state.at=Date.now();const message:ViewerMessage={type:'event',session:this.state.session,seq:this.state.seq,at:this.state.at,channel,payload};for(const fn of this.listeners){try{fn(message)}catch{/* Viewing never interrupts a run. */}}}
 setBook(book:CanvasBook){const next=viewerBook(book),json=JSON.stringify(next);if(json===this.bookJSON)return;this.bookJSON=json;this.state.book=next;this.emit('book',next)}
 setReports(reports:RecoveryReport[]){this.state.reports=structuredClone(reports.slice(-100));this.emit('reports',this.state.reports)}
 begin(id:string,canvasId:string,graph:AgentGraph){const record=this.state.book.tabs.find(t=>t.id===canvasId||t.savedId===canvasId||`tab:${t.id}`===canvasId)??this.state.book.zipLibrary.groups.filter(g=>!g.problem).flatMap(g=>g.canvases).find(c=>c.canvasId===canvasId);this.state.run={id,canvasId,name:record?.name??'Çalışan tuval',graph:structuredClone(graph),phase:'running',nodeId:null,status:{},edges:[],loop:'',method:''};this.emit('run',this.state.run)}
 finish(outcome:{ok?:boolean;stopped?:boolean}|undefined){if(!this.state.run)return;this.state.run.phase=outcome?.stopped?'stopped':outcome?.ok?'completed':'failed';this.emit('run:finish',{phase:this.state.run.phase})}
 event(channel:string,payload:unknown){
  const run=this.state.run
  const hud=updateViewerHud(this.state.hud,channel,payload)
  if(hud)this.state.hud=hud
  if(channel==='agent:log'){const p=payload as {level:string;message:string};this.state.logs.push({...p,at:Date.now()});this.state.logs=this.state.logs.slice(-300)}
  else if(channel==='agent:step'&&run){const p=payload as {id:string;status:StepStatus};run.status[p.id]=p.status;if(p.status==='running'||p.status==='error'){if(p.status!=='error'||!run.nodeId||!isAncestor(run.graph,p.id,run.nodeId))run.nodeId=p.id}}
  else if(channel==='agent:patch'&&run){const p=payload as {id:string;patch:Record<string,unknown>};patchViewerGraph(run.graph,p.id,p.patch)}
  else if(channel==='agent:edge'&&run){const p=payload as {id:string;from:string;to:string};const cut=run.edges.findIndex(e=>e.from===p.to);if(cut>=0)run.edges=run.edges.slice(0,cut);if(!run.edges.some(e=>e.id===p.id))run.edges.push(p)}
  else if(channel==='hud:loop'&&run)run.loop=(payload as {text:string}).text
  else if(channel==='hud:method'&&run)run.method=(payload as {text:string}).text
  else if(channel==='recovery:status'&&run)run.recovery=payload as ViewerRun['recovery']
  else if(channel==='recovery:report'){const report=structuredClone(payload as RecoveryReport);this.state.reports=[...this.state.reports.filter(r=>r.id!==report.id),report].slice(-100)}
  else if(channel==='recovery:removed'){const ids=payload as string[];this.state.reports=this.state.reports.filter(r=>!ids.includes(r.id))}
  else if(!hud)return
  this.emit(channel,payload)
 }
}
function isAncestor(graph:AgentGraph,parent:string,child:string):boolean{return parent!==child&&viewerNodePath(graph,child).includes(parent)}
