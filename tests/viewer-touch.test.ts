// @vitest-environment jsdom
import { createElement,act } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import NodeCanvas from '../src/components/NodeCanvas'
import { ViewerGesture } from '../src/viewer/gesture'
import { createNode } from '../electron/graph-types'
let root:Root,host:HTMLDivElement
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals()})
function pointer(target:Element,type:string,id:number,x:number,y:number){const event=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y});Object.defineProperty(event,'pointerId',{value:id});act(()=>target.dispatchEvent(event))}
describe('tablet touch canvas',()=>{
 it('pans from a node without moving/selecting it, then inspects a tap',()=>{
  const write=vi.fn(),inspect=vi.fn(),select=vi.fn(),node={...createNode('type',0,0),id:'touch-node'}
  act(()=>root.render(createElement(NodeCanvas,{readOnly:true,onInspect:inspect,graph:{nodes:[node],edges:[]},canvasKey:'a',selectedNodeId:null,selectedIds:[],selectedEdgeId:null,stepStatus:{},running:false,onSelectNode:select,onSelectMany:select,onSelectEdge:select,onMoveNodes:write,onSetMembership:write,onWrap:write,onConnect:write,onAddAfter:write,onAddAt:write,onDeleteNode:write,onDeleteEdge:write,onDuplicate:write,onRunFrom:write,onEnterPackage:write,onUnpackPackage:write})))
  const canvas=host.querySelector('.canvas-scroll')!,el=host.querySelector('[data-node-id="touch-node"]')!,before=(canvas as HTMLElement).style.backgroundPosition
  pointer(el,'pointerdown',1,50,50);pointer(canvas,'pointermove',1,100,80);pointer(canvas,'pointerup',1,100,80)
  expect((canvas as HTMLElement).style.backgroundPosition).not.toBe(before);expect(write).not.toHaveBeenCalled();expect(select).not.toHaveBeenCalled();expect(inspect).not.toHaveBeenCalled();expect(host.querySelector('.marquee')).toBeNull()
  pointer(el,'pointerdown',2,50,50);pointer(canvas,'pointerup',2,50,50);expect(inspect).toHaveBeenCalledWith('touch-node')
  act(()=>el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:50,clientY:50})));act(()=>window.dispatchEvent(new MouseEvent('mousemove',{clientX:200,clientY:200})));act(()=>window.dispatchEvent(new MouseEvent('mouseup')));expect(write).not.toHaveBeenCalled();expect(select).not.toHaveBeenCalled()
 })
 it('anchors pinch zoom and continues one-finger pan without a jump or accidental tap',()=>{
  const g=new ViewerGesture(),start={x:20,y:10,z:1};g.down(1,{x:100,y:100},start,'node');g.down(2,{x:200,y:100},start,null)
  const zoom=g.move(2,{x:300,y:100})!;expect(zoom.z).toBe(1.8);expect((200-zoom.x)/zoom.z).toBeCloseTo((150-start.x)/start.z)
  expect(g.up(2,zoom)).toBeNull();const moved=g.move(1,{x:110,y:105})!;expect(moved.x).toBeCloseTo(zoom.x+10);expect(moved.y).toBeCloseTo(zoom.y+5);expect(g.up(1,moved)).toBeNull()
  g.down(3,{x:10,y:10},start,'node');expect(g.up(3,start,true)).toBeNull();g.down(4,{x:10,y:10},start,'node');g.clear();expect(g.up(4,start)).toBeNull()
 })
})
