import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CanvasBook, CanvasLibrary } from './graph-types'
import { validateLibrary } from './library-tree'
import { encodeLibrary, decodeLibrary } from './library-database'

type File = { format: 'nubbo-library'; version: 1; revision: string; library: CanvasLibrary }
const FILE = 'Nubbo.library'
function decode(raw: string): File {
 const doc = JSON.parse(raw) as File
 if (doc.format !== 'nubbo-library' || doc.version !== 1 || typeof doc.revision !== 'string') throw Error('Bu klasör geçerli bir Nubbo kütüphanesi içermiyor.')
 validateLibrary(doc.library); return doc
}
function atomic(file: string, data: string|Uint8Array) {
 const temp = `${file}.${randomUUID()}.tmp`
 try { const fd=fs.openSync(temp,'wx');try{fs.writeFileSync(fd,data,'utf8');fs.fsyncSync(fd)}finally{fs.closeSync(fd)};fs.renameSync(temp,file) }
 finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
}
function locked<T>(directory:string, fn:()=>T):T {
 fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,'.nubbo-library.lock'),nonce=randomUUID()
 let fd:number
 try{fd=fs.openSync(file,'wx')}catch(e){
  if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e
  const owner=JSON.parse(fs.readFileSync(file,'utf8')) as {format?:string;pid?:number}
  if(owner.format!=='nubbo-lock'||!Number.isInteger(owner.pid)||(owner.pid ?? 0)<=0)throw Error('Kütüphane kilidi okunamadı; mevcut dosyalar korunuyor.')
  let gone=false;try{process.kill(owner.pid!,0)}catch(err){gone=(err as NodeJS.ErrnoException).code==='ESRCH'}
  if(!gone)throw Error('Kütüphane şu anda başka bir Nubbo tarafından kaydediliyor. Tekrar dene.')
  fs.unlinkSync(file);fd=fs.openSync(file,'wx')
 }
 try{fs.writeFileSync(fd,JSON.stringify({format:'nubbo-lock',pid:process.pid,nonce}));return fn()}
 finally{fs.closeSync(fd);try{if(JSON.parse(fs.readFileSync(file,'utf8')).nonce===nonce)fs.unlinkSync(file)}catch{/* Another owner must keep its lock. */}}
}
/** Portable catalog only: API keys and session tabs stay in the local profile. */
export class LibraryStorage {
 private raw:Buffer=Buffer.alloc(0)
 private catalogJSON=''
 constructor(public directory: string) { this.directory = path.resolve(directory) }
 get file() { return path.join(this.directory, FILE) }
 get legacyFile(){return path.join(this.directory,'nubbo-library.json')}
 load(legacy?: CanvasLibrary): CanvasLibrary {
  if (!fs.existsSync(this.file)) {
   if(!legacy&&!fs.existsSync(this.legacyFile))throw Error('Kütüphane dosyası bulunamadı. Eski kayıtların üzerine boş kütüphane yazılmadı.')
   locked(this.directory,()=>{
    if(fs.existsSync(this.file))return
    const old=fs.existsSync(this.legacyFile)?decode(fs.readFileSync(this.legacyFile,'utf8')).library:legacy
    if(!old)throw Error('Kütüphane dosyası bulunamadı. Eski kayıtların üzerine boş kütüphane yazılmadı.')
    const next=encodeLibrary(old);decodeLibrary(next);atomic(this.file,next)
    if(fs.existsSync(this.legacyFile)){fs.mkdirSync(path.join(this.directory,'Backups'),{recursive:true});fs.renameSync(this.legacyFile,path.join(this.directory,'Backups',`Legacy-${Date.now()}-${randomUUID()}.json`))}
   })
  }
  const raw=fs.readFileSync(this.file),library=decodeLibrary(raw);this.raw=raw;this.catalogJSON=JSON.stringify(library);return library
 }
 save(library: CanvasLibrary): void {
  validateLibrary(library)
  locked(this.directory,()=>{
  const current = fs.readFileSync(this.file)
  if (!current.equals(this.raw)) throw Error('Kütüphane başka bir programda değişti. Yeniden açmadan üzerine yazılmaz.')
  const json=JSON.stringify(library);if(this.catalogJSON===json)return
  const next = encodeLibrary(library)
  fs.mkdirSync(path.join(this.directory, 'Backups'), { recursive: true })
  atomic(path.join(this.directory, 'Backups', `${Date.now()}-${randomUUID()}.library`), current)
  atomic(this.file, next); this.raw = next;this.catalogJSON=json
  const backups = fs.readdirSync(path.join(this.directory, 'Backups')).filter(f => /^\d+-[\w-]+\.library$/.test(f)).sort()
  for (const old of backups.slice(0, Math.max(0, backups.length - 30))) { try { fs.unlinkSync(path.join(this.directory, 'Backups', old)) } catch { /* Saved catalog stays valid. */ } }
  })
 }
 backup(): string {
  const current = fs.readFileSync(this.file); decodeLibrary(current)
  const directory = path.join(this.directory, 'Backups'); fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, `${Date.now()}-${randomUUID()}.library`); atomic(file, current); return file
 }
 restore(file: string): CanvasLibrary {
  const raw=fs.readFileSync(file),library=raw.subarray(0,16).toString()==='SQLite format 3\0'?decodeLibrary(raw):decode(raw.toString('utf8')).library
  this.save(library); return library
 }
}
export function librarySession(book: CanvasBook): CanvasBook {
 const copy = { ...book }; delete copy.library; return copy
}
