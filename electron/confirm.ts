import { commandNeedle, containsTextStrict, norm } from './matcher'
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
    // İğne, ekrana gerçekten gelmesi beklenen HEDEF yazısıdır: tırnaklı ifade, yoksa kaydedilmiş
    // locator metni; ikisi de yoksa komutun kendisinden türetilir (komutun tamamı çoğu zaman
    // ekranda hiç görünmediği için "hazır" kararı hiç oluşmuyordu).
    const quoted = (n.prompt || '').match(/[“"«„]([^”"»“]{1,80})[”"»“]/)
    if (quoted?.[1]?.trim()) return quoted[1].trim()
    const loc = (n.locator?.text || n.locator?.name || '').trim()
    if (loc) return loc
    return commandNeedle(n.prompt || '')
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
  // Tam KELİME/ifade eşleşmesi: "İndirilenler" gelince "İndir", "Tamamlanıyor" gelince "Tamam"
  // doğrulanmış sayılmaz (üst-küme yazı "hazır" üretmez).
  const has = (texts: string[]) => (expected ? containsTextStrict(texts.map((text, id) => ({ id, text, type: 'Text', src: 'ocr' as const, x: 0, y: 0, w: 0, h: 0 })), expected) !== undefined : false)
  const had = has(before)
  const now = has(after)
  // Yüklenme/tamamlanma sinyali "hazır"dan ÖNCE değerlendirilir. Kapsam DAR tutulur: ekranın
  // tamamı tarandığı için sürekli duran ilgisiz bir "işleniyor/bekleyin" etiketi varsa hazır kararı
  // sonsuza kadar hiç oluşmazdı (hafızaya doğrulanmış hedef yazılmaz, "on" modunda gereksiz model
  // çağrısı). Bu yüzden yalnız (1) bu karede YENİ çıkan yüklenme yazısı ya da (2) beklenen iğneyi
  // kendisi İÇEREN üst-küme yazı (ör. beklenen "Tamam", ekranda "Tamamlanıyor") sinyal sayılır.
  // D06 (yönerge): `norm(expected)` BOŞ olabilir (noktalama-only iğne, ör. "×" → norm ""). O durumda
  // `norm(t).includes('')` HER ZAMAN doğru olurdu ve ilgisiz bir "işleniyor/yükleniyor" yazısı adımı
  // 'loading' yapardı (matcher'daki boşluk korumasının bu satırda karşılığı yoktu). Boş iğnede üst-küme
  // kontrolü UYGULANMAZ; "bu karede YENİ çıkan yüklenme yazısı" kuralı aynen çalışmaya devam eder.
  const beklenenNorm = norm(expected)
  const loading = fresh.some((t) => LOADING.test(norm(t)))
    || (!!expected && beklenenNorm !== '' && after.some((t) => LOADING.test(norm(t)) && norm(t).includes(beklenenNorm)))

  if (loading) {
    return { kind: 'loading', reason: 'ekranda yüklenme/tamamlanma yazısı var; hedef doğrulanmış sayılmaz', expected, fresh, changed }
  }
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
