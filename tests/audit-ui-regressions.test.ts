// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, createElement, useState } from 'react'
import { create, type ReactTestRenderer } from 'react-test-renderer'
import fs from 'node:fs'
import { createNode, DEFAULT_SETTINGS, type AgentGraph, type CanvasBook } from '../electron/graph-types'
import { callTool } from '../electron/tools'
import NodeCanvas from '../src/components/NodeCanvas'
import SidePanel from '../src/components/SidePanel'
import ScreenScanner from '../src/components/ScreenScanner'
import { remapPixel } from '../src/lib/value-ramp'

vi.mock('../electron/a11y-bridge',()=>({listWindows:async()=>[],scan:async()=>({items:[],area:{x:0,y:0,w:1,h:1},image:{data:'AA==',w:1,h:1,mime:'image/png'}})}))
let mounted:ReactTestRenderer|undefined
afterEach(()=>{if(mounted)act(()=>mounted!.unmount());mounted=undefined;vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks()})
const canvasProps=(graph:AgentGraph)=>({graph,canvasKey:'canvas-one',selectedNodeId:null,selectedIds:[],selectedEdgeId:null,stepStatus:{},running:false,
  onSelectNode:vi.fn(),onSelectMany:vi.fn(),onSelectEdge:vi.fn(),onMoveNodes:vi.fn(),onSetMembership:vi.fn(),onWrap:vi.fn(),onConnect:vi.fn(),onAddAfter:vi.fn(),onAddAt:vi.fn(),onDeleteNode:vi.fn(),onDeleteEdge:vi.fn(),onDuplicate:vi.fn(),onRunFrom:vi.fn(),onEnterPackage:vi.fn(),onUnpackPackage:vi.fn()})
const nodeMock=()=>({getBoundingClientRect:()=>({left:0,top:0,width:1000,height:800}),clientWidth:1000,clientHeight:800,contains:()=>false,addEventListener:()=>{},removeEventListener:()=>{}})
const buttonText=(b:any)=>b.children.join('')

it('C2: repeated screen.read image calls retain all temporary files',async()=>{
  const paths:string[]=[]
  try{
    for(let i=0;i<3;i++){
      const r=await callTool('screen.read',{image:true},{log:()=>{}} as any)
      expect(r.ok).toBe(true);paths.push(String(r.data?.imagePath))
    }
    expect(new Set(paths).size).toBe(3);expect(paths.every(p=>p&&fs.existsSync(p))).toBe(true)
  }finally{for(const p of paths)if(p)fs.rmSync(p,{force:true})}
})

it('B3: merge reports removed node IDs in both result and message',async()=>{
  const s=createNode('start',0,0),c=createNode('click',100,0),w=createNode('wait',200,0),e=createNode('end',300,0)
  const edge=(a:any,b:any)=>({id:`e-${a.id}`,from:a.id,fromPort:'next',to:b.id})
  let book:CanvasBook={activeId:'c1',tabs:[{id:'c1',name:'Canvas',graph:{nodes:[s,c,w,e],edges:[edge(s,c),edge(c,w),edge(w,e)]}}]}
  let applied:AgentGraph|undefined
  const ctx:any={getGraph:()=>book.tabs[0].graph,getSettings:()=>DEFAULT_SETTINGS,log:()=>{},isRunning:()=>false,userStop:()=>false,
    permission:()=> 'auto',askApproval:async()=>true,getCanvases:()=>structuredClone(book),saveCanvases:(b:CanvasBook)=>{book=b},applyMerge:async(p:any)=>{applied=p.graph;return{ok:true}}}
  const branch=await callTool('branch.create',{name:'audit'},ctx);expect(branch.ok).toBe(true)
  const id=branch.data?.branchId
  const edited=await callTool('flow.edit',{branchId:id,ops:[{op:'disconnect',from:s.id},{op:'addNode',key:'alt',kind:'wait',fields:{ms:700},connectFrom:s.id},{op:'connect',from:'alt',to:w.id}]},ctx)
  expect(edited.ok).toBe(true)
  const preview=await callTool('branch.merge',{branchId:id},ctx)
  expect(preview.data?.wouldRemove).toContain(c.id)
  const result=await callTool('branch.merge',{branchId:id,apply:true},ctx,'panel')
  expect(result.ok).toBe(true);expect(applied!.nodes.some(n=>n.id===c.id)).toBe(false)
  expect(result.data?.removed).toContain(c.id);expect(result.message).toContain(c.id)
  expect(result.message).toContain('Tarif silindi')
})

it('D3: changing canvasKey dismisses an old node menu',()=>{
  const n=createNode('wait',100,100);const p=canvasProps({nodes:[n],edges:[]})
  act(()=>{mounted=create(createElement(NodeCanvas,p),{createNodeMock:nodeMock})})
  const target=mounted!.root.findAll(x=>x.props['data-node-id']===n.id&&typeof x.props.onContextMenu==='function')[0]
  act(()=>target.props.onContextMenu({preventDefault:()=>{},stopPropagation:()=>{},clientX:110,clientY:110}))
  expect(mounted!.root.findAll(x=>x.props.className==='ctx-menu')).toHaveLength(1)
  act(()=>mounted!.update(createElement(NodeCanvas,{...p,canvasKey:'canvas-two',graph:{nodes:[],edges:[]}})))
  expect(mounted!.root.findAll(x=>x.props.className==='ctx-menu')).toHaveLength(0)
  expect(p.onRunFrom).not.toHaveBeenCalled()
})

const sideProps=()=>{
  const n=createNode('loop',0,0);n.items=['C:\\audit\\one.glb']
  return {tab:'node' as const,settings:structuredClone(DEFAULT_SETTINGS),setSettings:vi.fn(),onSaveSettings:vi.fn(),onTab:vi.fn(),windows:[],onRefreshWindows:vi.fn(),models:[],onLoadModels:vi.fn(),onTestApi:vi.fn(),onTestVision:vi.fn(),graph:{nodes:[n],edges:[]},selected:n,selectedEdge:null,onUpdateNode:vi.fn(),onDeleteNode:vi.fn(),onDeleteEdge:vi.fn(),onCaptureForNode:vi.fn(),onOpenScanner:vi.fn(),onFillFromFolder:vi.fn(),onLoopFolder:vi.fn(),onEnterPackage:vi.fn(),onUnpackPackage:vi.fn(),onUpdatePackaged:vi.fn(),onPickDir:async()=>null,capturing:0}
}
it('D2: loop-row menu dismisses on Escape and never stays in a disabled fieldset',()=>{
  const p=sideProps();act(()=>{mounted=create(createElement(SidePanel,p))})
  act(()=>mounted!.root.findAll(x=>typeof x.props.className==='string'&&x.props.className.startsWith('xp-tick-row'))[0].props.onContextMenu({preventDefault:()=>{},clientX:1,clientY:1}))
  act(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))})
  expect(mounted!.root.findAll(x=>x.props.className==='ctx-menu')).toHaveLength(0)
  act(()=>mounted!.root.findAll(x=>typeof x.props.className==='string'&&x.props.className.startsWith('xp-tick-row'))[0].props.onContextMenu({preventDefault:()=>{},clientX:1,clientY:1}))
  act(()=>mounted!.update(createElement(SidePanel,{...p,disabled:true})))
  expect(mounted!.root.findAll(x=>x.props.className==='ctx-menu')).toHaveLength(0)
})
it('D4: emptying a loop row dispatches an editable empty value',()=>{
  const p=sideProps();act(()=>{mounted=create(createElement(SidePanel,p))})
  const input=mounted!.root.findByProps({className:'xp-tick-path mono'})
  act(()=>input.props.onChange({target:{value:''}}))
  expect(p.onUpdateNode).toHaveBeenCalledWith({items:['']})
  act(()=>mounted!.update(createElement(SidePanel,{...p,selected:{...p.selected,items:['']}})))
  expect(mounted!.root.findByProps({className:'xp-tick-path mono'}).props.value).toBe('')
})

it('Q11: image arriving after ramp edit paints with the current ramp',async()=>{
  const paints:number[][]=[];let pendingImage:any
  const pixels=new Uint8ClampedArray([128,128,128,255])
  const context={drawImage:()=>{},getImageData:()=>({data:pixels,width:1,height:1}),putImageData:(data:any)=>paints.push(Array.from(data.data))}
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context as any)
  vi.stubGlobal('URL',{createObjectURL:()=> 'blob:audit',revokeObjectURL:()=>{}})
  vi.stubGlobal('Image',class {naturalWidth=1;naturalHeight=1;onload:any;set src(_v:string){pendingImage=this}})
  vi.stubGlobal('ImageData',class {constructor(public data:Uint8ClampedArray,public width:number,public height:number){}})
  const p={targetLabel:'audit',windows:[],defaultWindow:'',valueLo:0,valueHi:1,onSave:()=>{},onPick:()=>{},onClose:()=>{},
    onScan:async()=>({items:[],area:{x:0,y:0,w:1,h:1},image:{data:'AA==',w:1,h:1,mime:'image/png'}} as any)}
  await act(async()=>{mounted=create(createElement(ScreenScanner,p),{createNodeMock:(el:any)=>el.type==='canvas'?document.createElement('canvas'):nodeMock()})})
  expect(pendingImage).toBeTruthy()
  act(()=>mounted!.update(createElement(ScreenScanner,{...p,valueLo:.15,valueHi:.8})))
  act(()=>pendingImage.onload())
  expect(paints.at(-1)![0]).toBe(remapPixel(128,128,128,.15,.8)[0])
  expect(remapPixel(128,128,128,.15,.8)[0]).not.toBe(128)
})

vi.mock('electron',()=>({screen:{getPrimaryDisplay:()=>({bounds:{x:0,y:0,width:1920,height:1080},scaleFactor:1})}}))
it('Q10: timeoutMs=0 is rejected explicitly before attempting desktop input',async()=>{
  const ctx:any={getSettings:()=>({...DEFAULT_SETTINGS,stepDelayMs:0}),log:()=>{},isRunning:()=>false,userStop:()=>false,sendStep:()=>{},permission:()=> 'auto'}
  const r=await callTool('act.wait',{ms:50,timeoutMs:0},ctx)
  expect(r.ok).toBe(false);expect(r.message).toContain('pozitif')
})

it('Q8: false openPath result appears as a visible loop-item error',async()=>{
  const p=sideProps();(window as any).xpAgent={openPath:vi.fn(async()=>false)}
  act(()=>{mounted=create(createElement(SidePanel,p))})
  await act(async()=>{mounted!.root.findAll(x=>typeof x.props.className==='string'&&x.props.className.startsWith('xp-tick-row'))[0].props.onDoubleClick()})
  expect(mounted!.root.findAllByProps({role:'status'}).some(n=>n.children.join('').includes('Öğe açılamadı'))).toBe(true)
  delete (window as any).xpAgent
})

it('D1: LLM draft survives actual SidePanel tab unmount/remount and unrelated settings changes',()=>{
  let switchTab!:(tab:'node'|'llm')=>void,change!:(patch:Partial<typeof DEFAULT_SETTINGS>)=>void
  const Host=()=>{const[settings,setSettings]=useState(structuredClone(DEFAULT_SETTINGS));const[tab,setTab]=useState<'node'|'llm'>('llm');switchTab=setTab;change=patch=>setSettings(prev=>({...prev,...patch}));return createElement(SidePanel,{...sideProps(),settings,setSettings,tab})}
  act(()=>{mounted=create(createElement(Host))})
  act(()=>mounted!.root.findAllByType('textarea')[0].props.onChange({target:{value:'PERSIST_DRAFT'}}))
  act(()=>switchTab('node'));act(()=>change({stepDelayMs:123}));act(()=>switchTab('llm'))
  expect(mounted!.root.findAllByType('textarea')[0].props.value).toBe('PERSIST_DRAFT')
})
