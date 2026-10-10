// @vitest-environment jsdom
import { act,createElement } from 'react'
import {createRoot} from 'react-dom/client'
import {expect,it,vi} from 'vitest'
import NodeCanvas from '../src/components/NodeCanvas'
import {createNode} from '../electron/graph-types'
it('running=true prevents dragging an execution node',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 const node=createNode('click',80,80),move=vi.fn(),select=vi.fn()
 const props:any={graph:{nodes:[node],edges:[]},running:true,selectedNodeId:null,selectedIds:[],stepStatus:{},onSelectNode:select,onMoveNodes:move,onSetMembership:vi.fn(),onPasteTarget:vi.fn()}
 await act(async()=>root.render(createElement(NodeCanvas,props)))
 await act(async()=>{host.querySelector('[data-node-id]')!.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:100,clientY:100}))})
 await act(async()=>{window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:180,clientY:160}))})
 await act(async()=>{window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,clientX:180,clientY:160}))})
 expect(move).not.toHaveBeenCalled()
 await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()
})
it('Run cancels an existing drag, while idle dragging still works',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 const node=createNode('click',80,80),move=vi.fn(),membership=vi.fn()
 const props:any={graph:{nodes:[node],edges:[]},running:false,selectedNodeId:null,selectedIds:[],stepStatus:{},onSelectNode:vi.fn(),onMoveNodes:move,onSetMembership:membership,onPasteTarget:vi.fn()}
 await act(async()=>root.render(createElement(NodeCanvas,props)))
 await act(async()=>{host.querySelector('[data-node-id]')!.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:100,clientY:100}))})
 await act(async()=>{window.dispatchEvent(new MouseEvent('mousemove',{clientX:180,clientY:160}))})
 expect(move).toHaveBeenCalledTimes(1)
 await act(async()=>root.render(createElement(NodeCanvas,{...props,running:true})))
 await act(async()=>{window.dispatchEvent(new MouseEvent('mousemove',{clientX:250,clientY:220}))})
 await act(async()=>root.render(createElement(NodeCanvas,props)))
 await act(async()=>{window.dispatchEvent(new MouseEvent('mousemove',{clientX:300,clientY:250}));window.dispatchEvent(new MouseEvent('mouseup'))})
 expect(move).toHaveBeenCalledTimes(1)
 expect(membership).not.toHaveBeenCalled()
 await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()
})
it('running lock prevents edge deletion as well as node movement',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 const a=createNode('click',80,80),b=createNode('click',400,80),remove=vi.fn()
 const props:any={graph:{nodes:[a,b],edges:[{id:'edge',from:a.id,fromPort:'next',to:b.id}]},running:true,selectedNodeId:null,selectedIds:[],stepStatus:{},onDeleteEdge:remove,onPasteTarget:vi.fn()}
 await act(async()=>root.render(createElement(NodeCanvas,props)))
 await act(async()=>{host.querySelector('.edge-hit')!.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))})
 expect(remove).not.toHaveBeenCalled()
 await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()
})
