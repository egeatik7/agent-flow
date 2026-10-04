import type { NodeKind } from './graph-types'
import { fillGoal, INITIATIVE_PROMPT, LIST_PROMPT, REACTION_PROMPT, SCREEN_PROMPT, STALL_PROMPT, TARS_TEMPLATE } from './llm-flow'
import { describeItems, type ScanResult } from './matcher'
import { StoppedError } from './runner'

/** A model request that has not answered by then is abandoned (and retried once). */
const REQUEST_TIMEOUT_MS = 90000

let stopCheck: () => boolean = () => false

/** Lets Ctrl+Shift+Q cut a pending model request instead of waiting for it. */
export function setStopCheck(fn: () => boolean) {
  stopCheck = fn
}

class TransientError extends Error {}

/** fetch + body read, with a time limit and the stop hotkey. */
async function guardedFetch(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<{ ok: boolean; status: number; text: string }> {
  const ctrl = new AbortController()
  let byUser = false
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const poll = setInterval(() => {
    if (stopCheck()) {
      byUser = true
      ctrl.abort()
    }
  }, 250)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    const text = await res.text()
    return { ok: res.ok, status: res.status, text }
  } catch (e) {
    if (byUser) throw new StoppedError()
    if (ctrl.signal.aborted) throw new TransientError(`Model ${Math.round(timeoutMs / 1000)} sn içinde cevap vermedi.`)
    throw new TransientError(`Bağlantı hatası: ${(e as Error).message}`)
  } finally {
    clearTimeout(timer)
    clearInterval(poll)
  }
}

async function stoppableWait(ms: number) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (stopCheck()) throw new StoppedError()
    await new Promise((r) => setTimeout(r, 200))
  }
}

const HEADERS = (apiKey: string) => ({
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
  'HTTP-Referer': 'https://nubbo.local',
  'X-Title': 'Nubbo Agent Studio',
})

type Message = { role: 'system' | 'user' | 'assistant'; content: string | object[] }

let chatLogger: ((line: string) => void) | null = null
let voiceLogger: ((line: string) => void) | null = null

/** The agent log receives every completion request and response. Images are noted, not pasted. */
export function setChatLogger(fn: ((line: string) => void) | null) {
  chatLogger = fn
}

/** A short line in the corner report: the model that answered, then what it said. */
export function setVoiceLogger(fn: ((line: string) => void) | null) {
  voiceLogger = fn
}

function shortModel(model: string): string {
  return (model.split('/').pop() || model).trim() || model
}

function modelSaid(model: string, content: string): string | null {
  const raw = content.trim()
  if (!raw || /^hata\b/i.test(raw)) return null
  let said = ''
  const thought = raw.match(/Thought:\s*([\s\S]+?)(?:\n\s*Action:|$)/i)
  if (thought) said = thought[1].replace(/\s+/g, ' ').trim()
  else {
    const p = parseJson(raw)
    said = String(p.thought ?? p.reason ?? '').replace(/\s+/g, ' ').trim()
  }
  if (said.length < 2) return null
  if (said.length > 180) said = `${said.slice(0, 177)}…`
  return `${shortModel(model)}: ${said}`
}

function clip(s: string, n = 6000): string {
  const t = s.trim()
  if (t.length <= n) return t
  return `${t.slice(0, n)}\n… (${t.length - n} karakter kısaltıldı)`
}

function describeMessages(messages: Message[]): string {
  return messages
    .map((m) => {
      if (typeof m.content === 'string') return `[${m.role}]\n${m.content}`
      const bits = (m.content as { type?: string; text?: string }[]).map((part) =>
        part.type === 'image_url' ? '[ekran görüntüsü]' : (part.text ?? '')
      )
      return `[${m.role}]\n${bits.filter(Boolean).join('\n')}`
    })
    .join('\n\n')
}

function reportOut(model: string, messages: Message[]) {
  chatLogger?.(`API → ${model}\n${clip(describeMessages(messages))}`)
}

function reportIn(text: string) {
  chatLogger?.(`API ← ${clip(text.trim() || '(boş yanıt)')}`)
}

class ImageUnsupportedError extends Error {}

/** Key or balance. Another model name cannot fix these. */
export class FatalApiError extends Error {}

/** This model could not answer. The next name in the list should be tried. */
export class ModelFailed extends Error {}

/** This model will not answer however often it is asked: wrong name or request (400/404/422), empty or unreadable answer. Outages and rate limits are not this. */
export class ModelRejected extends ModelFailed {}

const CYCLE_PAUSE_MS = 4000
/** Whole rounds in a row in which every model was rejected for good before the step gives up. */
const MAX_REJECTED_CYCLES = 8

export function asModelChain(model: string | string[] | undefined): string[] {
  const raw = Array.isArray(model) ? model : [model ?? '']
  const out: string[] = []
  for (const item of raw) {
    const name = String(item ?? '').trim()
    if (!name || out.includes(name)) continue
    out.push(name)
    if (out.length >= 5) break
  }
  return out
}

function brief(err: unknown): string {
  return ((err as Error).message || String(err)).replace(/\s+/g, ' ').slice(0, 160)
}

/**
 * Tries each model once. After the last one fails, waits and starts again at the first.
 * Stops when the user stops, the key / balance is rejected, or every model was rejected for good
 * in MAX_REJECTED_CYCLES rounds in a row. Outages, timeouts and rate limits keep waiting and retrying.
 */
export async function runModelChain<T>(models: string[], run: (model: string) => Promise<T>, pauseMs = CYCLE_PAUSE_MS): Promise<T> {
  const chain = asModelChain(models)
  if (!chain.length) throw new Error('Model adı yok. Ayarlar’dan bir model yaz.')
  let rejectedCycles = 0
  for (;;) {
    let allRejected = true
    let lastError = ''
    for (let i = 0; i < chain.length; i++) {
      if (stopCheck()) throw new StoppedError()
      const model = chain[i]
      try {
        return await run(model)
      } catch (e) {
        if (e instanceof StoppedError || e instanceof FatalApiError) throw e
        if (!(e instanceof ModelRejected)) allRejected = false
        lastError = brief(e)
        const last = i === chain.length - 1
        const next = chain[(i + 1) % chain.length]
        chatLogger?.(last ? `${model} olmadı (${brief(e)}). Sıra başa dönüyor.` : `${model} olmadı (${brief(e)}). ${next} deneniyor.`)
      }
    }
    rejectedCycles = allRejected ? rejectedCycles + 1 : 0
    if (rejectedCycles >= MAX_REJECTED_CYCLES) {
      throw new Error(`Hiçbir model cevap vermedi: ${rejectedCycles} tur üst üste reddedildi (model adını ve ayarları kontrol et). Son hata: ${lastError}`)
    }
    chatLogger?.(`Modellerin hepsi susuyor. ${Math.round(pauseMs / 1000)} sn sonra ${chain[0]} yeniden denenecek.`)
    await stoppableWait(pauseMs)
  }
}

/** One request to one model. No second try here; the chain does that. */
async function chatOnce(
  apiKey: string,
  model: string,
  messages: Message[],
  hasImage: boolean,
  opts: { json?: boolean; maxTokens?: number } = {}
): Promise<string> {
  const once = async (json: boolean) => {
    reportOut(model, messages)
    const res = await guardedFetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: HEADERS(apiKey),
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: opts.maxTokens ?? (hasImage ? 2500 : 800),
        messages,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    })
    if (!res.ok) {
      reportIn(`hata ${res.status}: ${res.text.slice(0, 2000)}`)
      if (res.status === 401) throw new FatalApiError('OpenRouter API anahtarı geçersiz (401).')
      if (res.status === 402) throw new FatalApiError('OpenRouter bakiyesi yetersiz (402).')
      if (hasImage && /image|vision|multimodal|modalit/i.test(res.text)) throw new ImageUnsupportedError(res.text.slice(0, 200))
      const message = `OpenRouter ${res.status}: ${res.text.slice(0, 200)}`
      throw [400, 404, 422].includes(res.status) ? new ModelRejected(message) : new ModelFailed(message)
    }
    let data: { choices?: { message?: { content?: string } }[]; error?: { message?: string } }
    try {
      data = JSON.parse(res.text)
    } catch {
      throw new ModelRejected('OpenRouter yanıtı okunamadı.')
    }
    if (data.error?.message) {
      const msg = data.error.message
      reportIn(`hata: ${msg}`)
      if (/invalid api key|unauthorized/i.test(msg)) throw new FatalApiError(`OpenRouter: ${msg}`)
      if (/insufficient credits|payment required|402/i.test(msg)) throw new FatalApiError(`OpenRouter: ${msg}`)
      throw new ModelFailed(`OpenRouter: ${msg.slice(0, 200)}`)
    }
    const content = data.choices?.[0]?.message?.content ?? ''
    reportIn(content)
    const said = modelSaid(model, content)
    if (said) voiceLogger?.(said)
    return content
  }
  try {
    return await once(opts.json !== false)
  } catch (e) {
    if (!(e instanceof ModelFailed) || opts.json === false) throw e
    if (/400|404|422/.test(e.message)) return once(false)
    throw e
  }
}

async function chat(
  apiKey: string,
  model: string | string[],
  messages: Message[],
  hasImage: boolean,
  opts: { json?: boolean; maxTokens?: number } = {},
  /** Same request with the picture removed, used when this model cannot see images. */
  withoutImage?: Message[]
): Promise<string> {
  return runModelChain(asModelChain(model), async (name) => {
    try {
      const text = await chatOnce(apiKey, name, messages, hasImage, opts)
      if (!text.trim()) throw new ModelRejected('boş yanıt')
      return text
    } catch (e) {
      if (!(e instanceof ImageUnsupportedError)) throw e
      if (!withoutImage) throw new ModelRejected(`${name} ekran görüntüsü kabul etmiyor.`)
      chatLogger?.(`${name} görüntü kabul etmiyor, yazı listesiyle deneniyor.`)
      const text = await chatOnce(apiKey, name, withoutImage, false, opts)
      if (!text.trim()) throw new ModelRejected('boş yanıt')
      return text
    }
  })
}

function parseJson(content: string): Record<string, unknown> {
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s) as Record<string, unknown>
    } catch {
      return null
    }
  }
  return tryParse(content) ?? tryParse(content.match(/\{[\s\S]*\}/)?.[0] ?? '') ?? {}
}

export type ScreenChoice = { id: number | null; text?: string; reason: string; usedImage: boolean }

export async function chooseScreenTarget(opts: {
  apiKey: string
  model: string | string[]
  prompt: string
  kind: NodeKind
  scan: ScanResult
  stepTitle: string
  sendImage: boolean
  onImageFallback?: (msg: string) => void
  /** What worked on earlier laps, or why this lap looks different. */
  hint?: string
  /** Replaces the built-in system prompt when set in the LLM panel. */
  system?: string
}): Promise<ScreenChoice> {
  const { scan } = opts
  const action =
    opts.kind === 'type'
      ? 'The user is about to type into a text field: choose the FIELD to type into (search box, Edit, input).'
      : 'The user is about to click somewhere on the screen: choose the text or control to click.'

  const system =
    opts.system?.trim() ||
    LIST_PROMPT.replace(
      'The user is about to click somewhere on the screen: choose the text or control to click.',
      action
    )

  const listText = `Screen area: ${scan.area.w}x${scan.area.h} (top-left ${scan.area.x},${scan.area.y})${scan.window ? `, window: ${scan.window}` : ''}
Items (#number type "text" @x,y widthxheight):
${describeItems(scan.items)}

Step: ${opts.stepTitle}
Instruction: ${opts.prompt}${opts.hint ? `\n\nMemory: ${opts.hint}\nMemory is only a hint; if the screen differs, follow the screen.` : ''}`

  const withImage = opts.sendImage && !!scan.image
  const build = (img: boolean): Message[] => [
    { role: 'system', content: system },
    {
      role: 'user',
      content: img
        ? [
            { type: 'text', text: `${listText}\n\nEkran görüntüsünde her öğenin sol üstünde numarası yazılı (mavi = UIA, turuncu = OCR).` },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${scan.image!.data}` } },
          ]
        : listText,
    },
  ]

  let content: string
  let usedImage = withImage
  try {
    content = await chat(opts.apiKey, opts.model, build(withImage), withImage, {}, withImage ? build(false) : undefined)
  } catch (e) {
    if (!(e instanceof ImageUnsupportedError)) throw e
    opts.onImageFallback?.('Seçili model ekran görüntüsünü desteklemiyor, sadece yazı listesiyle deneniyor.')
    usedImage = false
    content = await chat(opts.apiKey, opts.model, build(false), false)
  }

  const parsed = parseJson(content)
  const raw = parsed.id ?? parsed.i ?? parsed.index
  const id = raw === null || raw === undefined || raw === '' ? null : Number(String(raw).replace('#', ''))
  return {
    id: id !== null && Number.isFinite(id) ? id : null,
    text: typeof parsed.text === 'string' ? parsed.text : undefined,
    reason: String(parsed.reason ?? ''),
    usedImage,
  }
}

type Img = { data: string; w: number; h: number; mime?: string }

function imagePart(img: Img) {
  return { type: 'image_url', image_url: { url: `data:${img.mime ?? 'image/jpeg'};base64,${img.data}` } }
}

async function visionChat(apiKey: string, model: string | string[], system: string, text: string, images: Img[]): Promise<Record<string, unknown>> {
  try {
    const content = await chat(
      apiKey,
      model,
      [
        { role: 'system', content: system },
        { role: 'user', content: [{ type: 'text', text }, ...images.map(imagePart)] },
      ],
      true
    )
    return parseJson(content)
  } catch (e) {
    if (e instanceof ImageUnsupportedError) {
      throw new Error(`Görsel model “${model}” ekran görüntüsü kabul etmiyor. Ayarlar > Görsel LLM’den görsel destekli bir model seç.`)
    }
    throw e
  }
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.replace(/[^\d.-]/g, '')) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

/** Reads a point the model gave on a 0–1000 normalized grid (also accepts [x,y] / point arrays). */
function readPoint(p: Record<string, unknown>): { x: number; y: number } | null {
  let x = num(p.x)
  let y = num(p.y)
  const arr = (p.point ?? p.coordinates) as unknown
  if ((x === null || y === null) && Array.isArray(arr) && arr.length >= 2) {
    x = num(arr[0])
    y = num(arr[1])
  }
  if (x === null || y === null) return null
  if (x <= 1 && y <= 1 && (x > 0 || y > 0)) {
    x *= 1000
    y *= 1000
  }
  return { x: Math.min(1000, Math.max(0, x)), y: Math.min(1000, Math.max(0, y)) }
}

export type VisionPick =
  | { kind: 'item'; id: number; reason: string }
  | { kind: 'point'; nx: number; ny: number; reason: string }
  | { kind: 'none'; reason: string }

const VISION_ACTION: Partial<Record<NodeKind, string>> = {
  click: 'click',
  type: 'type into (an input, a search box, and so on)',
  key: 'click before the keypress, so the right place has focus',
}

export async function visionLocate(opts: {
  apiKey: string
  model: string | string[]
  prompt: string
  kind: NodeKind
  scan: ScanResult
  stepTitle: string
  /** Picture of the element to find (from Ekran Tarayıcı / İmleçle Yakala). */
  reference?: Img
  system?: string
}): Promise<VisionPick> {
  if (!opts.scan.image) throw new Error('Ekran görüntüsü alınamadı.')
  const list = opts.scan.items
    .slice(0, 250)
    .map((i) => `#${i.id} "${i.text.replace(/"/g, "'")}"`)
    .join('\n')
  const system = opts.system?.trim() || `You are an agent that looks at a Windows screenshot. Your job: find what the instruction asks you to ${VISION_ACTION[opts.kind] ?? 'locate'}.
Some text and controls are marked with numbered boxes (blue: application control, orange: text read from the screen). The target may be unmarked (an icon, a picture, an empty area).
- If the target is a numbered box: {"id": <number>, "reason": "..."}
- Otherwise give the CENTER of the target as normalized 0-1000 coordinates on the image (x left to right, y top to bottom): {"x": <0-1000>, "y": <0-1000>, "reason": "..."}
- If the target is not on screen: {"found": false, "reason": "..."}
JSON only.`
  const text = `Step: ${opts.stepTitle}
Instruction: ${opts.prompt}
${opts.reference ? '\nThe SECOND picture is the control to find (a previously captured icon or button). Find that same thing in the FIRST picture (the screen).\n' : ''}
İşaretli öğeler:
${list || '(yok)'}`
  const p = await visionChat(opts.apiKey, opts.model, system, text, opts.reference ? [opts.scan.image, opts.reference] : [opts.scan.image])
  const reason = String(p.reason ?? '')
  if (p.found === false) return { kind: 'none', reason }
  const id = num(p.id)
  if (id !== null && opts.scan.items.some((i) => i.id === id)) return { kind: 'item', id, reason }
  const pt = readPoint(p)
  if (pt) return { kind: 'point', nx: pt.x, ny: pt.y, reason }
  return { kind: 'none', reason: reason || 'model konum vermedi' }
}

/** Second pass on a zoomed crop around the first guess, for pixel-accurate clicks. */
export async function visionRefine(opts: {
  apiKey: string
  model: string | string[]
  prompt: string
  image: Img
}): Promise<{ x: number; y: number } | null> {
  const system = `Bu, ekranın yakınlaştırılmış küçük bir parçası. Talimattaki hedefin tam ORTASINI 0-1000 normalize koordinatla ver: {"x": <0-1000>, "y": <0-1000>}. Hedef bu parçada yoksa {"found": false}. Sadece JSON.`
  const p = await visionChat(opts.apiKey, opts.model, system, `Talimat: ${opts.prompt}`, [opts.image])
  if (p.found === false) return null
  return readPoint(p)
}

export type TypeChoiceInfo = {
  id: number
  window: string
  type: string
  native?: string
  name: string
  value: string
  valueKnown?: boolean
  label?: string
  clicked: boolean
  related?: boolean
}

const quoted = (s: string) => s.replace(/"/g, "'")

/** One candidate field as the model reads it: what it is, its caption, what it holds, and whether the click points at it. */
export function describeTypeChoice(c: TypeChoiceInfo): string {
  // Classic Win32 forms report every control as a Pane; the control's own class says what it really is.
  const kind = c.native && c.native !== c.type ? `${c.native} box (UIA says ${c.type})` : c.type
  const label = c.label ? ` caption "${quoted(c.label)}"` : ''
  // UIA puts a classic edit box's text in its name; that is the content, not a caption.
  const name = c.name && c.name !== c.value ? ` name "${quoted(c.name)}"` : ''
  const value = c.valueKnown === false ? ' text unknown' : c.value ? ` text "${quoted(c.value)}"` : ' empty'
  const hit = c.clicked ? ' The click landed in this field.' : c.related ? ' The caption that was clicked belongs to this field.' : ''
  return `${c.id}. Window "${quoted(c.window)}" — ${kind}, writable,${label}${name}${value}.${hit}`
}

export async function chooseTypeField(opts: {
  apiKey: string
  model: string | string[]
  step: string
  instruction: string
  text: string
  ahead: string
  choices: TypeChoiceInfo[]
}): Promise<{ id: number | null; reason: string }> {
  const lines = opts.choices.map(describeTypeChoice).join('\n')
  const system = `You choose which text field a Windows automation step should type into.
You receive the step kind, the node's instruction, the exact text that will be typed, the following steps, and the text fields in the active window.
Each candidate shows the caption on its row, what it holds now, and whether the click or the clicked caption points at it.
The candidates belong to the active window. Use the instruction and following steps to identify the intended field. Do not pick an unrelated field just because it can accept text.
Pick one id from the list. If none match, id is null.
JSON only: {"id": <number or null>, "reason": "<short reason>"}`
  const text = `Step: ${opts.step}
Instruction: ${opts.instruction || '(none)'}
Text to type: ${opts.text}
Following steps: ${opts.ahead || '(none)'}

Windows:
${lines}`
  const content = await chat(
    opts.apiKey,
    opts.model,
    [
      { role: 'system', content: system },
      { role: 'user', content: text },
    ],
    false
  )
  const p = parseJson(content)
  const id = num(p.id)
  return { id: id === null ? null : Math.round(id), reason: String(p.reason ?? '').slice(0, 240) }
}

export type ReactionVerdict = 'ready' | 'missed' | 'loading' | 'blocked' | 'unknown'

/** Two pocket frames: did the action move the screen toward the next step? */
export async function judgeReaction(opts: {
  apiKey: string
  model: string | string[]
  step: string
  expected: string
  ahead: string
  fresh: string[]
  before: Img
  after: Img
  system?: string
}): Promise<{ verdict: ReactionVerdict; reason: string }> {
  const system = opts.system?.trim() || REACTION_PROMPT
  const text = `Yapılan adım: ${opts.step}
Sıradaki adımlar: ${opts.ahead || '(yok)'}
Beklenen yazı veya hedef: ${opts.expected || '(yok)'}
Sonra ekrana yeni gelen yazılar: ${opts.fresh.length ? opts.fresh.join(' | ') : '(yok)'}
İlk görüntü adımdan önce, ikinci görüntü adımdan sonradır.`
  const p = await visionChat(opts.apiKey, opts.model, system, text, [opts.before, opts.after])
  const raw = String(p.verdict ?? p.status ?? '').toLowerCase()
  const verdict: ReactionVerdict =
    raw === 'ready' || raw === 'missed' || raw === 'loading' || raw === 'blocked' || raw === 'unknown' ? raw : 'unknown'
  return { verdict, reason: String(p.reason ?? '').slice(0, 240) }
}

export async function visionCheck(opts: {
  apiKey: string
  model: string | string[]
  question: string
  image: Img
  /** Picture of the element that should be present. */
  reference?: Img
}): Promise<{ answer: boolean; reason: string }> {
  const system = `Windows ekran görüntüsüne bakıp soruyu evet/hayır olarak cevapla. Soluk/pasif (tıklanamaz) görünen düğmeler “yok” sayılır. Sadece JSON: {"answer": true|false, "reason": "<kısa gerekçe>"}`
  const q = opts.reference
    ? `İkinci resimdeki öğe birinci resimde (ekran) görünüyor ve kullanılabilir durumda mı?${opts.question ? ` Ek bilgi: ${opts.question}` : ''}`
    : `Ekranda şu durum var mı / görünüyor mu? ${opts.question}`
  const p = await visionChat(opts.apiKey, opts.model, system, q, opts.reference ? [opts.image, opts.reference] : [opts.image])
  const a = p.answer
  const answer = a === true || (typeof a === 'string' && /^(true|evet|yes)$/i.test(a.trim()))
  return { answer, reason: String(p.reason ?? '') }
}

export async function visionDescribe(opts: { apiKey: string; model: string | string[]; image: Img }): Promise<string> {
  const p = await visionChat(
    opts.apiKey,
    opts.model,
    'Ekran görüntüsünde ne olduğunu tek kısa Türkçe cümleyle anlat. Sadece JSON: {"text": "..."}',
    'Bu ekranda ne görüyorsun?',
    [opts.image]
  )
  return String(p.text ?? p.description ?? JSON.stringify(p)).slice(0, 300)
}

export type AgentAction = {
  action: 'click' | 'double' | 'right' | 'type' | 'key' | 'wait' | 'done' | 'fail'
  id: number | null
  text: string
  keys: string
  seconds: number
  enter: boolean
  reason: string
}

/** İnisiyatif: one action at a time toward a goal, from the numbered screen list (and screenshot). */
export async function nextAction(opts: {
  apiKey: string
  model: string | string[]
  goal: string
  stepTitle: string
  history: string[]
  lastLap: string[]
  listText: string
  image?: Img | null
  next?: string
  system?: string
}): Promise<AgentAction> {
  const system = opts.system?.trim() || INITIATIVE_PROMPT
  const text = `Hedef: ${opts.goal}
Adım: ${opts.stepTitle}
${opts.next ? `Bu hedeften sonra akış şuna geçecek: ${opts.next}\n` : ''}${
    opts.lastLap.length ? `Geçen başarılı turda şu sırayla yapıldı (ipucu, ekran farklıysa ekrana uy):\n${opts.lastLap.map((l, i) => `${i + 1}. ${l}`).join('\n')}\n` : ''
  }Şimdiye kadar bu turda yapılanlar:
${opts.history.length ? opts.history.map((l, i) => `${i + 1}. ${l}`).join('\n') : '(henüz yok)'}

Ekrandaki öğeler:
${opts.listText}`
  const messages: Message[] = [
    { role: 'system', content: system },
    { role: 'user', content: opts.image?.data ? [{ type: 'text', text }, imagePart(opts.image)] : text },
  ]
  let content: string
  try {
    content = await chat(opts.apiKey, opts.model, messages, !!opts.image?.data)
  } catch (e) {
    if (!(e instanceof ImageUnsupportedError)) throw e
    content = await chat(opts.apiKey, opts.model, [messages[0], { role: 'user', content: text }], false)
  }
  const p = parseJson(content)
  const raw = String(p.action ?? '').toLowerCase()
  const allowed = ['click', 'double', 'right', 'type', 'key', 'wait', 'done', 'fail'] as const
  const action = (allowed as readonly string[]).includes(raw) ? (raw as AgentAction['action']) : 'wait'
  const id = num(p.id)
  return {
    action,
    id: id === null ? null : Math.round(id),
    text: String(p.text ?? ''),
    keys: String(p.keys ?? ''),
    seconds: Math.min(10, Math.max(1, Math.round(Number(p.seconds) || 2))),
    enter: p.enter === true || p.enter === 'true',
    reason: String(p.reason ?? '').slice(0, 240),
  }
}

// ---------- İnisiyatif (ekran): UI-TARS style computer use ----------

export type GuiAction = {
  thought: string
  kind: 'click' | 'double' | 'right' | 'drag' | 'hotkey' | 'type' | 'scroll' | 'wait' | 'finished' | 'call_user'
  /** Points as fractions of the screenshot (0–1). */
  x?: number
  y?: number
  x2?: number
  y2?: number
  keys?: string[]
  text?: string
  direction?: 'up' | 'down' | 'left' | 'right'
  /** The model's action line as it wrote it, for the log and the next turn. */
  raw: string
}

export type GuiTurn = { thought: string; raw: string; image?: Img; note?: string }

export function isTarsModel(model: string) {
  return /ui-?tars/i.test(model)
}

/** UI-TARS 1.5 answers in pixels of the image it saw; older UI-TARS and Doubao answer on a 0–1000 grid. */
function tarsAbsolute(model: string) {
  return /ui-?tars-?1\.5|ui-?tars-1_5/i.test(model) && !/doubao/i.test(model)
}

const TARS_PROMPT = (goal: string, custom?: string) => fillGoal(custom?.trim() || TARS_TEMPLATE, goal)

function unescape(s: string) {
  return s.replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

function argOf(action: string, name: string): string | undefined {
  const m = action.match(new RegExp(`${name}\\s*=\\s*(['"])([\\s\\S]*?)\\1\\s*(?:,\\s*\\w+\\s*=|\\)\\s*$)`))
  return m ? m[2] : undefined
}

function pointOf(v: string | undefined): [number, number] | null {
  if (!v) return null
  const nums = (v.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  if (nums.length >= 4) return [(nums[0] + nums[2]) / 2, (nums[1] + nums[3]) / 2]
  if (nums.length >= 2) return [nums[0], nums[1]]
  return null
}

/** Reads “Thought: … Action: click(start_box='(x,y)')” into an action with 0–1 coordinates. */
export function parseTars(content: string, imgW: number, imgH: number, absolute: boolean): GuiAction {
  const thought = (content.match(/Thought:\s*([\s\S]*?)(?:\n\s*Action:|$)/i)?.[1] ?? '').trim()
  const raw = (content.match(/Action:\s*([\s\S]*)$/i)?.[1] ?? content).trim().split('\n')[0].trim()
  const name = (raw.match(/^(\w+)\s*\(/)?.[1] ?? raw.replace(/\(.*$/, '')).toLowerCase()
  const norm = (p: [number, number] | null) => {
    if (!p) return null
    let [x, y] = p
    const abs = absolute && !(x <= 1 && y <= 1)
    x = abs ? x / Math.max(1, imgW) : x / 1000
    y = abs ? y / Math.max(1, imgH) : y / 1000
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))] as [number, number]
  }
  const start = norm(pointOf(argOf(raw, 'start_box') ?? argOf(raw, 'point') ?? argOf(raw, 'start_point')))
  const end = norm(pointOf(argOf(raw, 'end_box') ?? argOf(raw, 'end_point')))
  const base = { thought, raw }
  switch (name) {
    case 'click':
    case 'left_single':
      return start ? { ...base, kind: 'click', x: start[0], y: start[1] } : { ...base, kind: 'wait' }
    case 'left_double':
    case 'double_click':
      return start ? { ...base, kind: 'double', x: start[0], y: start[1] } : { ...base, kind: 'wait' }
    case 'right_single':
    case 'right_click':
      return start ? { ...base, kind: 'right', x: start[0], y: start[1] } : { ...base, kind: 'wait' }
    case 'drag':
    case 'select':
      return start && end ? { ...base, kind: 'drag', x: start[0], y: start[1], x2: end[0], y2: end[1] } : { ...base, kind: 'wait' }
    case 'hotkey':
    case 'press':
    case 'keydown': {
      const k = argOf(raw, 'key') ?? argOf(raw, 'keys') ?? ''
      return { ...base, kind: 'hotkey', keys: k.toLowerCase().split(/[\s+]+/).filter(Boolean) }
    }
    case 'type':
      return { ...base, kind: 'type', text: unescape(argOf(raw, 'content') ?? '') }
    case 'scroll': {
      const d = (argOf(raw, 'direction') ?? 'down').toLowerCase()
      const direction = (['up', 'down', 'left', 'right'].includes(d) ? d : 'down') as GuiAction['direction']
      return { ...base, kind: 'scroll', x: start?.[0] ?? 0.5, y: start?.[1] ?? 0.5, direction }
    }
    case 'finished':
      return { ...base, kind: 'finished', text: unescape(argOf(raw, 'content') ?? '') }
    case 'call_user':
      return { ...base, kind: 'call_user' }
    default:
      return { ...base, kind: 'wait' }
  }
}

function parseJsonAction(content: string): GuiAction {
  const p = parseJson(content)
  const n = (v: unknown) => {
    const x = num(v)
    return x === null ? undefined : Math.min(1, Math.max(0, x > 1 ? x / 1000 : x))
  }
  const a = String(p.action ?? '').toLowerCase()
  const kinds = ['click', 'double', 'right', 'drag', 'hotkey', 'type', 'scroll', 'wait', 'finished', 'call_user'] as const
  const kind = ((kinds as readonly string[]).includes(a) ? a : a === 'done' ? 'finished' : a === 'fail' ? 'call_user' : 'wait') as GuiAction['kind']
  const keys = Array.isArray(p.keys) ? p.keys.map((k) => String(k).toLowerCase()) : typeof p.keys === 'string' ? p.keys.toLowerCase().split(/[\s+]+/) : []
  const d = String(p.direction ?? '').toLowerCase()
  return {
    thought: String(p.thought ?? p.reason ?? '').trim(),
    kind,
    x: n(p.x),
    y: n(p.y),
    x2: n(p.x2),
    y2: n(p.y2),
    keys: keys.filter(Boolean),
    text: String(p.text ?? p.content ?? ''),
    direction: (['up', 'down', 'left', 'right'].includes(d) ? d : 'down') as GuiAction['direction'],
    raw: JSON.stringify({ action: kind, x: p.x, y: p.y, x2: p.x2, y2: p.y2, keys, text: p.text, direction: p.direction }),
  }
}

/**
 * One turn of the computer-use loop. The last few screenshots go as images, older turns as text only,
 * like UI-TARS Desktop does.
 */
export async function guiStep(opts: {
  apiKey: string
  model: string | string[]
  goal: string
  history: GuiTurn[]
  screen: Img
  keepImages?: number
  tarsPrompt?: string
  jsonPrompt?: string
}): Promise<GuiAction> {
  const keep = Math.max(1, opts.keepImages ?? 4)
  const recent = opts.history.slice(-keep + 1)
  const older = opts.history.slice(0, Math.max(0, opts.history.length - recent.length))
  return runModelChain(asModelChain(opts.model), async (model) => {
    if (isTarsModel(model)) {
      const messages: Message[] = [{ role: 'user', content: TARS_PROMPT(opts.goal, opts.tarsPrompt) }]
      for (const t of older) {
        messages.push({ role: 'assistant', content: `Thought: ${t.thought}\nAction: ${t.raw}` })
        if (t.note) messages.push({ role: 'user', content: t.note })
      }
      for (const t of recent) {
        if (t.image) messages.push({ role: 'user', content: [imagePart(t.image)] })
        messages.push({ role: 'assistant', content: `Thought: ${t.thought}\nAction: ${t.raw}` })
        if (t.note) messages.push({ role: 'user', content: t.note })
      }
      messages.push({ role: 'user', content: [imagePart(opts.screen)] })
      const content = await chatOnce(opts.apiKey, model, messages, true, { json: false, maxTokens: 1000 })
      if (!content.trim()) throw new ModelRejected('boş yanıt')
      return parseTars(content, opts.screen.w, opts.screen.h, tarsAbsolute(model))
    }
    const lines = opts.history.map((t, i) => `${i + 1}. ${t.thought ? `${t.thought} → ` : ''}${t.raw}${t.note ? ` (${t.note})` : ''}`)
    const text = `Hedef: ${opts.goal}

Önceki adımlar:
${lines.length ? lines.join('\n') : '(henüz yok)'}

Son ekran görüntüsü ektedir.`
    const messages: Message[] = [
      { role: 'system', content: opts.jsonPrompt?.trim() || SCREEN_PROMPT },
      { role: 'user', content: [{ type: 'text', text }, imagePart(opts.screen)] },
    ]
    const content = await chatOnce(opts.apiKey, model, messages, true)
    if (!content.trim()) throw new ModelRejected('boş yanıt')
    return parseJsonAction(content)
  })
}

export type StallPlan = {
  action: 'continue' | 'wait' | 'stop'
  waitMs: number
  lookFor: string
  reason: string
}

/** When a step did not land cleanly: look, wait if needed, and decide before the run is broken. */
export async function planStall(opts: {
  apiKey: string
  model: string | string[]
  step: string
  problem: string
  ahead: string
  expected: string
  image?: Img | null
  system?: string
}): Promise<StallPlan> {
  const system = opts.system?.trim() || STALL_PROMPT
  const text = `Adım: ${opts.step}
Sorun: ${opts.problem}
Sıradaki adımlar: ${opts.ahead || '(yok)'}
Beklenen: ${opts.expected || '(yok)'}`
  const messages: Message[] = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: opts.image?.data ? [{ type: 'text', text }, imagePart(opts.image)] : text,
    },
  ]
  const content = await chat(opts.apiKey, opts.model, messages, !!opts.image?.data)
  const p = parseJson(content)
  const action = p.action === 'wait' || p.action === 'stop' || p.action === 'continue' ? p.action : 'wait'
  const sec = Math.min(8, Math.max(1, Math.round(Number(p.waitSec) || 3)))
  return {
    action,
    waitMs: sec * 1000,
    lookFor: String(p.lookFor ?? '').trim().slice(0, 80),
    reason: String(p.reason ?? '').slice(0, 240),
  }
}

export async function testKey(apiKey: string): Promise<string> {
  chatLogger?.('API → GET /api/v1/key')
  const res = await guardedFetch('https://openrouter.ai/api/v1/key', { headers: HEADERS(apiKey) }, 20000)
  if (!res.ok) {
    chatLogger?.(`API ← hata ${res.status}`)
    throw new Error(`OpenRouter anahtarı geçersiz (${res.status}).`)
  }
  const data = JSON.parse(res.text) as { data?: { label?: string; limit_remaining?: number | null } }
  const rem = data.data?.limit_remaining
  const summary = `${data.data?.label ?? 'OK'}${typeof rem === 'number' ? `, kalan limit: ${rem.toFixed(2)}` : ''}`
  chatLogger?.(`API ← ${summary}`)
  return summary
}

export async function listModels(): Promise<{ id: string; vision: boolean }[]> {
  chatLogger?.('API → GET /api/v1/models')
  const res = await guardedFetch('https://openrouter.ai/api/v1/models', {}, 30000)
  if (!res.ok) {
    chatLogger?.(`API ← hata ${res.status}`)
    throw new Error(`Model listesi alınamadı (${res.status}).`)
  }
  const data = JSON.parse(res.text) as { data?: { id: string; architecture?: { input_modalities?: string[] } }[] }
  const list = (data.data ?? [])
    .map((m) => ({ id: m.id, vision: !!m.architecture?.input_modalities?.includes('image') }))
    .sort((a, b) => a.id.localeCompare(b.id))
  chatLogger?.(`API ← ${list.length} model`)
  return list
}
