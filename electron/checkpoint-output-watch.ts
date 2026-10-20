import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { CheckpointDetail, CheckpointMonitoring, CheckpointOutput } from './checkpoint-types'

/**
 * DOSYA OLAYI İZLEYİCİSİ — kapsamı ÇAĞIRAN belirler.
 *
 * Kökler tüm diskler değil, akışın yazdığı klasörlerdir (`checkpoint-roots.ts`). Tüm disk izleme
 * isteğe bağlıdır: `deps.wide()` true ise keşfedilen disk kökleri de eklenir.
 *
 * Kurallar (patch'in koruduğu davranış):
 *  · Yalnız gelen olay yollarının bilgisi okunur; tüm diskin envanteri/taraması YAPILMAZ.
 *  · Olay ALINDIĞI ANDA checkpoint'e bağlanır; `stat` sonradan tamamlanır.
 *  · Yeniden adlandırılmış/yeni dolu klasörün yalnız ÇOCUKLARI gezilir.
 *  · İzleme başlatılamazsa koşu DURMAZ: sorun `issues` içinde görünür, çıktı listesi sınırlı kalır.
 */
export type OutputWatchDeps = {
  /** Tüm disk izleme AÇIKKEN kullanılan disk kökleri (kapalıyken çağrılmaz). */
  discover: () => Promise<string[]>
  /** Tüm disk izleme açık mı (opt-in). Verilmezse kapalı sayılır. */
  wide?: () => boolean
  exclude?: string[]
  watch?: typeof fs.watch
  lapKey?: () => string | undefined
}
type Pending = { cp: CheckpointDetail; path: string; rename: boolean; at: number; lastAt: number; lapKey?: string }
export function insidePath(parent: string, target: string) {
  const rel = path.relative(parent.toLowerCase(), target.toLowerCase())
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
}

/** Bir kökün izlenebilir karşılığı: kendisi varsa kendisi, yoksa (en çok 2 üst) var olan atası. */
function izlenecekKok(intended: string): string | null {
  let dir = intended
  for (let i = 0; i < 3; i++) {
    try {
      if (fs.statSync(dir).isDirectory()) return dir
      return null // aynı yolda dosya var: klasör değil
    } catch { /* yok: üste çık */ }
    const up = path.dirname(dir)
    if (up === dir || /^[A-Za-z]:[\\/]?$/.test(up)) return null // disk köküne kadar çıkmayız
    dir = up
  }
  return null
}

export class CheckpointOutputWatch {
  private watchers = new Map<string, fs.FSWatcher>()
  private current?: CheckpointDetail
  private pending = new Map<string, Pending>()
  private dirty = new Set<CheckpointDetail>()
  private problems: string[] = []
  private enabled = false
  private indexes = new WeakMap<CheckpointDetail, Map<string, CheckpointOutput>>()
  /** Akışın bildirdiği kökler. */
  private requested: string[] = []
  /** Tüm disk izleme açıkken keşfedilen kökler. */
  private wideRoots: string[] = []
  /** Henüz oluşmamış kökler: oluşunca izlemeye alınır. */
  private waiting: string[] = []
  private skippedPaths = 0
  constructor(private deps: OutputWatchDeps) {}

  /** Tüm disk izleme açık mı. */
  wide() { return !!this.deps.wide?.() }
  monitoring(): CheckpointMonitoring {
    const roots = [...this.watchers.keys()]
    const wide = this.wide()
    // 'disk' = tüm diskler izleniyor; 'karisik' = tüm disk açık ama disk bulunamadı, akış köklerine
    // düşüldü; 'akis' = yalnız akış kökleri; 'yok' = hiçbir kök yok.
    const source: CheckpointMonitoring['source'] = !roots.length ? 'yok'
      : wide ? (this.wideRoots.length ? 'disk' : 'karisik')
      : 'akis'
    return {
      automatic: true, active: this.enabled, roots, issues: [...this.problems],
      flowRoots: [...this.requested], pendingRoots: [...this.waiting], wideWatch: wide, source,
      skippedPaths: this.skippedPaths,
    }
  }
  private issue(message: string, cp = this.current) {
    if (!this.problems.includes(message) && this.problems.length < 30) this.problems.push(message)
    if (cp && !cp.issues.includes(message) && cp.issues.length < 30) { cp.issues.push(message); this.dirty.add(cp) }
  }
  private excluded(p: string) {
    if (this.deps.exclude?.some(root => insidePath(root, p))) return true
    if (insidePath(os.tmpdir(), p) && /^(?:xpas-(?:ocr|preview|onnx)-[a-f0-9]{32}\.(?:png|jpg|raw)|nubbo-screen-[0-9T_:.Z-]+-[0-9a-f-]+\.(?:png|jpg))$/i.test(path.basename(p))) return true
    return /(?:^|[\\/])(?:\$Recycle\.Bin|System Volume Information)(?:[\\/]|$)/i.test(p)
  }

  /**
   * İzlemeyi başlatır. KÖK YOKSA HATA ATMAZ: akışta izlenecek klasör olmaması normaldir ve
   * otomasyonu durdurmak için gerekçe değildir (yalnız çıktı listesi sınırlı kalır).
   */
  async start() {
    this.enabled = true; this.problems = []; this.requested = []; this.wideRoots = []; this.waiting = []; this.skippedPaths = 0
    if (this.wide()) await this.refresh()
  }

  /** Akıştan gelen kökleri uygular (her checkpoint'te yeniden hesaplanır). */
  async setFlowRoots(roots: string[], skipped = 0) {
    this.requested = [...new Set(roots.filter(r => typeof r === 'string' && path.isAbsolute(r)).map(r => path.resolve(r)))]
    this.skippedPaths = Math.max(0, skipped)
    await this.sync()
  }

  /** Tüm disk izleme açıksa diskleri yeniden keşfeder; her durumda kökleri tazeler. */
  async refresh() {
    if (!this.enabled) return
    if (this.wide()) {
      try { this.wideRoots = await this.deps.discover() }
      catch (e) { this.issue(`Diskler algılanamadı: ${(e as Error).message}`); this.wideRoots = [] }
      if (!this.enabled) return
    } else this.wideRoots = []
    await this.sync()
  }

  /** İstenen kökleri gerçek izleyicilere çevirir: kapananları kapatır, yenileri açar. */
  private async sync() {
    if (!this.enabled) return
    const wide = this.wide()
    // Tüm disk izleme açıksa disk kökleri yeterlidir; kapalıyken YALNIZ akış kökleri izlenir.
    const istenen = wide && this.wideRoots.length ? this.wideRoots : this.requested
    const hedefler = new Map<string, string>()
    const waiting: string[] = []
    for (const raw of istenen) {
      if (typeof raw !== 'string' || !path.isAbsolute(raw)) continue
      const intended = path.resolve(raw)
      const target = izlenecekKok(intended)
      if (!target) { if (!wide) waiting.push(intended); continue }
      // Henüz var olmayan klasör: üst klasör izlenir, yol "oluşunca izlenecek" listesine girer.
      if (!wide && target !== intended) waiting.push(intended)
      hedefler.set(target.toLowerCase(), target)
    }
    for (const [root, watcher] of this.watchers) {
      if (hedefler.has(root.toLowerCase())) continue
      watcher.close(); this.watchers.delete(root)
      this.issue(`İzleme sona erdi: ${root}`)
    }
    for (const root of hedefler.values()) {
      if ([...this.watchers.keys()].some(p => p.toLowerCase() === root.toLowerCase())) continue
      this.ac(root)
    }
    this.waiting = waiting
    if (this.current) this.current.roots = [...this.watchers.keys()]
  }

  private ac(root: string) {
    try {
      const watcher = (this.deps.watch ?? fs.watch)(root, { recursive: true }, (event, filename) => {
        if (!this.enabled || this.watchers.get(root) !== watcher) return
        if (!filename) { this.issue(`Dosya izleyici bir olayın yolunu bildirmedi (${root}); çıktı kaydı eksik olabilir.`); return }
        const full = path.resolve(root, String(filename))
        if (full.toLowerCase() === root.toLowerCase()) { this.issue(`Dosya izleyici yalnız izlenen kökü bildirdi (${root}); çıktı kaydı eksik olabilir.`); return }
        if (!insidePath(root, full) || this.excluded(full) || !this.current) return
        const lapKey = this.deps.lapKey?.()
        const key = `${this.current.id}\0${lapKey ?? ''}\0${full.toLowerCase()}`
        const old = this.pending.get(key)
        if (!old && this.pending.size >= 100000) { this.issue('100.000 bekleyen dosya olayı sınırı: çıktı kaydı eksik olabilir.'); return }
        this.pending.set(key, { cp: this.current, path: full, rename: event === 'rename' || !!old?.rename, at: old?.at ?? Date.now(), lastAt: Date.now(), lapKey })
      })
      watcher.on('error', error => {
        if (this.watchers.get(root) !== watcher) return
        this.issue(`Dosya izleyici hatası (${root}): ${error.message}; çıktı kaydı eksik olabilir.`)
        watcher.close(); this.watchers.delete(root)
      })
      this.watchers.set(root, watcher)
    } catch (e) { this.issue(`Klasör izlenemedi (${root}): ${(e as Error).message}`) }
  }

  bind(cp?: CheckpointDetail) { this.current = cp }
  stop() {
    this.enabled = false; this.current = undefined
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
    this.requested = []; this.wideRoots = []; this.waiting = []
  }
  private record(event: Pending, kind: CheckpointOutput['kind'], size: number, present: boolean) {
    let index = this.indexes.get(event.cp)
    const outputKey = (p: string, lap?: string) => `${lap ?? ''}\0${p.toLowerCase()}`
    if (!index) { index = new Map(event.cp.outputs.map(output => [outputKey(output.path, output.lapKey), output])); this.indexes.set(event.cp, index) }
    const old = index.get(outputKey(event.path, event.lapKey))
    if (!old && index.size >= 100000) { this.issue('100.000 çıktı yolu sınırı: bu checkpoint kaydı eksik olabilir.', event.cp); return false }
    if (old) { old.path = event.path; old.kind = kind === 'unknown' ? old.kind : kind; old.size = size; old.lastSeen = Math.max(old.lastSeen, event.lastAt); old.present = present }
    else {
      const row: CheckpointOutput = { path: event.path, kind, size, change: 'observed', present, firstSeen: event.at, lastSeen: event.lastAt, ...(event.lapKey ? { lapKey: event.lapKey } : {}) }
      index.set(outputKey(event.path, event.lapKey), row); event.cp.outputs.push(row)
      const scopes = event.cp.outputScopes ??= {}
      scopes[event.lapKey ?? ''] = (scopes[event.lapKey ?? ''] ?? 0) + 1
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
