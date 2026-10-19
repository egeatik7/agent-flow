import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { CheckpointDetail, CheckpointMonitoring, CheckpointOutput } from './checkpoint-types'

export type OutputWatchDeps = {
  discover: () => Promise<string[]>
  exclude?: string[]
  watch?: typeof fs.watch
}
type Pending = { cp: CheckpointDetail; path: string; rename: boolean; at: number; lastAt: number }
export function insidePath(parent: string, target: string) {
  const rel = path.relative(parent.toLowerCase(), target.toLowerCase())
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
}

/** Event paths, not full-drive polling. Observation time fixes the checkpoint before any async stat. */
export class CheckpointOutputWatch {
  private watchers = new Map<string, fs.FSWatcher>()
  private current?: CheckpointDetail
  private pending = new Map<string, Pending>()
  private dirty = new Set<CheckpointDetail>()
  private problems: string[] = []
  private enabled = false
  private indexes = new WeakMap<CheckpointDetail, Map<string, CheckpointOutput>>()
  constructor(private deps: OutputWatchDeps) {}
  monitoring(): CheckpointMonitoring { return { automatic: true, active: this.enabled, roots: [...this.watchers.keys()], issues: [...this.problems] } }
  private issue(message: string, cp = this.current) {
    if (!this.problems.includes(message) && this.problems.length < 30) this.problems.push(message)
    if (cp && !cp.issues.includes(message) && cp.issues.length < 30) { cp.issues.push(message); this.dirty.add(cp) }
  }
  private excluded(p: string) {
    if (this.deps.exclude?.some(root => insidePath(root, p))) return true
    if (insidePath(os.tmpdir(), p) && /^(?:xpas-(?:ocr|preview|onnx)-[a-f0-9]{32}\.(?:png|jpg|raw)|nubbo-screen-[0-9T_:.Z-]+-[0-9a-f-]+\.(?:png|jpg))$/i.test(path.basename(p))) return true
    return /(?:^|[\\/])(?:\$Recycle\.Bin|System Volume Information)(?:[\\/]|$)/i.test(p)
  }
  async start() {
    this.enabled = true; this.problems = []
    try {
      await this.refresh()
      if (!this.watchers.size) throw new Error(this.problems.join('; ') || 'İzlenebilecek disk bulunamadı.')
    } catch (e) { this.stop(); throw new Error(`Otomatik çıktı izleme başlatılamadı: ${(e as Error).message}`) }
  }
  async refresh() {
    if (!this.enabled) return
    let roots: string[]
    try { roots = await this.deps.discover() }
    catch (e) { this.issue(`Diskler algılanamadı: ${(e as Error).message}`); return }
    if (!this.enabled) return
    const normalized = [...new Set(roots.filter(root => typeof root === 'string' && path.isAbsolute(root)).map(root => path.resolve(root)))]
    for (const [root, watcher] of this.watchers) if (!normalized.some(p => p.toLowerCase() === root.toLowerCase())) { watcher.close(); this.watchers.delete(root); this.issue(`Disk izleme sona erdi: ${root}`) }
    for (const root of normalized) {
      if ([...this.watchers.keys()].some(p => p.toLowerCase() === root.toLowerCase())) continue
      try {
        const watcher = (this.deps.watch ?? fs.watch)(root, { recursive: true }, (event, filename) => {
          if (!this.enabled || this.watchers.get(root) !== watcher) return
          if (!filename) { this.issue(`Dosya izleyici bir olayın yolunu bildirmedi (${root}); çıktı kaydı eksik olabilir.`); return }
          const full = path.resolve(root, String(filename))
          if (full.toLowerCase() === root.toLowerCase()) { this.issue(`Dosya izleyici yalnız disk kökünü bildirdi (${root}); çıktı kaydı eksik olabilir.`); return }
          if (!insidePath(root, full) || this.excluded(full) || !this.current) return
          const key = `${this.current.id}\0${full.toLowerCase()}`
          const old = this.pending.get(key)
          if (!old && this.pending.size >= 100000) { this.issue('100.000 bekleyen dosya olayı sınırı: çıktı kaydı eksik olabilir.'); return }
          this.pending.set(key, { cp: this.current, path: full, rename: event === 'rename' || !!old?.rename, at: old?.at ?? Date.now(), lastAt: Date.now() })
        })
        watcher.on('error', error => {
          if (this.watchers.get(root) !== watcher) return
          this.issue(`Disk izleyici hatası (${root}): ${error.message}; çıktı kaydı eksik olabilir.`)
          watcher.close(); this.watchers.delete(root)
        })
        this.watchers.set(root, watcher)
      } catch (e) { this.issue(`Disk izlenemedi (${root}): ${(e as Error).message}`) }
    }
    if (this.current) this.current.roots = [...this.watchers.keys()]
  }
  bind(cp?: CheckpointDetail) { this.current = cp }
  stop() {
    this.enabled = false; this.current = undefined
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
  }
  private record(event: Pending, kind: CheckpointOutput['kind'], size: number, present: boolean) {
    let index = this.indexes.get(event.cp)
    if (!index) { index = new Map(event.cp.outputs.map(output => [output.path.toLowerCase(), output])); this.indexes.set(event.cp, index) }
    const old = index.get(event.path.toLowerCase())
    if (!old && index.size >= 100000) { this.issue('100.000 çıktı yolu sınırı: bu checkpoint kaydı eksik olabilir.', event.cp); return false }
    if (old) { old.path = event.path; old.kind = kind === 'unknown' ? old.kind : kind; old.size = size; old.lastSeen = Math.max(old.lastSeen, event.lastAt); old.present = present }
    else {
      const row: CheckpointOutput = { path: event.path, kind, size, change: 'observed', present, firstSeen: event.at, lastSeen: event.lastAt }
      index.set(event.path.toLowerCase(), row); event.cp.outputs.push(row)
    }
    event.cp.outputCount = event.cp.outputs.length
    this.dirty.add(event.cp)
    return true
  }
  private async observe(event: Pending, walk = false) {
    if (this.excluded(event.path)) return
    let st: fs.Stats
    try { st = await fs.promises.lstat(event.path) }
    catch (e) {
      if (['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '')) this.record(event, 'unknown', 0, false)
      else { this.record(event, 'unknown', 0, true); this.issue(`Dosya bilgisi okunamadı (${event.path}): ${(e as Error).message}`, event.cp) }
      return
    }
    const folder = st.isDirectory()
    if (!this.record(event, folder ? 'folder' : 'file', st.size, true)) return
    // A renamed/new populated folder can arrive with only one directory event.
    // Walk only THAT changed folder; never enumerate whole volumes as a baseline.
    if (!folder || st.isSymbolicLink() || !(walk || event.rename)) return
    let children: fs.Dirent[]
    try { children = await fs.promises.readdir(event.path, { withFileTypes: true }) }
    catch (e) { this.issue(`Klasör içeriği okunamadı (${event.path}): ${(e as Error).message}`, event.cp); return }
    for (const child of children) {
      if (event.cp.outputs.length >= 100000) { this.issue('100.000 çıktı yolu sınırı: bu checkpoint kaydı eksik olabilir.', event.cp); break }
      await this.observe({ ...event, path: path.join(event.path, child.name) }, true)
    }
  }
  async drain(): Promise<CheckpointDetail[]> {
    const batch = [...this.pending.values()]
    this.pending.clear()
    // New events remain queued with their original checkpoint; no unbounded flush loop.
    for (const event of batch) await this.observe(event)
    const dirty = [...this.dirty]
    this.dirty.clear()
    return dirty
  }
  retryPersist(cps: CheckpointDetail[]) { for (const cp of cps) this.dirty.add(cp) }
}
