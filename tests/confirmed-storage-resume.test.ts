import { describe, expect, it } from 'vitest'
import { createNode } from '../electron/graph-types'
import { runGraph } from '../electron/runner'
import { openSavedCanvas, saveCanvas } from '../electron/canvas-library'
import { canvasDirty } from '../electron/canvas-session'
let seq=0
const edge=(a:any,b:any,port='next')=>({id:String(++seq),from:a.id,fromPort:port,to:b.id})
const recorder=()=>{const actions:string[]=[]; return {actions,ex:{log:()=>{},step:()=>{},shouldStop:()=>false,click:async(n:any)=>{actions.push(n.prompt)},type:async()=>{},key:async()=>{},exists:async()=>true}}}
describe('Package resume identity and concurrent canvas saves',()=>{
 it.each([false,true])('package entry retains the resume item identity (normal entry=%s)',async(normal)=>{
  const start=createNode('start',0,0),pkg=createNode('package',0,0),s=createNode('start',0,0),loop=createNode('loop',0,0),a=createNode('click',30,20)
  a.prompt='{{öğe}}';loop.items=['new.glb','saved.glb'];loop.startIndex=0;loop.members=[a.id]
  pkg.inner={nodes:[s,loop,a],edges:[edge(s,loop)]}; const graph={nodes:[start,pkg],edges:[edge(start,pkg)]}
  const r=recorder(); await runGraph(graph,r.ex,{maxSteps:100,stepDelayMs:0,...(normal ? {} : {startId:a.id,packagePath:[pkg.id]}),resume:true,resumeLoopId:loop.id,resumeItem:'saved.glb'})
  expect(r.actions).toEqual(['saved.glb'])
 })
 it('stale working copy cannot overwrite the newest record',()=>{
  const s=createNode('start',0,0),a=createNode('click',30,0);a.prompt='Original'
  const c={id:'saved',name:'Work',graph:{nodes:[s,a],edges:[edge(s,a)]},updatedAt:1}
  let book:any={activeId:'',tabs:[],library:{schemaVersion:2,canvases:[c],automations:[]}}
  book=openSavedCanvas(book,c);book=openSavedCanvas(book,c)
  const [one,two]=book.tabs
  book={...book,tabs:book.tabs.map((t:any)=>t.id===one.id?{...t,graph:{...t.graph,nodes:t.graph.nodes.map((n:any)=>n.id===a.id?{...n,prompt:'Latest A'}:n)}}:t)}
  book=saveCanvas(book,one.id)
  expect(canvasDirty(book,book.tabs[1])).toBe(false)
  book={...book,tabs:book.tabs.map((t:any)=>t.id===two.id?{...t,name:'Renamed B'}:t)}
  const before=structuredClone(book)
  expect(()=>saveCanvas(book,two.id)).toThrow(/başka bir sekmeden/)
  expect(book).toEqual(before)
  expect(book.library.canvases[0].graph.nodes.find((n:any)=>n.id===a.id).prompt).toBe('Latest A')
 })
})
