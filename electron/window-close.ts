/** How long a close request waits for the renderer before the close is forced. */
export const CLOSE_REPLY_TIMEOUT_MS = 10_000

/** Handed to `request` so a hung renderer cannot keep the window (and the session) open forever. */
export type CloseGuardOptions = {
  timeoutMs?: number
  onTimeout?: (id: number) => void
}

/** One renderer review per close attempt; stale/double replies cannot close a window. */
export class WindowCloseGuard {
  ready = false
  approved = false
  private serial = 0
  private pending: number | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  /**
   * `true` means the window may close now. `false` means the renderer was asked once and the answer
   * is still pending. `opts.timeoutMs` bounds that wait: without it, a renderer that never answers
   * (hung, crashed) blocked `before-quit` forever and unsaved work never reached the disk.
   */
  request(send: (id: number) => void, opts: CloseGuardOptions = {}): boolean {
    if (!this.ready || this.approved) return true
    if (this.pending === null) {
      const id = ++this.serial
      this.pending = id
      send(id)
      const ms = Math.max(0, opts.timeoutMs ?? CLOSE_REPLY_TIMEOUT_MS)
      if (ms > 0) {
        this.clearTimer()
        this.timer = setTimeout(() => this.expire(opts.onTimeout), ms)
        // The pending close must not be the very thing that keeps the process alive.
        const handle = this.timer as unknown as { unref?: () => void }
        if (typeof handle.unref === 'function') handle.unref()
      }
    }
    return false
  }

  /**
   * The wait ran out: the close is approved even though no renderer answer arrived. Returns the id
   * that timed out, or `null` when there was nothing to expire.
   */
  expire(notify?: (id: number) => void): number | null {
    if (this.pending === null) return null
    const id = this.pending
    this.clearTimer()
    this.pending = null
    this.approved = true
    notify?.(id)
    return id
  }

  /** Approves the close at once (renderer crashed or stopped answering) and forgets the request. */
  force(): void {
    this.clearTimer()
    this.pending = null
    this.approved = true
  }

  /**
   * Arayüz "hâlâ çalışıyorum" derse süreyi tazele. Kullanıcıya kaydetme sorusu gösterilirken arayüz
   * canlıdır ama cevap insandan gelir; sabit süre dolunca pencereyi kapatmak kararı çöpe atıyordu.
   * Arayüz çökerse/asalarsa mesaj gelmez ve süre normal şekilde dolar.
   */
  touch(timeoutMs: number = CLOSE_REPLY_TIMEOUT_MS, onTimeout?: (id: number) => void): void {
    if (this.pending === null) return
    const ms = Math.max(0, timeoutMs)
    if (ms === 0) return
    this.clearTimer()
    this.timer = setTimeout(() => this.expire(onTimeout), ms)
    const handle = this.timer as unknown as { unref?: () => void }
    if (typeof handle.unref === 'function') handle.unref()
  }

  /** Yalnızca hâlâ bekleyen istek için süre tazeler; eski bir kimlik yenisini uzatamaz. */
  touchFor(id: unknown, timeoutMs: number = CLOSE_REPLY_TIMEOUT_MS, onTimeout?: (id: number) => void): void {
    if (this.pending === null || id !== this.pending) return
    this.touch(timeoutMs, onTimeout)
  }

  reply(id: unknown, allow: unknown): boolean {
    if (this.pending === null || id !== this.pending || typeof allow !== 'boolean') return false
    this.clearTimer()
    this.pending = null
    this.approved = allow
    return allow
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
