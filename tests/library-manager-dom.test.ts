// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import CanvasLibrary from '../src/components/CanvasLibrary'
import type { CanvasLibrary as Library } from '../electron/graph-types'
import type { AutomationEditor } from '../electron/graph-types'

let host:HTMLDivElement,root:Root
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
const library=():Library=>({folders:[{id:'folder',name:'Hunyuan',section:'canvas'},{id:'target',name:'Blender',section:'canvas'},{id:'afolder',name:'Hunyuan',section:'automation'}],canvases:[{id:'one',name:'Image 1',folderId:'folder',graph:{nodes:[],edges:[]},updatedAt:1},{id:'two',name:'Image 2',folderId:'folder',graph:{nodes:[],edges:[]},updatedAt:1}],automations:[{id:'run',name:'Production',entries:[{id:'entry',canvasId:'one'}],updatedAt:1}]})
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

it('selects a Shift range and drags the entire selection together',async()=>{
 const p=props();await act(async()=>root.render(createElement(CanvasLibrary,p)));await event(host.querySelector('[aria-label="Genişlet Hunyuan"]')!,'click')
 await event(row('Image 1'),'click');await event(row('Image 2'),'click',{shiftKey:true});expect(host.querySelectorAll('[aria-selected=true][role=treeitem]')).toHaveLength(2)
 const values=new Map<string,string>(),dataTransfer={setData:(k:string,v:string)=>values.set(k,v),getData:(k:string)=>values.get(k)||'',effectAllowed:'',dropEffect:''}
 for(const [el,type] of [[row('Image 1'),'dragstart'],[row('Blender'),'drop']] as const)await act(async()=>{const e=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,'dataTransfer',{value:dataTransfer});el.dispatchEvent(e)})
 expect(p.onLibraryChange).toHaveBeenCalledExactlyOnceWith({action:'move',refs:[{kind:'canvas',id:'one'},{kind:'canvas',id:'two'}],parentId:'target'})
})

it('draws a selection box from empty space and keeps the selected items after release',async()=>{
 const p=props();await act(async()=>root.render(createElement(CanvasLibrary,p)));await event(host.querySelector('[aria-label="Genişlet Hunyuan"]')!,'click')
 const tree=host.querySelector('[role=tree]')!;vi.spyOn(tree,'getBoundingClientRect').mockReturnValue(new DOMRect(0,0,260,320))
 Array.from(tree.querySelectorAll('[role=treeitem]')).forEach((el,i)=>vi.spyOn(el,'getBoundingClientRect').mockReturnValue(new DOMRect(0,i*30,200,25)))
 await event(tree,'mousedown',{button:0,clientX:240,clientY:70});await act(async()=>window.dispatchEvent(new MouseEvent('mousemove',{clientX:50,clientY:119})))
 expect(host.querySelector('.library-marquee')).not.toBeNull();expect(row('Image 1').getAttribute('aria-selected')).toBe('true');expect(row('Image 2').getAttribute('aria-selected')).toBe('true');expect(row('Hunyuan').getAttribute('aria-selected')).toBe('false')
 await act(async()=>window.dispatchEvent(new MouseEvent('mouseup')));expect(host.querySelector('.library-marquee')).toBeNull();expect(host.querySelectorAll('[aria-selected=true][role=treeitem]')).toHaveLength(2)
})

it('keeps a new automation inside its chosen folder through creation and acknowledged Save',async()=>{
 const saved=vi.fn()
 function Harness(){const [lib,setLib]=useState(library()),[draft,setDraft]=useState<AutomationEditor|null>(null);return createElement(CanvasLibrary,{...props(),library:lib,draft,onDraftChange:setDraft,onSaveAutomation:async d=>{saved(d);const record={id:'new-record',name:d.name,folderId:d.folderId,entries:d.entries,updatedAt:2};setLib(current=>({...current,automations:[...current.automations,record]}));return record}})}
 await act(async()=>root.render(createElement(Harness)));await event(button('Otomasyonlar',host),'click');await event(row('Hunyuan'),'contextmenu');await event(button('Yeni Otomasyon',document.querySelector('[role=menu]')!),'click')
 const draftRow=host.querySelector('.library-tree-row.draft')!;expect(draftRow.getAttribute('aria-level')).toBe('2');expect(row('Hunyuan').getAttribute('aria-expanded')).toBe('true');expect(draftRow.nextElementSibling?.className).toBe('automation-editor-attached')
 await event(button('Kaydet',host),'click');expect(saved).toHaveBeenCalledWith(expect.objectContaining({folderId:'afolder',name:'Otomasyon 1'}));expect(row('Otomasyon 1').getAttribute('aria-level')).toBe('2');expect(row('Otomasyon 1').nextElementSibling?.className).toBe('automation-editor-attached');expect(host.querySelector('.library-tree-row.draft')).toBeNull();expect(host.textContent).toContain('Kayıt güncel.')
})

it('does not save a different automation editor from another row context menu',async()=>{
 const p=props();p.library.automations.push({id:'other',name:'Other',entries:[],updatedAt:1});await act(async()=>root.render(createElement(CanvasLibrary,p)));await event(button('Otomasyonlar',host),'click');await event(row('Production'),'dblclick')
 await event(row('Production'),'contextmenu');await event(button('Yeniden Adlandır…',document.querySelector('[role=menu]')!),'click');const input=document.querySelector<HTMLInputElement>('[role=dialog] input')!;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;await act(async()=>{setter.call(input,'Changed');input.dispatchEvent(new Event('input',{bubbles:true}))});await event(button('Kaydet',document.querySelector('[role=dialog]')!),'click')
 await event(row('Other'),'contextmenu');const save=button('Değişiklikleri Kaydet',document.querySelector('[role=menu]')!);expect(save.disabled).toBe(true);await event(save,'click');expect(p.onSaveAutomation).not.toHaveBeenCalled()
})

it('deletes the whole multi-selection from the context menu in one batch',async()=>{
 const p={...props(),onDeleteItems:vi.fn(async(_refs: import('../electron/library-tree').LibraryRef[])=>true)};await act(async()=>root.render(createElement(CanvasLibrary,p)))
 await event(host.querySelector('[aria-label="Genişlet Hunyuan"]')!,'click')
 await event(row('Image 1'),'click');await event(row('Image 2'),'click',{ctrlKey:true});await event(row('Image 1'),'contextmenu')
 const menu=document.querySelector('[role=menu]')!;expect(button('Sil…',menu)).toBeUndefined()
 await event(button('Seçilenleri Sil… (2)',menu),'click')
 expect(p.onDeleteItems).toHaveBeenCalledTimes(1)
 expect(p.onDeleteItems.mock.calls[0][0]).toEqual([{kind:'canvas',id:'one'},{kind:'canvas',id:'two'}])
 expect(p.onDeleteCanvas).not.toHaveBeenCalled()
})
it('Delete key sends the whole selection and a failed save keeps it selected',async()=>{
 const p={...props(),onDeleteItems:vi.fn(async(_refs: import('../electron/library-tree').LibraryRef[])=>false)};await act(async()=>root.render(createElement(CanvasLibrary,p)))
 await event(host.querySelector('[aria-label="Genişlet Hunyuan"]')!,'click')
 await event(row('Image 1'),'click');await event(row('Image 2'),'click',{ctrlKey:true})
 await act(async()=>row('Image 2').dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true})))
 expect(p.onDeleteItems).toHaveBeenCalledTimes(1)
 expect(host.querySelectorAll('[aria-selected=true][role=treeitem]')).toHaveLength(2)
})

it('marquee selection is deleted as one batch through Delete',async()=>{
 const p={...props(),onDeleteItems:vi.fn(async(_refs: import('../electron/library-tree').LibraryRef[])=>true)};await act(async()=>root.render(createElement(CanvasLibrary,p)));await event(host.querySelector('[aria-label="Genişlet Hunyuan"]')!,'click')
 const tree=host.querySelector('[role=tree]')!;vi.spyOn(tree,'getBoundingClientRect').mockReturnValue(new DOMRect(0,0,260,320))
 Array.from(tree.querySelectorAll('[role=treeitem]')).forEach((el,i)=>vi.spyOn(el,'getBoundingClientRect').mockReturnValue(new DOMRect(0,i*30,200,25)))
 await event(tree,'mousedown',{button:0,clientX:240,clientY:70});await act(async()=>window.dispatchEvent(new MouseEvent('mousemove',{clientX:50,clientY:119})));await act(async()=>window.dispatchEvent(new MouseEvent('mouseup')))
 await act(async()=>tree.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true})))
 expect(p.onDeleteItems).toHaveBeenCalledTimes(1)
 expect(p.onDeleteItems.mock.calls[0][0].map(r=>r.id)).toEqual(['one','two'])
})

it('legacy mixed folders are visible in both sections instead of losing their hierarchy',async()=>{
 const p=props();p.library.folders!.push({id:'legacy',name:'Mixed legacy'});p.library.canvases[0].folderId='legacy';p.library.automations[0].folderId='legacy'
 await act(async()=>root.render(createElement(CanvasLibrary,p)));expect(row('Mixed legacy')).toBeTruthy()
 await event(button('Otomasyonlar',host),'click');expect(row('Mixed legacy')).toBeTruthy()
})
it('a selected synthetic automation draft is passed separately from stored batch refs',async()=>{
 const p={...props(),onDeleteItems:vi.fn(async(_refs:import('../electron/library-tree').LibraryRef[],_draft?:{key:string;name:string})=>true)}
 await act(async()=>root.render(createElement(CanvasLibrary,p)));await event(button('Otomasyonlar',host),'click');await event(host.querySelector('[role=tree]')!,'contextmenu');await event(button('Yeni Otomasyon',document.querySelector('[role=menu]')!),'click')
 const draftRow=host.querySelector('.library-tree-row.draft')!;const key=draftRow.getAttribute('data-library-key')!.replace('automation:','')
 await event(draftRow,'click');await event(row('Production'),'click',{ctrlKey:true})
 await act(async()=>host.querySelector('[role=tree]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true})))
 expect(p.onDeleteItems).toHaveBeenCalledWith([{kind:'automation',id:'run'}],expect.objectContaining({key,name:'Otomasyon 1'}))
 expect(host.querySelector('.library-tree-row.draft')).toBeNull()
})
