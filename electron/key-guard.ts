/**
 * Combinations the initiative model may not press. The list stays short on purpose: the
 * initiative node is the workhorse for jobs the flow cannot express, so only closing and
 * deleting are barred. Escape and Backspace stay available: they close dialogs and edit
 * text, which the model needs. A recorded initiative path is replayed as it was; this guard
 * covers the model's live choice only.
 */
const BLOCKED_KEY_SETS: string[][] = [
  ['alt', 'f4'],
  ['alt', 'ctrl', 'f4'],
  ['alt', 'shift', 'f4'],
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

const sortSet = (parts: string[]): string[] => [...new Set(parts.map((p) => KEY_ALIASES[p] ?? p))].sort()

/**
 * SendKeys yazımı mı? `^w`, `%{F4}`, `+{TAB}`, `{ESC}{DELETE}` gibi. Düz yazım (`ctrl+s`,
 * `alt+f4`, `win+r`) değil: oradaki `+` ayırıcıdır, shift öneki değil.
 */
const isSendKeysSyntax = (text: string): boolean => text.includes('{') || /^[%^+]/.test(text)

/** SendKeys parçalarını basış kümelerine ayırır: `^+{w}` → [[ctrl,shift,w]], `{ESC}{DELETE}` → [[escape],[delete]]. */
function parseSendKeys(text: string): string[][] {
  const chords: string[][] = []
  let mods: string[] = []
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '{') {
      const end = text.indexOf('}', i + 1)
      const name = (end < 0 ? text.slice(i + 1) : text.slice(i + 1, end)).trim().toLowerCase()
      if (name) chords.push(sortSet([...mods, name]))
      mods = []
      i = end < 0 ? text.length : end
      continue
    }
    if (c === '^') { mods.push('ctrl'); continue }
    if (c === '%') { mods.push('alt'); continue }
    if (c === '+') { mods.push('shift'); continue }
    if (c === ' ' || c === '\t') continue
    chords.push(sortSet([...mods, c.toLowerCase()]))
    mods = []
  }
  return chords
}

/**
 * Aynı kombinasyon her yazımda: "alt+f4", ["alt","F4"], "%{F4}", "^w", "^+{w}", "{ESC}{DELETE}".
 * Her basış ayrı bir kümedir; tek bir 'delete' basışı da engellenir.
 */
export function keyChords(keys: string | string[] | undefined): string[][] {
  if (keys === undefined || keys === null) return []
  const list = Array.isArray(keys) ? keys.filter((k) => String(k ?? '').trim() !== '') : []
  if (Array.isArray(keys)) {
    const mods: string[] = []
    const out: string[][] = []
    for (const piece of list) {
      const p = String(piece).trim().toLowerCase()
      if (!p) continue
      if (p === 'alt' || p === 'ctrl' || p === 'control' || p === 'shift' || p === 'win' || p === 'meta' || p === 'cmd' || p === 'super') { mods.push(p); continue }
      if (p.includes('{') || /^[%^+]/.test(p)) {
        const inner = parseSendKeys(p)
        if (inner.length) {
          inner[0] = sortSet([...mods, ...inner[0]])
          mods.length = 0
          out.push(...inner)
          continue
        }
      }
      out.push(sortSet([...mods, p]))
      mods.length = 0
    }
    if (mods.length) out.push(sortSet(mods))
    return out
  }
  const text = String(keys).trim()
  if (!text) return []
  if (isSendKeysSyntax(text)) return parseSendKeys(text)
  return [sortSet(text.split('+').map((p) => p.trim().toLowerCase()).filter(Boolean))]
}

/** Geriye uyumlu düz küme: tüm basışların birleşimi. */
export function keySet(keys: string | string[] | undefined): string[] | null {
  const chords = keyChords(keys)
  if (!chords.length) return null
  return sortSet(chords.flat())
}

/** Refuses a combination that would close a window or delete the selected thing. */
export function assertModelKeysAllowed(keys: string | string[] | undefined) {
  for (const chord of keyChords(keys)) {
    if (!chord.length) continue
    const hit = BLOCKED_KEY_SETS.find((b) => b.length === chord.length && b.every((k) => chord.includes(k)))
    if (hit) {
      throw new Error(`“${hit.join('+')}” engellendi: kapatma ve silme tuşları İnisiyatif'te kullanılamaz. Başka bir yol dene.`)
    }
  }
}
