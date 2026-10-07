/** Runtime-only input evidence; it is never stored in node/flow JSON. */
export type Point = { x: number; y: number }
export type Rect = Point & { w: number; h: number }
export type InputWindow = { hwnd: string; pid: number; title: string; rect: Rect }
export type InputGuard = { window: InputWindow; at?: Point; visual?: boolean; direct?: boolean }
export type InputState = {
  type: string; writable: boolean; name: string; window: string
  inputRejection?: string; native?: string; hwnd?: string; pid?: number; focusHwnd?: string
  rect?: Rect | null; caret?: (Rect & { hwnd: string }) | null; readOnly?: boolean | null
}

export function inside(rect: Rect, p: Point): boolean {
  return [rect.x, rect.y, rect.w, rect.h, p.x, p.y].every(Number.isFinite)
    && rect.w > 0 && rect.h > 0 && p.x >= rect.x && p.x < rect.x + rect.w && p.y >= rect.y && p.y < rect.y + rect.h
}

export function movedPoint(old: Rect, now: Rect, p?: Point): Point | undefined {
  // Translation is safe to rebase; a resize/layout change needs fresh targeting.
  if (!p || old.w !== now.w || old.h !== now.h || !inside(old, p)) return undefined
  return { x: now.x + p.x - old.x, y: now.y + p.y - old.y }
}

export function focusAt(state: InputState | null, p: Point): boolean {
  return !!state?.writable && !!state.rect && inside(state.rect, p)
}

export function repeatedClick(a: { kind: string; x?: number; y?: number }, area: Rect, p: Point & { kind?: string }): boolean {
  if (!['click', 'double', 'right'].includes(a.kind) || a.x === undefined || a.y === undefined) return false
  // A deliberate double-click after selection is distinct from a blind repeat.
  if (p.kind && a.kind !== p.kind) return false
  return Math.hypot(area.x + a.x * area.w - p.x, area.y + a.y * area.h - p.y) <= 8
}

export function clickFeedback(goal: string, p: Point, area: Rect, state: InputState | null): string {
  return 'Son tıklama @' + Math.round(p.x) + ',' + Math.round(p.y)
    + ' (bu görüntüde ' + Math.round((p.x - area.x) / area.w * 1000) + ','
    + Math.round((p.y - area.y) / area.h * 1000) + '/1000). Ekranda belirgin değişiklik gözlenmedi;'
    + ' bu tek başına başarısızlık kanıtı değildir. Odak: ' + (state?.type || 'bilinmiyor')
    + ' / ' + (state?.window || 'bilinmiyor') + '. Hedef: ' + goal
    + '. Güncel görüntüde hedefin gerçekleşip gerçekleşmediğini yeniden değerlendir.'
    + ' Henüz gerçekleşmediyse hedefi yeniden bul; aynı noktayı körlemesine tekrarlama.'
    + ' Yüklenme varsa kısa bekle. Sırf ekran değişsin diye ilgisiz menü açma, Esc gönderme veya uygulamayı kapatma.'
}

/**
 * Yazma koruması: alan BİZİM tarafımızdan tıklandıysa (binding.at var, hedef kaymamış) **ve**
 * temizleme istenmişse "doğrudan" yol kullanılır — UIA sınıflandırması (Pane/TkChild/Window)
 * yazmayı engellemez. Ölçülen sorun (223 gerçek günlük): "Odaktaki öğe bir yazı alanı değil
 * (Window)" 14× ve "Odak bir yazı alanı değil (Pane). Yazı gönderilmedi." 9× — sınıflandırma
 * yüzünden yazma reddediliyordu.
 *
 * Temizleme istenmiyorsa doğrudan yol **kapalıdır**: worker o yolda silme yetkisi ister ve
 * istenmeyen bir silme asla yapılmamalıdır (`scripts/test-input-recovery.ps1` bunu şart koşar).
 */
export function inputGuardFor(
  binding: { window: InputWindow; at?: Point; mustRetarget?: boolean } | undefined,
  opts: { visual: boolean; clear: boolean }
): InputGuard | undefined {
  if (!binding) return undefined
  const tiklamaKaniti = !!binding.at && !binding.mustRetarget
  return { window: binding.window, at: binding.at, visual: opts.visual, direct: tiklamaKaniti && !!opts.clear }
}
