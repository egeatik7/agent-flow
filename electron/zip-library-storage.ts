import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { withLibraryLock } from './library-lock'
import { readJsonZip, writeJsonZip, ZIP_LIMITS } from './zip-container'
import { zipCanvasDocument, copyZipCanvas, type ZipCanvasDocument } from './zip-canvas-document'

export type ZipCanvasGroup = {
  /** Relative ZIP path, not a separate catalog identity. */
  id: string
  name: string
  archived: boolean
  revision: string
  canvases: ZipCanvasDocument[]
  problem?: string
}
export type ZipLibrarySnapshot = { directory: string; groups: ZipCanvasGroup[] }
export class ZipLibraryConflictError extends Error {
  readonly code = 'ZIP_LIBRARY_CONFLICT'
  constructor(message = 'ZIP grubu dışarıda değişti; yeniden yüklemeden üzerine yazılmadı.') { super(message); this.name = 'ZipLibraryConflictError' }
}
const ARCHIVE = 'Arşiv'
const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')
const collator = new Intl.Collator('tr', { numeric: true, sensitivity: 'variant' })
const fileKey = (name: string) => name.normalize('NFC').toUpperCase()

function groupFilename(name: string): string {
  const clean = name.trim()
  if (!clean || clean.length > 120 || /[<>:"/\\|?*\x00-\x1f]/.test(clean) || /[. ]$/.test(clean) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean)) throw new Error('ZIP grubu adı Windows için geçersiz.')
  return clean + '.zip'
}
function entryFilename(document: ZipCanvasDocument, index: number): string {
  const stem = document.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 120) || 'Tuval'
  return `${String(index + 1).padStart(4, '0')}_${stem}.json`
}
function groupBuffer(documents: ZipCanvasDocument[]): Buffer {
  return writeJsonZip(documents.map((document, index) => ({ name: entryFilename(document, index), data: Buffer.from(JSON.stringify(document, null, 2) + '\n') })))
}
function decodeGroup(buffer: Buffer, importing = false): ZipCanvasDocument[] {
  return readJsonZip(buffer).map(entry => {
    let raw: unknown
    try { raw = JSON.parse(entry.data.toString('utf8').replace(/^\uFEFF/, '')) } catch { throw new Error(`“${entry.name}” geçerli JSON değil.`) }
    return zipCanvasDocument(raw, importing ? entry.name.replace(/\.json$/i, '').replace(/^\d+[_ -]+/, '') : undefined)
  })
}

/** Only ZIP groups and canvas JSONs persist. There is no database or order manifest. */
export class ZipLibraryStorage {
  readonly directory: string
  constructor(directory: string) { this.directory = path.resolve(directory) }

  private sectionDirectory(archived: boolean): string {
    fs.mkdirSync(this.directory, { recursive: true })
    const root = fs.realpathSync(this.directory)
    if (!archived) return root
    const directory = path.join(root, ARCHIVE)
    if (fs.existsSync(directory)) {
      if (fs.lstatSync(directory).isSymbolicLink() || !fs.statSync(directory).isDirectory()) throw new Error('Arşiv yolu gerçek bir klasör olmalı.')
    } else fs.mkdirSync(directory)
    return directory
  }
  private groupPath(group: ZipCanvasGroup): string { return path.join(this.sectionDirectory(group.archived), path.basename(group.id)) }
  private readBuffer(file: string): Buffer {
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('ZIP grubu gerçek bir dosya olmalı.')
    if (stat.size > ZIP_LIMITS.archiveBytes) throw new Error('ZIP dosyası boyut sınırını aşıyor.')
    const data = fs.readFileSync(file)
    if (data.length > ZIP_LIMITS.archiveBytes) throw new Error('ZIP dosyası boyut sınırını aşıyor.')
    return data
  }
  private readSnapshot(): ZipLibrarySnapshot {
    const groups: ZipCanvasGroup[] = []
    const identities = new Map<string, string>()
    for (const archived of [false, true]) {
      // An empty library does not need an archive directory until something is archived.
      if (archived && !fs.existsSync(path.join(this.directory, ARCHIVE))) continue
      const directory = this.sectionDirectory(archived)
      const filenames = fs.readdirSync(directory).filter(n => /\.zip$/i.test(n)).sort(collator.compare)
      const names = new Map<string, string[]>()
      for (const filename of filenames) names.set(fileKey(filename), [...(names.get(fileKey(filename)) ?? []), filename])
      for (const filename of filenames) {
        const id = archived ? `${ARCHIVE}/${filename}` : filename
        const group: ZipCanvasGroup = { id, name: filename.slice(0, -4), archived, revision: '', canvases: [] }
        try {
          const buffer = this.readBuffer(path.join(directory, filename))
          group.revision = hash(buffer)
          group.canvases = decodeGroup(buffer)
          const own = new Set<string>()
          for (const canvas of group.canvases) {
            if (own.has(canvas.canvasId)) throw new ZipLibraryConflictError('ZIP içinde aynı kimlikli iki tuval var.')
            own.add(canvas.canvasId)
          }
          for (const canvas of group.canvases) {
            const owner = identities.get(canvas.canvasId)
            if (owner) {
              const message = `“${canvas.name}” kimliği hem “${owner}” hem “${id}” içinde var; kopya ayrı kimlikle kaydedilmeli.`
              group.problem = message
              const prior = groups.find(g => g.id === owner)
              if (prior) prior.problem = prior.problem ? `${prior.problem} ${message}` : message
            } else identities.set(canvas.canvasId, id)
          }
        } catch (error) { group.problem = (error as Error).message }
        const collisions = names.get(fileKey(filename)) ?? []
        if (collisions.length > 1) {
          const message = `Windows’ta aynı sayılan ZIP adları var: ${collisions.join(', ')}. Bu dosyalarda işlem yapılmaz; adları elle düzelt.`
          group.problem = group.problem ? `${group.problem} ${message}` : message
        }
        groups.push(group)
      }
    }
    return { directory: this.directory, groups }
  }
  load(): ZipLibrarySnapshot { return withLibraryLock(this.directory, () => this.readSnapshot()) }
  private freshGroup(snapshot: ZipLibrarySnapshot, id: string, revision: string, allowProblem = false): ZipCanvasGroup {
    const group = snapshot.groups.find(g => g.id === id)
    if (!group || group.revision !== revision) throw new ZipLibraryConflictError()
    // Even delete must not select one member of an ambiguous filename set.
    if (snapshot.groups.some(g => g.id !== group.id && g.archived === group.archived && fileKey(path.basename(g.id)) === fileKey(path.basename(group.id)))) {
      throw new ZipLibraryConflictError('Çakışan ZIP adında silme/yazma işlemi yapılmaz; adları elle düzelt.')
    }
    if (group.problem && !allowProblem) throw new ZipLibraryConflictError(group.problem)
    return group
  }
  private assertAvailable(snapshot: ZipLibrarySnapshot, filename: string, archived: boolean, excluding?: string): void {
    if (snapshot.groups.some(g => g.archived === archived && g.id !== excluding && fileKey(path.basename(g.id)) === fileKey(filename))) throw new ZipLibraryConflictError('Bu bölümde aynı adlı bir ZIP var; farklı bir ad seç.')
  }
  private validateDocuments(snapshot: ZipLibrarySnapshot, documents: ZipCanvasDocument[], owner?: string): ZipCanvasDocument[] {
    const clean = documents.map(d => zipCanvasDocument(d)), ids = new Set<string>()
    for (const document of clean) {
      if (ids.has(document.canvasId)) throw new ZipLibraryConflictError('Bir ZIP içinde aynı kimlikli iki tuval olamaz.')
      ids.add(document.canvasId)
      if (snapshot.groups.some(g => g.id !== owner && g.canvases.some(c => c.canvasId === document.canvasId))) throw new ZipLibraryConflictError(`“${document.name}” kimliği başka bir ZIP’te kullanılıyor; Farklı Kaydet gerekli.`)
    }
    return clean
  }
  private publish(file: string, data: Buffer, expected?: string): void {
    const temporary = path.join(path.dirname(file), `.${randomUUID()}.tmp`)
    try {
      const fd = fs.openSync(temporary, 'wx')
      try { fs.writeFileSync(fd, data); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      if (expected !== undefined) {
        let current: Buffer
        try { current = this.readBuffer(file) } catch { throw new ZipLibraryConflictError() }
        if (hash(current) !== expected) throw new ZipLibraryConflictError()
        fs.renameSync(temporary, file)
      } else {
        // link is an atomic no-replace publication: a concurrent creator is never overwritten.
        try { fs.linkSync(temporary, file) } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ZipLibraryConflictError('ZIP dosyası zaten var; üzerine yazılmadı.')
          throw error
        }
      }
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
  }
  createGroup(name: string, archived = false): ZipLibrarySnapshot {
    return this.importDocuments(name, [], archived)
  }
  importZip(name: string, buffer: Buffer, archived = false, asCopy = false): ZipLibrarySnapshot {
    const documents = decodeGroup(buffer, true)
    if (!documents.length) throw new Error('ZIP içinde tuval JSON dosyası yok.')
    return this.importDocuments(name, asCopy ? documents.map(d => copyZipCanvas(d)) : documents, archived)
  }
  importDocuments(name: string, documents: ZipCanvasDocument[], archived = false): ZipLibrarySnapshot {
    return withLibraryLock(this.directory, () => {
      const snapshot = this.readSnapshot(), filename = groupFilename(name)
      this.assertAvailable(snapshot, filename, archived)
      const clean = this.validateDocuments(snapshot, documents)
      this.publish(path.join(this.sectionDirectory(archived), filename), groupBuffer(clean))
      return this.readSnapshot()
    })
  }
  saveGroup(id: string, documents: ZipCanvasDocument[], revision: string): ZipLibrarySnapshot {
    return withLibraryLock(this.directory, () => {
      const snapshot = this.readSnapshot(), group = this.freshGroup(snapshot, id, revision)
      const clean = this.validateDocuments(snapshot, documents, group.id)
      if (JSON.stringify(clean) !== JSON.stringify(group.canvases)) this.publish(this.groupPath(group), groupBuffer(clean), revision)
      return this.readSnapshot()
    })
  }
  reorderGroup(id: string, order: string[], revision: string): ZipLibrarySnapshot {
    return withLibraryLock(this.directory, () => {
      const snapshot = this.readSnapshot(), group = this.freshGroup(snapshot, id, revision)
      if (order.length !== group.canvases.length || new Set(order).size !== order.length || order.some(id => !group.canvases.some(c => c.canvasId === id))) throw new Error('Tuval sırası grubun tamamını birer kez içermeli.')
      return this.saveGroup(id, order.map(id => group.canvases.find(c => c.canvasId === id)!), revision)
    })
  }
  renameGroup(id: string, name: string, revision: string): ZipLibrarySnapshot {
    return this.relocateGroup(id, name, undefined, revision)
  }
  archiveGroup(id: string, archived: boolean, revision: string): ZipLibrarySnapshot {
    return this.relocateGroup(id, undefined, archived, revision)
  }
  private relocateGroup(id: string, name: string | undefined, archived: boolean | undefined, revision: string): ZipLibrarySnapshot {
    return withLibraryLock(this.directory, () => {
      const snapshot = this.readSnapshot(), group = this.freshGroup(snapshot, id, revision)
      const section = archived ?? group.archived, filename = groupFilename(name ?? group.name)
      this.assertAvailable(snapshot, filename, section, id)
      const from = this.groupPath(group), to = path.join(this.sectionDirectory(section), filename)
      if (from !== to) {
        if (hash(this.readBuffer(from)) !== revision) throw new ZipLibraryConflictError()
        if (process.platform === 'win32' && fileKey(from) === fileKey(to)) fs.renameSync(from, to)
        else {
          fs.linkSync(from, to)
          try { fs.unlinkSync(from) } catch (error) { fs.unlinkSync(to); throw error }
        }
      }
      return this.readSnapshot()
    })
  }
  deleteGroup(id: string, revision: string): ZipLibrarySnapshot {
    return withLibraryLock(this.directory, () => {
      const snapshot = this.readSnapshot(), group = this.freshGroup(snapshot, id, revision, true), file = this.groupPath(group)
      if (hash(this.readBuffer(file)) !== revision) throw new ZipLibraryConflictError()
      fs.unlinkSync(file)
      return this.readSnapshot()
    })
  }
  exportGroup(id: string, revision: string): Buffer {
    return withLibraryLock(this.directory, () => {
      const snapshot = this.readSnapshot(), group = this.freshGroup(snapshot, id, revision)
      const data = this.readBuffer(this.groupPath(group))
      if (hash(data) !== revision) throw new ZipLibraryConflictError()
      return data
    })
  }
}
