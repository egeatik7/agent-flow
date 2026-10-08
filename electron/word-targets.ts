import { describeItems, type ScanResult, type ScreenItem, type Target } from './matcher'
import { taskbarItem } from './spatial-context'

export const WORD_TARGET_RULES = `OCR is supplied as individual observed words with real bounding boxes, not reconstructed sentence boxes. Use the whole word cloud: proximity, alignment, spacing, UIA control bounds, and overall screen position to infer which words belong to the requested label or button. A shared OCR parent is NOT proof of one button; adjacent words can be different buttons. Related words can have different parents. Do not infer a clickable button from proximity alone.
For an OCR target, choose exactly ONE word: the word you are most confident lies on the intended clickable target. Return that word's listed id. The engine will click INSIDE that word's real box, never at an average between words or at a combined group center. Do not return several IDs, a group ID, an OCR parent ID, or coordinates. The text field cannot change the click box. Context-only unsplit OCR boxes are NOT selectable. For a genuine UIA/DOM control, its listed id remains valid. If no observed candidate fits, return id:null.
These IDs belong only to this current list. Screenshot numbers, if present, refer to original control/phrase IDs; OCR word IDs in this list have their own coordinates. Resolve word IDs from the list, not screenshot numbering.
Preserve a specifically named application's identity. A generic "browser"/"tarayıcı" label does not identify Google Chrome or any other named application. If the requested application is not identified by observed evidence, return id:null; do not substitute another application with a similar purpose.`

export const OCR_READER_RULES = `OCR-reader identifies Windows, ONNX, or both reading the SAME captured frame. Different readings at overlapping coordinates are alternatives for one location, not automatically different buttons. Infer the best reading from nearby words and the instruction. Do not concatenate conflicting alternatives or mix observations from unrelated locations. ONNX-confidence is that reader's recognition score, not proof of clickability. Keep counters, totals and negations meaningful: 6/60 is not 60/60, and running is not finished.`
export const CONDITION_TARGET_RULES = `This is a READ-ONLY existence condition, NOT an action. Interpret the user's whole instruction and decide whether observed screen evidence supports the requested state. Choose one listed word/control or OCR-context-only line as evidence, or id:null if it is absent. For this condition, an unsplit line IS selectable as evidence even without word geometry; no click is sent. Do not open menus, close popups, advance the application or plan steps to make the condition true. A semantic paraphrase can match, but required numbers, totals and negations must agree. For example, "job finished 60/60 yazıyorsa evet ver" needs evidence of completion with 60/60; a running job or 6/60 does not qualify.`

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

export function describeWordCandidates(scan: ScanResult, candidates: WordCandidate[]): string {
  return candidates.map(({ item, parentId, wordIndex, contextOnly }) => {
    const x = (item.x + item.w / 2 - scan.area.x) / Math.max(1, scan.area.w) * 100
    const y = (item.y + item.h / 2 - scan.area.y) / Math.max(1, scan.area.h) * 100
    return `${describeItems([item])} center=${x.toFixed(1)}%,${y.toFixed(1)}%${item.src === 'ocr' ? wordIndex !== undefined ? ` OCR-word parent=#${parentId}` : contextOnly ? ' OCR-context-only (word geometry unavailable; NOT selectable for clicking)' : ' OCR-single-token (word geometry unavailable)' : ''}${taskbarItem(scan, item) ? ' region=taskbar' : ''}`
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
