import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { randomUUID } from 'node:crypto'
import type { CanvasLibrary } from './graph-types'
import { validateLibrary } from './library-tree'

let sql:SqlJsStatic|undefined,pending:Promise<void>|undefined
export function initializeLibraryDatabase():Promise<void>{
 return pending??=(async()=>{sql=await initSqlJs({locateFile:()=>require.resolve('sql.js/dist/sql-wasm.wasm')})})()
}
function database(data?:Uint8Array){if(!sql)throw Error('Kütüphane veritabanı hazır değil.');return new sql.Database(data)}
const APP_ID=0x4e554242
export function encodeLibrary(library:CanvasLibrary):Buffer{
 validateLibrary(library);const db=database()
 try{
  db.run(`PRAGMA application_id=${APP_ID}; PRAGMA user_version=2; PRAGMA foreign_keys=ON;
   CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE folders(id TEXT PRIMARY KEY,name TEXT NOT NULL,parent_id TEXT REFERENCES folders(id) DEFERRABLE INITIALLY DEFERRED,archived INTEGER,position INTEGER NOT NULL,section TEXT);
   CREATE TABLE canvases(id TEXT PRIMARY KEY,name TEXT NOT NULL,folder_id TEXT REFERENCES folders(id),archived INTEGER,updated_at INTEGER NOT NULL,graph TEXT NOT NULL,position INTEGER NOT NULL);
   CREATE TABLE automations(id TEXT PRIMARY KEY,name TEXT NOT NULL,folder_id TEXT REFERENCES folders(id),archived INTEGER,updated_at INTEGER NOT NULL,position INTEGER NOT NULL);
   CREATE TABLE automation_entries(automation_id TEXT NOT NULL REFERENCES automations(id),id TEXT NOT NULL,canvas_id TEXT NOT NULL REFERENCES canvases(id),position INTEGER NOT NULL,PRIMARY KEY(automation_id,id),UNIQUE(automation_id,position)); BEGIN;`)
  const flag=(value:boolean|undefined)=>value===undefined?null:value?1:0
  db.run('INSERT INTO metadata VALUES (?,?)',['revision',randomUUID()]);db.run('INSERT INTO metadata VALUES (?,?)',['shape',JSON.stringify({folders:library.folders!==undefined,schemaVersion:library.schemaVersion})])
  library.folders?.forEach((f,i)=>db.run('INSERT INTO folders VALUES (?,?,?,?,?,?)',[f.id,f.name,f.parentId??null,flag(f.archived),i,f.section??null]))
  library.canvases.forEach((c,i)=>db.run('INSERT INTO canvases VALUES (?,?,?,?,?,?,?)',[c.id,c.name,c.folderId??null,flag(c.archived),c.updatedAt,JSON.stringify(c.graph),i]))
  library.automations.forEach((a,i)=>{db.run('INSERT INTO automations VALUES (?,?,?,?,?,?)',[a.id,a.name,a.folderId??null,flag(a.archived),a.updatedAt,i]);a.entries.forEach((e,j)=>db.run('INSERT INTO automation_entries VALUES (?,?,?,?)',[a.id,e.id,e.canvasId,j]))})
  db.run('COMMIT');return Buffer.from(db.export())
 }finally{db.close()}
}
function rows(db:Database,table:string){const statement=db.prepare(`SELECT * FROM ${table} ORDER BY position`),result:Record<string,unknown>[]=[];try{while(statement.step())result.push(statement.getAsObject())}finally{statement.free()}return result}
export function decodeLibrary(data:Uint8Array):CanvasLibrary{
 const db=database(data)
 try{
  // 1 = bolumsuz (eski) sema, 2 = klasor bolumu sutunlu. Ikisi de okunur; yazarken 2 damgalanir.
  const surum=Number(db.exec('PRAGMA user_version')[0]?.values[0]?.[0])
  if(db.exec('PRAGMA application_id')[0]?.values[0]?.[0]!==APP_ID||(surum!==1&&surum!==2))throw Error('Bu dosya geçerli bir Nubbo kütüphanesi değil.')
  if(db.exec('PRAGMA quick_check')[0]?.values[0]?.[0]!=='ok'||db.exec('PRAGMA foreign_key_check').length)throw Error('Kütüphane veritabanı veya bağlantıları bozuk.')
  const shape=JSON.parse(String(db.exec("SELECT value FROM metadata WHERE key='shape'")[0]?.values[0]?.[0]??'{}')) as {folders?:boolean;schemaVersion?:2}
  const common=(r:Record<string,unknown>)=>({id:String(r.id),name:String(r.name),...(r.archived===null?{}:{archived:r.archived===1})})
  const folder=(r:Record<string,unknown>)=>r.folder_id===null?{}:{folderId:String(r.folder_id)}
  const entries=rows(db,'automation_entries'),library:CanvasLibrary={
   ...(shape.schemaVersion===undefined?{}:{schemaVersion:shape.schemaVersion}),
   ...(shape.folders?{folders:rows(db,'folders').map(r=>({...common(r),...(r.parent_id===null?{}:{parentId:String(r.parent_id)}),...((r.section==='canvas'||r.section==='automation')?{section:r.section as 'canvas'|'automation'}:{})}))}:{}),
   canvases:rows(db,'canvases').map(r=>({...common(r),...folder(r),updatedAt:Number(r.updated_at),graph:JSON.parse(String(r.graph))})),
   automations:rows(db,'automations').map(r=>({...common(r),...folder(r),updatedAt:Number(r.updated_at),entries:entries.filter(e=>e.automation_id===r.id).map(e=>({id:String(e.id),canvasId:String(e.canvas_id)}))}))
  };validateLibrary(library);return library
 }finally{db.close()}
}
