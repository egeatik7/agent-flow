/** One renderer review per close attempt; stale/double replies cannot close a window. */
export class WindowCloseGuard {
  ready = false
  approved = false
  private serial = 0
  private pending: number | null = null

  request(send: (id: number) => void): boolean {
    if (!this.ready || this.approved) return true
    if (this.pending === null) {
      this.pending = ++this.serial
      send(this.pending)
    }
    return false
  }

  reply(id: unknown, allow: unknown): boolean {
    if (this.pending === null || id !== this.pending || typeof allow !== 'boolean') return false
    this.pending = null
    this.approved = allow
    return allow
  }
}
