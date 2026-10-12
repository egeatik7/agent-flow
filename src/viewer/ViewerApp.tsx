import { useEffect, useState } from 'react'
import NodeCanvas from '../components/NodeCanvas'
import NodeNavigator from '../components/NodeNavigator'
import NubboMascot from '../components/NubboMascot'
import RecoveryNote from '../components/RecoveryNote'
import { NODE_SPECS,summarize,type AgentGraph } from '../types'
import { runNodePath,runNodeView } from '../lib/run-progress'
import { useViewer } from './useViewer'
import ViewerHudScreen from './ViewerHudScreen'
import { useViewerDevice } from './device'
import type { RecoveryReport } from '../../electron/recovery'
import './viewer.css'
const noop=()=>{}
export default function ViewerApp(){
 const viewer=useViewer(),device=useViewerDevice()
 if(device==='phone')return <ViewerHudScreen phoneOnly hud={viewer.state?.hud} connected={viewer.connected} error={viewer.error}/>
 return <ViewerWorkspace {...viewer}/>
}
function ViewerWorkspace({state,connected,error}:ReturnType<typeof useViewer>){
 const [selected,setSelected]=useState(''),[path,setPath]=useState<string[]>([]),[inspect,setInspect]=useState<string|null>(null),[tab,setTab]=useState<'node'|'canvases'|'reports'>('canvases'),[archived,setArchived]=useState(false),[focus,setFocus]=useState<{nodeId:string;at:number}>(),[report,setReport]=useState<RecoveryReport|null>(null),[logOpen,setLogOpen]=useState(true)
 const [followLocked,setFollowLocked]=useState(false),[hudOpen,setHudOpen]=useState(false)
 const book=state?.book,run=state?.run
 const lockedView=followLocked&&run?.nodeId?runNodeView(run.graph,run.nodeId):null
 const shownSelected=followLocked?'@run':selected,shownPath=followLocked?(lockedView?.stack.map(p=>p.id)??[]):path
 useEffect(()=>{
  if(!followLocked||!run?.nodeId||!lockedView)return
  const nodeId=run.nodeId
  const center=()=>{if(!document.hidden)setFocus(previous=>({nodeId,at:Math.max(Date.now(),(previous?.at??0)+1)}))}
  center();const timer=window.setInterval(center,250)
  window.addEventListener('resize',center);document.addEventListener('visibilitychange',center)
  return()=>{window.clearInterval(timer);window.removeEventListener('resize',center);document.removeEventListener('visibilitychange',center)}
 },[followLocked,run?.id,run?.nodeId,!!lockedView])
 const toggleFollow=()=>{if(followLocked){setSelected(shownSelected);setPath(shownPath)}else{setInspect(null);setTab('node')};setFollowLocked(!followLocked)}
 const record=book?.zipLibrary.groups.filter(g=>!g.problem).flatMap(g=>g.canvases).map(c=>({name:c.name,graph:{nodes:c.nodes,edges:c.edges},id:c.canvasId})).find(c=>c.id===selected)??book?.tabs.find(t=>`tab:${t.id}`===selected)
 const showRun=shownSelected==='@run',root=showRun?run?.graph:record?.graph
 let graph:AgentGraph=root??{nodes:[],edges:[]},validPath:string[]=[],pathNames:string[]=[]
 for(const id of shownPath){const n=graph.nodes.find(n=>n.id===id&&n.kind==='package'&&n.inner);if(!n?.inner)break;graph=n.inner;validPath.push(id);pathNames.push(n.title)}
 const active=!!showRun&&!!run,phase=active?(run.phase==='running'?'running':run.phase==='completed'?'idle':'stopped'):'idle'
 const highlighted=active&&root&&run.nodeId?runNodePath(root,run.nodeId).filter(id=>graph.nodes.some(n=>n.id===id)):[]
 const title=showRun?run?.name:record?.name,node=graph.nodes.find(n=>n.id===inspect)
 const open=(id:string)=>{setSelected(id);setPath([]);setInspect(null);setTab('node')}
 const navigate=(id:string,details=false)=>{const n=graph.nodes.find(n=>n.id===id);if(n?.kind==='package'&&!details){setPath([...validPath,id]);setInspect(null)}else{setInspect(id);setFocus({nodeId:id,at:Date.now()});setTab('node')}}
 const follow=()=>{if(!run?.nodeId)return;const found=runNodeView(run.graph,run.nodeId);setSelected('@run');setPath(found?.stack.map(p=>p.id)??[]);setInspect(null);setFocus({nodeId:run.nodeId,at:Date.now()})}
 return <div className="app viewer-mode">
  <div className="titlebar"><span className="titlebar-text">Nubbo Agent Studio · Tablet İzleme</span><span>{connected?'● Bağlı':'○ Bağlantı yok'}</span></div>
  <div className="viewer-toolbar"><button className="xp-btn" onClick={()=>open('@run')} disabled={!run||followLocked}>Çalışan tuval</button><button className="xp-btn" onClick={follow} disabled={!run?.nodeId}>Çalışan adıma git</button><button className="xp-btn" onClick={()=>{setPath(validPath.slice(0,-1));setInspect(null)}} disabled={!validPath.length||followLocked}>Üst pakete çık</button><button className="xp-btn" aria-pressed={followLocked} onClick={toggleFollow}>Aktif node’a kilitle</button><button className="xp-btn" onClick={()=>setHudOpen(true)}>Bilgi kartı · Tam ekran</button><button className="xp-btn" onClick={()=>setLogOpen(!logOpen)}>Günlük</button><span>{run?({running:'Çalışıyor',completed:'Tamamlandı',stopped:'Durdu',failed:'Hata'}[run.phase]):'Koşu yok'}{run?.loop?` · ${run.loop}`:''}</span></div>
  {error&&<div className="viewer-connection" role="status">{error}</div>}
  <div className="viewer-workspace"><main className="viewer-canvas-area"><div className="viewer-location">{title??'Tuval seç'}{pathNames.map(name=>` / ${name}`).join('')}</div>
   {root?<NodeCanvas readOnly onInspect={id=>navigate(id)} graph={graph} canvasKey={`${shownSelected}:${validPath.join('/')}`} reportCanvasId={showRun?run?.canvasId:selected} recoveryReports={state?.reports} selectedNodeId={null} selectedIds={[]} selectedEdgeId={null} stepStatus={active?run.status:{}} running={phase==='running'} highlightedNodeIds={highlighted} runPhase={phase} traversedEdges={active?new Set(run.edges.map(e=>e.id)):undefined} focus={focus}
    onSelectNode={noop} onSelectMany={noop} onSelectEdge={noop} onMoveNodes={noop} onSetMembership={noop} onWrap={noop} onConnect={noop} onAddAfter={noop} onAddAt={noop} onDeleteNode={noop} onDeleteEdge={noop} onDuplicate={noop} onRunFrom={noop} onEnterPackage={id=>navigate(id)} onUnpackPackage={noop}/>:<div className="workspace-welcome"><h2>Nubbo İzleme</h2><p>Sağdaki kütüphaneden tuval aç veya çalışan tuvale git.</p><p>Tek parmak: kaydır · İki parmak: yakınlaştır</p></div>}
  </main><aside className="side-panel viewer-sidebar"><div className="tabs">{([['node','Node'],['canvases','Tuvaller'],['reports','Raporlar']] as const).map(([id,label])=><button className={`tab ${tab===id?'active':''}`} onClick={()=>setTab(id)} key={id}>{label}</button>)}</div><div className="panel-body">
   {tab==='node'&&<><NodeNavigator touch graph={graph} name={title} locationKey={`${shownSelected}:${validPath.join('/')}`} onNavigate={navigate} onOut={()=>{setPath(validPath.slice(0,-1));setInspect(null)}} canOut={!!validPath.length&&!followLocked} stepStatus={active?run?.status:{}} highlightedNodeIds={highlighted} runPhase={phase}/>{node&&<section className="viewer-inspector"><h3>{node.title}</h3><p>{NODE_SPECS[node.kind]?.label??node.kind}</p><p>{summarize(node)}</p>{(['prompt','text','keys','windowTitle','url','seconds','waitSeconds','items'] as const).map(key=>{const value=(node as unknown as Record<string,unknown>)[key];return value!==undefined&&value!==''?<div key={key}><b>{{prompt:'Görev',text:'Metin',keys:'Tuşlar',windowTitle:'Pencere',url:'Adres',seconds:'Süre',waitSeconds:'Bekleme',items:'Öğeler'}[key]}</b><pre>{typeof value==='string'?value:JSON.stringify(value,null,2)}</pre></div>:null})}</section>}</>}
   {tab==='canvases'&&<div className="canvas-tab-content"><div className="canvas-library"><div className="library-views"><button className="xp-btn" aria-pressed={!archived} onClick={()=>setArchived(false)}>Tuvaller</button><button className="xp-btn" aria-pressed={archived} onClick={()=>setArchived(true)}>Arşiv</button></div><div className="canvas-library-scroll">{book?.zipLibrary.groups.filter(g=>g.archived===archived).map(g=><details key={g.id}><summary>{g.name}.zip · {g.canvases.length} tuval</summary>{g.problem?<p role="alert">{g.problem}</p>:g.canvases.map((c,i)=><button className="library-row" key={c.canvasId} disabled={followLocked} onClick={()=>open(c.canvasId)}>{i+1} · {c.name}</button>)}</details>)}</div></div><div className="library-brand"><NubboMascot/></div></div>}
   {tab==='reports'&&<div className="viewer-reports">{state?.reports.map(r=><button className="xp-btn" key={r.id} onClick={()=>setReport(r)}>{r.nodeTitle}</button>)}{!state?.reports.length&&<p>Kurtarma raporu yok.</p>}</div>}
  </div></aside></div>
  {logOpen&&<section className="bottom-panel viewer-log"><div className="panel-header">Ajan Günlüğü · {connected?'Canlı':'Son alınan kayıtlar'}</div><div className="log-body">{state?.logs.slice(-150).map((l,i)=><div className={`log-line ${l.level}`} key={`${l.at}:${i}`}>[{new Date(l.at).toLocaleTimeString('tr-TR')}] {l.message}</div>)}</div></section>}
  <div className="statusbar">Yalnız izleme · {run?.method??''}{run?.recovery?.active?` · Kurtarma: ${run.recovery.message}`:''}</div>
  {hudOpen&&<ViewerHudScreen hud={state?.hud} connected={connected} error={error} onClose={()=>setHudOpen(false)}/>}
  {report&&<RecoveryNote readOnly reports={[report]} title={report.nodeTitle} onClose={()=>setReport(null)}/>}
 </div>
}
