import { containsText, norm } from './matcher'
import { NODE_SPECS, type AgentNode } from './graph-types'
import type { StepAhead } from './runner'

export type VerdictKind = 'ready' | 'missed' | 'loading' | 'blocked' | 'unknown'

export type Verdict = {
  kind: VerdictKind
  reason: string
  expected: string
  fresh: string[]
  changed: boolean
}

const LOADING = /yuklen|loading|please wait|lutfen bekle|isleniyor|bekleyin|processing|tamamlani/

/** The first quoted token in a condition, or the whole text when it is already short. */
export function conditionNeedle(text: string): string {
  const t = text.trim()
  const q = t.match(/[“"«„]([^”"»“]{1,80})[”"»“]/)
  if (q?.[1]?.trim()) return q[1].trim()
  return t
}

/** The next node's own words are the result this step should make possible. */
export function expectation(ahead?: StepAhead): string {
  const n = ahead?.next
  if (!n) return ''
  if (n.kind === 'condition') {
    const text = (n.text || '').trim()
    const needle = conditionNeedle(text)
    if (needle && needle.length <= 80 && needle !== text) return needle
    if (text.length <= 48) return text
    return (n.locator?.text || '').trim()
  }
  if (n.kind === 'click' || n.kind === 'type' || n.kind === 'key') {
    const quoted = (n.prompt || '').match(/[“"«„]([^”"»“]{1,80})[”"»“]/)
    if (quoted?.[1]?.trim()) return quoted[1].trim()
    const prompt = (n.prompt || '').trim()
    if (prompt && prompt.length <= 48) return prompt
    return (n.locator?.text || n.locator?.name || '').trim()
  }
  return ''
}

export function describeAhead(ahead?: StepAhead): string {
  const bits = [ahead?.next, ahead?.then]
    .filter((n): n is AgentNode => !!n)
    .map((n) => `${NODE_SPECS[n.kind].label}${n.prompt?.trim() ? `: ${n.prompt.trim()}` : n.text?.trim() ? `: ${n.text.trim()}` : ''}`)
  return bits.join(' → ')
}

function keySet(texts: string[]): Set<string> {
  return new Set(texts.map((t) => norm(t)).filter((t) => t.length >= 2))
}

/** Decides whether the action landed, from the texts visible before and after it. */
export function judgeScreen(before: string[], after: string[], expected: string): Verdict {
  const A = keySet(before)
  const B = keySet(after)
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  const union = A.size + B.size - inter
  const changed = union === 0 ? false : inter / union < 0.86
  const freshRaw = after.filter((t) => {
    const k = norm(t)
    return k.length >= 2 && !A.has(k)
  })
  const fresh = [...new Set(freshRaw.map((t) => t.trim()))].slice(0, 8)
  const has = (texts: string[]) => (expected ? containsText(texts.map((text, id) => ({ id, text, type: 'Text', src: 'ocr' as const, x: 0, y: 0, w: 0, h: 0 })), expected) : false)
  const had = has(before)
  const now = has(after)
  const loading = fresh.some((t) => LOADING.test(norm(t)))

  if (expected && now && !had) {
    return { kind: 'ready', reason: `sıradaki “${expected}” ekrana geldi`, expected, fresh, changed }
  }
  if (expected && now && had && changed) {
    return { kind: 'unknown', reason: `“${expected}” zaten ekrandaydı; başka yazıların değişmesi bu eylemi doğrulamıyor`, expected, fresh, changed }
  }
  if (expected && now && had && !changed) {
    return { kind: 'missed', reason: `“${expected}” zaten ekrandaydı, tıklama ekranı değiştirmedi`, expected, fresh, changed }
  }
  if (!changed) {
    return { kind: 'missed', reason: 'ekran değişmedi, tuş tepki vermemiş olabilir', expected, fresh, changed }
  }
  if (loading) {
    return { kind: 'loading', reason: 'yüklenme yazısı var, sıradaki hedef henüz yok', expected, fresh, changed }
  }
  if (!expected && changed) {
    return { kind: 'unknown', reason: 'ekran değişti; beklenen sonuç belirtilmediği için eylem doğrulanamadı', expected, fresh, changed }
  }
  if (fresh.length === 0) {
    return { kind: 'loading', reason: 'eski yazılar kalktı, yenisi henüz gelmedi', expected, fresh, changed }
  }
  return {
    kind: 'blocked',
    reason: `ekrana başka bir şey geldi: ${fresh.slice(0, 4).map((t) => `“${t}”`).join(', ')}`,
    expected,
    fresh,
    changed,
  }
}
