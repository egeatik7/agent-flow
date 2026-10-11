// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import CanvasLibrary from '../src/components/CanvasLibrary'
import type { CanvasLibrary as Library } from '../electron/graph-types'

let host:HTMLDivElement,root:Root
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
const library=():Library=>({folders:[{id:'folder',name:'Hunyuan'},{id:'target',name:'Blender'}],canvases:[{id:'one',name:'Image 1',folderId:'folder',graph:{nodes:[],edges:[]},updatedAt:1},{id:'two',name:'Image 2',folderId:'folder',graph:{nodes:[],edges:[]},updatedAt:1}],automations:[{id:'run',name:'Production',entries:[{id:'entry',canvasId:'one'}],updatedAt:1}]})
const props=()=>({library:library(),tabs:[],disabled:false,onConfirm:async()=>true,onSaveCanvas:vi.fn(),onOpenCanvas:vi.fn(),onCloseCanvas:vi.fn(),onRenameCanvas:async()=>true,onDeleteCanvas:vi.fn(),onOpenAutomation:vi.fn(),onSaveAutomation:vi.fn(),onDeleteAutomation:vi.fn(),onExportAutomation:vi.fn(),onLibraryChange:vi.fn(async()=>true)})
const event=async(el:Element,type:string,init:MouseEventInit={})=>act(async()=>{el.dispatchEvent(new MouseEvent(type,{bubbles:true,...init}))})
const button=(text:string,scope:ParentNode=document)=>[...scope.querySelectorAll('button')].find(el=>el.textContent===text)!
const row=(name:string,scope:ParentNode=host)=>[...scope.querySelectorAll('[role=treeitem]')].find(el=>el.querySelector('.library-tree-name')?.textContent===name)!

it('keeps row actions in a dismissible context menu and archives the selected canvas',async()=>{
 const p=props();await act(async()=>root.render(createElement(CanvasLibrary,p)))
 await event(host.querySelector('[aria-label="Genişlet Hunyuan"]')!,'click')
 const canvas=row('Image 1');expect(canvas.querySelectorAll('button')).toHaveLength(1)
 expect(document.querySelector('[role=menu]')).toBeNull()
 await event(canvas,'contextmenu',{clientX:100,clientY:100})
 expect(button('Yeniden Adlandır…',document.querySelector('[role=menu]')!)).toBeDefined()
 await event(button('Arşivle',document.querySelector('[role=menu]')!),'click')
 expect(p.onLibraryChange).toHaveBeenCalledWith({action:'archive',refs:[{kind:'canvas',id:'one'}],archived:true})
 expect(document.querySelector('[role=menu]')).toBeNull()
})

it('attaches the expanded list to its automation row and adds through the folder picker',async()=>{
 const p=props();await act(async()=>root.render(createElement(CanvasLibrary,p)))
 await event(button('Otomasyonlar',host),'click');const automation=row('Production')
 await event(automation,'dblclick');expect(automation.nextElementSibling?.className).toBe('automation-editor-attached')
 expect(automation.nextElementSibling?.textContent).toContain('Image 1')
 await event(button('Tuval Ekle…',host),'click')
 const picker=document.querySelector('[role=dialog]')!;expect(picker.getAttribute('aria-label')).toBe('Otomasyona Tuval Ekle')
 await event(picker.querySelector('[aria-label="Genişlet Hunyuan"]')!,'click')
 expect(row('Image 1',picker)).toBeUndefined();await event(row('Image 2',picker),'click');await event(button('Ekle',picker),'click')
 expect(document.querySelector('[role=dialog]')).toBeNull();expect(host.querySelectorAll('.automation-entry')).toHaveLength(2)
 await event(automation,'dblclick');expect(host.querySelector('.automation-editor-attached')).toBeNull()
})

it('drops a canvas on a folder once; dropping on another canvas does not move it to the root',async()=>{
 const p=props();await act(async()=>root.render(createElement(CanvasLibrary,p)));await event(host.querySelector('[aria-label="Genişlet Hunyuan"]')!,'click')
 const values=new Map<string,string>(),dataTransfer={setData:(k:string,v:string)=>values.set(k,v),getData:(k:string)=>values.get(k)||'',effectAllowed:'',dropEffect:''}
 const drag=async(el:Element,type:string)=>act(async()=>{const e=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,'dataTransfer',{value:dataTransfer});el.dispatchEvent(e)})
 await drag(row('Image 1'),'dragstart');await drag(row('Image 2'),'drop');expect(p.onLibraryChange).not.toHaveBeenCalled()
 await drag(row('Blender'),'drop');expect(p.onLibraryChange).toHaveBeenCalledExactlyOnceWith({action:'move',refs:[{kind:'canvas',id:'one'}],parentId:'target'})
})
