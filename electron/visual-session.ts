/** Per visual action only; never persisted in settings or canvas JSON. */
export class VisualModelSession {
  private chain: string[]
  constructor(chain: string[], readonly revision: number, readonly source: string) {
    this.chain = [...chain]
  }
  get models(): string[] { return [...this.chain] }
  accept(model: string): void {
    const index = this.chain.indexOf(model)
    if (index < 0) throw new Error(`Görsel devam modeli bu işlemin kalan zincirinde yok: ${model}`)
    this.chain = this.chain.slice(index)
  }
}
