import {expect,it,vi} from 'vitest'
import {createNode,normalizeGraph,type AgentGraph,type AgentNode} from '../electron/graph-types'
import {inspectRunStructure,assertRunStructure} from '../electron/run-structure'
import {runGraph,type Executor} from '../electron/runner'
const edge=(from:AgentNode,to:AgentNode,fromPort='next')=>({id:`${from.id}-${to.id}-${fromPort}`,from:from.id,to:to.id,fromPort})
const basic=()=>{const start=createNode('start',0,0),key=createNode('key',100,0),end=createNode('end',200,0);return {start,key,end,graph:{nodes:[start,key,end],edges:[edge(start,key),edge(key,end)]}}}
it('a valid linear flow has no structural warnings',()=>{expect(inspectRunStructure(basic().graph,{requireEnd:true})).toEqual([])})
it('an implicit last loop-member output is a valid lap boundary',()=>{
 const {start,end}=basic(),loop=createNode('loop',100,0),a=createNode('key',150,0),b=createNode('wait',200,0);loop.items=['a','b'];loop.members=[a.id,b.id]
 const graph={nodes:[start,loop,a,b,end],edges:[edge(start,loop),edge(a,b),edge(loop,end,'done')]}
 expect(inspectRunStructure(graph,{requireEnd:true})).toEqual([])
})
it('an unreachable loop member is named before the loop starts',()=>{
 const {start,end}=basic(),loop=createNode('loop',100,0),a=createNode('key',150,0),b=createNode('wait',200,0);loop.members=[a.id,b.id];b.title='Kopuk yazma'
 const issues=inspectRunStructure({nodes:[start,loop,a,b,end],edges:[edge(start,loop),edge(loop,end,'done')]})
 expect(issues).toContainEqual(expect.objectContaining({code:'unreachable-node',nodeId:b.id,node:'Kopuk yazma'}))
})
it('a disconnected condition arm is a warning with the exact port',()=>{
 const {start,end}=basic(),condition=createNode('condition',100,0)
 const issues=inspectRunStructure({nodes:[start,condition,end],edges:[edge(start,condition),edge(condition,end,'true')]})
 expect(issues).toEqual([expect.objectContaining({code:'open-output',nodeId:condition.id,port:'false',severity:'warning',message:expect.stringContaining('yok')})])
})
it('a regular condition/timer checking cycle with an End branch is valid',()=>{
 const {start,end}=basic(),condition=createNode('condition',100,0),wait=createNode('wait',200,0)
 expect(inspectRunStructure({nodes:[start,condition,wait,end],edges:[edge(start,condition),edge(condition,end,'true'),edge(condition,wait,'false'),edge(wait,condition)]},{requireEnd:true})).toEqual([])
})
it('raw broken edges are detected before normalization can discard them',()=>{
 const {graph,start}=basic();graph.edges.push({id:'bad',from:start.id,fromPort:'next',to:'deleted'})
 expect(inspectRunStructure(graph).some(i=>i.code==='dangling-edge')).toBe(true)
 expect(normalizeGraph(graph).edges.some(e=>e.to==='deleted')).toBe(false)
})
it('duplicate outgoing ports are rejected rather than silently choosing one',()=>{
 const {graph,start,end}=basic();graph.edges.push(edge(start,end))
 expect(()=>assertRunStructure(graph)).toThrow('birden fazla düğüme bağlı')
})
it.each(['missing','multiple','recursive'] as const)('rejects %s loop membership',kind=>{
 const a=createNode('loop',0,0),b=createNode('loop',100,0),key=createNode('key',200,0)
 if(kind==='missing')a.members=['deleted']
 if(kind==='multiple'){a.members=[key.id];b.members=[key.id]}
 if(kind==='recursive'){a.members=[b.id];b.members=[a.id]}
 expect(inspectRunStructure({nodes:[a,b,key],edges:[]}).some(i=>i.severity==='error')).toBe(true)
})
it('package boundaries need no fake outgoing edge on their recorded internal exit',()=>{
 const outer=basic(),inner=basic(),pkg=createNode('package',100,0)
 pkg.inner={nodes:[inner.start,inner.key],edges:[edge(inner.start,inner.key)]};pkg.packageExit={from:inner.key.id,fromPort:'next'}
 expect(inspectRunStructure({nodes:[outer.start,pkg,outer.end],edges:[edge(outer.start,pkg),edge(pkg,outer.end)]},{requireEnd:true})).toEqual([])
})
it.each(['missing','port','unreachable'] as const)('detects a %s recorded package exit with package context',kind=>{
 const outer=basic(),inner=basic(),pkg=createNode('package',100,0);pkg.title='Remesh paketi';pkg.inner=inner.graph
 pkg.packageExit={from:kind==='missing'?'deleted':inner.key.id,fromPort:kind==='port'?'false':'next'}
 if(kind==='unreachable')pkg.inner.edges=[edge(inner.start,inner.end)]
 const issues=inspectRunStructure({nodes:[outer.start,pkg,outer.end],edges:[edge(outer.start,pkg),edge(pkg,outer.end)]})
 expect(issues).toContainEqual(expect.objectContaining({severity:'error',path:['Remesh paketi'],code:kind==='missing'?'missing-package-exit':kind==='port'?'invalid-package-exit':'unreachable-package-exit'}))
})
it('an alternative package branch ending before the recorded exit is reported',()=>{
 const outer=basic(),inner=basic(),c=createNode('condition',80,0),pkg=createNode('package',100,0)
 pkg.inner={nodes:[inner.start,c,inner.key,inner.end],edges:[edge(inner.start,c),edge(c,inner.key,'true'),edge(c,inner.end,'false')]};pkg.packageExit={from:inner.key.id,fromPort:'next'}
 expect(inspectRunStructure({nodes:[outer.start,pkg,outer.end],edges:[edge(outer.start,pkg),edge(pkg,outer.end)]})).toContainEqual(expect.objectContaining({code:'early-package-end',nodeId:inner.end.id}))
})
it('selected-node execution does not warn about deliberately skipped root steps',()=>{
 const {graph,key}=basic();const prior=createNode('key',50,100);graph.nodes.push(prior)
 expect(inspectRunStructure(graph,{startId:key.id,requireEnd:true})).toEqual([])
})
it('a selected package path checks the chosen starting node and its outer continuation',()=>{
 const outer=basic(),inner=basic(),pkg=createNode('package',100,0);pkg.inner=inner.graph
 const graph={nodes:[outer.start,pkg,outer.end],edges:[edge(outer.start,pkg),edge(pkg,outer.end)]}
 expect(inspectRunStructure(graph,{packagePath:[pkg.id],startId:inner.key.id,requireEnd:true})).toEqual([])
 expect(inspectRunStructure(graph,{packagePath:[pkg.id],startId:'deleted'})).toContainEqual(expect.objectContaining({code:'missing-entry',severity:'error'}))
})
it('an inner package End is not the root canvas End required by canvas sequencing',()=>{
 const outer=basic(),inner=basic(),pkg=createNode('package',100,0);pkg.inner=inner.graph
 expect(inspectRunStructure({nodes:[outer.start,pkg],edges:[edge(outer.start,pkg)]},{requireEnd:true})).toContainEqual(expect.objectContaining({code:'missing-end',severity:'error'}))
})
it('inspection never edits IDs, membership, edges or loop progress',()=>{
 const {graph}=basic(),before=structuredClone(graph);inspectRunStructure(graph);expect(graph).toEqual(before)
})
it('a broken later package is rejected before ANY earlier desktop operation or loop progress event',async()=>{
 const outer=basic(),pkg=createNode('package',150,0),inner=basic();pkg.inner=inner.graph;pkg.packageExit={from:'deleted',fromPort:'next'}
 const graph:AgentGraph={nodes:[...outer.graph.nodes,pkg],edges:[edge(outer.start,outer.key),edge(outer.key,pkg),edge(pkg,outer.end)]}
 const input=vi.fn(async()=>{}),step=vi.fn(),patchNode=vi.fn()
 const ex:Executor={log:()=>{},step,patchNode,shouldStop:()=>false,click:input,type:input,key:input,exists:async()=>true}
 await expect(runGraph(graph,ex,{maxSteps:50,stepDelayMs:0})).rejects.toThrow('Paketin kayıtlı çıkış düğümü bulunamadı')
 expect(input).not.toHaveBeenCalled();expect(step).not.toHaveBeenCalled();expect(patchNode).not.toHaveBeenCalled()
})

it('an empty canvas in a sequence is rejected before earlier canvases execute',()=>{
 expect(inspectRunStructure({nodes:[],edges:[]},{requireEnd:true})).toContainEqual(expect.objectContaining({code:'missing-end',severity:'error'}))
})
