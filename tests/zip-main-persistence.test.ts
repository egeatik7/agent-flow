import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { ZipLibraryStorage } from '../electron/zip-library-storage'
import { zipCanvasDocument,copyZipCanvas } from '../electron/zip-canvas-document'
import { zipDocumentFor } from '../electron/zip-workspace'
import { normalizeCanvasBook,createNode,type CanvasBook } from '../electron/graph-types'
import { sameCanvasContent } from '../electron/canvas-content'
const source=ts.createSourceFile('main.ts',fs.readFileSync(new URL('../electron/main.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true)
const functions=new Map<string,string>();let perform=''
function visit(n:ts.Node){if(ts.isFunctionDeclaration(n)&&n.name&&['loadCanvases','storeWorkspace'].includes(n.name.text))functions.set(n.name.text,n.getText(source));if(ts.isCallExpression(n)&&n.expression.getText(source)==='ipcMain.handle'&&ts.isStringLiteral(n.arguments[0])&&n.arguments[0].text==='zip-library:action')perform=n.arguments[1].getText(source);ts.forEachChild(n,visit)}visit(source)
const compiled=ts.transpileModule([...functions.values()].join('\n')+`\n({loadCanvases,storeWorkspace,perform:${perform}})`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
const dirs:string[]=[];afterEach(()=>{for(const d of dirs.splice(0))fs.rmSync(d,{recursive:true,force:true})})
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nubbo-zip-main-'));dirs.push(dir);const storage=new ZipLibraryStorage(dir);const values:Record<string,unknown>={canvases:{activeId:'old',tabs:[{id:'old',name:'Old',graph:{nodes:[],edges:[]}}],library:{canvases:[],automations:[]}}};const store={get:(key:string)=>values[key],set:(key:string|Record<string,unknown>,value?:unknown)=>{if(typeof key==='string')values[key]=structuredClone(value);else Object.assign(values,structuredClone(key))}};const callbacks=vm.runInNewContext(compiled,{zipStorage:storage,zipSnapshot:undefined,store,normalizeCanvasBook,viewerState:{setBook(){}},app:{getPath:()=>dir},path,fs,structuredClone,running:false,recoveryActive:false,mainWindow:{},zipDocumentFor,copyZipCanvas,sameCanvasContent}) as {loadCanvases():CanvasBook;storeWorkspace(b:CanvasBook,w?:string):{conflict:boolean};perform(e:unknown,a:unknown):Promise<{library:ReturnType<ZipLibraryStorage['load']>}>};return {storage,values,...callbacks}}
const document=()=>zipCanvasDocument({format:'nubbo-canvas',version:1,canvasId:'canvas',name:'Canvas',nodes:[createNode('start',0,0)],edges:[]})
describe('main uses ZIP files separately from profile sessions',()=>{
 it('session autosave does not reopen/inflate every ZIP after the initial load',()=>{
  const f=fixture();const b=f.loadCanvases();const scan=vi.spyOn(f.storage,'load');f.storeWorkspace(b);f.storeWorkspace(b);expect(scan).not.toHaveBeenCalled()
 })
 it('multi-canvas delete is one atomic ZIP rewrite with stale selection protection',async()=>{
  const f=fixture();f.storage.importDocuments('Group',[document(),{...document(),canvasId:'second',name:'Second'},{...document(),canvasId:'keep',name:'Keep'}]);const g=f.storage.load().groups[0]
  await f.perform(undefined,{action:'deleteCanvases',id:g.id,revision:g.revision,canvasIds:['canvas','second']});expect(f.storage.load().groups[0].canvases.map(c=>c.canvasId)).toEqual(['keep'])
  const fresh=f.storage.load().groups[0];await expect(f.perform(undefined,{action:'deleteCanvases',id:fresh.id,revision:fresh.revision,canvasIds:['missing']})).rejects.toThrow('seçimi değişti');expect(f.storage.load().groups[0].revision).toBe(fresh.revision)
 })

 it('does not load or migrate the discarded old catalog and open tabs',()=>{const f=fixture(),b=f.loadCanvases();expect(b.workspaceVersion).toBe(3);expect(b.tabs).toEqual([]);expect(b).not.toHaveProperty('library');expect(fs.readdirSync(f.storage.directory)).toEqual([])})
 it('automatic session save never publishes renderer library data or rewrites a ZIP',()=>{const f=fixture();f.storage.importDocuments('Group',[document()]);const before=f.storage.load().groups[0].revision,b=f.loadCanvases();b.zipLibrary!.groups=[];f.storeWorkspace(b,'window');expect(f.storage.load().groups[0].revision).toBe(before);expect(f.values.zipCanvases).not.toHaveProperty('zipLibrary');expect(f.values.zipCanvases).not.toHaveProperty('library')})
 it('tool branch save preserves window-owned tabs and does not publish ZIPs',()=>{const f=fixture();const b=f.loadCanvases();b.tabs=[{id:'tab',name:'Working',graph:{nodes:[createNode('start',0,0)],edges:[]}}];b.activeId='tab';f.storeWorkspace(b);f.storeWorkspace({...b,tabs:[],branches:[{id:'branch'}]},'tools');const loaded=f.loadCanvases();expect(loaded.tabs[0].id).toBe('tab');expect(loaded.branches).toEqual([{id:'branch'}]);expect(fs.readdirSync(f.storage.directory)).toEqual([])})
 it('explicit create/reorder IPC writes ordinary ZIPs and expected order',async()=>{const f=fixture();await f.perform(undefined,{action:'create',name:'Group'});let g=f.storage.load().groups[0];f.storage.saveGroup(g.id,[document(),{...document(),canvasId:'second',name:'Second'}],g.revision);g=f.storage.load().groups[0];const result=await f.perform(undefined,{action:'reorder',id:g.id,revision:g.revision,order:['second','canvas']});expect(result.library.groups[0].canvases.map(c=>c.canvasId)).toEqual(['second','canvas']);expect(fs.readdirSync(f.storage.directory)).toEqual(['Group.zip'])})
 it('imported same-ID JSON cannot overwrite its existing record even inside the same ZIP',async()=>{
  const f=fixture();f.storage.importDocuments('Group',[document()]);const g=f.storage.load().groups[0]
  await expect(f.perform(undefined,{action:'saveCanvas',id:g.id,revision:g.revision,tab:{id:'imported',canvasId:'canvas',name:'Changed version',graph:{nodes:[createNode('start',0,0)],edges:[]}}})).rejects.toThrow('kimliği')
  expect(f.storage.load().groups[0].revision).toBe(g.revision)
 })
 it('stale UI revision cannot reorder a changed ZIP',async()=>{const f=fixture();f.storage.importDocuments('Group',[document()]);const g=f.storage.load().groups[0];f.storage.saveGroup(g.id,[{...document(),name:'External change'}],g.revision);await expect(f.perform(undefined,{action:'reorder',id:g.id,revision:g.revision,order:['canvas']})).rejects.toThrow('değişti')})
})
