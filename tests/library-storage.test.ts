import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it,vi } from 'vitest'
import { initializeLibraryDatabase, decodeLibrary } from '../electron/library-database'
import { LibraryStorage, librarySession } from '../electron/library-storage'
import { changeLibrary, isArchived } from '../electron/library-tree'
import { normalizeCanvasBook, type CanvasBook } from '../electron/graph-types'
import { saveCanvas, saveAutomation } from '../electron/canvas-library'
const dirs:string[]=[]
beforeAll(initializeLibraryDatabase)
const dir=()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'nubbo-library-test-'));dirs.push(d);return d}
afterEach(()=>{for(const d of dirs.splice(0))fs.rmSync(d,{recursive:true,force:true})})
const book=():CanvasBook=>({activeId:'tab',tabs:[{id:'tab',savedId:'c',name:'Canvas',graph:{nodes:[],edges:[]}}],library:{folders:[{id:'f',name:'Hunyuan',section:'canvas'}],canvases:[{id:'c',name:'Canvas',folderId:'f',graph:{nodes:[],edges:[]},updatedAt:0}],automations:[{id:'a',name:'Run',folderId:'f',entries:[{id:'entry',canvasId:'c'}],updatedAt:0}]}})
describe('portable library and recoverable storage',()=>{
 it('migrates without changing IDs; the library contains no open session or settings',()=>{
  const b=book(),store=new LibraryStorage(dir());expect(store.load(b.library)).toEqual(b.library)
  const bytes=fs.readFileSync(store.file),raw=decodeLibrary(bytes);expect(bytes.subarray(0,16).toString()).toBe('SQLite format 3\0');expect(raw.automations[0].entries[0].canvasId).toBe('c');expect(Object.keys(raw)).not.toContain('tabs');expect(Object.keys(raw)).not.toContain('settings');expect(librarySession(b).library).toBeUndefined()
 })
 it('backs up catalog changes, restores them, and preserves folder metadata on explicit Save',()=>{
  const b=book(),store=new LibraryStorage(dir());store.load(b.library)
  const saved=saveCanvas(b,'tab');expect(saved.library!.canvases[0].folderId).toBe('f')
  const next=changeLibrary(saved,{action:'archive',refs:[{kind:'folder',id:'f'}],archived:true});store.save(next.library!)
  const backup=path.join(store.directory,'Backups',fs.readdirSync(path.join(store.directory,'Backups'))[0]);expect(store.restore(backup)).toEqual(b.library)
  const edited=saveAutomation(b,{id:'a',name:'Changed',entries:b.library!.automations[0].entries,expected:b.library!.automations[0]});expect(edited.library!.automations[0].folderId).toBe('f')
 })
 it('detects another writer and retains both its catalog and this attempted change',()=>{
  const d=dir(),first=new LibraryStorage(d),second=new LibraryStorage(d),b=book();first.load(b.library);second.load()
  const other=changeLibrary(b,{action:'newFolder',name:'Other'});second.save(other.library!)
  expect(()=>first.save(b.library!)).toThrow('başka bir programda');expect(new LibraryStorage(d).load()).toEqual(other.library)
 })
 it('refuses a missing or corrupt chosen library without creating an empty replacement',()=>{
  const store=new LibraryStorage(dir());expect(()=>store.load()).toThrow('bulunamadı');expect(fs.existsSync(store.file)).toBe(false)
  fs.writeFileSync(store.file,'broken');expect(()=>store.load(book().library)).toThrow();expect(fs.readFileSync(store.file,'utf8')).toBe('broken')
 })
 it('rejects folder cycles and orphan references before any disk write',()=>{
  const b=book();const child=changeLibrary(b,{action:'newFolder',name:'Child',parentId:'f'});const id=child.library!.folders![1].id
  expect(()=>changeLibrary(child,{action:'move',refs:[{kind:'folder',id:'f'}],parentId:id})).toThrow('kendi içine')
  expect(()=>changeLibrary(b,{action:'move',refs:[{kind:'canvas',id:'c'}],parentId:'missing'})).toThrow('klasörü')
  expect(()=>changeLibrary(b,{action:'deleteFolder',id:'f'})).toThrow('dolu')
 })
 it('archive hides descendants without deleting automation links; individual restore stays visible',()=>{
  const archived=changeLibrary(book(),{action:'archive',refs:[{kind:'folder',id:'f'}],archived:true});expect(isArchived(archived.library!,archived.library!.canvases[0])).toBe(true)
  expect(archived.library!.automations[0].entries).toEqual([{id:'entry',canvasId:'c'}])
  const restored=changeLibrary(archived,{action:'archive',refs:[{kind:'canvas',id:'c'}],archived:false});expect(isArchived(restored.library!,restored.library!.canvases[0])).toBe(false)
  const normalized=normalizeCanvasBook(archived);expect(normalized.library!.folders).toEqual(archived.library!.folders);expect(normalized.library!.canvases[0].folderId).toBe('f');expect(normalized.library!.automations[0].folderId).toBe('f')
 })
 it('moves a selected folder and its selected children together without flattening the tree',()=>{
  const b=book();b.library!.folders!.push({id:'target',name:'Blender'})
  const refs=[{kind:'folder' as const,id:'f'},{kind:'canvas' as const,id:'c'}]
  const moved=changeLibrary(b,{action:'move',refs,parentId:'target'})
  expect(moved.library!.folders![0].parentId).toBe('target');expect(moved.library!.canvases[0].folderId).toBe('f')
  const archived=changeLibrary(moved,{action:'archive',refs,archived:true})
  expect(archived.library!.canvases[0].archived).toBeUndefined()
  const restored=changeLibrary(archived,{action:'archive',refs,archived:false})
  expect(restored.library!.canvases[0].folderId).toBe('f');expect(isArchived(restored.library!,restored.library!.canvases[0])).toBe(false)
  expect(restored.library!.automations[0].entries).toEqual(b.library!.automations[0].entries)
 })
 it('refuses a live writer lock without changing either file, and releases its own lock',()=>{
  const store=new LibraryStorage(dir()),b=book();store.load(b.library)
  const file=path.join(store.directory,'.nubbo-library.lock'),raw=fs.readFileSync(store.file,'utf8')
  const lock=JSON.stringify({format:'nubbo-lock',pid:process.pid,nonce:'other'});fs.writeFileSync(file,lock)
  const next=changeLibrary(b,{action:'newFolder',name:'Extra'})
  expect(()=>store.save(next.library!)).toThrow('başka bir Nubbo');expect(fs.readFileSync(store.file,'utf8')).toBe(raw);expect(fs.readFileSync(file,'utf8')).toBe(lock)
  fs.unlinkSync(file);store.save(next.library!);expect(fs.existsSync(file)).toBe(false);expect(store.load()).toEqual(next.library)
 })
 it('retains a new automation folder through draft recovery and explicit Save',()=>{
  const b=book();b.automationDraft={key:'draft',name:'New',folderId:'f',entries:[]}
  const normalized=normalizeCanvasBook(b);const saved=saveAutomation(normalized,normalized.automationDraft!)
  expect(saved.library!.automations.at(-1)!.folderId).toBe('f')
 })
 it('migrates an existing JSON catalog once, keeping the exact source as a backup',()=>{
  const storage=new LibraryStorage(dir()),old=JSON.stringify({format:'nubbo-library',version:1,revision:'old',library:book().library},null,2);fs.writeFileSync(storage.legacyFile,old)
  expect(storage.load()).toEqual(book().library);expect(fs.existsSync(storage.legacyFile)).toBe(false)
  const backup=fs.readdirSync(path.join(storage.directory,'Backups')).find(f=>f.startsWith('Legacy-'))!;expect(fs.readFileSync(path.join(storage.directory,'Backups',backup),'utf8')).toBe(old)
  expect(new LibraryStorage(storage.directory).load()).toEqual(book().library)
 })
 it('preserves malformed legacy data and refuses migration or a corrupt database',()=>{
  const storage=new LibraryStorage(dir());fs.writeFileSync(storage.legacyFile,'broken legacy')
  expect(()=>storage.load(book().library)).toThrow();expect(fs.existsSync(storage.file)).toBe(false);expect(fs.readFileSync(storage.legacyFile,'utf8')).toBe('broken legacy')
  fs.writeFileSync(storage.file,'broken database');expect(()=>storage.load(book().library)).toThrow();expect(fs.readFileSync(storage.file,'utf8')).toBe('broken database')
 })
 it('retains the previous database and can retry if publishing the new file fails',()=>{
  const storage=new LibraryStorage(dir()),b=book();storage.load(b.library);const original=fs.readFileSync(storage.file),next=changeLibrary(b,{action:'newFolder',name:'New'})
  const rename=fs.renameSync,mocked=vi.spyOn(fs,'renameSync').mockImplementation((from,to)=>{if(String(to)===storage.file)throw Error('Disk write failed');return rename(from,to)})
  try{expect(()=>storage.save(next.library!)).toThrow('Disk write failed');expect(fs.readFileSync(storage.file)).toEqual(original);expect(fs.readdirSync(storage.directory).some(f=>f.endsWith('.tmp'))).toBe(false)}finally{mocked.mockRestore()}
  storage.save(next.library!);expect(new LibraryStorage(storage.directory).load()).toEqual(next.library)
 })
})
