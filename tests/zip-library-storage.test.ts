import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { afterEach, describe, expect, it } from 'vitest'
import { ZipLibraryStorage, ZipLibraryConflictError, type ZipCanvasGroup } from '../electron/zip-library-storage'
import { zipCanvasDocument, copyZipCanvas } from '../electron/zip-canvas-document'
import { readJsonZip, writeJsonZip } from '../electron/zip-container'
import { createNode } from '../electron/graph-types'
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })
function store() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nubbo-zip-test-')); dirs.push(dir); return new ZipLibraryStorage(dir) }
const canvas = (name = 'Tuval', id = name) => zipCanvasDocument({ format: 'nubbo-canvas', version: 1, canvasId: id, name, nodes: [createNode('start', 0, 0)], edges: [] })
const group = (s: ZipLibraryStorage, name = 'Grup') => s.load().groups.find(g => g.name === name)!
const save = (s: ZipLibraryStorage, g: ZipCanvasGroup, docs: ReturnType<typeof canvas>[]) => s.saveGroup(g.id, docs, g.revision)

describe('actual ZIP files are the only library records', () => {
 it('creates an empty library without a catalog, database, backup directory or lasting lock', () => {
  const s = store(); expect(s.load().groups).toEqual([]); expect(fs.readdirSync(s.directory)).toEqual([])
 })
 it('creating a group immediately creates a normal ZIP', () => {
  const s = store(); s.createGroup('Çalışma'); expect(fs.readdirSync(s.directory)).toEqual(['Çalışma.zip'])
  expect(new AdmZip(path.join(s.directory, 'Çalışma.zip')).getEntries()).toHaveLength(0)
 })
 it('saves one independent JSON per canvas, with identity inside JSON and no manifest', () => {
  const s = store(); s.createGroup('Grup'); save(s, group(s), [canvas('Bir'), canvas('İki')])
  const zip = new AdmZip(path.join(s.directory, 'Grup.zip'))
  expect(zip.getEntries().map(e => e.entryName)).toEqual(['0001_Bir.json', '0002_İki.json'])
  expect(JSON.parse(zip.readAsText('0002_İki.json')).canvasId).toBe('İki')
  expect(fs.readdirSync(s.directory)).toEqual(['Grup.zip'])
 })
 it('physical ordinal filenames preserve order after a fresh process/storage load', () => {
  const s = store(); s.createGroup('Grup'); save(s, group(s), [canvas('Bir'), canvas('İki'), canvas('Üç')])
  const g = group(s); s.reorderGroup(g.id, ['Üç', 'Bir', 'İki'], g.revision)
  expect(new ZipLibraryStorage(s.directory).load().groups[0].canvases.map(c => c.canvasId)).toEqual(['Üç', 'Bir', 'İki'])
  expect(new AdmZip(path.join(s.directory, 'Grup.zip')).getEntries().map(e => e.entryName)).toEqual(['0001_Üç.json','0002_Bir.json','0003_İki.json'])
 })
 it('bad reorder never changes the ZIP', () => {
  const s = store(); s.createGroup('Grup'); save(s, group(s), [canvas('Bir'), canvas('İki')]); const g=group(s)
  for (const order of [['Bir'], ['Bir','Bir'], ['Bir','Missing']]) expect(() => s.reorderGroup(g.id,order,g.revision)).toThrow()
  expect(group(s).revision).toBe(g.revision)
 })
 it('unchanged explicit save does not rewrite the ZIP', () => {
  const s=store();s.createGroup('Grup');save(s,group(s),[canvas()]);const g=group(s)
  save(s,g,g.canvases);expect(group(s).revision).toBe(g.revision)
 })
 it('duplicate identity is an explicit conflict across groups, not silent re-ID', () => {
  const s=store();s.importDocuments('Bir',[canvas('A','identity')])
  expect(()=>s.importDocuments('İki',[canvas('B','identity')])).toThrow(ZipLibraryConflictError)
  expect(fs.readdirSync(s.directory)).toEqual(['Bir.zip'])
 })
 it('a copy explicitly gets a new canvas identity', () => {
  const s=store(),a=canvas();s.importDocuments('Bir',[a]);s.importDocuments('İki',[copyZipCanvas(a)])
  expect(new Set(s.load().groups.flatMap(g=>g.canvases.map(c=>c.canvasId))).size).toBe(2)
 })
 it('duplicate identity within one ZIP is rejected before any file is created', () => {
  const s=store(),a=canvas();expect(()=>s.importDocuments('Grup',[a,a])).toThrow(ZipLibraryConflictError)
  expect(fs.readdirSync(s.directory)).toEqual([])
 })
 it('external edits reject stale save, rename, archive and delete', () => {
  const s=store();s.importDocuments('Grup',[canvas()]);const g=group(s)
  const other=new ZipLibraryStorage(s.directory);save(other,group(other),[canvas('Changed','changed')])
  expect(()=>save(s,g,[canvas('Old')])).toThrow(ZipLibraryConflictError)
  expect(()=>s.renameGroup(g.id,'Rename',g.revision)).toThrow(ZipLibraryConflictError)
  expect(()=>s.archiveGroup(g.id,true,g.revision)).toThrow(ZipLibraryConflictError)
  expect(()=>s.deleteGroup(g.id,g.revision)).toThrow(ZipLibraryConflictError)
  expect(group(s).canvases[0].canvasId).toBe('changed')
 })
 it('archives and restores the ZIP itself, preserving its bytes and canvas identities', () => {
  const s=store();s.importDocuments('Grup',[canvas()]);const g=group(s),bytes=s.exportGroup(g.id,g.revision)
  s.archiveGroup(g.id,true,g.revision);const archived=group(s)
  expect(archived.id).toBe('Arşiv/Grup.zip');expect(archived.archived).toBe(true)
  expect(s.exportGroup(archived.id,archived.revision)).toEqual(bytes)
  s.archiveGroup(archived.id,false,archived.revision);expect(group(s).id).toBe('Grup.zip')
 })
 it('rename changes only the physical ZIP filename', () => {
  const s=store();s.importDocuments('Before',[canvas()]);const g=group(s,'Before');s.renameGroup(g.id,'After',g.revision)
  expect(group(s,'After').revision).toBe(g.revision);expect(fs.readdirSync(s.directory)).toEqual(['After.zip'])
 })
 it('a conflicting group name is never overwritten', () => {
  const s=store();s.createGroup('Grup');const g=group(s)
  expect(()=>s.createGroup('grup')).toThrow(ZipLibraryConflictError)
  s.createGroup('Other');expect(()=>s.renameGroup(g.id,'Other',g.revision)).toThrow(ZipLibraryConflictError)
 })
 it.each(['../escape','CON','nul.txt','bad/name','bad:group','..','ends.'])('rejects unsafe Windows group name %s', name=>{
  const s=store();expect(()=>s.createGroup(name)).toThrow();expect(fs.readdirSync(s.directory)).toEqual([])
 })
 it('imports an ordinary user ZIP of raw JSONs once, assigns identity, and strips ancillary files', () => {
  const s=store(),zip=new AdmZip();zip.addFile('02_İkinci.json',Buffer.from(JSON.stringify({nodes:[createNode('start',0,0)],edges:[]})))
  zip.addFile('01_İlk.json',Buffer.from(JSON.stringify({nodes:[createNode('start',0,0)],edges:[]})));zip.addFile('Beni_Oku.txt',Buffer.from('notes'))
  s.importZip('Akış',zip.toBuffer());const first=group(s,'Akış');expect(first.canvases.map(c=>c.name)).toEqual(['İlk','İkinci'])
  expect(first.canvases.every(c=>c.canvasId)).toBe(true);expect(readJsonZip(s.exportGroup(first.id,first.revision))).toHaveLength(2)
  expect(new ZipLibraryStorage(s.directory).load().groups[0].canvases.map(c=>c.canvasId)).toEqual(first.canvases.map(c=>c.canvasId))
 })
 it('native canvas with a missing identity is not silently repaired, even on import', () => {
  const s=store(),zip=new AdmZip();zip.addFile('bad.json',Buffer.from(JSON.stringify({format:'nubbo-canvas',version:1,name:'Bad',nodes:[],edges:[]})))
  expect(()=>s.importZip('Bad',zip.toBuffer())).toThrow('kimlik eksik');expect(fs.readdirSync(s.directory)).toEqual([])
 })
 it('a corrupt ZIP remains visible as a problem and does not hide a valid group', () => {
  const s=store();s.importDocuments('Valid',[canvas()]);fs.writeFileSync(path.join(s.directory,'Bad.zip'),'broken')
  const snap=s.load();expect(snap.groups.find(g=>g.name==='Bad')?.problem).toBeTruthy();expect(snap.groups.find(g=>g.name==='Valid')?.canvases).toHaveLength(1)
  save(s,group(s,'Valid'),[canvas('Updated','updated')]);expect(group(s,'Valid').canvases[0].canvasId).toBe('updated')
  const bad=group(s,'Bad');s.deleteGroup(bad.id,bad.revision);expect(fs.existsSync(path.join(s.directory,'Bad.zip'))).toBe(false)
 })
 it('manual copies of a ZIP flag both conflicting groups without changing either file', () => {
  const s=store();s.importDocuments('Original',[canvas()]);fs.copyFileSync(path.join(s.directory,'Original.zip'),path.join(s.directory,'Copy.zip'))
  expect(s.load().groups.every(g=>!!g.problem)).toBe(true)
  const original=group(s,'Original');expect(()=>save(s,original,original.canvases)).toThrow(ZipLibraryConflictError)
 })
 it('rejects traversal/nested JSON archive entries without extracting anything', () => {
  for(const name of ['../escape.json','nested/canvas.json']){
   const zip=new AdmZip();zip.addFile(name.startsWith('../') ? '..xescape.json' : name,Buffer.from('{}'));let data=zip.toBuffer();if(name.startsWith('../')) data=Buffer.from(data.toString('latin1').replaceAll('..xescape.json','../escape.json'),'latin1');expect(()=>readJsonZip(data)).toThrow()
  }
 })
 it('detects a corrupted CRC before JSON parsing', () => {
  const zip=writeJsonZip([{name:'canvas.json',data:Buffer.from('{"test":true}')}]);const central=zip.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));zip.writeUInt32LE(0,central+16)
  expect(()=>readJsonZip(zip)).toThrow('CRC')
 })
})
