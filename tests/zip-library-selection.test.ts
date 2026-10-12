// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ZipCanvasLibrary from '../src/components/ZipCanvasLibrary'
import type { ZipLibrarySnapshot } from '../electron/zip-library-storage'
const doc=(id:string)=>({format:'nubbo-canvas' as const,version:1 as const,canvasId:id,name:id,nodes:[],edges:[]})
const library:ZipLibrarySnapshot={directory:'lib',groups:[{id:'Group.zip',name:'Group',archived:false,revision:'r',canvases:[doc('A'),doc('B'),doc('C')]}]}
let host:HTMLDivElement,root:Root
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals()})
function fixture(confirm=true){const onAction=vi.fn(async()=>true),onConfirm=vi.fn(async()=>confirm);act(()=>root.render(createElement(ZipCanvasLibrary,{library,disabled:false,onAction,onConfirm,onOpenCanvas:vi.fn(),onOpenGroup:vi.fn(),onNewCanvas:vi.fn(),onSaveCanvas:vi.fn(),onManage:vi.fn()})));act(()=>host.querySelector<HTMLButtonElement>('[role=treeitem]')!.click());return {onAction,onConfirm}}
function rows(){return Array.from(host.querySelectorAll<HTMLButtonElement>('[role=treeitem]'))}
function click(row:HTMLButtonElement,keys:MouseEventInit={}){act(()=>row.dispatchEvent(new MouseEvent('click',{bubbles:true,...keys})))}
async function remove(){const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Sil')!;await act(async()=>{button.click();await Promise.resolve()})}
it('Ctrl and Shift select multiple JSONs and one delete rewrites the ZIP once',async()=>{
 const h=fixture(),r=rows();click(r[1]);click(r[2],{ctrlKey:true});expect(r.filter(n=>n.getAttribute('aria-selected')==='true')).toHaveLength(2);await remove();expect(h.onConfirm).toHaveBeenCalledTimes(1);expect(h.onAction).toHaveBeenCalledExactlyOnceWith({action:'deleteCanvases',id:'Group.zip',revision:'r',canvasIds:['A','B']})
 click(r[1]);click(r[3],{shiftKey:true});expect(rows().filter(n=>n.getAttribute('aria-selected')==='true')).toHaveLength(3)
})
it('marquee selection from empty space really selects rows and Delete removes all selected JSONs',async()=>{
 const h=fixture(),tree=host.querySelector<HTMLElement>('[role=tree]')!,r=rows();tree.setPointerCapture=vi.fn();vi.spyOn(tree,'getBoundingClientRect').mockReturnValue(new DOMRect(0,0,200,160));r.forEach((row,i)=>vi.spyOn(row,'getBoundingClientRect').mockReturnValue(new DOMRect(0,i*28,180,26)))
 for(const [type,x,y] of [['pointerdown',190,80],['pointermove',10,30],['pointerup',10,30]] as const)act(()=>{const event=new MouseEvent(type,{bubbles:true,button:0,clientX:x,clientY:y});Object.defineProperty(event,'pointerId',{value:1});tree.dispatchEvent(event)})
 expect(rows().filter(n=>n.getAttribute('aria-selected')==='true').map(n=>n.textContent)).toEqual(['01 · A','02 · B']);await act(async()=>{tree.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Delete'}));await Promise.resolve()});expect(h.onAction).toHaveBeenCalledExactlyOnceWith({action:'deleteCanvases',id:'Group.zip',revision:'r',canvasIds:['A','B']})
})
it('cancel keeps selection and performs no delete; selected parent includes children only once',async()=>{
 const h=fixture(false),r=rows();click(r[1]);click(r[2],{ctrlKey:true});await remove();expect(h.onAction).not.toHaveBeenCalled();expect(rows().filter(n=>n.getAttribute('aria-selected')==='true')).toHaveLength(2)
 click(r[0],{ctrlKey:true});expect(rows().filter(n=>n.getAttribute('aria-selected')==='true')).toHaveLength(3)
})
it('a selected ZIP and its children delete only the ZIP once',async()=>{
 const h=fixture(),r=rows();click(r[1]);click(r[0],{ctrlKey:true});await remove();expect(h.onAction).toHaveBeenCalledExactlyOnceWith({action:'deleteGroup',id:'Group.zip',revision:'r'})
})
