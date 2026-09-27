import type { NodeKind } from './graph-types'
import { describeItems, type ScanResult } from './matcher'

const HEADERS = (apiKey: string) => ({
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
  'HTTP-Referer': 'https://xp-agent-studio.local',
  'X-Title': 'XP Agent Studio',
})

type Message = { role: 'system' | 'user'; content: string | object[] }

let chatLogger: ((line: string) => void) | null = null

/** The agent log receives every completion request and response. Images are noted, not pasted. */
export function setChatLogger(fn: ((line: string) => void) | null) {
  chatLogger = fn
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

async function chat(apiKey: string, model: string, messages: Message[], hasImage: boolean): Promise<string> {
  const send = async (json: boolean) => {
    reportOut(model, messages)
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: HEADERS(apiKey),
      body: JSON.stringify({
        model,
        temperature: 0,
        // Reasoning models spend tokens before answering; too low a cap yields empty replies.
        max_tokens: hasImage ? 2500 : 800,
        messages,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      reportIn(`hata ${res.status}: ${text.slice(0, 2000)}`)
      return { ok: false as const, status: res.status, text }
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } }
    const content = data.choices?.[0]?.message?.content ?? ''
    reportIn(data.error?.message ? `hata: ${data.error.message}` : content)
    return { ok: true as const, data, content }
  }

  let res = await send(true)
  if (!res.ok && (res.status === 400 || res.status === 404 || res.status === 422)) {
    if (hasImage && /image|vision|multimodal|modalit/i.test(res.text)) throw new ImageUnsupportedError(res.text.slice(0, 200))
    res = await send(false)
  }
  if (!res.ok) {
    if (hasImage && /image|vision|multimodal|modalit/i.test(res.text)) throw new ImageUnsupportedError(res.text.slice(0, 200))
    if (res.status === 401) throw new Error('OpenRouter API anahtarı geçersiz (401).')
    if (res.status === 402) throw new Error('OpenRouter bakiyesi yetersiz (402).')
    throw new Error(`OpenRouter ${res.status}: ${res.text.slice(0, 300)}`)
  }
  if (res.data.error?.message) throw new Error(`OpenRouter: ${res.data.error.message}`)
  return res.content
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
  model: string
  prompt: string
  kind: NodeKind
  scan: ScanResult
  stepTitle: string
  sendImage: boolean
  onImageFallback?: (msg: string) => void
}): Promise<ScreenChoice> {
  const { scan } = opts
  const action =
    opts.kind === 'type'
      ? 'Kullanıcı bu adımda bir metin kutusuna yazı yazacak: yazılacak ALANI seç (arama kutusu, Edit, giriş alanı).'
      : 'Kullanıcı bu adımda ekranda bir yere tıklayacak: tıklanacak yazıyı/öğeyi seç.'

  const system = `Sen bir Windows masaüstü otomasyon ajanısın. Ekranda görünen yazıların ve öğelerin numaralı listesi verilir (UIA = uygulamanın bildirdiği öğe, Yazı = ekran görüntüsünden OCR ile okunan yazı).
${action}
Kullanıcının talimatındaki isim ekrandaki yazıyla birebir aynı olmayabilir (Türkçe ekler, büyük/küçük harf, OCR hataları): anlamca en uygun öğeyi seç. Konum ifadelerini (tepedeki, sağdaki, alttaki) koordinatlara göre değerlendir.
Yanıtı SADECE JSON olarak ver: {"id": <numara veya null>, "text": "<tıklanacak yazının kendisi>", "reason": "<kısa gerekçe>"}
Uygun öğe yoksa id=null ver.`

  const listText = `Ekran alanı: ${scan.area.w}x${scan.area.h} (sol üst ${scan.area.x},${scan.area.y})${scan.window ? `, pencere: ${scan.window}` : ''}
Öğeler (#numara tür "yazı" @x,y genişlikxyükseklik):
${describeItems(scan.items)}

Adım: ${opts.stepTitle}
Talimat: ${opts.prompt}`

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
    content = await chat(opts.apiKey, opts.model, build(withImage), withImage)
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

async function visionChat(apiKey: string, model: string, system: string, text: string, images: Img[]): Promise<Record<string, unknown>> {
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
  click: 'tıklanacak yeri',
  type: 'yazı yazılacak alanı (giriş kutusu, arama çubuğu vb.)',
  key: 'tuşlara basmadan önce odaklanmak için tıklanacak yeri',
}

export async function visionLocate(opts: {
  apiKey: string
  model: string
  prompt: string
  kind: NodeKind
  scan: ScanResult
  stepTitle: string
}): Promise<VisionPick> {
  if (!opts.scan.image) throw new Error('Ekran görüntüsü alınamadı.')
  const list = opts.scan.items
    .slice(0, 250)
    .map((i) => `#${i.id} "${i.text.replace(/"/g, "'")}"`)
    .join('\n')
  const system = `Sen Windows ekran görüntüsüne bakarak işlem yapan bir ajansın. Görevin: talimata göre ${VISION_ACTION[opts.kind] ?? 'hedefi'} bulmak.
Görüntüde bazı yazı/öğeler numaralı ince kutularla işaretli (mavi: uygulama öğesi, turuncu: okunan yazı). Hedef işaretsiz de olabilir (ikon, resim, boş alan).
- Hedef numaralı bir kutuysa: {"id": <numara>, "reason": "..."}
- Değilse hedefin ORTASINI görüntü üzerinde 0-1000 arası normalize koordinatla ver (x: soldan sağa, y: yukarıdan aşağıya): {"x": <0-1000>, "y": <0-1000>, "reason": "..."}
- Hedef ekranda yoksa: {"found": false, "reason": "..."}
Sadece JSON yaz.`
  const text = `Adım: ${opts.stepTitle}
Talimat: ${opts.prompt}

İşaretli öğeler:
${list || '(yok)'}`
  const p = await visionChat(opts.apiKey, opts.model, system, text, [opts.scan.image])
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
  model: string
  prompt: string
  image: Img
}): Promise<{ x: number; y: number } | null> {
  const system = `Bu, ekranın yakınlaştırılmış küçük bir parçası. Talimattaki hedefin tam ORTASINI 0-1000 normalize koordinatla ver: {"x": <0-1000>, "y": <0-1000>}. Hedef bu parçada yoksa {"found": false}. Sadece JSON.`
  const p = await visionChat(opts.apiKey, opts.model, system, `Talimat: ${opts.prompt}`, [opts.image])
  if (p.found === false) return null
  return readPoint(p)
}

export type ReactionVerdict = 'ready' | 'missed' | 'loading' | 'blocked' | 'unknown'

/** Two pocket frames: did the action move the screen toward the next step? */
export async function judgeReaction(opts: {
  apiKey: string
  model: string
  step: string
  expected: string
  ahead: string
  fresh: string[]
  before: Img
  after: Img
}): Promise<{ verdict: ReactionVerdict; reason: string }> {
  const system = `Bir otomasyon adımının ÖNCESİ ve SONRASI olmak üzere iki ekran görüntüsü verilir. Sıradaki adımın mümkün olup olmadığına karar ver.
Tek bir verdict seç:
- ready: sıradaki adımın hedefi görünüyor ya da ekran o adıma hazır
- missed: ekran pratikte aynı, tıklama veya tuş tepki vermemiş
- loading: sayfa veya içerik hâlâ yükleniyor, hedef henüz gelmedi
- blocked: tıklama bir şey açtı (diyalog, uyarı, başka sayfa) ama bu, sıradaki adımın istediği şey değil
- unknown: bu dördünden hiçbiri seçilemiyor
Sadece JSON: {"verdict":"ready|missed|loading|blocked|unknown","reason":"<kısa gerekçe>"}`
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
  model: string
  question: string
  image: Img
}): Promise<{ answer: boolean; reason: string }> {
  const system = `Windows ekran görüntüsüne bakıp soruyu evet/hayır olarak cevapla. Sadece JSON: {"answer": true|false, "reason": "<kısa gerekçe>"}`
  const p = await visionChat(opts.apiKey, opts.model, system, `Ekranda şu durum var mı / görünüyor mu? ${opts.question}`, [opts.image])
  const a = p.answer
  const answer = a === true || (typeof a === 'string' && /^(true|evet|yes)$/i.test(a.trim()))
  return { answer, reason: String(p.reason ?? '') }
}

export async function visionDescribe(opts: { apiKey: string; model: string; image: Img }): Promise<string> {
  const p = await visionChat(
    opts.apiKey,
    opts.model,
    'Ekran görüntüsünde ne olduğunu tek kısa Türkçe cümleyle anlat. Sadece JSON: {"text": "..."}',
    'Bu ekranda ne görüyorsun?',
    [opts.image]
  )
  return String(p.text ?? p.description ?? JSON.stringify(p)).slice(0, 300)
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
  model: string
  step: string
  problem: string
  ahead: string
  expected: string
  image?: Img | null
}): Promise<StallPlan> {
  const system = `Bir masaüstü otomasyon adımı net tepki vermedi ya da sıradaki öğe bulunamadı. Akışı hemen bozma.
Karar:
- continue: sıradaki adımın istediği şey bu ekranda var ya da adım denenebilir; akış sürsün
- wait: sayfa henüz oturmadı, kısa bekle (waitSec 1 ile 8 arası)
- stop: istenen öğeye bu ekrandan gidilemiyor, durmak gerek
lookFor: ekranda aranacak kısa yazı. Yoksa boş string.
Sadece JSON: {"action":"continue|wait|stop","waitSec":3,"lookFor":"","reason":"<kısa plan>"}`
  const text = `Adım: ${opts.step}
Sorun: ${opts.problem}
Sıradaki adımlar: ${opts.ahead || '(yok)'}
Beklenen: ${opts.expected || '(yok)'}`
  const messages: Message[] = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: opts.image?.data
        ? [{ type: 'text', text }, imagePart(opts.image)]
        : text,
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
  const res = await fetch('https://openrouter.ai/api/v1/key', { headers: HEADERS(apiKey) })
  if (!res.ok) {
    chatLogger?.(`API ← hata ${res.status}`)
    throw new Error(`OpenRouter anahtarı geçersiz (${res.status}).`)
  }
  const data = (await res.json()) as { data?: { label?: string; limit_remaining?: number | null } }
  const rem = data.data?.limit_remaining
  const summary = `${data.data?.label ?? 'OK'}${typeof rem === 'number' ? `, kalan limit: ${rem.toFixed(2)}` : ''}`
  chatLogger?.(`API ← ${summary}`)
  return summary
}

export async function listModels(): Promise<{ id: string; vision: boolean }[]> {
  chatLogger?.('API → GET /api/v1/models')
  const res = await fetch('https://openrouter.ai/api/v1/models')
  if (!res.ok) {
    chatLogger?.(`API ← hata ${res.status}`)
    throw new Error(`Model listesi alınamadı (${res.status}).`)
  }
  const data = (await res.json()) as { data?: { id: string; architecture?: { input_modalities?: string[] } }[] }
  const list = (data.data ?? [])
    .map((m) => ({ id: m.id, vision: !!m.architecture?.input_modalities?.includes('image') }))
    .sort((a, b) => a.id.localeCompare(b.id))
  chatLogger?.(`API ← ${list.length} model`)
  return list
}
