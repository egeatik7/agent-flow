import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { CheckpointOutputWatch, type OutputWatchDeps } from './checkpoint-output-watch'
import { flowRoots } from './checkpoint-roots'
import type { CheckpointDetail, CheckpointInfo, CheckpointSnapshot } from './checkpoint-types'

const json = async <T>(file: string): Promise<T> => JSON.parse(await fs.promises.readFile(file, 'utf8'))

/** Yazım kesintisi işareti: checkpoint geçmişinin yanında durur, `detail()` issues'a ekler. */
export const UNRELIABLE_NAME = '.resume-unreliable.json'
const unreliableFile = (dir: string) => path.join(dir, UNRELIABLE_NAME)

/**
 * Windows'ta taze dosyayı Defender/indeksleyici kısa süre tutabiliyor; rename EPERM/EBUSY veriyor.
 * ZIP kütüphanesinde ölçülen aynı sınıf hata (bkz. zip-library-storage.ts). Sınırlı ve artan
 * beklemeli deneme; başka hata kodu ve win32 dışı hemen yüzeye çıkar.
 */
const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_ATTEMPTS = 12
const RENAME_MAX_PAUSE_MS = 400
export async function renameWithRetry(
  from: string,
  to: string,
  deps: { platform: string; rename: (a: string, b: string) => Promise<void>; pause: (ms: number) => Promise<void> } =
    { platform: process.platform, rename: (a, b) => fs.promises.rename(a, b), pause: (ms) => new Promise(r => setTimeout(r, ms)) },
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try { await deps.rename(from, to); return } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      if (deps.platform !== 'win32' || !RENAME_RETRY_CODES.has(code) || attempt >= RENAME_ATTEMPTS) throw error
      await deps.pause(Math.min(30 * 2 ** (attempt - 1), RENAME_MAX_PAUSE_MS))
    }
  }
}

async function write(file: string, value: unknown) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await fs.promises.writeFile(tmp, JSON.stringify(value))
  try { await renameWithRetry(tmp, file) }
  catch (error) { try { await fs.promises.unlink(tmp) } catch { /* geçici dosya zaten yok */ } throw error }
}

/** Saklama: en yeni bu kadar checkpoint çifti tutulur; daha eskiler ve bayat .tmp'ler silinir. */
export const CHECKPOINT_KEEP = 400
export const CHECKPOINT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const STALE_TMP_MS = 24 * 60 * 60 * 1000

/**
 * Checkpoint geçmişini budar: dosya sayısı sınırsız büyümesin (her döngü öğesi iki dosya yazar).
 * Grup = bir checkpoint (detail + snapshot + yarım kalmış .tmp); çift birlikte silinir ki
 * `detail()` yarım kayıtla karşılaşmasın.
 */
export async function pruneCheckpoints(dir: string, now = Date.now(), keep = CHECKPOINT_KEEP): Promise<{ removed: number }> {
  let names: string[]
  try { names = await fs.promises.readdir(dir) } catch { return { removed: 0 } }
  const groups = new Map<string, { files: string[]; at: number; tmpOnly: boolean }>()
  for (const name of names) {
    const m = name.match(/^([a-f0-9-]{36})(\.snapshot)?\.(?:json(?:\.tmp)?|outputs\.jsonl)$/)
    if (!m) continue
    const id = m[1], file = path.join(dir, name)
    let at = now
    try { at = (await fs.promises.stat(file)).mtimeMs } catch { continue }
    const group = groups.get(id) ?? { files: [], at, tmpOnly: !!m[3] }
    group.files.push(file)
    group.at = Math.max(group.at, at)
    group.tmpOnly = group.tmpOnly && !!m[3]
    groups.set(id, group)
  }
  const ordered = [...groups.values()].sort((a, b) => b.at - a.at)
  let removed = 0
  for (const [index, group] of ordered.entries()) {
    const staleTmp = group.tmpOnly && now - group.at > STALE_TMP_MS
    if (index < keep && !staleTmp && now - group.at <= CHECKPOINT_MAX_AGE_MS) continue
    for (const file of group.files) {
      try { await fs.promises.unlink(file); removed++ } catch { /* başka süreç tutuyor: sonraki turda */ }
    }
  }
  return { removed }
}

/** Otomatik çıktı takibi — kökler AKIŞTAN gelir; tüm disk izleme isteğe bağlıdır (opt-in). */
export class Checkpoints {
  private active?: { runId: string; canvasId: string; canvasName: string; ordinal: number; parentId?: string }
  private current?: CheckpointDetail
  private timer?: ReturnType<typeof setInterval>
  private queue: Promise<unknown> = Promise.resolve()
  private pollPending = false
  private lastDiscovery = 0
  private exclude: string[]
  private outputs: CheckpointOutputWatch
  constructor(private dir: string, private warn: (message: string) => void = () => {}, deps?: OutputWatchDeps) {
    this.exclude = [dir, ...(deps?.exclude ?? [])]
    this.outputs = new CheckpointOutputWatch({ discover: deps?.discover ?? (async () => []), ...deps, exclude: this.exclude })
  }
  monitoring() { return this.outputs.monitoring() }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn)
    this.queue = next.catch(() => {})
    return next
  }
  private async persistChanges() {
    const dirty = await this.outputs.drain()
    try {
      for (const cp of dirty) {
        // Çıktılar APPEND-ONLY NDJSON'a yazılır; checkpoint JSON'u yalnız meta taşır. Eskiden her
        // flush tüm çıktı dizisini yeniden serileştiriyordu (O(n²)) ve `mark()` aynı kuyrukta
        // olduğu için koşunun öğe gecikmesine ekleniyordu.
        const done = this.appended.get(cp.id) ?? 0
        const fresh = cp.outputs.slice(done)
        if (fresh.length) {
          await fs.promises.appendFile(this.outputFile(cp.id), fresh.map(o => JSON.stringify(o) + '\n').join(''), 'utf8')
          this.appended.set(cp.id, cp.outputs.length)
        }
        await write(this.file(cp.id), this.metaOf(cp))
      }
    }
    catch (e) { this.outputs.retryPersist(dirty); await this.markUnreliable((e as Error).message); throw e }
  }
  /** Yazım kesintiye uğradıysa "hatadan devam güvenilir değil" işareti bırakılır (panelde görünür). */
  async markUnreliable(reason: string): Promise<void> {
    try { await fs.promises.writeFile(unreliableFile(this.dir), JSON.stringify({ at: Date.now(), reason }), 'utf8') } catch { /* tanılama */ }
  }
  private appended = new Map<string, number>()
  private outputFile(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Geçersiz checkpoint kimliği.')
    return path.join(this.dir, `${id}.outputs.jsonl`)
  }
  private metaOf(cp: CheckpointDetail): CheckpointDetail {
    return { ...cp, outputs: [], outputCount: cp.outputs.length }
  }
  private async appendedOutputs(id: string): Promise<CheckpointDetail['outputs']> {
    let text: string
    try { text = await fs.promises.readFile(this.outputFile(id), 'utf8') } catch { return [] }
    const rows: CheckpointDetail['outputs'] = []
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try { rows.push(JSON.parse(line)) } catch { /* yarım satır: atla */ }
    }
    return rows
  }
  private poll() {
    if (this.pollPending || !this.active) return
    this.pollPending = true
    void this.serial(async () => {
      if (!this.active) return
      await this.persistChanges()
      // 10 sn'de bir kökleri tazele: yeni oluşan klasör izlemeye alınır (tüm disk izleme açıksa
      // takılan/sökülen diskler de burada yakalanır).
      if (Date.now() - this.lastDiscovery >= 10000) { this.lastDiscovery = Date.now(); await this.outputs.refresh() }
    }).catch(e => this.warn(`Checkpoint çıktı izlemesi: ${(e as Error).message}`)).finally(() => { this.pollPending = false })
  }
  async begin(runId: string, canvasId: string, canvasName: string, parentId?: string) {
    if (this.active) throw new Error('Checkpoint izlemesi zaten çalışıyor.')
    // Yeni koşu temiz başlar: önceki koşunun "güvenilmez" işareti kalkar.
    try { await fs.promises.rm(unreliableFile(this.dir), { force: true }) } catch { /* yok */ }
    // Kök yoksa HATA ATMAZ: izlenecek klasör bulunamaması otomasyonu durdurmaz (bkz. KULLANIM).
    await this.outputs.start()
    this.active = { runId, canvasId, canvasName, ordinal: 0, parentId }
    this.lastDiscovery = Date.now()
  }
  private file(id: string, snapshot = false) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Geçersiz checkpoint kimliği.')
    return path.join(this.dir, `${id}${snapshot ? '.snapshot' : ''}.json`)
  }
  async mark(label: string, snapshot: CheckpointSnapshot) {
    return this.serial(async () => {
      if (!this.active) throw new Error('Checkpoint oturumu başlamadı.')
      // KAPSAM: izlenecek kökler bu checkpoint'in grafından ve imlecinden hesaplanır. Döngü bir
      // sonraki klasöre geçince izleme de oraya taşınır; tüm disk izleme kapalıyken başka
      // programların dosyaları listeye dolmaz.
      const kapsam = flowRoots(snapshot.graph, snapshot.cursor, { exclude: this.exclude })
      await this.outputs.setFlowRoots(kapsam.roots, kapsam.skipped)
      const now = Date.now(), old = this.current
      const { runId, canvasId, canvasName, parentId } = this.active
      const monitoring = this.outputs.monitoring()
      const cp: CheckpointDetail = { id: randomUUID(), runId, ordinal: ++this.active.ordinal, canvasId, canvasName, label, at: now, outputCount: 0, status: 'running', roots: monitoring.roots, issues: monitoring.issues, outputs: [], parentId }
      // Switch ownership synchronously. Queued old events retain the old checkpoint.
      this.current = cp
      this.outputs.bind(cp)
      if (old) { old.endedAt = now; old.status = 'closed' }
      this.appended.set(cp.id, 0)
      await this.persistChanges()
      if (old) { await write(this.file(old.id), this.metaOf(old)); this.appended.delete(old.id) }
      await write(this.file(cp.id, true), snapshot)
      await write(this.file(cp.id), this.metaOf(cp))
      if (!this.timer) this.timer = setInterval(() => this.poll(), 500)
      return cp.id
    })
  }
  async finish(status: 'completed' | 'stopped' | 'failed') {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    // Stop observation at the run boundary, then persist every already-received event.
    this.outputs.stop()
    const endedAt = Date.now()
    const result = await this.serial(async () => {
      try {
        await this.persistChanges()
        if (this.current) { this.current.endedAt = endedAt; this.current.status = status; await write(this.file(this.current.id), this.metaOf(this.current)) }
      } finally { this.active = undefined; this.current = undefined }
    })
    // Saklama: koşu bittikten sonra eski kayıtları buda. Koşuyu beklemez; kilit/izin hatası yutulur.
    void pruneCheckpoints(this.dir).catch(() => {})
    return result
  }
  async list(): Promise<CheckpointInfo[]> {
    let names: string[]
    try { names = await fs.promises.readdir(this.dir) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e }
    const rows: CheckpointInfo[] = []
    for (const name of names.filter(n => /^[a-f0-9-]{36}\.json$/.test(n))) {
      // Tek bozuk/kilitli dosya bütün geçmişi görünmez kılmaz: satır atlanır, bir kez uyarılır.
      try {
        const cp = await json<CheckpointDetail>(path.join(this.dir, name))
        const { outputs: _outputs, ...info } = cp
        if (info.status === 'running' && info.id !== this.current?.id) info.status = 'interrupted'
        rows.push(info)
      } catch (e) {
        this.warnOnce(name, `Checkpoint okunamadı (${name}); liste bu kayıt olmadan gösteriliyor: ${(e as Error).message}`)
      }
    }
    return rows.sort((a, b) => a.at - b.at || a.ordinal - b.ordinal)
  }
  private warned = new Set<string>()
  private warnOnce(key: string, message: string) {
    if (this.warned.has(key)) return
    this.warned.add(key)
    this.warn(message)
  }
  private async read<T>(file: string): Promise<T> {
    try { return await json<T>(file) }
    catch (e) { throw new Error(`Checkpoint dosyası okunamadı (bozuk ya da başka bir program tutuyor): ${path.basename(file)} — ${(e as Error).message}`) }
  }
  async detail(id: string): Promise<CheckpointDetail> {
    const cp = await this.read<CheckpointDetail>(this.file(id))
    if (cp.status === 'running' && cp.id !== this.current?.id) cp.status = 'interrupted'
    // Bu koşuda checkpoint yazımı kesintiye uğradıysa "buradan devam" güvenilir değildir; söyle.
    try {
      const raw = await fs.promises.readFile(unreliableFile(this.dir), 'utf8')
      const info = JSON.parse(raw) as { at?: number; reason?: string }
      cp.issues = [`Checkpoint yazımı bu koşuda kesintiye uğradı (${info.reason ?? 'bilinmeyen hata'}); buradan devam ederken öğeler yeniden çalışabilir.`, ...cp.issues]
    } catch { /* işaret yok */ }
    // Yeni biçim: çıktılar NDJSON'da. Eski checkpoint'lerde dizi hâlâ JSON içindedir.
    const appended = await this.appendedOutputs(id)
    if (appended.length) cp.outputs = appended
    cp.outputs = await Promise.all(cp.outputs.map(async output => {
      try { await fs.promises.access(output.path); return { ...output, present: true } }
      catch (e) {
        if (['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '')) return { ...output, present: false }
        cp.issues.push(`Yola erişilemiyor (${output.path}): ${(e as Error).message}`)
        return { ...output, present: undefined }
      }
    }))
    return cp
  }
  async snapshot(id: string) { return this.read<CheckpointSnapshot>(this.file(id, true)) }
}
