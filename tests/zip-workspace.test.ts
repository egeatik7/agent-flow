import { describe, expect, it } from 'vitest'
import { createNode, normalizeCanvasBook, type CanvasBook } from '../electron/graph-types'
import { openZipGroup, openZipCanvas, zipCanvasDirty, savedZipTab, adoptZipLibrary } from '../electron/zip-workspace'
import type { ZipCanvasGroup } from '../electron/zip-library-storage'
const doc = (id: string) => ({ format: 'nubbo-canvas' as const, version: 1 as const, canvasId: id, name: id, nodes: [createNode('start',0,0)], edges: [] })
const group = (): ZipCanvasGroup => ({ id:'Flow.zip', name:'Flow', archived:false, revision:'revision', canvases:[doc('03'),doc('01'),doc('02')] })
const book = ():CanvasBook => ({ workspaceVersion:3,activeId:'',tabs:[],zipLibrary:{directory:'library',groups:[group()]} })
describe('ZIP order becomes the working sequence without automation records',()=>{
 it('opens top-to-bottom ZIP order as left-to-right tabs with the first active',()=>{
  const opened=openZipGroup(book(),group());expect(opened.tabs.map(t=>t.name)).toEqual(['03','01','02']);expect(opened.activeId).toBe(opened.tabs[0].id)
  expect(new Set(opened.tabs.map(t=>t.id)).size).toBe(3);expect(opened).not.toHaveProperty('automationDraft');expect(opened).not.toHaveProperty('library')
  expect(opened.tabs.every(t=>!zipCanvasDirty(opened,t))).toBe(true)
 })
 it('never aliases graphs from the ZIP snapshot into working tabs',()=>{
  const source=book(),opened=openZipGroup(source,source.zipLibrary!.groups[0]);opened.tabs[0].graph.nodes[0].title='Changed';expect(source.zipLibrary!.groups[0].canvases[0].nodes[0].title).toBe('Başlangıç')
  expect(zipCanvasDirty(opened,opened.tabs[0])).toBe(true)
 })
 it('opening one canvas appends a working tab without changing the saved file',()=>{
  const opened=openZipCanvas(book(),'01');expect(opened.tabs[0].savedId).toBe('01');expect(opened.zipLibrary!.groups[0].canvases).toHaveLength(3)
 })
 it('empty/broken ZIP groups cannot be opened as a sequence',()=>{
  expect(()=>openZipGroup(book(),{...group(),canvases:[]})).toThrow('boş');expect(()=>openZipGroup(book(),{...group(),problem:'broken'})).toThrow('broken')
 })
 it('deleting a file binding keeps its open content as an unsaved draft',()=>{
  const opened=openZipCanvas(book(),'01'),next=adoptZipLibrary(opened,{directory:'library',groups:[]});expect(next.tabs).toHaveLength(1);expect(next.tabs[0].savedId).toBeUndefined();expect(next.tabs[0].graph).toEqual(opened.tabs[0].graph);expect(zipCanvasDirty(next,next.tabs[0])).toBe(true)
 })
 it('a successful explicit save alone updates the tab baseline',()=>{
  const opened=openZipCanvas(book(),'01');opened.tabs[0].graph.nodes[0].title='Edited';const document={...doc('01'),nodes:opened.tabs[0].graph.nodes};const library={directory:'library',groups:[{...group(),canvases:[document]}]}
  const saved=savedZipTab(opened,opened.activeId,document,library);expect(zipCanvasDirty(saved,saved.tabs[0])).toBe(false)
 })
 it('saving one tab also detaches another open document deleted outside Nubbo',()=>{
  const opened=openZipCanvas(openZipCanvas(book(),'01'),'02'),saved=doc('01')
  const next=savedZipTab(opened,opened.tabs[0].id,saved,{directory:'library',groups:[{...group(),canvases:[saved]}]})
  expect(next.tabs[1].savedId).toBeUndefined();expect(next.tabs[1].baseline).toBeUndefined();expect(next.tabs[1].graph).toEqual(opened.tabs[1].graph);expect(zipCanvasDirty(next,next.tabs[1])).toBe(true)
 })
 it('v3 normalization never creates an old catalog from open tabs',()=>{
  const normalized=normalizeCanvasBook(openZipGroup(book(),group()));expect(normalized).not.toHaveProperty('library');expect(normalized.zipLibrary!.groups[0].canvases.map(c=>c.canvasId)).toEqual(['03','01','02'])
 })
 it('v3 keeps a full canvas name rather than silently shortening it on reopen',()=>{
  const opened=openZipCanvas(book(),'01');opened.tabs[0].name='Uzun '.repeat(20);expect(normalizeCanvasBook(opened).tabs[0].name).toBe(opened.tabs[0].name.trim())
 })
})

describe('explicit rename baseline safety', () => {
 it('reload preserves local name and baseline; explicit rename preserves dirty graph', async () => {
  const { adoptZipCanvasRename } = await import('../electron/zip-workspace')
  const opened = openZipCanvas(book(), '01')
  opened.tabs[0].graph.nodes[0].title = 'Unsaved edit'
  const renamed = { ...doc('01'), name: 'New name', nodes: opened.zipLibrary!.groups[0].canvases.find(c => c.canvasId === '01')!.nodes }
  const library = { directory:'library', groups:[{...group(), canvases:[renamed]}] }
  expect(adoptZipLibrary(opened, library).tabs[0].baseline!.name).toBe('01')
  const next = adoptZipCanvasRename(opened, library, '01')
  expect(next.tabs[0].name).toBe('New name')
  expect(next.tabs[0].baseline!.name).toBe('New name')
  expect(next.tabs[0].graph.nodes[0].title).toBe('Unsaved edit')
  expect(zipCanvasDirty(next, next.tabs[0])).toBe(true)
  expect(opened.tabs[0].baseline!.name).toBe('01')
 })
 it('explicit rename cannot erase an unsaved local name or legitimise a stale baseline', async () => {
  const { adoptZipCanvasRename } = await import('../electron/zip-workspace')
  const opened = openZipCanvas(book(), '01')
  opened.tabs[0].name = 'Local name'
  const old = opened.zipLibrary!.groups[0].canvases.find(c => c.canvasId === '01')!
  const library = {directory:'library',groups:[{...group(),canvases:[{...old,name:'Remote name'}]}]}
  expect(adoptZipCanvasRename(opened,library,'01').tabs[0].name).toBe('Local name')
  opened.tabs[0].baseline!.name = 'Stale name'
  expect(adoptZipCanvasRename(opened,library,'01').tabs[0].baseline!.name).toBe('Stale name')
  opened.tabs[0].baseline!.name = '01'
  const changed = structuredClone(library); changed.groups[0].canvases[0].nodes[0].title='External edit'
  expect(adoptZipCanvasRename(opened,changed,'01').tabs[0].baseline!.name).toBe('01')
 })
})
