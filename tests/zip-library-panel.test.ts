// @vitest-environment jsdom
import { createElement } from 'react'
import { act,create,type ReactTestRenderer,type ReactTestInstance } from 'react-test-renderer'
import { afterEach,describe,expect,it,vi } from 'vitest'
import ZipCanvasLibrary from '../src/components/ZipCanvasLibrary'
import type { ZipLibrarySnapshot } from '../electron/zip-library-storage'
import { createNode } from '../electron/graph-types'
const text=(n:ReactTestInstance):string=>n.children.map(c=>typeof c==='string'?c:text(c)).join('')
const doc=(id:string)=>({format:'nubbo-canvas' as const,version:1 as const,canvasId:id,name:id,nodes:[createNode('start',0,0)],edges:[]})
const library:ZipLibrarySnapshot={directory:'lib',groups:[{id:'Flow.zip',name:'Flow',archived:false,revision:'r',canvases:[doc('First'),doc('Second')]},{id:'Arşiv/Old.zip',name:'Old',archived:true,revision:'a',canvases:[doc('Old')]}]}
let mounted:ReactTestRenderer|undefined
afterEach(()=>{if(mounted)act(()=>mounted!.unmount());mounted=undefined})
function fixture(){const handlers={onAction:vi.fn(async()=>true),onOpenCanvas:vi.fn(),onOpenGroup:vi.fn(),onNewCanvas:vi.fn(),onSaveCanvas:vi.fn(),onManage:vi.fn(),onConfirm:vi.fn(async()=>true)};act(()=>{mounted=create(createElement(ZipCanvasLibrary,{library,disabled:false,...handlers}))});return handlers}
const button=(label:string)=>mounted!.root.findAllByType('button').find(b=>text(b)===label)!
const context=(item:ReactTestInstance)=>act(()=>item.props.onContextMenu({preventDefault(){},stopPropagation(){},clientX:0,clientY:0}))
describe('ZIP library panel',()=>{
 it('has exactly Canvases and Archive tabs, without an Automations section',()=>{
  fixture();expect(mounted!.root.findAll(n=>n.props.role==='tab').map(text)).toEqual(['Tuvaller','Arşiv']);expect(text(mounted!.root)).not.toContain('Otomasyonlar')
 })
 it('Archive contains only physical archive ZIPs',()=>{
  fixture();act(()=>button('Arşiv').props.onClick());expect(text(mounted!.root)).toContain('Old.zip');expect(text(mounted!.root)).not.toContain('Flow.zip')
 })
 it('group context opens it as automation directly',()=>{
  const h=fixture();context(mounted!.root.findAll(n=>n.props.role==='treeitem')[0]);act(()=>button('Otomasyon olarak aç').props.onClick());expect(h.onOpenGroup).toHaveBeenCalledWith('Flow.zip')
 })
 it('expansion shows the physical JSON order',()=>{
  fixture();act(()=>mounted!.root.findAll(n=>n.props.role==='treeitem')[0].props.onClick());expect(mounted!.root.findAll(n=>n.props.role==='treeitem').slice(1).map(text)).toEqual(['01 · First','02 · Second'])
 })
 it('moving a canvas up sends one reordered ZIP save with the expected revision',()=>{
  const h=fixture();act(()=>mounted!.root.findAll(n=>n.props.role==='treeitem')[0].props.onClick());context(mounted!.root.findAll(n=>n.props.role==='treeitem')[2]);act(()=>button('Yukarı taşı').props.onClick());expect(h.onAction).toHaveBeenCalledWith({action:'reorder',id:'Flow.zip',revision:'r',order:['Second','First']})
 })
 it('opens ZIP import instead of importing an automation catalog',()=>{
  const h=fixture();act(()=>button('ZIP Aç…').props.onClick());expect(h.onAction).toHaveBeenCalledWith({action:'import',archived:false})
 })
})
