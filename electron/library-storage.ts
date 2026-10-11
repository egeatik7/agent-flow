import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CanvasBook, CanvasLibrary } from './graph-types'
import { validateLibrary } from './library-tree'

type File = { format: 'nubbo-library'; version: 1; revision: string; library: CanvasLibrary }
const FILE = 'nubbo-library.json'
function decode(raw: string): File {
 const doc = JSON.parse(raw) as File
 if (doc.format !== 'nubbo-library' || doc.version !== 1 || typeof doc.revision !== 'string') throw Error('Bu klasör geçerli bir Nubbo kütüphanesi içermiyor.')
 validateLibrary(doc.library); return doc
}
function atomic(file: string, data: string) {
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
 private raw = ''
 constructor(public directory: string) { this.directory = path.resolve(directory) }
 get file() { return path.join(this.directory, FILE) }
 load(legacy?: CanvasLibrary): CanvasLibrary {
  if (!fs.existsSync(this.file)) {
   if (!legacy) throw Error('Kütüphane dosyası bulunamadı. Eski kayıtların üzerine boş kütüphane yazılmadı.')
   validateLibrary(legacy); fs.mkdirSync(this.directory, { recursive: true })
   locked(this.directory,()=>{if(!fs.existsSync(this.file))atomic(this.file, JSON.stringify({ format: 'nubbo-library', version: 1, revision: randomUUID(), library: legacy }, null, 2))})
  }
  this.raw = fs.readFileSync(this.file, 'utf8'); return decode(this.raw).library
 }
 save(library: CanvasLibrary): void {
  validateLibrary(library)
  locked(this.directory,()=>{
  const current = fs.readFileSync(this.file, 'utf8')
  if (current !== this.raw) throw Error('Kütüphane başka bir programda değişti. Yeniden açmadan üzerine yazılmaz.')
  if (JSON.stringify(decode(current).library) === JSON.stringify(library)) return
  const next = JSON.stringify({ format: 'nubbo-library', version: 1, revision: randomUUID(), library }, null, 2)
  fs.mkdirSync(path.join(this.directory, 'Backups'), { recursive: true })
  atomic(path.join(this.directory, 'Backups', `${Date.now()}-${randomUUID()}.json`), current)
  atomic(this.file, next); this.raw = next
  const backups = fs.readdirSync(path.join(this.directory, 'Backups')).filter(f => /^\d+-[\w-]+\.json$/.test(f)).sort()
  for (const old of backups.slice(0, Math.max(0, backups.length - 30))) { try { fs.unlinkSync(path.join(this.directory, 'Backups', old)) } catch { /* Saved catalog stays valid. */ } }
  })
 }
 backup(): string {
  const current = fs.readFileSync(this.file, 'utf8'); decode(current)
  const directory = path.join(this.directory, 'Backups'); fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, `${Date.now()}-${randomUUID()}.json`); atomic(file, current); return file
 }
 restore(file: string): CanvasLibrary {
  const library = decode(fs.readFileSync(file, 'utf8')).library
  this.save(library); return library
 }
}
export function librarySession(book: CanvasBook): CanvasBook {
 const copy = { ...book }; delete copy.library; return copy
}
