// @vitest-environment jsdom
import { act,createElement } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import { afterEach,beforeEach,expect,it,vi } from 'vitest'
import CanvasTabs from '../src/components/CanvasTabs'
import { reorderCanvasTab } from '../electron/canvas-library'
let host:HTMLDivElement,root:Root
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals()})
it('shows short COLORLESS tabs with only close buttons and drag reordering',()=>{
 const onReorder=vi.fn(),name='Long canvas name that must stay intact in storage',p={tabs:[{id:'a',name},{id:'b',name:'Second'},{id:'c',name:'Third'}],activeId:'a',disabled:false,running:false,onReorder,onSelect:vi.fn(),onAdd:vi.fn(),onClose:vi.fn(),onRename:vi.fn(),onRunAll:vi.fn(),onStop:vi.fn()}
 act(()=>root.render(createElement(CanvasTabs,p)));const tabs=Array.from(host.querySelectorAll<HTMLElement>('[role=tab]'))
 expect(tabs.every(t=>!t.style.getPropertyValue('--tab-hue'))).toBe(true);expect(tabs[0].title).toBe(name);expect(tabs[0].querySelector('.canvas-tab-name')!.textContent).toBe(name.slice(0,24)+'…');expect(tabs[0].querySelectorAll('button')).toHaveLength(1);expect(host.querySelector('[title="Tuvali sola taşı"]')).toBeNull()
 const data=new Map<string,string>(),dataTransfer={setData:(k:string,v:string)=>data.set(k,v),getData:(k:string)=>data.get(k)||'',effectAllowed:'',dropEffect:''};vi.spyOn(tabs[2],'getBoundingClientRect').mockReturnValue(new DOMRect(100,0,100,25))
 for(const [target,type] of [[tabs[0],'dragstart'],[tabs[2],'dragover'],[tabs[2],'drop']] as const)act(()=>{const e=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:180});Object.defineProperty(e,'dataTransfer',{value:dataTransfer});target.dispatchEvent(e)})
 expect(onReorder).toHaveBeenCalledExactlyOnceWith('a','c',true)
 act(()=>root.render(createElement(CanvasTabs,{...p,tabs:[p.tabs[2],p.tabs[0],p.tabs[1]]})));expect(Array.from(host.querySelectorAll<HTMLElement>('[role=tab]')).every(t=>!t.style.getPropertyValue('--tab-hue'))).toBe(true)
})
it('reorders in both directions by IDs, preserving active canvas, graph and metadata',()=>{
 const tabs=['a','b','c','d'].map(id=>({id,name:id,graph:{nodes:[],edges:[]}})),book={activeId:'c',tabs,branches:['owned by tools']}
 const after=reorderCanvasTab(book,'a','c',true);expect(after.tabs.map(t=>t.id)).toEqual(['b','c','a','d']);expect(after.activeId).toBe('c');expect(after.tabs[2]).toBe(tabs[0]);expect(after.branches).toBe(book.branches)
 expect(reorderCanvasTab(after,'d','b').tabs.map(t=>t.id)).toEqual(['d','b','c','a']);expect(reorderCanvasTab(book,'gone','a')).toBe(book);expect(book.tabs.map(t=>t.id)).toEqual(['a','b','c','d'])
})
