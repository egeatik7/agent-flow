/** Per visual action only; never persisted in settings or canvas JSON. */
export class VisualModelSession {
  private chain: string[]
  private configured: string[]
  constructor(chain: string[], public revision: number, public source: string) {
    this.chain = [...chain]; this.configured = [...chain]
  }
  get models(): string[] { return [...this.chain] }
  /** Settings changes affect the next request; unchanged lists retain the accepted suffix. */
  refresh(chain: string[], revision: number, source: string): void {
    if (source !== this.source || JSON.stringify(chain) !== JSON.stringify(this.configured)) {
      this.configured = [...chain]; this.chain = [...chain]
    }
    this.revision = revision; this.source = source
  }
  accept(model: string): void {
    const index = this.chain.indexOf(model)
    if (index < 0) throw new Error(`Görsel devam modeli bu işlemin kalan zincirinde yok: ${model}`)
    this.chain = this.chain.slice(index)
  }
}
