import type { A11yNode, NodeKind } from './graph-types'

export type A11yDecision = {
  name: string
  controlType: string
  automationId?: string
  path: string
  reason: string
}

type CatalogItem = {
  i: number
  name: string
  type: string
  id?: string
  path: string
}

function buildCatalog(tree: A11yNode, limit = 700): CatalogItem[] {
  const out: CatalogItem[] = []
  const walk = (n: A11yNode) => {
    if (out.length >= limit) return
    if (n.name || n.automationId) {
      out.push({
        i: out.length,
        name: n.name,
        type: n.controlType,
        ...(n.automationId ? { id: n.automationId } : {}),
        path: n.path,
      })
    }
    for (const c of n.children ?? []) walk(c)
  }
  walk(tree)
  return out
}

const HEADERS = (apiKey: string) => ({
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
  'HTTP-Referer': 'https://xp-agent-studio.local',
  'X-Title': 'XP Agent Studio',
})

async function chat(apiKey: string, model: string, messages: object[]): Promise<string> {
  const send = (json: boolean) =>
    fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: HEADERS(apiKey),
      body: JSON.stringify({
        model,
        temperature: 0,
        messages,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    })

  let res = await send(true)
  if (res.status === 400) res = await send(false)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`)
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return data.choices?.[0]?.message?.content ?? ''
}

function parseJson(content: string): Record<string, unknown> {
  try {
    return JSON.parse(content)
  } catch {
    const m = content.match(/\{[\s\S]*\}/)
    if (!m) return {}
    try {
      return JSON.parse(m[0])
    } catch {
      return {}
    }
  }
}

export async function chooseElement(opts: {
  apiKey: string
  model: string
  prompt: string
  tree: A11yNode
  kind: NodeKind
  stageTitle: string
  stageIndex: number
  windowTitle: string
}): Promise<A11yDecision> {
  const catalog = buildCatalog(opts.tree)
  if (catalog.length === 0) throw new Error('Accessibility tree boş, seçilecek öğe yok.')

  const action =
    opts.kind === 'type'
      ? 'Kullanıcı bu adımda bir metin kutusuna yazı yazacak; yazılacak ALANI seç (Edit, ComboBox, Document vb.).'
      : 'Kullanıcı bu adımda bir öğeye tıklayacak; tıklanacak öğeyi seç.'

  const system = `Sen bir Windows UI Automation ajanısın. Verilen accessibility kataloğundan kullanıcının adım talimatına en uygun TEK öğeyi seçersin.
${action}
Yanıtı SADECE şu JSON olarak ver: {"i": <katalog numarası>, "reason": "<kısa gerekçe>"}`

  const user = `Pencere: ${opts.windowTitle}
Aşama ${opts.stageIndex} (${opts.stageTitle})
Talimat: ${opts.prompt}

Katalog (i, name, type, id, path):
${JSON.stringify(catalog)}`

  const content = await chat(opts.apiKey, opts.model, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ])
  const parsed = parseJson(content)
  const idx = Number(parsed.i ?? parsed.index)
  const byPath = typeof parsed.path === 'string' ? catalog.find((c) => c.path === parsed.path) : undefined
  const hit = byPath ?? (Number.isInteger(idx) ? catalog[idx] : undefined)
  if (!hit) throw new Error(`LLM geçerli bir öğe seçmedi: ${content.slice(0, 160)}`)

  return {
    name: hit.name,
    controlType: hit.type,
    automationId: hit.id,
    path: hit.path,
    reason: String(parsed.reason ?? ''),
  }
}

export async function testKey(apiKey: string): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/key', { headers: HEADERS(apiKey) })
  if (!res.ok) throw new Error(`OpenRouter anahtarı geçersiz (${res.status}).`)
  const data = (await res.json()) as { data?: { label?: string } }
  return data.data?.label ?? 'OK'
}

export async function listModels(): Promise<string[]> {
  const res = await fetch('https://openrouter.ai/api/v1/models')
  if (!res.ok) throw new Error(`Model listesi alınamadı (${res.status}).`)
  const data = (await res.json()) as { data?: { id: string }[] }
  return (data.data ?? []).map((m) => m.id).sort()
}
