import { inside, type InputWindow, type Point, type Rect } from './input-policy'
import type { ScanResult } from './matcher'

export type InputObservation = { text: string; rect: Rect }

/** A fresh, single OCR row near the clicked field; labels alone grant no write permission. */
export function observedInput(scan: ScanResult, win: InputWindow, at: Point): InputObservation | undefined {
  const rows = scan.items.filter(i => i.src === 'ocr' && i.text.trim().length >= 12
    && i.text.length <= 512 && i.w > 0 && i.h > 0 && i.h <= 60
    && inside(win.rect, { x: i.x, y: i.y })
    && inside(win.rect, { x: i.x + i.w - 1, y: i.y + i.h - 1 })
    && Math.abs(at.y - (i.y + i.h / 2)) <= Math.max(6, i.h / 2)
    && at.x >= i.x - 12 && at.x <= i.x + i.w + Math.min(240, win.rect.w / 3))
  // Multiple distinct rows on the same baseline could be different fields.
  if (rows.length !== 1) return undefined
  const i = rows[0]
  return { text: i.text.trim(), rect: { x: i.x, y: i.y, w: i.w, h: i.h } }
}

function normalized(s: string): string {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[ı]/g, 'i').replace(/[$5]/g, 's').replace(/[^\p{L}\p{N}]/gu, '')
}

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = next
  }
  return prev[b.length]
}

/** Full-value comparison with bounded OCR tolerance, never a short substring match. */
export function matchesObservedInput(observed: string, copied: string): boolean {
  if (observed.length > 512 || copied.length > 2048 || /[\r\n]/.test(copied)) return false
  const a = normalized(observed), b = normalized(copied)
  if (a.length < 12 || b.length < 12 || Math.min(a.length, b.length) / Math.max(a.length, b.length) < 0.8) return false
  if (/[\\/]/.test(observed) && /[\\/]/.test(copied)) {
    // A common C:\Users prefix must not hide a different final folder/file.
    const ta = normalized(observed.split(/[\\/]/).slice(-1)[0] || ''), tb = normalized(copied.split(/[\\/]/).slice(-1)[0] || '')
    if (!ta || !tb || distance(ta, tb) > Math.floor(Math.max(ta.length, tb.length) * 0.2)) return false
  }
  return distance(a, b) <= Math.floor(Math.max(a.length, b.length) * 0.2)
}
