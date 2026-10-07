/**
 * Yazılı komutun hangi ekran öğesini kastettiğini seçen saf kurallar.
 *
 * Motorun merdiveni bunları kullanır: bir tıklama için öğenin kendisi, bir yazma için yazılabilir
 * alan. Ayrı dururlar çünkü kurallar test edilebilir olmalı ve motorun geri kalanını çağırmadan
 * doğrulanabilmelidir.
 */
import type { ScreenItem } from './matcher'

/** Control types that carry their own click target. A control beats a label that merely names it. */
export const CLICKABLE_CONTROLS = [
  'Button',
  'MenuItem',
  'Link',
  'CheckBox',
  'RadioButton',
  'TabItem',
  'ListItem',
  'TreeItem',
  'ComboBox',
  'Edit',
  'Image',
]

/** Control types that actually accept typing. A label next to a field is not one of them. */
export const WRITABLE_TYPES = ['Edit', 'Document', 'ComboBox']

export function normName(s: string): string {
  return String(s || '')
    .toLocaleLowerCase('tr')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The candidate closest to the last click, because that is the one the person just aimed at. */
export function nearestTo(hits: ScreenItem[], near?: { x: number; y: number }): ScreenItem | undefined {
  if (hits.length <= 1 || !near) return hits[0]
  return hits.reduce((a, b) => {
    const da = Math.hypot(a.x + a.w / 2 - near.x, a.y + a.h / 2 - near.y)
    const db = Math.hypot(b.x + b.w / 2 - near.x, b.y + b.h / 2 - near.y)
    return db < da ? b : a
  })
}

/**
 * The element a written click command means.
 *
 * The name must match exactly: a partial match is how the wrong control gets clicked. When several
 * elements carry the same name, a real control is preferred over a text label, and then the one
 * nearest the last click. If several remain and there is no click to tell them apart, **no
 * candidate is produced**: taking the first is how another application's button gets pressed.
 */
export function clickableBy(items: ScreenItem[], wanted: string, near?: { x: number; y: number }): ScreenItem | undefined {
  const w = normName(wanted)
  if (!w) return undefined
  const exact = items.filter((it) => normName(it.text) === w)
  if (!exact.length) return undefined
  const controls = exact.filter((it) => CLICKABLE_CONTROLS.includes(it.type))
  const pool = controls.length ? controls : exact
  if (pool.length > 1 && !near) return undefined
  return nearestTo(pool, near)
}

/**
 * The element a written command should be typed into. Only editable control types are accepted, the
 * name must match exactly, and the same "several matches, no context" rule applies as for a click.
 */
export function writableBy(items: ScreenItem[], wanted: string, near?: { x: number; y: number }): ScreenItem | undefined {
  const w = normName(wanted)
  if (!w) return undefined
  const hits = items.filter((it) => WRITABLE_TYPES.includes(it.type) && normName(it.text) === w)
  if (hits.length > 1 && !near) return undefined
  return nearestTo(hits, near)
}
