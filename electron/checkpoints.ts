import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { CheckpointOutputWatch, type OutputWatchDeps } from './checkpoint-output-watch'
import { flowRoots } from './checkpoint-roots'
import type { CheckpointDetail, CheckpointInfo, CheckpointSnapshot } from './checkpoint-types'

const json = async <T>(file: string): Promise<T> => JSON.parse(await fs.promises.readFile(file, 'utf8'))
async function write(file: string, value: unknown) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await fs.promises.writeFile(tmp, JSON.stringify(value))
  await fs.promises.rename(tmp, file)
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
    try { for (const cp of dirty) await write(this.file(cp.id), cp) }
    catch (e) { this.outputs.retryPersist(dirty); throw e }
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
      await this.persistChanges()
      if (old) await write(this.file(old.id), old)
      await write(this.file(cp.id, true), snapshot)
      await write(this.file(cp.id), cp)
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
    return this.serial(async () => {
      try {
        await this.persistChanges()
        if (this.current) { this.current.endedAt = endedAt; this.current.status = status; await write(this.file(this.current.id), this.current) }
      } finally { this.active = undefined; this.current = undefined }
    })
  }
  async list(): Promise<CheckpointInfo[]> {
    let names: string[]
    try { names = await fs.promises.readdir(this.dir) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e }
    const rows: CheckpointInfo[] = []
    for (const name of names.filter(n => /^[a-f0-9-]{36}\.json$/.test(n))) {
      const cp = await json<CheckpointDetail>(path.join(this.dir, name))
      const { outputs: _outputs, ...info } = cp
      if (info.status === 'running' && info.id !== this.current?.id) info.status = 'interrupted'
      rows.push(info)
    }
    return rows.sort((a, b) => a.at - b.at || a.ordinal - b.ordinal)
  }
  async detail(id: string): Promise<CheckpointDetail> {
    const cp = await json<CheckpointDetail>(this.file(id))
    if (cp.status === 'running' && cp.id !== this.current?.id) cp.status = 'interrupted'
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
  async snapshot(id: string) { return json<CheckpointSnapshot>(this.file(id, true)) }
}
