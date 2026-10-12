import { describeItems, type ScanResult, type ScreenItem, type Target } from './matcher'
import { taskbarItem } from './spatial-context'

export const WORD_TARGET_RULES = `OCR is supplied as individual observed words with real bounding boxes, not reconstructed sentence boxes. Use the whole word cloud: proximity, alignment, spacing, UIA control bounds, and overall screen position to infer which words belong to the requested label or button. A shared OCR parent is NOT proof of one button; adjacent words can be different buttons. Related words can have different parents. Do not infer a clickable button from proximity alone.
For an OCR target, choose exactly ONE word: the word you are most confident lies on the intended clickable target. Return that word's listed id. The engine will click INSIDE that word's real box, never at an average between words or at a combined group center. Do not return several IDs, a group ID, an OCR parent ID, or coordinates. The text field cannot change the click box. Context-only unsplit OCR boxes are NOT selectable. For a genuine UIA/DOM control, its listed id remains valid. If no observed candidate fits, return id:null.
These IDs belong only to this current list. Screenshot numbers, if present, refer to original control/phrase IDs; OCR word IDs in this list have their own numbering. Resolve word IDs from the list, not screenshot numbering. Return the word whose text matches the instruction's own wording; never return another word from the same line, and never return a number that appears only in parent-line="..." or overlapping-OCR=...
Preserve a specifically named application's identity. A generic "browser"/"tarayıcı" label does not identify Google Chrome or any other named application. If the requested application is not identified by observed evidence, return id:null; do not substitute another application with a similar purpose.`

export const OCR_READER_RULES = `OCR-reader identifies the reader of each observation from the SAME captured frame. Windows and ONNX observations are supplied separately even when their text and coordinates overlap. Identical or differing readings at overlapping coordinates can refer to the SAME target; they are not automatically different buttons, additional completed jobs or additional actions. Infer the best reading from nearby words and the instruction. Select only ONE listed candidate for the requested target or condition evidence. Do not concatenate conflicting alternatives or mix observations from unrelated locations. overlapping-OCR lists cross-reader candidate IDs whose boxes geometrically overlap; its percentage is intersection area divided by the smaller box area, NOT a probability or proof of one button. Use it to recognize repeated observations of the same screen location, while still checking text and surrounding context. Each candidate keeps its own measured box; never average boxes or borrow word geometry from another observation. ONNX-confidence is that reader's recognition score, not proof of clickability. Keep counters, totals and negations meaningful: 6/60 is not 60/60, and running is not finished.`
export const CONDITION_TARGET_RULES = `This is a READ-ONLY existence condition, NOT an action. Interpret the user's whole instruction and decide whether observed screen evidence supports the requested state. Return satisfied:boolean for the whole condition. Choose one listed word/control or OCR-context-only line as positive evidence. An absence condition can be satisfied with id:null only if observed application/context and reading coverage support absence; an empty list or a missing application alone does not prove absence. If uncertain, return satisfied:false. For this condition, an unsplit line IS selectable as evidence even without word geometry; no click is sent. Do not open menus, close popups, advance the application or plan steps to make the condition true. A semantic paraphrase can match, but required numbers, totals and negations must agree. For example, "job finished 60/60 yazıyorsa evet ver" needs evidence of completion with 60/60; a running job or 6/60 does not qualify.`

export type WordCandidate = { item: ScreenItem; parentId: number; wordIndex?: number; contextOnly?: boolean }

function validBox(w: { x: number; y: number; w: number; h: number }): boolean {
  return [w.x, w.y, w.w, w.h].every(Number.isFinite) && w.w > 0 && w.h > 0
}

/** Request-local IDs. Scanner IDs, locators and stored flows are never rewritten. */
export function wordCandidates(scan: ScanResult): WordCandidate[] {
  let nextId = Math.max(0, ...scan.items.map(i => i.id)) + 1
  const out: WordCandidate[] = []
  for (const parent of scan.items) {
    if (parent.src !== 'ocr') {
      out.push({ item: parent, parentId: parent.id })
      continue
    }
    const valid = (parent.words ?? []).map((w, index) => ({ w, index })).filter(({ w }) => w.t.trim() && validBox(w))
    if (valid.length) {
      for (const { w, index } of valid) {
        out.push({ item: { id: nextId++, text: w.t, type: 'Word', src: 'ocr', x: w.x, y: w.y, w: w.w, h: w.h,
          ocrSources: w.ocrSources ?? parent.ocrSources, ocrConfidence: parent.ocrConfidence }, parentId: parent.id, wordIndex: index })
      }
    } else if (validBox(parent)) {
      // Older scans/readers may lack word geometry: expose it honestly as an unsplit box.
      out.push({ item: parent, parentId: parent.id, contextOnly: /\s/.test(parent.text.trim()) })
    }
  }
  return out
}

/** Measured cross-reader overlap, without grouping targets or altering their boxes/IDs. */
function readerOverlaps(candidates: WordCandidate[]): Map<number, Map<number, number>> {
  const readers = (item: ScreenItem) => item.ocrSources ?? ['windows']
  const windows = candidates.filter(c => c.item.src === 'ocr' && readers(c.item).includes('windows'))
  const onnx = candidates.filter(c => c.item.src === 'ocr' && readers(c.item).includes('onnx'))
  const links = new Map<number, Map<number, number>>()
  const add = (from: number, to: number, overlap: number) => {
    if (!links.has(from)) links.set(from, new Map())
    links.get(from)!.set(to, Math.round(overlap * 100))
  }
  for (const { item: a } of windows) for (const { item: b } of onnx) {
    if (a.id === b.id || !validBox(a) || !validBox(b)) continue
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
    if (w <= 0 || h <= 0) continue
    const overlap = w * h / Math.min(a.w * a.h, b.w * b.h)
    if (overlap < .45) continue
    add(a.id, b.id, overlap)
    add(b.id, a.id, overlap)
  }
  return links
}

/**
 * Modele gönderilen aday listesinin üst sınırı: satır sayısı.
 *
 * Adaylar tek tek `describeItems([item])` ile yazıldığı için `describeItems`'ın 400 öğelik sınırı
 * etkisiz kalıyordu ve liste ekrandaki HER OCR kelimesini içeriyordu; prompt on binlerce token
 * olabiliyordu. Sınır tek yerde durur.
 */
export const WORD_CANDIDATE_LIMIT = 400
/** Satır başına yazı üst sınırı: tek bir OCR çöp satırı prompt'u şişirmesin (kimlik/kutu korunur). */
export const WORD_TEXT_LIMIT = 120

/** Sınır aşıldığında bir kez yazılacak bilgi satırı; çağıran isterse kendi günlüğüne yönlendirir. */
export type WordLimitNote = (message: string) => void

/** Hangi adayların tutulacağı DETERMİNİSTİK: önce tıklanabilir adaylar (contextOnly olmayanlar),
 *  sonra ekran merkezine yakınlık, sonra listedeki okuma sırası. Rastgelelik yok. */
function boundedCandidates(candidates: WordCandidate[], area: ScanResult['area']): WordCandidate[] {
  if (candidates.length <= WORD_CANDIDATE_LIMIT) return candidates
  const cx = area.x + area.w / 2
  const cy = area.y + area.h / 2
  return candidates
    .map((c, i) => ({
      c,
      i,
      ctx: c.contextOnly ? 1 : 0,
      d: Math.hypot(c.item.x + c.item.w / 2 - cx, c.item.y + c.item.h / 2 - cy),
    }))
    .sort((a, b) => a.ctx - b.ctx || a.d - b.d || a.i - b.i)
    .slice(0, WORD_CANDIDATE_LIMIT)
    .sort((a, b) => a.i - b.i)
    .map((r) => r.c)
}

export function describeWordCandidates(scan: ScanResult, candidates: WordCandidate[], note?: WordLimitNote, options?: { fullText?: boolean }): string {
  const overlaps = readerOverlaps(candidates)
  const kept = boundedCandidates(candidates, scan.area)
  // Ölçülen kusur (1.9.110): listede İKİ numara dünyası vardı — satır başındaki seçilebilir aday
  // numaraları ve `parent=#13` / `overlapping-OCR=#124(100%)` gibi ASIL öğe kimlikleri. Küçük yerel
  // model bunları karıştırıp listede olmayan bir numara döndürüyordu ("LLM uygun öğe bulamadı").
  // Artık referanslar numara taşımaz: üst satır METNİYLE, örtüşme YÜZDEYLE anılır.
  const parentText = new Map(scan.items.map((item) => [item.id, item.text.replace(/"/g, "'").slice(0, 60)]))
  if (kept.length < candidates.length) {
    // §9: aday listesi sınırsız büyümesin. Tek satır bilgi, aday başına değil.
    const say = `Aday listesi sınırlandı: ${candidates.length} adaydan ${kept.length} tanesi modele gönderiliyor (üst sınır ${WORD_CANDIDATE_LIMIT}).`
    if (note) note(say)
    else console.warn(`[hedef] ${say}`)
  }
  return kept.map(({ item, parentId, wordIndex, contextOnly }) => {
    const x = (item.x + item.w / 2 - scan.area.x) / Math.max(1, scan.area.w) * 100
    const y = (item.y + item.h / 2 - scan.area.y) / Math.max(1, scan.area.h) * 100
    const links = overlaps.get(item.id)
    const overlapHint = links?.size ? ` overlapping-OCR=${[...links].map(([, percent]) => `${percent}%`).join(',')}` : ''
    const clipped = !options?.fullText && item.text.length > WORD_TEXT_LIMIT ? { ...item, text: item.text.slice(0, WORD_TEXT_LIMIT) } : item
    return `${describeItems([clipped])} center=${x.toFixed(1)}%,${y.toFixed(1)}%${item.src === 'ocr' ? wordIndex !== undefined ? ` OCR-word parent-line="${parentText.get(parentId) ?? ''}"` : contextOnly ? ' OCR-context-only (word geometry unavailable; NOT selectable for clicking)' : ' OCR-single-token (word geometry unavailable)' : ''}${taskbarItem(scan, item) ? ' region=taskbar' : ''}${overlapHint}`
  }).join('\n')
}

/** Ignore model-supplied text/coordinates: only the selected observed word defines this box. */
export function refineWordTarget(item: ScreenItem, wordIndex: number): Target | null {
  if (item.src !== 'ocr' || !Number.isInteger(wordIndex) || wordIndex < 0) return null
  const word = item.words?.[wordIndex]
  if (!word || !word.t.trim() || !validBox(word)) return null
  const minX = Math.ceil(word.x), maxX = Math.ceil(word.x + word.w) - 1
  const minY = Math.ceil(word.y), maxY = Math.ceil(word.y + word.h) - 1
  if (maxX < minX || maxY < minY) return null
  const clickPoint = { x: Math.min(maxX, Math.max(minX, Math.floor(word.x + word.w / 2))), y: Math.min(maxY, Math.max(minY, Math.floor(word.y + word.h / 2))) }
  return { x: word.x, y: word.y, w: word.w, h: word.h, text: word.t, item, clickPoint }
}

/**
 * Kisa ikinci kelime secimine girilmeli mi (1.9.117). Olculen kusur: goruntu rozetinden cozulen cok
 * kelimeli OCR satirinda wordIndex bos oldugu icin yol erken cikiyor, gunluk "ikinci secime gidiyor"
 * derken satir MERKEZINE tikliyordu. Rozet satiri da bu yola girer; tikla gercek kelime kutusuna gider.
 */
export function shouldRefineWord(kind: string, itemSrc: string, choice: { wordIndex?: number; badgeResolved?: boolean }): boolean {
  if (kind !== 'click' || itemSrc !== 'ocr') return false
  if (choice.wordIndex === undefined && choice.badgeResolved !== true) return false
  return true
}
