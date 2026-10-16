/** A single owner for visibility. Status messages never activate or re-stack the card. */
export type HudWindow = {
  isDestroyed(): boolean
  isVisible(): boolean
  hide(): void
  showInactive(): void
  webContents: {
    isLoading(): boolean
    send(channel: string, payload: unknown): void
    once(event: 'did-finish-load', callback: () => void): unknown
  }
}

export class HudWindowController {
  private wanted = false
  private captures = new Set<object>()
  private pending = new Map<string, unknown>()
  private loading: HudWindow | null = null

  constructor(private window: () => HudWindow | null, private canShow: () => boolean, private place: () => void) {}

  reset() {
    this.wanted = false
    this.captures.clear()
    this.pending.clear()
    this.loading = null
  }

  show() {
    this.wanted = true
    this.refresh()
  }

  hide() {
    this.wanted = false
    this.pending.clear()
    const w = this.window()
    if (w && !w.isDestroyed() && w.isVisible()) w.hide()
  }

  private refresh() {
    const w = this.window()
    if (!w || w.isDestroyed()) return
    if (w.webContents.isLoading()) { this.waitForLoad(w); return }
    if (!this.wanted || !this.canShow() || this.captures.size) return
    if (!w.isVisible()) {
      this.place()
      w.showInactive()
    }
  }

  private waitForLoad(w: HudWindow) {
    if (this.loading === w) return
    this.loading = w
    w.webContents.once('did-finish-load', () => {
      if (this.loading !== w || this.window() !== w || w.isDestroyed()) return
      this.loading = null
      const messages = [...this.pending]
      this.pending.clear()
      for (const [name, value] of messages) w.webContents.send(name, value)
      this.refresh()
    })
  }

  send(channel: string, payload: unknown, show: boolean) {
    const w = this.window()
    if (!w || w.isDestroyed()) return
    if (show) this.wanted = true
    if (w.webContents.isLoading()) {
      this.pending.set(channel, payload)
      this.waitForLoad(w)
    } else {
      w.webContents.send(channel, payload)
      this.refresh()
    }
  }

  /** Called AFTER a worker request leaves the queue, before its command is written. */
  capture(): () => void {
    const w = this.window()
    if (!w || w.isDestroyed()) return () => {}
    const token = {}
    this.captures.add(token)
    try {
      if (w.isVisible()) w.hide()
    } catch (error) {
      this.captures.delete(token)
      throw error
    }
    return () => {
      if (!this.captures.delete(token)) return
      if (this.window() === w) this.refresh()
    }
  }
}
