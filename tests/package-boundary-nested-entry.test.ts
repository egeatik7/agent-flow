import { describe, expect, it, vi } from 'vitest'
import { createNode } from '../electron/graph-types'
import { runGraph } from '../electron/runner'
import { packageSelection } from '../src/lib/graph-ops'
let seq=0
const edge=(a:any,b:any,port='next')=>({id:String(++seq),from:a.id,fromPort:port,to:b.id})
const recorder=()=>{const actions:string[]=[]; return {actions,ex:{log:()=>{},step:()=>{},shouldStop:()=>false,click:async(n:any)=>{actions.push(n.prompt)},type:async()=>{},key:async()=>{},exists:async()=>true}}}
describe('Package exit semantics and nested selected entry',()=>{
 it('nested selected resume replays actions before the selected node',async()=>{
  const start=createNode('start',0,0), outer=createNode('loop',0,0), inner=createNode('loop',10,10), a=createNode('click',30,20),b=createNode('click',80,20)
  a.prompt='A';b.prompt='B';outer.items=['file'];outer.members=[inner.id];inner.count=1;inner.members=[a.id,b.id]
  const graph={nodes:[start,outer,inner,a,b],edges:[edge(start,outer),edge(a,b)]}
  const r=recorder();await runGraph(graph,r.ex,{maxSteps:100,stepDelayMs:0,startId:b.id,resume:true})
  expect(r.actions).toEqual(['B'])
 })
 it('packaging a condition makes its true exit run even when it is false',async()=>{
  const s=createNode('start',0,0),c=createNode('condition',200,0),a=createNode('click',450,0)
  c.text='“Ready”';c.timeoutMs=0;a.prompt='TRUE ONLY'
  const graph={nodes:[s,c,a],edges:[edge(s,c),edge(c,a,'true')]}
  const before=recorder();before.ex.exists=async()=>false
  await runGraph(graph,before.ex,{maxSteps:100,stepDelayMs:0});expect(before.actions).toEqual([])
  const packed=packageSelection(graph,[c.id])!;expect(packed).not.toBeNull()
  const after=recorder();after.ex.exists=async()=>false
  await runGraph(packed.graph,after.ex,{maxSteps:100,stepDelayMs:0});expect(after.actions).toEqual([])
 })
})
describe('boundary and first-lap corner cases',()=>{
 const opts={maxSteps:100,stepDelayMs:0}
 const conditionGraph=(port='true')=>{
  const s=createNode('start',0,0),c=createNode('condition',200,0),a=createNode('click',450,0)
  c.text='Ready';c.timeoutMs=0;a.prompt='OUT'
  return {s,c,a,graph:{nodes:[s,c,a],edges:[edge(s,c),edge(c,a,port)]}}
 }
 it.each([true,false])('true/false exit preserves the selected branch (exists=%s)',async(present)=>{
  for(const port of ['true','false']){
   const {graph,c}=conditionGraph(port),before=recorder(),after=recorder()
   before.ex.exists=after.ex.exists=async()=>present
   await runGraph(structuredClone(graph),before.ex,opts)
   await runGraph(packageSelection(graph,[c.id])!.graph,after.ex,opts)
   expect(after.actions).toEqual(before.actions)
  }
 })
 it('taking an internal alternative branch does not authorize the external exit',async()=>{
  const {graph,c}=conditionGraph(),fallback=createNode('click',210,200);fallback.prompt='FALLBACK'
  graph.nodes.push(fallback);graph.edges.push(edge(c,fallback,'false'))
  const r=recorder();r.ex.exists=async()=>false
  await runGraph(packageSelection(graph,[c.id,fallback.id])!.graph,r.ex,opts)
  expect(r.actions).toEqual(['FALLBACK'])
 })
 it('an explicit initiative fail exit stays connected across packaging',async()=>{
  const s=createNode('start',0,0),ai=createNode('ai',100,0),out=createNode('click',400,0);ai.prompt='task';out.prompt='FAIL HANDLER'
  const graph={nodes:[s,ai,out],edges:[edge(s,ai),edge(ai,out,'fail')]}
  const r=recorder();await runGraph(packageSelection(graph,[ai.id])!.graph,{...r.ex,initiative:async()=>false},opts)
  expect(r.actions).toEqual(['FAIL HANDLER'])
 })
 it('selected condition inside package obeys the same exit gate as normal entry',async()=>{
  const {graph,c}=conditionGraph(),packed=packageSelection(graph,[c.id])!
  const r=recorder();r.ex.exists=async()=>false
  await runGraph(packed.graph,r.ex,{...opts,resume:true,startId:c.id,packagePath:[packed.id]})
  expect(r.actions).toEqual([])
 })
 it('an End inside a marked package cannot accidentally release its outside next step',async()=>{
  const {graph,c}=conditionGraph(),end=createNode('end',230,150)
  graph.nodes.push(end);graph.edges.push(edge(c,end,'false'))
  const r=recorder();r.ex.exists=async()=>false
  await runGraph(packageSelection(graph,[c.id,end.id])!.graph,r.ex,opts)
  expect(r.actions).toEqual([])
 })
 it('legacy package without exit metadata retains its existing completion behavior',async()=>{
  const {graph,c}=conditionGraph(),packed=packageSelection(graph,[c.id])!
  delete packed.graph.nodes.find(n=>n.id===packed.id)!.packageExit
  const r=recorder();r.ex.exists=async()=>false
  await runGraph(packed.graph,r.ex,opts)
  expect(r.actions).toEqual(['OUT'])
 })
 it('missing exit node never guesses a different exit or rewrites the JSON',async()=>{
  const {graph,c}=conditionGraph(),packed=packageSelection(graph,[c.id])!
  packed.graph.nodes.find(n=>n.id===packed.id)!.packageExit!.from='deleted'
  const snapshot=JSON.stringify(packed.graph),r=recorder();r.ex.exists=async()=>true
  await runGraph(packed.graph,r.ex,opts)
  expect(r.actions).toEqual([]);expect(JSON.stringify(packed.graph)).toBe(snapshot)
 })
 it('chosen B is first-lap-only through three nested loops and remaining files',async()=>{
  const s=createNode('start',0,0),outer=createNode('loop',0,0),middle=createNode('loop',0,0),inner=createNode('loop',0,0),a=createNode('click',30,0),b=createNode('click',80,0)
  outer.items=['x','y'];outer.members=[middle.id];middle.count=2;middle.members=[inner.id];inner.count=2;inner.members=[a.id,b.id];a.prompt='A';b.prompt='B'
  const r=recorder();await runGraph({nodes:[s,outer,middle,inner,a,b],edges:[edge(s,outer),edge(a,b)]},r.ex,{...opts,startId:b.id,resume:true})
  expect(r.actions).toEqual(['B',...Array.from({length:7},()=>['A','B']).flat()])
 })
 it('identity is used only once; later outer items start their inner list normally',async()=>{
  const s=createNode('start',0,0),outer=createNode('loop',0,0),inner=createNode('loop',0,0),a=createNode('click',30,0)
  outer.items=['x','y'];outer.members=[inner.id];inner.items=['first','saved'];inner.members=[a.id];a.prompt='{{öğe}}'
  const r=recorder();await runGraph({nodes:[s,outer,inner,a],edges:[edge(s,outer)]},r.ex,{...opts,startId:a.id,resume:true,resumeLoopId:inner.id,resumeItem:'saved'})
  expect(r.actions).toEqual(['saved','first','saved'])
 })
})

it('timeout on the designated false exit runs its handler rather than becoming an unconnected error',async()=>{
 const s=createNode('start',0,0),c=createNode('condition',100,0),out=createNode('click',300,0)
 c.text='Ready';c.timeoutMs=1;out.prompt='TIMEOUT HANDLER'
 const graph={nodes:[s,c,out],edges:[edge(s,c),edge(c,out,'false')]},r=recorder();r.ex.exists=async()=>false
 let time=0;const clock=vi.spyOn(Date,'now').mockImplementation(()=>time+=1000)
 try { await runGraph(packageSelection(graph,[c.id])!.graph,r.ex,{maxSteps:100,stepDelayMs:0}) }
 finally { clock.mockRestore() }
 expect(r.actions).toEqual(['TIMEOUT HANDLER'])
})
it('manual package entry finishes remaining inner and outer laps without replaying the first A',async()=>{
 const s=createNode('start',0,0),outer=createNode('loop',0,0),inner=createNode('loop',0,0),pkg=createNode('package',0,0)
 outer.items=['x','y'];outer.members=[inner.id];inner.count=2;inner.members=[pkg.id]
 const ps=createNode('start',0,0),a=createNode('click',10,0),b=createNode('click',20,0),c=createNode('click',30,0)
 a.prompt='A';b.prompt='B';c.prompt='C';pkg.inner={nodes:[ps,a,b,c],edges:[edge(ps,a),edge(a,b),edge(b,c)]};pkg.packageExit={from:c.id,fromPort:'next'}
 const graph={nodes:[s,outer,inner,pkg],edges:[edge(s,outer)]},r=recorder()
 await runGraph(graph,r.ex,{maxSteps:100,stepDelayMs:0,startId:b.id,packagePath:[pkg.id],resume:true})
 expect(r.actions).toEqual(['B','C',...Array.from({length:3},()=>['A','B','C']).flat()])
})
it('a revisited condition cannot retain an earlier positive exit decision',async()=>{
 const s=createNode('start',0,0),c=createNode('condition',100,0),again=createNode('click',200,0),out=createNode('click',400,0),pkg=createNode('package',0,0)
 c.text='Ready';c.timeoutMs=0;again.prompt='AGAIN';out.prompt='OUT'
 pkg.inner={nodes:[s,c,again],edges:[edge(s,c),edge(c,again,'true'),edge(again,c)]};pkg.packageExit={from:c.id,fromPort:'true'}
 const r=recorder();let checks=0;r.ex.exists=async()=>++checks===1
 await runGraph({nodes:[pkg,out],edges:[edge(pkg,out)]},r.ex,{maxSteps:100,stepDelayMs:0})
 expect(r.actions).toEqual(['AGAIN'])
})
it('a negative package lap does not block the next loop item or release its own outside action',async()=>{
 const s=createNode('start',0,0),loop=createNode('loop',0,0),pkg=createNode('package',0,0),out=createNode('click',400,0),done=createNode('click',600,0)
 const ps=createNode('start',0,0),c=createNode('condition',100,0);c.text='Ready';c.timeoutMs=0
 loop.items=['x','y'];loop.members=[pkg.id,out.id];out.prompt='{{öğe}}';done.prompt='DONE'
 pkg.inner={nodes:[ps,c],edges:[edge(ps,c)]};pkg.packageExit={from:c.id,fromPort:'true'}
 const r=recorder();let checks=0;r.ex.exists=async()=>++checks===2
 await runGraph({nodes:[s,loop,pkg,out,done],edges:[edge(s,loop),edge(pkg,out),edge(loop,done,'done')]},r.ex,{maxSteps:100,stepDelayMs:0})
 expect(r.actions).toEqual(['y','DONE'])
})
it('nested package exit gate stays intact while climbing out from a selected condition',async()=>{
 const top=createNode('package',0,0),child=createNode('package',100,0),s=createNode('start',0,0),c=createNode('condition',100,0),out=createNode('click',400,0)
 c.text='Ready';c.timeoutMs=0;out.prompt='OUT';child.inner={nodes:[s,c],edges:[edge(s,c)]};child.packageExit={from:c.id,fromPort:'true'}
 top.inner={nodes:[child],edges:[]};top.packageExit={from:child.id,fromPort:'next'}
 for(const present of [false,true]){
  const r=recorder();r.ex.exists=async()=>present
  await runGraph({nodes:[top,out],edges:[edge(top,out)]},r.ex,{maxSteps:100,stepDelayMs:0,startId:c.id,packagePath:[top.id,child.id],resume:true})
  expect(r.actions).toEqual(present?['OUT']:[])
 }
})
