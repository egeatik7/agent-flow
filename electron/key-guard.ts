/**
 * Combinations the initiative model may not press. The list stays short on purpose: the
 * initiative node is the workhorse for jobs the flow cannot express, so only closing and
 * deleting are barred. Escape and Backspace stay available: they close dialogs and edit
 * text, which the model needs. A recorded initiative path is replayed as it was; this guard
 * covers the model's live choice only.
 */
const BLOCKED_KEY_SETS: string[][] = [
  ['alt', 'f4'],
  ['ctrl', 'w'],
  ['ctrl', 'q'],
  ['ctrl', 'shift', 'w'],
  ['delete'],
  ['shift', 'delete'],
]

const KEY_ALIASES: Record<string, string> = {
  control: 'ctrl',
  ctl: 'ctrl',
  lwin: 'win',
  rwin: 'win',
  meta: 'win',
  cmd: 'win',
  super: 'win',
  del: 'delete',
  esc: 'escape',
}

/** The same combination however it was written: "alt+f4", ["alt", "F4"], "%{F4}". */
export function keySet(keys: string | string[] | undefined): string[] | null {
  const raw = Array.isArray(keys) ? keys : String(keys ?? '').split('+')
  const parts: string[] = []
  for (const piece of raw) {
    const s = String(piece).trim().toLowerCase()
    if (!s) continue
    const legacy = s.match(/^([%^+]*)\{([^}]+)\}$/)
    if (legacy) {
      for (const c of legacy[1]) parts.push(c === '%' ? 'alt' : c === '^' ? 'ctrl' : 'shift')
      parts.push(legacy[2])
      continue
    }
    parts.push(s)
  }
  if (!parts.length) return null
  return [...new Set(parts.map((p) => KEY_ALIASES[p] ?? p))].sort()
}

/** Refuses a combination that would close a window or delete the selected thing. */
export function assertModelKeysAllowed(keys: string | string[] | undefined) {
  const set = keySet(keys)
  if (!set) return
  const hit = BLOCKED_KEY_SETS.find((b) => b.length === set.length && b.every((k) => set.includes(k)))
  if (hit) {
    throw new Error(`“${hit.join('+')}” engellendi: kapatma ve silme tuşları İnisiyatif'te kullanılamaz. Başka bir yol dene.`)
  }
}
