import {inspectRunStructure} from '../electron/run-structure'
import { expect, it, vi } from 'vitest'
import fs from 'node:fs'
import ts from 'typescript'
import { createNode, type AgentGraph } from '../electron/graph-types'
import { collectLoopPaths, fullItemPath } from '../src/lib/item-paths'
const loop=(items:string[],folder?:string)=>({...createNode('loop',0,0),items,folder})
const graph=(items:string[],folder?:string):AgentGraph=>({nodes:[loop(items,folder)],edges:[]})
it('N2: drive root and its child path are preserved',()=>{
 expect(fullItemPath('a.glb','C:\\')).toBe('C:\\a.glb')
 const paths=collectLoopPaths([{name:'T',graph:graph(['a.glb'],'C:\\')}])
 expect(paths.map(p=>p.path)).toEqual(['C:\\','C:\\a.glb'])
})
it('N3: unresolved absolute templates are not checked literally',()=>{
 expect(fullItemPath('C:\\models\\{{öğe}}.glb')).toBe('')
})
it('N3: dynamic folder ignores cached items refreshed at runtime',()=>{
 const paths=collectLoopPaths([{name:'T',graph:graph(['C:\\old\\deleted.glb'],'C:\\models\\{{öğe}}')}])
 expect(paths.map(p=>p.path)).toEqual([])
})
function appRun(ctx:any){
 const source=fs.readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8')
 const from=source.indexOf('  const guardMissingPaths = async')
 const to=source.indexOf('\n  const stop =',from)
 const js=ts.transpileModule(source.slice(from,to)+'\nreturn {run};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
 return new Function('ctx','with(ctx){'+js+'}')(ctx).run
}
function validRunGraph(items:string[]){
 const l=loop(items),start=createNode('start',0,0),body=createNode('wait',200,0),end=createNode('end',400,0);l.members=[body.id]
 return {nodes:[l,start,body,end],edges:[{id:'s',from:start.id,fromPort:'next',to:l.id},{id:'e',from:l.id,fromPort:'done',to:end.id}]}
}
function context(){
 const pending:Array<(p:string[])=>void>=[]
 const ctx:any={flushSettings:vi.fn(async()=>true),structuredClone,missingAnswer:{current:null},setMissingReport:vi.fn(),loaded:true,closingRef:{current:false},saveAnswer:{current:null},runningRef:{current:false},libraryBusyRef:{current:false},confirmAnswer:{current:null},missingReport:null,activeIdRef:{current:'tab'},graphRef:{current:validRunGraph(['C:\\a.glb'])},stackRef:{current:[]},
 api:{missingPaths:vi.fn(()=>new Promise<string[]>(r=>pending.push(r))),runAgent:vi.fn(async()=>({ok:true}))},inspectRunStructure,collectLoopPaths,missingLoopPaths:()=>[],canvasName:()=> 'T',rooted:(g:any)=>g,resetLoopTicks:(g:any)=>g,writeCanvas:vi.fn(),setRunning:vi.fn(),setStepStatus:vi.fn(),stopRequested:{current:false},setRunProgress:vi.fn(),beginProgress:()=>({}),pushLog:vi.fn(),bookRef:{current:{tabs:[{id:'tab'}]}},finishProgress:()=>({}),runIdle:{current:null},errText:String}
 return {ctx,pending}
}
it('N1: actual App run handler locks before asynchronous preflight',async()=>{
 const {ctx,pending}=context();const run=appRun(ctx)
 const a=run();const b=run()
 await Promise.resolve();
 expect(pending).toHaveLength(1);expect(ctx.runningRef.current).toBe(true)
 pending[0]([]);await Promise.all([a,b])
 expect(ctx.api.runAgent).toHaveBeenCalledTimes(1)
})
it('N1: App runs the checked snapshot even if a graph ref changes',async()=>{
 const {ctx,pending}=context();const run=appRun(ctx);const a=run()
 await Promise.resolve();
 expect(ctx.api.missingPaths).toHaveBeenCalledWith(['C:\\a.glb'])
 const next=graph(['C:\\unchecked.glb']);ctx.graphRef.current=next
 pending[0]([]);await a
 expect(ctx.api.runAgent.mock.calls[0][0]).not.toBe(next);expect(ctx.api.runAgent.mock.calls[0][0].nodes[0].items).toEqual(['C:\\a.glb'])
})

it('N1: ignored second request does not clear the active run state',async()=>{
 const {ctx,pending}=context();let finish:any
 ctx.api.runAgent=vi.fn().mockImplementationOnce(()=>new Promise(r=>finish=r)).mockRejectedValueOnce(new Error('Ajan zaten çalışıyor.'))
 const run=appRun(ctx);const a=run();const b=run()
 await Promise.resolve();
 pending[0]([]);await b;await Promise.resolve();await Promise.resolve()
 expect(ctx.api.runAgent).toHaveBeenCalledTimes(1)
 expect(ctx.runningRef.current).toBe(true)
 expect(ctx.setRunning).toHaveBeenLastCalledWith(true)
 finish({ok:true});await a
})
it('N4: actual App keyboard handler protects the graph while missing-path dialog is open',()=>{
 const source=fs.readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8')
 const from=source.lastIndexOf('    const onKey = (e: KeyboardEvent) => {')
 const to=source.indexOf("    window.addEventListener('keydown', onKey)",from)
 const js=ts.transpileModule(source.slice(from,to)+'\nreturn onKey;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
 const deleteSelection=vi.fn()
 const ctx:any={checkpointsOpen:false,activeIdRef:{current:'tab'},workspacePicker:null,confirmQuestion:null,saveAnswer:{current:null},closingRef:{current:false},runningRef:{current:false},libraryBusyRef:{current:false},scanner:null,nameQuestion:null,importQuestion:null,missingReport:{items:[{path:'C:\\missing.glb'}]},selectedEdgeId:null,selectedIdsRef:{current:['selected']},selectedNodeId:'selected',deleteSelection}
 const handler=new Function('ctx','with(ctx){'+js+'}')(ctx)
 handler({key:'Delete',ctrlKey:false,metaKey:false,target:{tagName:'BUTTON',closest:()=>null}})
 expect(deleteSelection).not.toHaveBeenCalled()
})

it('actual App reports a broken structure before dispatch even when no file is missing',async()=>{
 const {ctx,pending}=context();ctx.graphRef.current.edges.push({id:'broken',from:ctx.graphRef.current.nodes[1].id,fromPort:'next',to:'deleted'})
 const promise=appRun(ctx)();await Promise.resolve();pending[0]([]);await Promise.resolve();await Promise.resolve()
 const report=ctx.setMissingReport.mock.calls.find(([value]:any[])=>value?.structure?.length)?.[0]
 expect(report.structure).toContainEqual(expect.objectContaining({code:'dangling-edge',canvas:'T'}))
 expect(ctx.api.runAgent).not.toHaveBeenCalled();report.answer(true);await promise
 expect(ctx.api.runAgent).not.toHaveBeenCalled() // structural errors cannot be overridden accidentally
})
it('actual App warns about an unconnected condition arm and can cancel before any dispatch',async()=>{
 const {ctx,pending}=context(),condition=createNode('condition',500,0);ctx.graphRef.current=validRunGraph(['C:\\a.glb']);const end=ctx.graphRef.current.nodes.find((n:any)=>n.kind==='end')
 ctx.graphRef.current.nodes.push(condition);ctx.graphRef.current.edges.find((e:any)=>e.to===end.id).to=condition.id
 ctx.graphRef.current.edges.push({id:'yes',from:condition.id,fromPort:'true',to:end.id})
 const promise=appRun(ctx)();await Promise.resolve();pending[0]([]);await Promise.resolve();await Promise.resolve()
 const report=ctx.setMissingReport.mock.calls.find(([value]:any[])=>value?.structure?.length)?.[0]
 expect(report.structure).toContainEqual(expect.objectContaining({code:'open-output',port:'false'}))
 report.answer(false);await promise;expect(ctx.api.runAgent).not.toHaveBeenCalled()
})

it('file-check failure cannot bypass a structural error report',async()=>{
 const {ctx}=context();ctx.graphRef.current.edges.push({id:'bad',from:ctx.graphRef.current.nodes[1].id,fromPort:'next',to:'missing'})
 ctx.api.missingPaths=vi.fn(async()=>{throw Error('file check unavailable')})
 const pending=appRun(ctx)();await Promise.resolve();await Promise.resolve();await Promise.resolve()
 const report=ctx.setMissingReport.mock.calls.find(([value]:any[])=>value?.structure?.length)?.[0]
 expect(report.structure.some((issue:any)=>issue.severity==='error')).toBe(true)
 report.answer(false);await pending;expect(ctx.api.runAgent).not.toHaveBeenCalled()
})
