import type { TargetMemo } from './graph-types'
import { norm, type ScreenItem } from './matcher'

export const MEMO_KEEP = 5

type Area = { x: number; y: number; w: number; h: number }

export function memoOf(item: ScreenItem, area: Area, win: string): TargetMemo {
  const cx = item.x + item.w / 2
  const cy = item.y + item.h / 2
  return {
    win: win || '',
    type: item.type,
    src: item.src,
    rx: area.w ? Math.min(1, Math.max(0, (cx - area.x) / area.w)) : 0.5,
    ry: area.h ? Math.min(1, Math.max(0, (cy - area.y) / area.h)) : 0.5,
    text: item.text.slice(0, 80),
    at: Date.now(),
  }
}

/** Newest first; only the last few laps count so a slowly changing page is followed. */
export function remember(list: TargetMemo[] | undefined, m: TargetMemo): TargetMemo[] {
  return [m, ...(list ?? [])].slice(0, MEMO_KEEP)
}

function sameWin(a: string, b: string) {
  if (!a || !b) return true
  const tail = (s: string) => s.slice(s.lastIndexOf(' - ') + 1).trim().toLowerCase()
  return a === b || tail(a) === tail(b)
}

function comparableType(a: TargetMemo | { src: string; type: string }, b: { src: string; type: string }) {
  return a.src !== 'ocr' && b.src !== 'ocr'
}

/** How much a candidate looks like the recent successful targets (0–1), newest laps weigh more. */
export function likeness(list: TargetMemo[] | undefined, c: TargetMemo): number {
  if (!list?.length) return 0
  let sum = 0
  let wsum = 0
  list.forEach((m, i) => {
    const w = 1 / (i + 1)
    const dist = Math.hypot(m.rx - c.rx, m.ry - c.ry)
    let s = 0.4 * Math.max(0, 1 - dist / 0.25)
    if (comparableType(m, c)) s += m.type === c.type ? 0.3 : 0
    else s += 0.15
    s += sameWin(m.win, c.win) ? 0.2 : 0
    s += norm(m.text) === norm(c.text) ? 0.1 : 0
    sum += s * w
    wsum += w
  })
  return wsum ? sum / wsum : 0
}

/**
 * The laps agree with each other, and this lap's pick does not.
 * Returns what is different, or null when the pick is in line (or memory is too thin to judge).
 */
export function conflict(list: TargetMemo[] | undefined, c: TargetMemo): string | null {
  if (!list || list.length < 2) return null
  const recent = list.slice(0, 3)
  const reasons: string[] = []
  const typed = recent.filter((m) => comparableType(m, c))
  if (typed.length >= 2 && typed.every((m) => m.type === typed[0].type) && c.src !== 'ocr' && c.type !== typed[0].type) {
    reasons.push(`önceki turlarda hep ${typed[0].type}, bu tur ${c.type}`)
  }
  const cx = recent.reduce((s, m) => s + m.rx, 0) / recent.length
  const cy = recent.reduce((s, m) => s + m.ry, 0) / recent.length
  const spread = Math.max(...recent.map((m) => Math.hypot(m.rx - cx, m.ry - cy)))
  if (spread < 0.12 && Math.hypot(c.rx - cx, c.ry - cy) > 0.35) reasons.push('bu tur ekranın bambaşka bir yerinde')
  const wins = recent.map((m) => m.win).filter(Boolean)
  if (wins.length >= 2 && wins.every((w) => sameWin(w, wins[0])) && c.win && !sameWin(c.win, wins[0])) {
    reasons.push(`önceki turlarda “${wins[0]}” penceresindeydi, bu tur “${c.win}”`)
  }
  return reasons.length ? reasons.join('; ') : null
}

export function describeMemory(list: TargetMemo[] | undefined): string {
  if (!list?.length) return ''
  const m = list[0]
  return `geçen tur: ${m.src === 'ocr' ? 'yazı' : m.type} “${m.text}” (ekranın ${Math.round(m.rx * 100)}% sağı, ${Math.round(m.ry * 100)}% aşağısı)${
    m.win ? `, ${m.win}` : ''
  }`
}
