export type ScreenWord = { t: string; x: number; y: number; w: number; h: number }

export type ScreenItem = {
  id: number
  text: string
  type: string
  src: 'uia' | 'ocr' | 'dom'
  x: number
  y: number
  w: number
  h: number
  aid?: string
  words?: ScreenWord[]
}

export type ScanResult = {
  area: { x: number; y: number; w: number; h: number }
  items: ScreenItem[]
  ocr: boolean
  uiaCount: number
  ocrCount: number
  image: { data: string; w: number; h: number; mime?: string } | null
  window: string
  /** Set when the configured target window was not open and the whole screen was read instead. */
  missingWindow?: string
  /** 32x18 grayscale thumbnail (base64) when requested. */
  sig?: string
  /** Windows whose accessibility tree was too big to read in time. */
  uiaSkipped?: number
  /** The bundled Chinese/English reader ran on this scan. */
  onnx?: boolean
  /** Lines it added or corrected. Windows OCR lines that already matched are not counted. */
  onnxAdded?: number
}

export type Target = { x: number; y: number; w: number; h: number; text: string; item: ScreenItem }

const CLICKABLE = new Set([
  'Button',
  'MenuItem',
  'TabItem',
  'ListItem',
  'Hyperlink',
  'CheckBox',
  'RadioButton',
  'TreeItem',
  'ComboBox',
  'Edit',
  'SplitButton',
  'DataItem',
])

const STOPWORDS = new Set(
  [
    'tikla', 'tiklat', 'bas', 'basin', 'bastir', 'sec', 'secin', 'ac', 'yaz', 'git', 'uzerine', 'ustune', 'ustunde',
    'yazan', 'yazisina', 'yazisi', 'yazili', 'olan', 'yere', 'yeri', 'kismina', 'kisma', 'butonuna', 'butona', 'buton',
    'dugmesine', 'dugme', 'simgesine', 'simge', 'ikonuna', 'ikon', 'sekmesine', 'sekme', 'linkine', 'baglantiya',
    'tepedeki', 'tepeye', 'ustteki', 'alttaki', 'soldaki', 'sagdaki', 'ortadaki', 'en', 'bir', 've', 'ile', 'da', 'de',
    'click', 'on', 'the', 'press', 'tap', 'button', 'open', 'select',
  ].map((w) => w)
)

export function norm(s: string): string {
  return s
    .replace(/[İIı]/g, 'i')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Text the user explicitly marked with quotes, or the part before a Turkish suffix apostrophe (Opera'ya → Opera). */
export function extractTarget(prompt: string): { text: string; quoted: boolean } | null {
  const q = prompt.match(/[“"«„]([^”"»“]{1,80})[”"»“]/)
  if (q && q[1].trim()) return { text: q[1].trim(), quoted: true }
  const a = prompt.match(/([\p{L}\p{N}][\p{L}\p{N} .+-]{0,40}?)['’`](?:[\p{L}]{1,6})\b/u)
  if (a && a[1].trim()) {
    const words = a[1].trim().split(/\s+/)
    return { text: words.slice(-3).join(' '), quoted: false }
  }
  return null
}

function center(t: { x: number; y: number; w: number; h: number }) {
  return { cx: t.x + t.w / 2, cy: t.y + t.h / 2 }
}

function refineToWords(item: ScreenItem, q: string): { x: number; y: number; w: number; h: number } | null {
  const words = item.words ?? []
  if (words.length < 2) return null
  const qn = q.split(' ').length
  for (let i = 0; i + qn <= words.length; i++) {
    const slice = words.slice(i, i + qn)
    if (norm(slice.map((w) => w.t).join(' ')) === q || (qn === 1 && norm(slice[0].t).startsWith(q))) {
      const x1 = Math.min(...slice.map((w) => w.x))
      const y1 = Math.min(...slice.map((w) => w.y))
      const x2 = Math.max(...slice.map((w) => w.x + w.w))
      const y2 = Math.max(...slice.map((w) => w.y + w.h))
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
    }
  }
  return null
}

function toTarget(item: ScreenItem, box?: { x: number; y: number; w: number; h: number } | null): Target {
  const b = box ?? item
  return { x: b.x, y: b.y, w: b.w, h: b.h, text: item.text, item }
}

type Scored = { item: ScreenItem; score: number; box: { x: number; y: number; w: number; h: number } | null }

/** 0–1 likeness to what worked on earlier laps; only breaks ties between near-equal matches. */
export type Prefer = (item: ScreenItem) => number

function pickBest(scored: Scored[], anchor?: { x: number; y: number }, prefer?: Prefer): Scored | null {
  if (!scored.length) return null
  const top = Math.max(...scored.map((s) => s.score))
  const best = scored.filter((s) => s.score >= top - 4)
  const like = new Map(prefer ? best.map((s) => [s, prefer(s.item)] as const) : [])
  best.sort((a, b) => {
    if (prefer) {
      const d = (like.get(b) ?? 0) - (like.get(a) ?? 0)
      if (Math.abs(d) > 0.08) return d
    }
    if (anchor) {
      const da = Math.hypot(center(a.item).cx - anchor.x, center(a.item).cy - anchor.y)
      const db = Math.hypot(center(b.item).cx - anchor.x, center(b.item).cy - anchor.y)
      if (Math.abs(da - db) > 20) return da - db
    }
    if (b.score !== a.score) return b.score - a.score
    return a.item.id - b.item.id
  })
  return best[0]
}

function typeBonus(item: ScreenItem): number {
  if (item.src !== 'ocr' && CLICKABLE.has(item.type)) return item.src === 'dom' ? 8 : 6
  if (item.src !== 'ocr') return 2
  return 0
}

/** Finds `text` among on-screen items: exact > whole-word inside a phrase > substring. */
export function matchText(
  items: ScreenItem[],
  text: string,
  opts: { anchor?: { x: number; y: number }; minScore?: number; prefer?: Prefer } = {}
): Target | null {
  const q = norm(text)
  if (!q) return null
  const scored: Scored[] = []
  for (const item of items) {
    const t = norm(item.text)
    if (!t) continue
    let score = 0
    let box: Scored['box'] = null
    if (t === q) score = 100
    else if (` ${t} `.includes(` ${q} `)) {
      score = 70 - Math.min(20, t.length - q.length)
      box = refineToWords(item, q)
    } else if (q.length >= 3 && t.includes(q)) {
      score = 45
      box = refineToWords(item, q)
    } else if (t.length >= 3 && q.includes(t) && t.length >= q.length * 0.6) score = 35
    if (score) scored.push({ item, score: score + typeBonus(item), box })
  }
  const best = pickBest(scored, opts.anchor, opts.prefer)
  if (!best || best.score < (opts.minScore ?? 30)) return null
  return toTarget(best.item, best.box)
}

/** Matches free-form Turkish/English prompts like "operaya tıkla" against on-screen text, tolerating suffixes. */
export function matchPrompt(
  items: ScreenItem[],
  prompt: string,
  anchor?: { x: number; y: number },
  prefer?: Prefer
): Target | null {
  const pw = norm(prompt)
    .split(' ')
    .filter(Boolean)
  if (!pw.length) return null
  const content = pw.filter((w) => !STOPWORDS.has(w))
  const scored: Scored[] = []
  const candidates: { item: ScreenItem; text: string; box: Scored['box']; penalty: number }[] = []
  for (const item of items) {
    candidates.push({ item, text: item.text, box: null, penalty: 0 })
    const words = item.words ?? []
    if (words.length > 1) {
      for (let len = 1; len <= Math.min(3, words.length - 1); len++) {
        for (let i = 0; i + len <= words.length; i++) {
          const slice = words.slice(i, i + len)
          const x1 = Math.min(...slice.map((w) => w.x))
          const y1 = Math.min(...slice.map((w) => w.y))
          const x2 = Math.max(...slice.map((w) => w.x + w.w))
          const y2 = Math.max(...slice.map((w) => w.y + w.h))
          candidates.push({
            item,
            text: slice.map((w) => w.t).join(' '),
            box: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 },
            penalty: 3,
          })
        }
      }
    }
  }
  for (const { item, text, box, penalty } of candidates) {
    const iw = norm(text).split(' ').filter(Boolean)
    if (!iw.length || iw.length > 5) continue
    if (iw.every((w) => STOPWORDS.has(w))) continue
    for (let i = 0; i + iw.length <= pw.length; i++) {
      let ok = true
      let chars = 0
      for (let k = 0; k < iw.length; k++) {
        const p = pw[i + k]
        const w = iw[k]
        const last = k === iw.length - 1
        if (w.length < 2) {
          ok = p === w
        } else if (last) {
          ok = p.startsWith(w) && p.length - w.length <= 5
        } else {
          ok = p === w
        }
        if (!ok) break
        chars += w.length
      }
      if (ok) {
        const coverage = chars / Math.max(1, content.join('').length)
        scored.push({ item, score: chars * 4 + coverage * 30 + typeBonus(item) - penalty, box })
        break
      }
    }
  }
  const best = pickBest(scored, anchor, prefer)
  if (!best || best.score < 12) return null
  return toTarget(best.item, best.box)
}

/** Optimal string alignment distance (Levenshtein + adjacent transpositions), capped for speed. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      rowMin = Math.min(rowMin, d[i][j])
    }
    if (rowMin > max) return max + 1
  }
  return d[a.length][b.length]
}

function wordSimilarity(q: string, w: string): number {
  if (q === w) return 1
  if (q.length >= 3 && w.length >= 3 && (w.startsWith(q) || q.startsWith(w))) {
    const extra = Math.abs(q.length - w.length)
    if (extra <= 5) return 0.9
  }
  const allowed = q.length >= 7 ? 2 : q.length >= 4 ? 1 : 0
  if (allowed && editDistance(q, w, allowed) <= allowed) return 0.8
  return 0
}

/** Word-overlap match that tolerates typos, OCR mistakes and extra words (“kutsla bilgi” → “kutsal bilgi kaynağı”). */
export function matchFuzzy(
  items: ScreenItem[],
  text: string,
  opts: { anchor?: { x: number; y: number }; minScore?: number; prefer?: Prefer } = {}
): Target | null {
  const qw = norm(text)
    .split(' ')
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w))
  if (!qw.length) return null
  const total = qw.reduce((s, w) => s + w.length, 0)
  const scored: Scored[] = []
  for (const item of items) {
    const iw = norm(item.text).split(' ').filter(Boolean)
    if (!iw.length) continue
    let got = 0
    let matched = 0
    const used = new Set<number>()
    for (const q of qw) {
      let best = 0
      let bestIdx = -1
      iw.forEach((w, i) => {
        if (used.has(i)) return
        const s = wordSimilarity(q, w)
        if (s > best) {
          best = s
          bestIdx = i
        }
      })
      if (bestIdx >= 0) {
        used.add(bestIdx)
        got += q.length * best
        matched++
      }
    }
    const coverage = got / total
    if (coverage < 0.6 || matched < Math.ceil(qw.length * 0.6)) continue
    const extra = iw.length - used.size
    scored.push({ item, score: coverage * 100 - extra * 2 + typeBonus(item), box: null })
  }
  const best = pickBest(scored, opts.anchor, opts.prefer)
  if (!best || best.score < (opts.minScore ?? 50)) return null
  return toTarget(best.item, best.box)
}

/** Whole-word match only: “下载” is not found inside “下载App”, “İndir” not inside “İndirimler”. */
export function containsTextStrict(items: ScreenItem[], text: string): ScreenItem | undefined {
  const q = norm(text)
  if (!q) return undefined
  return items.find((i) => ` ${norm(i.text)} `.includes(` ${q} `))
}

export function containsText(items: ScreenItem[], text: string): boolean {
  const q = norm(text)
  if (!q) return false
  return items.some((i) => ` ${norm(i.text)} `.includes(` ${q} `) || norm(i.text).includes(q))
}

export function refineTarget(item: ScreenItem, text?: string): Target {
  if (text) {
    const box = refineToWords(item, norm(text))
    if (box) return toTarget(item, box)
  }
  return toTarget(item)
}

export function describeItems(items: ScreenItem[], limit = 400): string {
  return items
    .slice(0, limit)
    .map((i) => `#${i.id} ${i.src === 'ocr' ? 'Yazı' : i.type} "${i.text.replace(/"/g, "'")}" @${Math.round(i.x)},${Math.round(i.y)} ${Math.round(i.w)}x${Math.round(i.h)}`)
    .join('\n')
}

export function sampleTexts(items: ScreenItem[], n = 12): string {
  return items
    .filter((i) => i.text.length <= 30)
    .slice(0, n)
    .map((i) => `“${i.text}”`)
    .join(', ')
}
