import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CanvasBook, CanvasLibrary } from './graph-types'
import { validateLibrary, ensureSections } from './library-tree'
import { encodeLibrary, decodeLibrary } from './library-database'
import { claimLibraryLock, withLibraryLock as locked, type LibraryLock } from './library-lock'

type File = { format: 'nubbo-library'; version: 1; revision: string; library: CanvasLibrary }
/** Disk ile bellek ayrıştığında fırlatılır; çağıran bunu ayrı bir DURUM olarak yönetir, yazmayı zorlamaz. */
export class LibraryConflictError extends Error {
 readonly code = 'LIBRARY_CONFLICT'
 constructor(message: string) { super(message); this.name = 'LibraryConflictError' }
}
export function isLibraryConflict(error: unknown): boolean {
 return !!error && typeof error === 'object' && (error as { code?: string }).code === 'LIBRARY_CONFLICT'
}
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
/** Portable catalog only: API keys and session tabs stay in the local profile. */
export class LibraryStorage {
 private raw:Buffer=Buffer.alloc(0)
 private catalogJSON=''
 private claimLock?: LibraryLock
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
  const raw=fs.readFileSync(this.file),library=ensureSections(decodeLibrary(raw));this.raw=raw;this.catalogJSON=JSON.stringify(library);return library
 }
 save(library: CanvasLibrary): void {
  library = ensureSections(library)
  validateLibrary(library)
  locked(this.directory,()=>{
  let current:Buffer
  try { current = fs.readFileSync(this.file) } catch (e) { throw Error(`Kütüphane dosyası okunamadı (${(e as Error).message}); kayıt yapılmadı.`) }
  if (!current.equals(this.raw)) throw new LibraryConflictError('Kütüphane başka bir programda değişti. Yeniden açmadan üzerine yazılmaz.')
  const json=JSON.stringify(library);if(this.catalogJSON===json)return
  const next = encodeLibrary(library)
  fs.mkdirSync(path.join(this.directory, 'Backups'), { recursive: true })
  atomic(path.join(this.directory, 'Backups', `${Date.now()}-${randomUUID()}.library`), current)
  atomic(this.file, next); this.raw = next;this.catalogJSON=json
  const backups = fs.readdirSync(path.join(this.directory, 'Backups')).filter(f => /^\d+-[\w-]+\.library$/.test(f)).sort()
  for (const old of backups.slice(0, Math.max(0, backups.length - 30))) { try { fs.unlinkSync(path.join(this.directory, 'Backups', old)) } catch { /* Saved catalog stays valid. */ } }
  })
 }
 /** Disk bellekteki kopyadan farklı mı. Kaydetmeden önce durumu bilmek için (hata fırlatmaz). */
 stale(): boolean {
  try { return !fs.readFileSync(this.file).equals(this.raw) } catch { return false }
 }
 /** Güncel kütüphaneyi diskten yeniden okur: çakışma sonrası toparlanma yolu. */
 reload(legacy?: CanvasLibrary): CanvasLibrary {
  return this.load(legacy)
 }
 /** Kütüphane bazında yazıcı sahipliği: oturum boyu tutulur, ölü sahipten devralınır. */
 claim(): void {
  if (this.claimLock) { this.claimLock.assertOwned(); return }
  this.claimLock = claimLibraryLock(this.directory)
 }
 release(): void {
  const lock = this.claimLock
  this.claimLock = undefined
  lock?.release()
 }
 backup(): string {
  const current = fs.readFileSync(this.file); decodeLibrary(current)
  const directory = path.join(this.directory, 'Backups'); fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, `${Date.now()}-${randomUUID()}.library`); atomic(file, current); return file
 }
 restore(file: string): CanvasLibrary {
  const raw=fs.readFileSync(file),library=ensureSections(raw.subarray(0,16).toString()==='SQLite format 3\0'?decodeLibrary(raw):decode(raw.toString('utf8')).library)
  this.reload(); this.save(library); return library
 }
}
export function librarySession(book: CanvasBook): CanvasBook {
 const copy = { ...book }; delete copy.library; return copy
}
