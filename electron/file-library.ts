import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { withLibraryLock } from './library-lock'
import { normalizeFileSetup, fileSetupKey, type FileSetup, type FileFolder, type FileEntry, type FileLibraryInfo, type FileSelection, type FileRunContext, type FileDefaults } from './file-contract'
import { listFileSource } from './file-list'

type Catalog = { version: 1; folders: FileFolder[]; tools: string; defaults: Record<string, FileDefaults> }
const safeId = (s: string) => /^[a-f0-9-]{36}$/.test(s)
function safeName(s: string): string {
  const n = String(s).trim()
  if (!n || n.length > 120 || /[<>:"/\\|?*\x00-\x1f]/.test(n) || /[. ]$/.test(n) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(n)) throw new Error('Geçerli bir klasör adı yaz.')
  return n
}
export class FileLibrary {
  constructor(readonly root: string) {}
  private catalogFile() { return path.join(this.root, 'Kayitlar', 'klasorler.json') }
  private read(): Catalog {
    let raw: string
    try { raw = fs.readFileSync(this.catalogFile(), 'utf8') } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, folders: [], tools: '', defaults: {} }; throw e }
    const c = JSON.parse(raw) as Catalog
    if (c.version !== 1 || !Array.isArray(c.folders) || !c.defaults) throw new Error('Nubbo dosya kaydı okunamadı; mevcut dosyalar değiştirilmedi.')
    return c
  }
  private change<T>(fn: (c: Catalog) => T): T {
    fs.mkdirSync(this.root, { recursive: true })
    return withLibraryLock(this.root, () => {
      const c = this.read(), value = fn(c), file = this.catalogFile()
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const temp = file + '.' + randomUUID() + '.tmp'
      try { fs.writeFileSync(temp, JSON.stringify(c, null, 2), { flag: 'wx' }); fs.renameSync(temp, file) } finally { try { fs.unlinkSync(temp) } catch {} }
      return value
    })
  }
  info(): FileLibraryInfo { const c = this.read(); return { root: this.root, tools: c.tools, folders: c.folders.map(f => ({ ...f, available: fs.existsSync(f.path) })) } }
  folder(id: string): FileFolder { const f = this.read().folders.find(f => f.id === id); if (!f) throw new Error('Klasör kaydı bulunamadı.'); return f }
  create(name: string, parentId?: string, relative = ''): FileFolder {
    const display = safeName(name), id = randomUUID()
    return this.change(c => {
      const parent = parentId ? c.folders.find(f => f.id === parentId) : undefined
      if (parentId && !parent) throw new Error('Üst klasör kaydı bulunamadı.')
      if (parent) this.requireDirectory(parent.path)
      const target = parent ? path.join(this.directory(parent.id, relative), display) : path.join(this.root, 'Klasorler', id)
      if (parent && fs.existsSync(target)) throw new Error('Bu isimde klasör zaten var; başka ad seç.')
      fs.mkdirSync(target, { recursive: !parent })
      const f: FileFolder = { id, name: display, path: target, kind: 'managed', createdAt: Date.now() }
      c.folders.push(f); return f
    })
  }
  private requireDirectory(p: string) { const st = fs.lstatSync(p); if (!st.isDirectory() || st.isSymbolicLink()) throw new Error(`Klasör kullanılamıyor: ${p}`) }
  private directory(id: string, relative = ''): string {
    const root = fs.realpathSync(this.folder(id).path), target = fs.realpathSync(path.resolve(root, relative))
    const rel = path.relative(root, target)
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('Klasörün dışında bir yol seçildi.')
    this.requireDirectory(target)
    return target
  }
  link(target: string): FileFolder {
    this.requireDirectory(target)
    const real = fs.realpathSync(target)
    return this.change(c => {
      const old = c.folders.find(f => path.resolve(f.path).toLowerCase() === real.toLowerCase())
      if (old) return old
      const f: FileFolder = { id: randomUUID(), name: path.basename(real) || real, path: real, kind: 'linked', createdAt: Date.now() }
      c.folders.push(f); return f
    })
  }
  rename(id: string, name: string) { return this.change(c => { const f = c.folders.find(f => f.id === id); if (!f) throw new Error('Klasör bulunamadı.'); f.name = safeName(name); return f }) }
  forget(id: string) { this.change(c => { c.folders = c.folders.filter(f => f.id !== id) }) }
  tools(target: string) { this.requireDirectory(target); this.change(c => { c.tools = path.resolve(target) }) }
  async browse(id: string, relative = ''): Promise<{ folder: FileFolder; relative: string; entries: FileEntry[] }> {
    const folder = this.folder(id), root = await fs.promises.realpath(folder.path)
    const target = path.resolve(root, relative), rel = path.relative(root, target)
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('Klasörün dışında bir yol seçildi.')
    const real = await fs.promises.realpath(target), realRel = path.relative(root, real)
    if (realRel === '..' || realRel.startsWith('..' + path.sep) || path.isAbsolute(realRel)) throw new Error('Klasör bağlantısı kökün dışında.')
    const names = await fs.promises.readdir(real, { withFileTypes: true })
    const entries: FileEntry[] = []
    for (const n of names) { if (n.isSymbolicLink() || !n.isDirectory() && !n.isFile()) continue; const p = path.join(real, n.name); const s = await fs.promises.stat(p); entries.push({ name: n.name, path: p, kind: n.isDirectory() ? 'folder' : 'file', size: s.size, modifiedAt: s.mtimeMs }) }
    entries.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'folder' ? -1 : 1) || a.name.localeCompare(b.name, 'tr', { numeric: true }))
    return { folder, relative: rel, entries }
  }
  async importFiles(id: string, sources: string[], relative = ''): Promise<void> {
    const target = this.directory(id, relative)
    for (const source of sources) {
      const st = await fs.promises.lstat(source)
      if (st.isSymbolicLink()) throw new Error('Bağlantı yerine gerçek dosya veya klasör seç.')
      const dest = path.join(target, path.basename(source))
      const rel = path.relative(source, dest)
      if (st.isDirectory() && (rel === '' || rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel))) throw new Error('Bir klasör kendi içine kopyalanamaz.')
      // Preflight before cp: no overwrite, partial successful copies are retained on failure.
      if (fs.existsSync(dest)) throw new Error(`Aynı ad zaten var: ${path.basename(source)}`)
      await fs.promises.cp(source, dest, { recursive: st.isDirectory(), errorOnExist: true, force: false, dereference: false, filter: async p => !(await fs.promises.lstat(p)).isSymbolicLink() })
    }
  }
  defaults(key: string): FileDefaults { return this.read().defaults[key] ?? {} }
  last(key: string, setup: FileSetup): FileRunContext | undefined { const last = this.defaults(key).last; return last?.setup === fileSetupKey(setup) ? last : undefined }
  byRun(id: string): FileRunContext | undefined { return Object.values(this.read().defaults).map(x => x.last).find(x => x?.id === id) }
  async prepare(key: string, setup: FileSetup, selection: FileSelection): Promise<FileRunContext> {
    setup = normalizeFileSetup(setup)!
    const input = this.folder(selection.inputId); this.requireDirectory(input.path)
    const items = await listFileSource(input.path, { kind: 'files', filter: setup.inputFilter })
    if (!items.length) throw new Error(`${setup.inputLabel}: uygun dosya bulunamadı (${setup.inputFilter}).`)
    const tools = selection.tools.trim()
    if (setup.tools) this.requireDirectory(tools)
    const id = randomUUID(), stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    let output: FileFolder
    if (selection.newOutput || !selection.outputId) output = this.create(`${setup.outputName} ${stamp}-${id.slice(0, 4)}`, selection.outputId || undefined)
    else output = this.folder(selection.outputId)
    this.requireDirectory(output.path)
    if (path.resolve(input.path).toLowerCase() === path.resolve(output.path).toLowerCase()) throw new Error('Giriş ve çıkış aynı klasör olamaz.')
    const workRoot = path.join(this.root, 'Calismalar', id)
    const vars: Record<string, string> = { girdi: input.path, cikti: output.path, calisma: workRoot, 'calisma.kod': stamp + '-' + id.slice(0, 4), araclar: tools }
    fs.mkdirSync(workRoot, { recursive: true })
    for (const k of setup.workFolders) { vars[`calisma.${k}`] = path.join(workRoot, k); fs.mkdirSync(vars[`calisma.${k}`]) }
    for (const f of this.info().folders) vars[`klasor.${f.id}`] = f.path
    const context: FileRunContext = { version: 1, id, canvasKey: key, setup: fileSetupKey(setup), input: input.path, output: output.path, workRoot, vars, roots: [output.path, workRoot], createdAt: Date.now() }
    this.change(c => {
      c.tools = tools || c.tools; c.defaults[key] = { selection: { ...selection }, last: context }
      c.folders.push({ id, name: `Çalışma ${stamp}-${id.slice(0, 4)}`, path: workRoot, kind: 'managed', role: 'work', createdAt: context.createdAt })
      if (selection.newOutput || !selection.outputId) { const entry = c.folders.find(f => f.id === output.id); if (entry) entry.role = 'output' }
    })
    return context
  }
  validate(context: FileRunContext, key: string, setup: FileSetup): FileRunContext {
    if (!context || context.version !== 1 || !safeId(context.id) || context.canvasKey !== key || context.setup !== fileSetupKey(setup)) throw new Error('Bu çalışmanın dosya ayarları tuvalle eşleşmiyor. Yeni çalışma başlat.')
    this.requireDirectory(context.input); this.requireDirectory(context.output); this.requireDirectory(context.workRoot)
    return context
  }
}
