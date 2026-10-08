import type { CanvasTab } from '../../electron/graph-types'
export type CanvasRunResult = { ok: boolean; stopped?: boolean; failed?: number; reachedEnd?: boolean }
/** One driver for a frozen tab order. Cancellation is sticky between awaited runs. */
export class CanvasSequence {
  private active = false
  private cancelled = false
  isRunning() { return this.active }
  isCancelled() { return this.cancelled }
  stop() { if (this.active) this.cancelled = true }
  async run(tabs: CanvasTab[], execute: (tab: CanvasTab, index: number, total: number) => Promise<CanvasRunResult>): Promise<'completed' | 'stopped'> {
    if (this.active) throw new Error('Tuval sırası zaten çalışıyor.')
    if (!tabs.length) throw new Error('Çalıştırılacak tuval yok.')
    for (const tab of tabs) {
      if (!tab.graph.nodes.some(n => n.kind === 'start')) throw new Error(`“${tab.name}”: Başlangıç node’u yok.`)
      if (!tab.graph.nodes.some(n => n.kind === 'end')) throw new Error(`“${tab.name}”: Bitti node’u yok; tuval sırası başlatılmadı.`)
    }
    const queue = structuredClone(tabs)
    this.active = true
    this.cancelled = false
    try {
      for (let i = 0; i < queue.length; i++) {
        if (this.cancelled) return 'stopped'
        const result = await execute(queue[i], i, queue.length)
        if (this.cancelled || result.stopped) return 'stopped'
        if (!result.ok || (result.failed ?? 0) > 0) throw new Error(`“${queue[i].name}” hatayla bitti; sonraki tuval başlatılmadı.`)
        if (result.reachedEnd !== true) throw new Error(`“${queue[i].name}” Bitti node’una ulaşmadı; sonraki tuval başlatılmadı.`)
      }
      return this.cancelled ? 'stopped' : 'completed'
    } finally { this.active = false }
  }
}
