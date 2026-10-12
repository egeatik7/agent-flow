/** Record identity is independent of its name, folder and working-tab identity. */
export class CanvasIdentityConflictError extends Error {
  constructor(public readonly canvasId: string, public readonly canvasName: string) {
    super(`“${canvasName}” ile aynı kimlikte farklı bir tuval sürümü zaten kütüphanede var. Mevcut kayıt değiştirilmedi; Farklı Kaydet ile ayrı kimlik oluştur.`)
    this.name = 'CanvasIdentityConflictError'
  }
}
