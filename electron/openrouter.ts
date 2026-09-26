import type { NodeKind } from './graph-types'
import { describeItems, type ScanResult } from './matcher'

const HEADERS = (apiKey: string) => ({
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
  'HTTP-Referer': 'https://xp-agent-studio.local',
  'X-Title': 'XP Agent Studio',
})

type Message = { role: 'system' | 'user'; content: string | object[] }

class ImageUnsupportedError extends Error {}

async function chat(apiKey: string, model: string, messages: Message[], hasImage: boolean): Promise<string> {
  const send = (json: boolean) =>
    fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: HEADERS(apiKey),
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 300,
        messages,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    })

  let res = await send(true)
  if (res.status === 400 || res.status === 404 || res.status === 422) {
    const text = await res.text()
    if (hasImage && /image|vision|multimodal|modalit/i.test(text)) throw new ImageUnsupportedError(text.slice(0, 200))
    res = await send(false)
  }
  if (!res.ok) {
    const text = await res.text()
    if (hasImage && /image|vision|multimodal|modalit/i.test(text)) throw new ImageUnsupportedError(text.slice(0, 200))
    if (res.status === 401) throw new Error('OpenRouter API anahtarı geçersiz (401).')
    if (res.status === 402) throw new Error('OpenRouter bakiyesi yetersiz (402).')
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`)
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } }
  if (data.error?.message) throw new Error(`OpenRouter: ${data.error.message}`)
  return data.choices?.[0]?.message?.content ?? ''
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

export async function testKey(apiKey: string): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/key', { headers: HEADERS(apiKey) })
  if (!res.ok) throw new Error(`OpenRouter anahtarı geçersiz (${res.status}).`)
  const data = (await res.json()) as { data?: { label?: string; limit_remaining?: number | null } }
  const rem = data.data?.limit_remaining
  return `${data.data?.label ?? 'OK'}${typeof rem === 'number' ? `, kalan limit: ${rem.toFixed(2)}` : ''}`
}

export async function listModels(): Promise<{ id: string; vision: boolean }[]> {
  const res = await fetch('https://openrouter.ai/api/v1/models')
  if (!res.ok) throw new Error(`Model listesi alınamadı (${res.status}).`)
  const data = (await res.json()) as { data?: { id: string; architecture?: { input_modalities?: string[] } }[] }
  return (data.data ?? [])
    .map((m) => ({ id: m.id, vision: !!m.architecture?.input_modalities?.includes('image') }))
    .sort((a, b) => a.id.localeCompare(b.id))
}
