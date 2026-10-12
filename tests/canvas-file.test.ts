import { describe, expect, it } from 'vitest'
import { createNode, normalizeCanvasBook } from '../electron/graph-types'
import { addCanvasTab, saveCanvas, saveCanvasAs, openSavedCanvas, exportAutomation, importAutomation, saveAutomation } from '../electron/canvas-library'
import { exportCanvasFile, readCanvasFile, importCanvasFile } from '../electron/canvas-file'
import { CanvasIdentityConflictError } from '../electron/canvas-identity'
const empty = () => normalizeCanvasBook({ activeId: '', tabs: [], library: { schemaVersion: 2, canvases: [], automations: [] } })
const saved = () => { const b=addCanvasTab(empty(),'A',{nodes:[createNode('start',0,0)],edges:[]});return saveCanvas(b,b.activeId) }
describe('portable canvas identity',()=>{
 it('keeps record identity across export/import into a different library, while using a separate tab identity',()=>{
  const source=saved(),record=source.library!.canvases[0],file=exportCanvasFile(record)
  const target=importCanvasFile(empty(),readCanvasFile(JSON.parse(JSON.stringify(file)),'Filename'))
  expect(target.library!.canvases[0].id).toBe(record.id);expect(target.tabs[0].id).not.toBe(record.id);expect(target.tabs[0].savedId).toBe(record.id)
  expect(file.nodes).toEqual(record.graph.nodes);expect(file.edges).toEqual(record.graph.edges)
 })
 it('reimporting identical identity and content reuses the record and clean tab',()=>{
  const source=saved(),file=exportCanvasFile(source.library!.canvases[0])
  const imported=importCanvasFile(source,readCanvasFile(file,'Name'))
  expect(imported.library!.canvases).toHaveLength(1);expect(imported.tabs).toHaveLength(1);expect(imported.activeId).toBe(source.activeId)
 })
 it('same identity with changed content conflicts atomically; Save As creates a separate identity',()=>{
  const source=saved(),before=structuredClone(source),file=exportCanvasFile(source.library!.canvases[0]);file.nodes[0].title='Changed version'
  const doc=readCanvasFile(file,'Name')
  expect(()=>importCanvasFile(source,doc)).toThrow(CanvasIdentityConflictError);expect(source).toEqual(before)
  const copy=importCanvasFile(source,doc,'Separate version')
  expect(copy.library!.canvases).toHaveLength(2);expect(copy.library!.canvases[1].id).not.toBe(file.canvasId)
  expect(copy.library!.canvases[0]).toEqual(before.library!.canvases[0]);expect(copy.library!.canvases[1].graph.nodes[0].title).toBe('Changed version')
 })
 it('same name and content with different identities remain different documents',()=>{
  const source=saved(),file={...exportCanvasFile(source.library!.canvases[0]),canvasId:'distinct-document'}
  const imported=importCanvasFile(source,readCanvasFile(file,'Name'))
  expect(imported.library!.canvases).toHaveLength(2);expect(imported.library!.canvases[1].id).toBe('distinct-document')
 })
 it('legacy nodes/edges imports still work and receive their own identity',()=>{
  const target=importCanvasFile(empty(),readCanvasFile({nodes:[],edges:[]},'Legacy'))
  expect(target.library!.canvases[0].name).toBe('Legacy');expect(target.library!.canvases[0].id).toBeTruthy()
 })
 it('an unsaved export retains identity when subsequently saved; Save As changes identity',()=>{
  const b=addCanvasTab(empty(),'Unsaved',{nodes:[],edges:[]}),file=exportCanvasFile(b.tabs[0]),normal=saveCanvas(b,b.activeId)
  expect(normal.library!.canvases[0].id).toBe(file.canvasId)
  const separate=saveCanvasAs(normal,normal.activeId,'Copy')
  expect(separate.tabs[0].savedId).not.toBe(file.canvasId)
  expect(exportCanvasFile(separate.tabs[0]).canvasId).toBe(separate.tabs[0].savedId)
  expect(normalizeCanvasBook(separate).tabs[0].canvasId).toBe(separate.tabs[0].canvasId)
 })
 it('a dirty open copy is preserved when an identical saved version is imported',()=>{
  const b=saved();b.tabs[0].graph.nodes[0].title='Dirty draft'
  const imported=importCanvasFile(b,readCanvasFile(exportCanvasFile(b.library!.canvases[0]),'Name'))
  expect(imported.tabs).toHaveLength(2);expect(imported.tabs[0].graph.nodes[0].title).toBe('Dirty draft')
 })
 it('normal Save does not silently republish a record missing after reload',()=>{
  const b=saved();b.library!.canvases=[]
  expect(()=>saveCanvas(b,b.activeId)).toThrow('Farklı Kaydet')
 })
 it('automation v2 preserves IDs in a fresh library and rejects a different version of an existing ID',()=>{
  let b=saved();b=saveAutomation(b,{name:'Pipeline',entries:[{id:'entry',canvasId:b.tabs[0].savedId!}]})
  const file=exportAutomation(b,b.library!.automations[0].id),fresh=importAutomation(empty(),file)
  expect(fresh.library!.canvases[0].id).toBe(file.canvases[0].id)
  file.canvases[0].graph.nodes[0].title='New version'
  expect(()=>importAutomation(b,file)).toThrow(CanvasIdentityConflictError)
  const copied=importAutomation(b,file,{copyConflicts:true,name:'Separate pipeline'})
  const created=copied.library!.automations.at(-1)!
  expect(created.name).toBe('Separate pipeline');expect(created.entries[0].canvasId).not.toBe(file.canvases[0].id)
  expect(copied.library!.canvases[0].graph.nodes[0].title).not.toBe('New version')
 })
 it('modern catalog duplicate identities are reported instead of silently reassigned',()=>{
  const b=saved();b.library!.canvases.push({...structuredClone(b.library!.canvases[0]),name:'Different version'})
  expect(()=>normalizeCanvasBook(b)).toThrow('aynı kimlikte')
 })
 it('modern records with missing identity are not silently assigned a new document identity',()=>{
  const b=saved();(b.library!.canvases[0] as {id?:string}).id=undefined
  expect(()=>normalizeCanvasBook(b)).toThrow('kimliği geçersiz')
 })
 it('rejects malformed identified files instead of pretending they are legacy graphs',()=>{
  for(const raw of [{nodes:[],edges:[],format:'nubbo-canvas',version:1},{nodes:[],edges:[],format:'nubbo-canvas',version:9,canvasId:'id'}]) expect(()=>readCanvasFile(raw,'Name')).toThrow()
 })
})
