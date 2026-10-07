/**
 * Fare oynatma kaydı: "önce oynat → emin ol → oradan tıkla" zincirinin tek doğruluk kaynağı.
 *
 * İNCELEME DÜZELTMESİ: eskiden agent.ts içinde iki ayrı yerel değişkendi (lastHoverPoint /
 * lastClickPoint); tıkla node'unun "Fareyi Oynat" modu bu kaydı GÜNCELLEMİYORDU ve koşu
 * başında sıfırlanmıyordu. Artık kayıt tek modülde ve koşu başında temizlenir.
 */
export type HoverPoint = { x: number; y: number }
export type HoverRecord = HoverPoint & {
  /** Taşıma anında noktanın altındaki pencere. Tıklama anında aynı olmalı. */
  hwnd?: number
  at: number
}

let kayit: HoverRecord | undefined

export function recordHover(point: HoverPoint, hwnd?: number, now = Date.now()): void {
  kayit = { x: Math.round(point.x), y: Math.round(point.y), hwnd, at: now }
}

export function hoverOf(): HoverRecord | undefined {
  return kayit
}

/** Koşu başında ve pencere/odak değişiminde çağrılır. */
export function clearHover(): void {
  kayit = undefined
}

/** Fareyi taşımayan başka bir eylem kaydı geçersiz kılar (bayat noktaya basmayalım). */
export function invalidateHover(): void {
  kayit = undefined
}

export const HOVER_TOLERANCE_PX = 3
/** Bu süreden eski kayıt bayat sayılır (kullanıcı arada fareyi oynatmış olabilir). */
export const HOVER_MAX_AGE_MS = 120_000

/**
 * "Oradan tıkla" kararı — SAF fonksiyon, bu yüzden test edilebilir.
 * Gerçek imleç, kayıttan bu toleransın üstünde sapıyorsa TIKLAMAYIZ; uydurmayız.
 */
export function hoverDecision(
  cursor: HoverPoint | undefined,
  opts: { record?: HoverRecord; now?: number; tolerance?: number; maxAgeMs?: number } = {}
): { ok: boolean; reason: string; point?: HoverPoint } {
  const r = opts.record ?? kayit
  if (!r) return { ok: false, reason: 'Fare konumu bilinmiyor: önce fareyi oynat.' }
  const yas = (opts.now ?? Date.now()) - r.at
  if (yas > (opts.maxAgeMs ?? HOVER_MAX_AGE_MS)) {
    return { ok: false, reason: `Fare kaydı bayat (${Math.round(yas / 1000)} sn); güvenmeyip tıklamadım.` }
  }
  if (!cursor) return { ok: false, reason: 'Gerçek fare konumu okunamadı; tıklamadım.' }
  const tol = opts.tolerance ?? HOVER_TOLERANCE_PX
  const sapma = Math.hypot(cursor.x - r.x, cursor.y - r.y)
  if (sapma > tol) {
    return { ok: false, reason: `Fare beklenen yerde değil (${Math.round(sapma)} px sapma); bayat noktaya basmadım.` }
  }
  return { ok: true, reason: 'Fare kaydedilen noktada', point: { x: r.x, y: r.y } }
}
