export type ScreenWord = { t: string; x: number; y: number; w: number; h: number }

export type ScreenItem = {
  id: number
  text: string
  type: string
  src: 'uia' | 'ocr'
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

function pickBest(scored: Scored[], anchor?: { x: number; y: number }): Scored | null {
  if (!scored.length) return null
  const top = Math.max(...scored.map((s) => s.score))
  const best = scored.filter((s) => s.score >= top - 4)
  best.sort((a, b) => {
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
  if (item.src === 'uia' && CLICKABLE.has(item.type)) return 6
  if (item.src === 'uia') return 2
  return 0
}

/** Finds `text` among on-screen items: exact > whole-word inside a phrase > substring. */
export function matchText(
  items: ScreenItem[],
  text: string,
  opts: { anchor?: { x: number; y: number }; minScore?: number } = {}
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
  const best = pickBest(scored, opts.anchor)
  if (!best || best.score < (opts.minScore ?? 30)) return null
  return toTarget(best.item, best.box)
}

/** Matches free-form Turkish/English prompts like "operaya tıkla" against on-screen text, tolerating suffixes. */
export function matchPrompt(items: ScreenItem[], prompt: string, anchor?: { x: number; y: number }): Target | null {
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
  const best = pickBest(scored, anchor)
  if (!best || best.score < 12) return null
  return toTarget(best.item, best.box)
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
    .map((i) => `#${i.id} ${i.src === 'uia' ? i.type : 'Yazı'} "${i.text.replace(/"/g, "'")}" @${Math.round(i.x)},${Math.round(i.y)} ${Math.round(i.w)}x${Math.round(i.h)}`)
    .join('\n')
}

export function sampleTexts(items: ScreenItem[], n = 12): string {
  return items
    .filter((i) => i.text.length <= 30)
    .slice(0, n)
    .map((i) => `“${i.text}”`)
    .join(', ')
}
