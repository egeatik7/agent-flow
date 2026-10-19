import { yapInputEstimate } from './yap-context'
import { visualToolCall, type VisualToolCall } from './visual-tool-call'
import { spawnSync } from 'node:child_process'
import { visualReplyJson } from './visual-reply-json'
import { olcumFor, olcumuTazele, olcumGoreviEkle, pencereTokenFor } from './local-context-probe'
import { olcumEskiMi, pencereKaynagi, type BaglamOlcumu } from './local-context'
import { baglamKartiOzet, baglamKartiYap, sunucuEtiketi } from './hud-context'
import { contextErrorKind, contextPressureText, responseUsageText, sendSummaryText, responseSummaryText, saveRequestEvidence, imageBytes, imageFromMessages, nextRequestId, countSentCandidates } from './send-log'
import { checkObservation } from './observation-budget'
import { recordTiming } from './step-timing'
import { spatialContext } from './spatial-context'
import { wordCandidates, describeWordCandidates, WORD_TARGET_RULES, OCR_READER_RULES, CONDITION_TARGET_RULES, WORD_CANDIDATE_LIMIT } from './word-targets'
import type { NodeKind } from './graph-types'
import { fillGoal, INITIATIVE_PROMPT, INITIATIVE_RULES, INITIATIVE_SCOPE_RULES, INITIATIVE_TARS_TEMPLATE, INITIATIVE_SCREEN_PROMPT, VISUAL_TARGET_RULES, VISUAL_TARGET_TARS_PROMPT, VISUAL_TARGET_JSON_PROMPT, WORD_CHOICE_PROMPT, LIST_PROMPT, REACTION_PROMPT, SCREEN_PROMPT, STALL_PROMPT, TARS_TEMPLATE, listPromptFor, initiativeTurnInstruction } from './llm-flow'
import { describeItems, type ScanResult } from './matcher'
import { StoppedError } from './runner'
import type { VisualPointerDecision } from './visual-hover'
import { VISUAL_POINTER_PROMPT, VISUAL_POINTER_JSON_CONTRACT, VISUAL_POINTER_TARS_CONTRACT } from './llm-flow'

/** Per-request timeout; failed requests retry without ending the node. */
const REQUEST_TIMEOUT_MS = 90000

let stopCheck: () => boolean = () => false
const attemptCaps: number[] = []

/** Lets Ctrl+Shift+Q cut a pending model request instead of waiting for it. */
export function setStopCheck(fn: () => boolean) {
  stopCheck = fn
}
export function getStopCheck(): () => boolean {
  return stopCheck
}

class TransientError extends Error { readonly serviceFailure = true }

/** fetch + body read, with a time limit and the stop hotkey. */
async function guardedFetch(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS, localStop: () => boolean = () => false, signal?: AbortSignal): Promise<{ ok: boolean; status: number; text: string }> {
  checkObservation(signal)
  if (stopCheck() || localStop()) throw new StoppedError()
  const startedAt = Date.now()
  const ctrl = new AbortController()
  const abort = () => ctrl.abort()
  signal?.addEventListener('abort', abort, { once: true })
  let byUser = false
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const poll = setInterval(() => {
    if (stopCheck() || localStop()) {
      byUser = true
      ctrl.abort()
    }
  }, 250)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    const text = await res.text()
    return { ok: res.ok, status: res.status, text }
  } catch (e) {
    checkObservation(signal)
    if (byUser) throw new StoppedError()
    if (ctrl.signal.aborted) throw new TransientError(`Model ${Math.round(timeoutMs / 1000)} sn içinde cevap vermedi.`)
    throw new TransientError(`Bağlantı hatası: ${redact((e as Error).message)}`)
  } finally {
    clearTimeout(timer)
    clearInterval(poll)
    signal?.removeEventListener('abort', abort)
    recordTiming('model', Date.now() - startedAt)
  }
}

export type ModelTool = {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}
export type ModelToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } }
export type ToolMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | object[] | null
  tool_calls?: ModelToolCall[]
  tool_call_id?: string
  /** Some providers need their opaque reasoning fields replayed with a tool call. */
  reasoning_details?: unknown
  /** Which model ACTUALLY answered (the configured chain is only tried; a model may be unavailable).
   *  `data.model` is what the provider reports, so it survives routing. */
  model?: string
  /** Provider-reported spend for this turn (OpenRouter `usage.include`). Never guessed. */
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number }
}

/** A bounded tool-calling turn. Model fallback happens before any action is executed. */
type RecoveryTurnArgs = {
  allowLocal?: boolean
  apiKey: string
  models: string[]
  messages: ToolMessage[]
  tools: ModelTool[]
  shouldStop: () => boolean
  timeoutMs: number
  stage?: string
  revision?: number
  chainSource?: string
}

export async function recoveryToolTurn(args: RecoveryTurnArgs): Promise<ToolMessage> {
  // Return after one finite model-method pass. Yap owns the next pass and must
  // be able to refresh its screen before asking again.
  return boundedRecoveryToolTurn(args.stage === 'yap' ? {
    ...args, timeoutMs: Math.max(REQUEST_TIMEOUT_MS, localTimeoutMs) * Math.max(1, asModelChain(args.models).length),
  } : args)
}

async function boundedRecoveryToolTurn(args: RecoveryTurnArgs): Promise<ToolMessage> {
  const runtime = localRuntime()
  const label = args.stage === 'yap' ? 'Yap' : 'Kurtarma'
  const deadline = Date.now() + args.timeoutMs
  const chain = asModelChain(args.models)
  if (args.stage) chatLogger?.(`ZINCIR asama=${args.stage} revizyon=${args.revision ?? 0} kaynak=${args.chainSource ?? '-'} sira=${chain.join(' > ')} ilk=${chain[0] ?? '-'}`)
  let last: unknown = new Error('Kurtarma modeli belirtilmedi.')
  // Within this Yap pass all remote rows share this OpenRouter account; local rows are independent.
  let rejectedRemoteAccount: FatalApiError | undefined
  for (const model of chain) {
    for (let outputAttempt = 0; outputAttempt < (args.stage === 'yap' ? 1 : 2); outputAttempt++) {
      if (args.shouldStop() || stopCheck()) throw new StoppedError()
      if (Date.now() >= deadline) throw new Error('Kurtarma modelinin süresi doldu.')
      try {
        const target = args.allowLocal ? targetFor(model, runtime) : { url: 'https://openrouter.ai/api/v1/chat/completions', model, local: false }
        if (args.stage === 'yap' && !target.local && rejectedRemoteAccount) throw rejectedRemoteAccount
        chatLogger?.(`${label} ${targetTag(target.local)} → ${target.model} · ${args.messages.length} mesaj · ${args.tools.length} araç`)
        if (!target.local && !args.apiKey.trim()) throw new ModelRejected('OpenRouter API anahtarı yok; model atlandı.')
        const hasImages = args.messages.some(m => Array.isArray(m.content) && m.content.some(p => (p as {type?:string}|null)?.type === 'image_url'))
        let messages = args.messages
        if (target.local && hasImages && !runtime.vision) {
          if (args.stage !== 'yap') throw new ImageUnsupportedError('Yerel model için görüntü desteği kapalı.')
          // Adapt a COPY for this target only. Remote/vision backups still receive original screenshots.
          messages = args.messages.map(message => {
            if (!Array.isArray(message.content)) return message
            const parts = message.content.filter(p => (p as {type?:string}|null)?.type !== 'image_url')
            return {...message,content:parts.length ? [...parts, { type: 'text', text: 'Görüntü bu yerel modele gönderilmedi. Görsel kanıt varsayma; ekran yazıları gerekiyorsa screen_read details:true iste.' }] : 'Görüntü yerel model ayarı nedeniyle gönderilmedi; ekran okumasının metin sonucunu kullan.'}
          })
          chatLogger?.(`YAP-MODALITE model=${model} goruntu=0 neden=yerel-goruntu-kapali metin=korundu`)
        }
        if (args.stage === 'yap' && target.local) {
          const measured = olcumFor(target.model, target.url)
          const window = !olcumEskiMi(measured, Date.now()) ? pencereTokenFor(target.model, target.url) : null
          const estimate = yapInputEstimate(messages, args.tools)
          if (window && estimate + 2048 > window) throw new Error(`Yap giriş bütçesi: tahmin ${estimate} + cevap payı 2048, ölçülen/yapılandırılmış pencere ${window}. İstek gönderilmedi.`)
        }
        const res = await guardedFetch(target.url, {
          method: 'POST', headers: target.local ? { 'Content-Type': 'application/json' } : HEADERS(args.apiKey),
          body: JSON.stringify({ model: target.model, messages, tools: args.tools, tool_choice: 'auto', parallel_tool_calls: false, usage: { include: true } }),
        }, Math.min(target.local && args.stage === 'yap' ? runtime.timeoutMs : REQUEST_TIMEOUT_MS, Math.max(1, deadline - Date.now())), args.shouldStop)
        if (args.shouldStop() || stopCheck()) throw new StoppedError()
        if (!res.ok) {
          chatLogger?.(`HTTP asama=${args.stage ?? 'recovery'} model=${target.model} durum=${res.status} govde=${res.text.slice(0, 500).replace(/\s+/g, ' ')}`)
          if (!target.local && (res.status === 401 || isCreditError(res.status, res.text))) throw new FatalApiError(`${label} uzak model çağrısı (HTTP ${res.status}): ${res.status === 401 ? 'API anahtarı geçersiz' : 'bakiye yetersiz'}. Aynı istek tekrar gönderilmedi.`)
          throw new Error(`${label} ${target.local ? 'yerel' : 'uzak'} model çağrısı (${res.status}): ${res.text.slice(0, 300)}`)
        }
        const data = JSON.parse(res.text)
        if (data.error) throw new ModelRejected(`OpenRouter: ${providerError(data.error).slice(0, 300)}`)
        const choice = data.choices?.[0]
        if (!choice?.message || choice.finish_reason === 'length') throw new ModelOutputRejected('Kurtarma modelinin yanıtı boş veya kesilmiş.')
        const m = choice.message
        if (m.tool_calls !== undefined && (!Array.isArray(m.tool_calls) || m.tool_calls.some((c: ModelToolCall) =>
          !c || typeof c.id !== 'string' || !c.id || c.type !== 'function' || typeof c.function?.name !== 'string' || typeof c.function?.arguments !== 'string'))) {
          throw new ModelOutputRejected('Kurtarma modeli geçersiz araç çağrısı verdi.')
        }
        for (const call of m.tool_calls ?? []) {
          const definition = args.tools.find(tool => tool.function.name === call.function.name)
          if (!definition) throw new ModelOutputRejected(`Araç yanıtı tanınmıyor: ${call.function.name}`)
          let value: unknown
          try { value = JSON.parse(call.function.arguments) }
          catch { throw new ModelOutputRejected('Araç argümanları geçerli JSON değil.') }
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ModelOutputRejected('Araç argümanları nesne olmalı.')
          const values = value as Record<string, unknown>
          const schema = definition.function.parameters
          const properties = schema.properties as Record<string, { type?: string; enum?: unknown[] }> | undefined
          for (const key of (schema.required as string[] | undefined) ?? []) {
            if (!(key in values)) throw new ModelOutputRejected(`Araç yanıtında eksik alan: ${key}`)
          }
          for (const [key, val] of Object.entries(values)) {
            const spec = properties?.[key]
            if (!spec && schema.additionalProperties === false) throw new ModelOutputRejected(`Araç yanıtında bilinmeyen alan: ${key}`)
            if (spec && (spec.type === 'integer' ? !Number.isInteger(val) : spec.type === 'array' ? !Array.isArray(val) : spec.type && typeof val !== spec.type)) throw new ModelOutputRejected(`Araç yanıtında geçersiz alan: ${key}`)
            if (spec?.enum && !spec.enum.includes(val)) throw new ModelOutputRejected(`Araç yanıtında geçersiz değer: ${key}`)
          }
        }
        const text = m.content == null ? null : responseText(m.content)
        if (args.stage === 'yap' && !m.tool_calls?.length && !text?.trim()) throw new ModelOutputRejected('Yap modelinin metni ve araç çağrısı boş; sıradaki model denenecek.')
        reportIn(target.local, JSON.stringify({ content: m.content, tool_calls: m.tool_calls, usage: data.usage }))
        const billed = data.usage && typeof data.usage === 'object' ? { prompt_tokens: data.usage.prompt_tokens, completion_tokens: data.usage.completion_tokens, total_tokens: data.usage.total_tokens, cost: typeof data.usage.cost === 'number' ? data.usage.cost : undefined } : undefined
        const answered = typeof data.model === 'string' && data.model ? data.model : model
        chatLogger?.(`CEVAPLAYAN asama=${args.stage ?? 'recovery'} model=${answered}`)
        chatLogger?.(`${label} ${targetTag(target.local)} ← ${answered}${billed?.total_tokens ? ` · ${billed.total_tokens} token` : ''}${typeof billed?.cost === 'number' ? ` · $${billed.cost.toFixed(4)}` : ''}`)
        return { role: 'assistant', content: text,
          ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}),
          ...(m.reasoning_details ? { reasoning_details: m.reasoning_details } : {}),
          model: answered,
          ...(billed && (billed.total_tokens || typeof billed.cost === 'number') ? { usage: billed } : {}) }
      } catch (error) {
        if (error instanceof StoppedError || error instanceof FatalApiError && args.stage !== 'yap') throw error
        if (error instanceof FatalApiError && args.stage === 'yap') rejectedRemoteAccount = error
        if (error instanceof ModelOutputRejected && outputAttempt === 0 && args.stage !== 'yap') {
          chatLogger?.(`CIKTI-TEKRAR asama=${args.stage ?? 'recovery'} model=${model} deneme=2/2 neden=${brief(error)}`)
          continue
        }
        last = error
        chatLogger?.(`ATLANDI asama=${args.stage ?? 'recovery'} model=${model} neden=${brief(error)}`)
        chatLogger?.(`${label} modeli ${model} yanıtlayamadı: ${brief(error)}`)
        break
      }
    }
  }
  throw last
}

async function stoppableWait(ms: number, signal?: AbortSignal, localStop: () => boolean = () => false) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    checkObservation(signal)
    if (stopCheck() || localStop()) throw new StoppedError()
    await new Promise((r) => setTimeout(r, Math.min(100, end - Date.now())))
  }
}

const secrets = new Set<string>()
export function validateApiKey(value: string): string {
  const key = String(value ?? '').trim()
  if (/[\r\n\x00-\x1f\x7f]/.test(key)) throw new ModelRejected('API anahtarı geçersiz kontrol karakteri içeriyor. Anahtarı yeniden yapıştır.')
  if (key) { secrets.add(key); if (secrets.size > 20) secrets.delete(secrets.values().next().value!) }
  return key
}
function redact(value: string): string {
  let out = value
  for (const key of secrets) out = out.split(key).join('[API ANAHTARI GİZLENDİ]')
  return out.replace(/sk-or-v1-[a-z0-9_-]+/gi, '[API ANAHTARI GİZLENDİ]')
}
const HEADERS = (apiKey: string) => ({
  Authorization: `Bearer ${validateApiKey(apiKey)}`,
  'Content-Type': 'application/json',
  'HTTP-Referer': 'https://nubbo.local',
  'X-Title': 'Nubbo Agent Studio',
})

/** Yerel (OpenAI uyumlu) taban adres. Boşken her istek OpenRouter'da kalır - davranış değişmez. */
let localBase = ''
let localTimeoutMs = 180_000
let localVision = false
let localOff = false
let localThink = ''
type LocalRuntime = { base: string; timeoutMs: number; vision: boolean; off: boolean; think: string }
const localRuntime = (): LocalRuntime => ({base:localBase, timeoutMs:localTimeoutMs, vision:localVision, off:localOff, think:localThink})
/** Ollama'nın kabul ettiği düşünme seviyeleri; boş dize "otomatik" demektir. */
const THINK_LEVELS = ['none', 'low', 'medium', 'high']
export function setLocalEndpoint(url: string | undefined, timeoutMs?: number, vision?: boolean, off?: boolean, think?: string) {
  const raw = String(url ?? '').trim().replace(/\/+$/, '')
  localBase = raw ? (/\/v1$/i.test(raw) ? raw : `${raw}/v1`) : ''
  localTimeoutMs = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs)
    ? Math.min(900_000, Math.max(10_000, Math.floor(timeoutMs)))
    : 180_000
  localVision = vision === true
  localOff = off === true
  const secim = String(think ?? '').trim().toLowerCase()
  localThink = THINK_LEVELS.includes(secim) ? secim : ''
}
/** Kullanıcı yerel modelin görüntü desteklediğini beyan etti mi. */
export function localVisionDeclared() { return localVision }
/** Yerel yol kullanılabilir mi: adres var ve "OpenRouter'a dön" kapalı. */
export function localConfigured() { return !!localBase && !localOff }
/**
 * Zincirdeki bir satırın nereye gideceğini söyler. `local:<model>` yerel tabana,
 * diğer her şey OpenRouter'a gider; böylece aynı listede ikisi birlikte durabilir.
 */
function targetFor(model: string, runtime = localRuntime()): { url: string; model: string; local: boolean } {
  const openRouter = 'https://openrouter.ai/api/v1/chat/completions'
  if (!/^local:/i.test(model)) return { url: openRouter, model, local: false }
  // "Şimdilik OpenRouter'a dön" açıkken veya adres boşken yerel satır ATLANIR; zincir sıradakine geçer.
  if (runtime.off || !runtime.base) throw new ModelRejected('Yerel model kapalı; satır atlandı (adres boş ya da "OpenRouter\'a dön" açık).')
  try {
    const url = new URL(runtime.base)
    if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash || url.username || url.password) throw new Error('invalid')
  } catch { throw new ModelRejected('Yerel sunucu adresi geçersiz. http:// veya https:// ile başlayan taban adresi yaz.') }
  const name = model.replace(/^local:/i, '').trim()
  if (!name) throw new ModelRejected('Yerel model adı boş.')
  return { url: `${runtime.base}/chat/completions`, model: name, local: true }
}
/**
 * Yerel adres bir Ollama sunucusu mu. Ollama'nın OpenAI uyumlu ucu düşünmeyi YALNIZCA
 * `reasoning_effort: "none"` alanıyla kapatıyor (11 Ekim 2026 ölçümü, qwen3.5:9b:
 * 9995 ms / 289 karakter düşünme -> 151 ms / 0 karakter). Modelfile'da `think`/`thinking`
 * parametresi reddediliyor ve `/no_think` işe yaramıyor; bu yüzden alanı istek gövdesine
 * biz ekliyoruz. Başka yerel sunucular bilinmeyen alanı reddedebildiği için yalnız
 * Ollama adreslerine gönderilir; diğer yerel adreslerde gövde eskisi gibi kalır.
 */
function localNeedsNoThinking(base = localBase): boolean {
  try {
    const u = new URL(base)
    return u.port === '11434' || /ollama/i.test(u.hostname) || /ollama/i.test(u.pathname)
  } catch { return false }
}

/**
 * Yerel istekte gönderilecek `reasoning_effort` değeri; null = alan hiç gönderilmez.
 * Kullanıcı Yerel Model sekmesinden bir seviye seçtiyse o gönderilir (her yerel sunucuya).
 * Seçim yoksa (otomatik) yalnız Ollama adreslerinde kapatılır; başka yerel sunucular
 * bilinmeyen alanı reddedebildiği için gövde eskisi gibi kalır.
 */
function localReasoningEffort(runtime = localRuntime()): string | null {
  if (runtime.think) return runtime.think
  return localNeedsNoThinking(runtime.base) ? 'none' : null
}

/** Yerel sunucunun model listesi. Aynı zamanda "adres açık mı" sınaması olarak kullanılır. */
export async function listLocalModels(base?: string): Promise<{ id: string; vision: boolean }[]> {
  const raw = String(base ?? localBase).trim().replace(/\/+$/, '')
  if (!raw) throw new Error('Yerel adres boş.')
  const root = /\/v1$/i.test(raw) ? raw : `${raw}/v1`
  try {
    const url = new URL(root)
    if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash || url.username || url.password) throw new Error('invalid')
  } catch { throw new Error('Yerel sunucu adresi geçersiz. Örnek: http://127.0.0.1:8080/v1') }
  const res = await guardedFetch(`${root}/models`, {}, 15000)
  if (!res.ok) throw new Error(`Yerel model listesi alınamadı (${res.status}). Sunucu açık mı?`)
  const data = JSON.parse(res.text) as { data?: { id?: string; architecture?: { input_modalities?: string[] } }[] }
  if (!Array.isArray(data.data)) throw new Error('Yerel sunucu geçerli bir model listesi döndürmedi (/v1/models).')
  return data.data
    .filter((m) => m && typeof m.id === 'string' && m.id.trim())
    .map((m) => ({ id: String(m.id), vision: !!m.architecture?.input_modalities?.includes('image') }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

// ---------- VRAM raporu: yalnız ÖLÇÜLEN değer yazılır, tahmin/uydurma yok ----------

/** MB cinsinden kullanılan/toplam belleği "5.0/12.0 GB" yapar. Okunamayan değerde boş dize. */
export function formatVram(usedMb: unknown, totalMb: unknown): string {
  const mb = (v: unknown): number => (String(v ?? '').trim() ? Number(String(v).trim()) : NaN)
  const used = mb(usedMb)
  const total = mb(totalMb)
  if (!Number.isFinite(used) || !Number.isFinite(total) || used < 0 || total <= 0) return ''
  return `${(used / 1024).toFixed(1)}/${(total / 1024).toFixed(1)} GB`
}

/** `nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits` çıktısının ilk satırı. */
export function parseNvidiaSmi(out: unknown): string {
  const line = String(out ?? '').split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? ''
  const m = line.match(/^(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/)
  return m ? formatVram(m[1], m[2]) : ''
}

/**
 * Ollama `/api/ps` yanıtındaki yüklü modellerin `size_vram` toplamı.
 * Buradan TOPLAM GPU belleği bilinmez, yalnız kullanılan yazılır; yüklü model yoksa boş.
 */
export function parseOllamaPs(json: unknown): string {
  const models = (json as { models?: unknown } | null | undefined)?.models
  if (!Array.isArray(models)) return ''
  let bytes = 0
  for (const m of models) {
    const v = Number((m as { size_vram?: unknown } | null | undefined)?.size_vram)
    if (Number.isFinite(v) && v > 0) bytes += v
  }
  return bytes > 0 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : ''
}

/** NVIDIA sürücüsü varsa gerçek VRAM kullanımı; sürücü/araç yoksa boş dize (~1,5 sn sınır). */
function nvidiaSmiVram(): string {
  try {
    const r = spawnSync('nvidia-smi', ['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits'], {
      timeout: 1500, windowsHide: true, encoding: 'utf8',
    })
    return r.status === 0 ? parseNvidiaSmi(r.stdout) : ''
  } catch {
    return ''
  }
}

/** Ollama adresiyse `/api/ps`; başka yerel sunucuda hiç denenmez. Toplam bilinmediği için tek değer yazılır. */
async function ollamaVram(): Promise<string> {
  if (!localBase || !localNeedsNoThinking()) return ''
  let root = ''
  try {
    const u = new URL(localBase)
    root = `${u.origin}${u.pathname.replace(/\/v1\/?$/i, '')}`
  } catch {
    return ''
  }
  try {
    const res = await guardedFetch(`${root}/api/ps`, {}, 1500)
    return res.ok ? parseOllamaPs(JSON.parse(res.text)) : ''
  } catch {
    return ''
  }
}

/** Ölçülebilen VRAM metni: önce nvidia-smi, sonra Ollama /api/ps. Ölçülemiyorsa boş dize. */
export async function gpuInfo(): Promise<string> {
  return nvidiaSmiVram() || await ollamaVram()
}

type Message = { role: 'system' | 'user' | 'assistant'; content: string | object[] }
let chatLogger: ((line: string) => void) | null = null
let voiceLogger: ((line: string) => void) | null = null

/**
 * BAĞLAM ÖLÇÜMÜ BAĞLANTISI (1.9.129). Kart, günlük METNİNDEN ayrıştırılmaz: ölçüm buradan NESNE
 * olarak dışarı verilir ve main → HUD → masaüstü/Android boyunca aynı nesne taşınır. Bu geri çağırma
 * isteği BEKLETMEZ, hata fırlatmaz ve istek gövdesini DEĞİŞTİRMEZ (çağıran taraf `void` ile çağırır).
 */
export type BaglamOlayi = {
  model: string
  sunucu: string
  requestId?: string
  /** 'istek': istek gövdesi yazıldı; ölçüm o an mevcut olan (veya hemen başlatılan) bilgidir. */
  asama: 'istek' | 'cevap'
  olcum?: BaglamOlcumu
  /** İstek gövdesinde GERÇEKTEN gönderilen num_ctx (yoksa undefined). */
  istekNumCtx?: number
  girisToken?: number
  tahminiToken?: number
}
let baglamLogger: ((olay: BaglamOlayi) => void) | null = null
export function setBaglamLogger(fn: ((olay: BaglamOlayi) => void) | null) { baglamLogger = fn }

/**
 * İstek gövdesinde GERÇEKTEN gönderilen num_ctx. Gövde `ollama.options.num_ctx` ya da OpenAI uyumlu
 * düz `num_ctx` biçiminde taşıyabilir; ikisi de okunur, GÖNDERİLMİYORSA undefined döner. Uygulama
 * şu an num_ctx göndermiyor: bu yüzden kart "gönderilmiyor" yazar, uydurma değer yazmaz.
 */
export function istekNumCtxAl(govde: unknown): number | undefined {
  const g = (govde ?? {}) as { num_ctx?: unknown; options?: { num_ctx?: unknown } }
  const aday = g.num_ctx ?? g.options?.num_ctx
  const n = typeof aday === 'number' ? aday : Number(aday)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/**
 * Sunucunun GERÇEKTEN bildirdiği giriş token sayısı: OpenAI uyumlu `usage.prompt_tokens` ya da
 * Ollama'nın yerel alanı. Hiçbiri yoksa undefined — TAHMİN ÜRETİLMEZ (kart "bilinmiyor" yazar).
 */
export function gercekGirisTokeni(yanit: unknown): number | undefined {
  const y = (yanit ?? {}) as { usage?: { prompt_tokens?: unknown }; prompt_eval_count?: unknown }
  const aday = y.usage?.prompt_tokens ?? y.prompt_eval_count
  const n = typeof aday === 'number' ? aday : Number(aday)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/** Ölçüm olayını kart/teşhis katmanına NESNE olarak verir; hata ASLA isteği bozmaz. */
function baglamOlayiYaz(olay: BaglamOlayi): void {
  try {
    baglamLogger?.(olay)
  } catch {
    /* kart/teşhis katmanı hata verirse istek etkilenmez */
  }
}

/**
 * Ölçüm nesnesini tek satırlık GÜNLÜK satırına çevirir. Dört kavram AYRI alanlarda yazılır; anahtar
 * veya tam URL YAZILMAZ (yalnız host). İstek num_ctx gerçekten gönderilmediyse "gonderilmiyor".
 */
export function baglamOlcumLogSatiri(o: BaglamOlayi): string {
  const p = pencereKaynagi(o.olcum)
  const s = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? String(Math.round(v)) : 'bilinmiyor')
  const zaman = Math.max(Number(o.olcum?.olcumAt) || 0, Number(o.olcum?.cevapAt) || 0)
  const saat = zaman > 0 ? new Date(zaman).toISOString().slice(11, 19) : 'bilinmiyor'
  const parca = [
    `BAGLAM-OLCUM | asama=${o.asama}`,
    `id=${o.requestId ?? '-'}`,
    `model=${o.model}`,
    `sunucu=${sunucuEtiketi(o.sunucu) || 'bilinmiyor'}`,
  ]
  if (o.asama === 'cevap') {
    parca.push(`yuklu=${s(o.olcum?.calisanPencere)}`, `azami=${s(o.olcum?.azamiKapasite)}`, `yapilandirilmis=${s(o.olcum?.yapilandirilmisPencere)}`)
    parca.push(`istek-num_ctx=${o.istekNumCtx === undefined ? 'gonderilmiyor' : s(o.istekNumCtx)}`)
    parca.push(`giris=${o.girisToken === undefined ? 'bilinmiyor' : `${Math.round(o.girisToken)} (olcum)`}`, `tahmini=${o.tahminiToken === undefined ? 'bilinmiyor' : `${o.tahminiToken} (TAHMIN)`}`)
    parca.push(`pencere-kaynagi=${p.kaynak}`, `olcum-zamani=${saat}`, `eski=${olcumEskiMi(o.olcum, Date.now()) ? 'evet' : 'hayir'}`)
    return parca.join(' | ')
  }
  return `${parca.join(' | ')} | pencere=${s(p.token)} | pencere-kaynagi=${p.kaynak} | olcum-zamani=${saat} | eski=${olcumEskiMi(o.olcum, Date.now()) ? 'evet' : 'hayir'} | kart="${baglamKartiOzet(baglamKartiYap({ model: o.model, sunucu: o.sunucu, olcum: o.olcum, istekNumCtx: o.istekNumCtx, girisToken: o.girisToken, tahminiToken: o.tahminiToken, simdi: Date.now() }))}"`
}

/**
 * CEVAP SONRASI tazeleme. İlk istek modeli yüklediyse yüklü pencere değişmiştir; bu yüzden cevaptan
 * sonra ölçüm YENİDEN alınır ve `cevapAt` damgasıyla kaydedilir. Sorgu isteği BEKLETMEZ (çağıran
 * `void` ile başlatır), Durdur sinyalinde çalışmaz ve eski model/sunucu damgası taşımaz — kart
 * yalnız bu olayın kendi model+sunucu anahtarıyla güncellenir.
 */
async function cevapSonrasiOlcumYaz(model: string, ucNokta: string, requestId: string | undefined, girisToken: number | undefined, tahminiToken: number, signal?: AbortSignal): Promise<void> {
  try {
    if (signal?.aborted) return // Durdur: iptal edilmiş isteğin ardından yeni sorgu başlatılmaz.
    const cevapAt = Date.now()
    await olcumuTazele(model, ucNokta, cevapAt, { cevapAt, girisToken })
    const olcum = olcumFor(model, ucNokta)
    baglamOlayiYaz({ model, sunucu: ucNokta, requestId, asama: 'cevap', olcum, girisToken, tahminiToken })
    chatLogger?.(baglamOlcumLogSatiri({ model, sunucu: ucNokta, requestId, asama: 'cevap', olcum, girisToken, tahminiToken }))
  } catch {
    /* ölçüm başarısızlığı isteği/cevabı ETKİLEMEZ */
  }
}

/** Ölçüm görevini başlatır ve takibe alır: istek BEKLETİLMEZ, ama test/teşhis bekleyebilir. */
function cevapSonrasiOlcumBaslat(model: string, ucNokta: string, requestId: string | undefined, girisToken: number | undefined, tahminiToken: number, signal?: AbortSignal): void {
  olcumGoreviEkle(cevapSonrasiOlcumYaz(model, ucNokta, requestId, girisToken, tahminiToken, signal))
}

/** The agent log receives every completion request and response. Images are noted, not pasted. */
export function setChatLogger(fn: ((line: string) => void) | null) {
  chatLogger = fn ? line => fn(redact(line)) : null
}

/** A short line in the corner report: the model that answered, then what it said. */
export function setVoiceLogger(fn: ((line: string) => void) | null) {
  voiceLogger = fn ? line => fn(redact(line)) : null
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

/** Günlükte cevabı kimin verdiği tek bakışta görünsün: [yerel] mi, [API] mi. */
function targetTag(local: boolean): string {
  return local ? '[yerel]' : '[API]'
}

/** Bir zincir satırının yerel tabana mı gideceğini söyler (adres/anahtar denetimi yapmaz). */
function isLocalName(model: string): boolean {
  return /^local:/i.test(String(model ?? ''))
}

function reportOut(model: string, local: boolean, messages: Message[]) {
  chatLogger?.(`${targetTag(local)} → ${model}\n${clip(describeMessages(messages))}`)
}

function reportIn(local: boolean, text: string) {
  chatLogger?.(`${targetTag(local)} ← ${clip(text.trim() || '(boş yanıt)')}`)
}

class ImageUnsupportedError extends Error {}

/** Key or balance. Another model name cannot fix these. */
export class FatalApiError extends Error { readonly serviceFailure = true }

/** This model could not answer. The next name in the list should be tried. */
export class ModelFailed extends Error { readonly serviceFailure = true }

/** This model will not answer however often it is asked: wrong name or request (400/404/422), empty or unreadable answer. Outages and rate limits are not this. */
export class ModelRejected extends ModelFailed {}
/** Only an actual model response rejected by the output contract gets one extra attempt. */
export class ModelOutputRejected extends ModelRejected {}
class CandidateOutputRejected extends ModelOutputRejected {
  constructor(message: string, readonly content: string) { super(message) }
}

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
  return redact((err as Error).message || String(err)).replace(/\s+/g, ' ').slice(0, 160)
}

/**
 * Tries each model once. After the last one fails, waits and starts again at the first.
 * A normal method gets one finite pass over its model alternatives. Exhaustion is
 * returned to the method owner, which advances methods or starts a FRESH pass.
 * Explicit diagnostic budgets remain supported; no hidden infinite model loop.
 */
export async function runModelChain<T>(models: string[], run: (model: string) => Promise<T>, pauseMs = CYCLE_PAUSE_MS, limits: { maxCycles?: number; maxWaitMs?: number; signal?: AbortSignal; shouldStop?: () => boolean; stage?: string; revision?: number; source?: string } = {}): Promise<T> {
  const stopped = () => stopCheck() || limits.shouldStop?.() === true
  const chain = asModelChain(models)
  if (!chain.length) throw new Error('Model adı yok. Ayarlar’dan bir model yaz.')
  // Sıra, çağrı başında kopyalanır. Kayıt bu istek bitmeden değişse de bu dizi durur.
  if (limits.stage) chatLogger?.(`ZINCIR asama=${limits.stage} revizyon=${limits.revision ?? 0} kaynak=${limits.source ?? '-'} sira=${chain.join(' > ')} ilk=${chain[0]}`)
  const retriedOutputs = new Set<string>()
  const invalidOutputs = new Set<string>()
  let lastOutputError: ModelOutputRejected | undefined
  let rejectedCycles = 0
  const maxCycles = Math.max(1, limits.maxCycles ?? 1)
  const deadline = limits.maxWaitMs === undefined ? Number.POSITIVE_INFINITY : Date.now() + Math.max(1, limits.maxWaitMs)
  let cycles = 0
  for (;;) {
    let allRejected = true
    let lastError = ''
    let lastFailure: unknown
    for (let i = 0; i < chain.length; i++) {
      checkObservation(limits.signal)
      if (stopped()) throw new StoppedError()
      if (Date.now() >= deadline) throw new ModelFailed('Model deneme süresi doldu (çağıranın açık süre sınırı).')
      const model = chain[i]
      if (invalidOutputs.has(model)) continue
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new ModelFailed('Model deneme süresi doldu (çağıranın açık süre sınırı).')
      attemptCaps.push(remaining)
      try {
        try {
          const value = await run(model)
          checkObservation(limits.signal)
          if (stopped()) throw new StoppedError()
          if (Date.now() > deadline) throw new ModelFailed('Model deneme süresi doldu (geç yanıt reddedildi).')
          return value
        }
        catch (error) {
          if (!(error instanceof ModelOutputRejected)) throw error
          if (retriedOutputs.has(model)) {
            invalidOutputs.add(model); lastOutputError = error; throw error
          }
          retriedOutputs.add(model)
          checkObservation(limits.signal)
          if (stopped()) throw new StoppedError()
          if (Date.now() >= deadline) throw new ModelFailed('Model deneme süresi doldu.')
          chatLogger?.(`CIKTI-TEKRAR asama=${limits.stage ?? '-'} model=${model} deneme=2/2 neden=${brief(error)}`)
          const againRemaining = deadline - Date.now()
          if (againRemaining <= 0) throw new ModelFailed('Model deneme süresi doldu (çağıranın açık süre sınırı).')
          attemptCaps[attemptCaps.length - 1] = againRemaining
          try {
            const value = await run(model)
            checkObservation(limits.signal)
            if (stopped()) throw new StoppedError()
            if (Date.now() > deadline) throw new ModelFailed('Model deneme süresi doldu (geç yanıt reddedildi).')
            return value
          }
          catch (again) {
            if (again instanceof ModelOutputRejected) { invalidOutputs.add(model); lastOutputError = again }
            throw again
          }
        }
      } catch (e) {
        checkObservation(limits.signal)
        if (e instanceof StoppedError) throw e
        if (e instanceof ModelFailed && e.message.includes('geç yanıt reddedildi')) throw e
        if (!(e instanceof ModelRejected) || e instanceof ModelOutputRejected) allRejected = false
        lastError = brief(e)
        lastFailure = e
        const last = i === chain.length - 1
        const next = chain[(i + 1) % chain.length]
        const neden = brief(e)
        chatLogger?.(`ATLANDI asama=${limits.stage ?? '-'} model=${model} neden=${neden} sonraki=${last ? (cycles + 1 >= maxCycles ? 'yok' : chain[0]) : next}`)
        chatLogger?.(last ? `${targetTag(isLocalName(model))} ${model} olmadı (${neden}). ${cycles + 1 >= maxCycles ? 'Deneme zinciri bitti.' : 'Sıra başa dönüyor.'}` : `${targetTag(isLocalName(model))} ${model} olmadı (${neden}). ${next} deneniyor.`)
      } finally {
        attemptCaps.pop()
      }
    }
    if (chain.every(model => invalidOutputs.has(model)) && cycles + 1 >= maxCycles) throw lastOutputError!
    rejectedCycles = allRejected ? rejectedCycles + 1 : 0
    if (rejectedCycles >= MAX_REJECTED_CYCLES) {
      throw new Error(`Hiçbir model cevap vermedi: ${rejectedCycles} tur üst üste reddedildi (model adını ve ayarları kontrol et). Son hata: ${lastError}`)
    }
    if (++cycles >= maxCycles || Date.now() >= deadline) {
      if (limits.maxCycles !== undefined || limits.maxWaitMs !== undefined) throw new ModelFailed(`Model deneme sınırı doldu (${cycles} tur). Son hata: ${lastError}`)
      throw lastFailure ?? new ModelFailed(`Model yöntemleri yanıtlayamadı. Son hata: ${lastError}`)
    }
    // Invalid/empty/truncated output is not a permanent model ban. A new round
    // asks independently again; no native action is replayed by this chain.
    invalidOutputs.clear()
    retriedOutputs.clear()
    chatLogger?.(`MODEL-BEKLE asama=${limits.stage ?? '-'} tur=${cycles} durum=cevap-bekleniyor sonHata=${lastError}`)
    chatLogger?.(`Modellerin hepsi susuyor. ${Math.round(pauseMs / 1000)} sn sonra ${chain[0]} yeniden denenecek.`)
    await stoppableWait(Math.min(pauseMs, Math.max(0, deadline - Date.now())), limits.signal, stopped)
  }
}

export function responseText(content: unknown): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(part => {
    if (part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') return part.text
    throw new ModelOutputRejected('Model yanıtında desteklenmeyen içerik parçası var.')
  }).join('\n')
  throw new ModelOutputRejected('Model yanıtının içerik biçimi geçersiz.')
}
function providerError(error: unknown): string {
  if (typeof error === 'string') return redact(error)
  if (error && typeof error === 'object') return redact(String((error as { message?: unknown }).message ?? 'Yanıt hatası'))
  return ''
}
function permanentFailure(status: number, text: string): boolean {
  return [400, 403, 404, 405, 413, 415, 422, 431].includes(status) || /invalid[_ ]request|invalid parameter|out of memory|not enough (?:gpu |vram |system )?memory|failed to allocate|context (?:length|window).*(?:exceed|limit)|invalid base64/i.test(text)
}

/** Bakiye hatası reasoning hatası değildir. Aynı gövde yeniden gönderilmez. */
export function isCreditError(status: number, text: string): boolean {
  if (status === 402) return true
  return /insufficient credits|payment required|requires more credits|out of credits|credit balance|insufficient_quota/i.test(text)
}

/** Sağlayıcı düşünmeyi kapatmayı reddetti. Yalnız bu alan kalkar; başka modellere düşünme açılmaz. */
export function isReasoningMandatory(text: string): boolean {
  return /reasoning is mandatory/i.test(text) && /cannot be disabled/i.test(text)
}

/** One request to one model. No second try here; the chain does that. */
async function chatOnce(
  apiKey: string,
  model: string,
  messages: Message[],
  hasImage: boolean,
  opts: { json?: boolean; signal?: AbortSignal; reasoningOff?: boolean; requestId?: string; stage?: string; runtime?: LocalRuntime } = {}
): Promise<string> {
  // Zorunlu düşünme hatası görülünce yalnız bu çağrıda alan kalkar. Sonraki model kendi gövdesini kurar.
  const runtime = opts.runtime ?? localRuntime()
  let dropReasoning = false
  const once = async (json: boolean) => {
    checkObservation(opts.signal)
    const target = targetFor(model, runtime)
    // Her deneme KENDİ istek kimliğini alır: zincirdeki ikinci model/eski deneme, yeni ölçümü ezmesin.
    const istekId = nextRequestId()
    if (!target.local) validateApiKey(apiKey)
    // Anahtar yoksa OpenRouter satırı atlanır; zincir varsa yerel satıra geçer (1.9.81).
    if (!target.local && !String(apiKey ?? '').trim()) throw new ModelRejected('OpenRouter anahtarı yok; satır atlandı.')
    if (target.local && hasImage && !runtime.vision) throw new ImageUnsupportedError('Yerel model için görüntü desteği kapalı.')
    const where = target.local ? 'Yerel sunucu' : 'OpenRouter'
    // Düşünme tercihi tek yerde çözülür: sekmede seçilen seviye ya da otomatik (Ollama'da kapalı).
    const effort = dropReasoning ? null : target.local ? opts.reasoningOff ? 'none' : localReasoningEffort(runtime) : null
    const reasoningDisabled = !dropReasoning && !target.local && !!opts.reasoningOff
    reportOut(target.model, target.local, messages)
    // Bağlam baskısı: yalnız sayaç/boyut (içerik yazılmaz).
    const metinKarakter = messages.reduce((t, m) => t + (typeof m.content === 'string' ? m.content.length : Array.isArray(m.content) ? (m.content as { type?: string; text?: string }[]).reduce((s, p) => s + (p.type === 'image_url' ? 0 : String(p.text ?? '').length), 0) : 0), 0)
    const resimler = messages.flatMap((m) => Array.isArray(m.content) ? (m.content as { type?: string; image_url?: { url?: string } }[]).filter((p) => p.type === 'image_url') : [])
    const bayt = resimler.reduce((t, p) => t + Math.round(((p.image_url?.url?.length ?? 0) * 3) / 4), 0)
    /** Tahmini giriş tokenı — TAHMİNDİR ve hiçbir karar buna dayanmaz (log ve kart bunu "TAHMİN" der). */
    const tahminiToken = Math.round(metinKarakter / 3.2 + resimler.length * 1400)
    // İstek gövdesi TEK yerde kurulur: ölçüm ve log aynı gövdeyi okur, üretim ayarları değişmez.
    const istekGovdesi = {
      model: target.model,
      temperature: 0,
      // Ollama'da düşünme varsayılan açık; kapatılmazsa model cevabı beklerken tokenı
      // düşünmeye harcıyor (ölçüldü: 1,4-10 sn ve boş cevap; kapalıyken 0,1 sn).
      ...(effort ? { reasoning_effort: effort } : {}),
      ...(reasoningDisabled ? { reasoning: { enabled: false } } : {}),
      // Leave output/reasoning token limits to the provider's model defaults.
      messages,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }
    /** İstek gövdesinde GERÇEKTEN gönderilen num_ctx (uygulama şu an göndermiyor → undefined). */
    const istekNumCtx = istekNumCtxAl(istekGovdesi)
    if (target.local) {
      chatLogger?.(contextPressureText({ model: target.model, metinKarakter, goruntuAdet: resimler.length, goruntuBayt: bayt, pencereToken: pencereTokenFor(target.model, target.url) }))
      // Ölçüm ÇAĞRI SINIRINDA, isteği BEKLETMEDEN tazelenir. Kart için ölçüm NESNE olarak verilir.
      void olcumuTazele(target.model, target.url).catch(() => {})
      const olay: BaglamOlayi = {
        model: target.model, sunucu: target.url, requestId: istekId, asama: 'istek',
        olcum: olcumFor(target.model, target.url), istekNumCtx, tahminiToken,
      }
      baglamOlayiYaz(olay)
      // Ayrı GÜNLÜK satırı: yüklü/yapılandırılmış/azami pencere, istek num_ctx ve ölçüm zamanı AYRI.
      chatLogger?.(baglamOlcumLogSatiri(olay))
    }
    const res = await guardedFetch(target.url, {
      method: 'POST',
      headers: target.local ? { 'Content-Type': 'application/json' } : HEADERS(apiKey),
      body: JSON.stringify(istekGovdesi),
    }, Math.min(target.local ? runtime.timeoutMs : REQUEST_TIMEOUT_MS, attemptCaps.length ? attemptCaps[attemptCaps.length - 1] : Number.POSITIVE_INFINITY), () => false, opts.signal)
    checkObservation(opts.signal)
    if (!res.ok) {
      reportIn(target.local, `hata ${res.status}: ${res.text.slice(0, 2000)}`)
      chatLogger?.(`HTTP asama=${opts.stage ?? '-'} model=${target.model} durum=${res.status} govde=${res.text.slice(0, 500).replace(/\s+/g, ' ')}`)
      if (!target.local && isCreditError(res.status, res.text)) {
        throw new FatalApiError(`OpenRouter bakiye hatası (HTTP ${res.status}). Aynı istek tekrar gönderilmedi. Gövde: ${res.text.slice(0, 180)}`)
      }
      if (isReasoningMandatory(res.text) && !dropReasoning && (reasoningDisabled || effort === 'none')) {
        dropReasoning = true
        chatLogger?.(`UYUM asama=${opts.stage ?? '-'} model=${target.model} alan=reasoning kaldirildi neden=endpoint zorunlu dusunme`)
        return once(json)
      }
      const tur = contextErrorKind(res.text)
      if (tur !== 'diger') chatLogger?.(tur === 'tekrar' ? `TOKEN-TEKrar | model=${target.model} | sunucu: token repeat limit (${res.status})` : `BAGLAM-HATA | model=${target.model} | sunucu: baglam/kesme hatasi (${res.status})`)
      // Anahtar/bakiye hatalari yalniz OpenRouter icin ölümcüldür; yerel sunucu 401 dönebilir.
      if (!target.local && res.status === 401) throw new FatalApiError('OpenRouter API anahtarı geçersiz (401).')
      if (!target.local && res.status === 402) throw new FatalApiError('OpenRouter bakiyesi yetersiz (402).')
      if (target.local && [401, 403].includes(res.status)) throw new ModelRejected('Yerel sunucu erişimi reddetti. Sunucunun kimlik doğrulama ayarını kontrol et; OpenRouter anahtarı yerel sunucuya gönderilmez.')
      if (hasImage && /(?:not support|unsupported|does not accept|only text|no vision).*(?:image|vision|multimodal)|(?:image|vision|multimodal).*(?:not support|unsupported|not available)/i.test(res.text)) throw new ImageUnsupportedError(res.text.slice(0, 200))
      const message = `${where} ${res.status}: ${res.text.slice(0, 200)}`
      throw permanentFailure(res.status, res.text) ? new ModelRejected(redact(message)) : new ModelFailed(redact(message))
    }
    let data: { choices?: { message?: { content?: unknown }; finish_reason?: string }[]; error?: unknown }
    try {
      data = JSON.parse(res.text)
    } catch {
      throw new ModelRejected(`${where} yanıtı okunamadı.`)
    }
    const kullanim = responseUsageText({ model: target.model, finishReason: data.choices?.[0]?.finish_reason, usage: (data as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }).usage, native: ((d) => ({ prompt_eval_count: d.prompt_eval_count, eval_count: d.eval_count, done_reason: d.done_reason }))(data as { prompt_eval_count?: number; eval_count?: number; done_reason?: string }), maxTokens: undefined })
    if (kullanim) chatLogger?.(kullanim)
    if (data.error) {
      const msg = providerError(data.error)
      reportIn(target.local, `hata: ${msg}`)
      if (!target.local && /invalid api key|unauthorized/i.test(msg)) throw new FatalApiError(`OpenRouter: ${msg}`)
      if (!target.local && isCreditError(0, msg)) throw new FatalApiError(`OpenRouter bakiye hatası. Aynı istek tekrar gönderilmedi. ${msg.slice(0, 180)}`)
      throw permanentFailure(0, msg) ? new ModelRejected(`${where}: ${msg.slice(0, 200)}`) : new ModelFailed(`${where}: ${msg.slice(0, 200)}`)
    }
    const content = responseText(data.choices?.[0]?.message?.content)
    reportIn(target.local, content)
    // CEVAP SONRASI ÖLÇÜM (1.9.129): ilk istek modeli YÜKLEMİŞ olabilir; yüklü pencere artık farklıdır.
    // Ölçüm NESNE olarak yenilenir ve `cevapAt` damgasıyla verilir; böylece bu kayıt "önceki isteğin
    // kesin pencere kanıtı" diye sunulmaz (card `cevapSonrasi` alanını ayrıca yazar).
    if (target.local) {
      const gercekGiris = gercekGirisTokeni(data)
      cevapSonrasiOlcumBaslat(target.model, target.url, istekId, gercekGiris, tahminiToken, opts.signal)
    }
    if (data.choices?.[0]?.finish_reason === 'length') throw new ModelOutputRejected('MODEL_OUTPUT_TRUNCATED: Yanıt token sınırında kesildi; hedef yok sayılmadı')
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
  opts: { json?: boolean; validate?: (text: string) => void; signal?: AbortSignal; maxCycles?: number; reasoningOff?: boolean; requestId?: string; stage?: string; revision?: number; source?: string; onAnsweredModel?: (model: string) => void } = {},
  /** Same request with the picture removed, used when this model cannot see images. */
  withoutImage?: Message[]
): Promise<string> {
  const requestOptions = {...opts, runtime:localRuntime()}
  return runModelChain(asModelChain(model), async (name) => {
    checkObservation(opts.signal)
    try {
      const text = await chatOnce(apiKey, name, messages, hasImage, requestOptions)
      if (!text.trim()) throw new ModelOutputRejected('boş yanıt')
      try { opts.validate?.(text) }
      catch (error) {
        if (error instanceof ModelOutputRejected) throw error
        if (error instanceof ModelRejected) throw new ModelOutputRejected(error.message)
        throw error
      }
      opts.onAnsweredModel?.(name)
      chatLogger?.(`CEVAPLAYAN asama=${opts.stage ?? '-'} model=${name}`)
      return text
    } catch (e) {
      if (!(e instanceof ImageUnsupportedError)) throw e
      if (!withoutImage) throw new ModelRejected(`${name} ekran görüntüsü kabul etmiyor.`)
      chatLogger?.(`${name} görüntü kabul etmiyor, yazı listesiyle deneniyor.`)
      const text = await chatOnce(apiKey, name, withoutImage, false, requestOptions)
      if (!text.trim()) throw new ModelOutputRejected('boş yanıt')
      try { opts.validate?.(text) }
      catch (error) {
        if (error instanceof ModelOutputRejected) throw error
        if (error instanceof ModelRejected) throw new ModelOutputRejected(error.message)
        throw error
      }
      opts.onAnsweredModel?.(name)
      chatLogger?.(`CEVAPLAYAN asama=${opts.stage ?? '-'} model=${name}`)
      return text
    }
  }, CYCLE_PAUSE_MS, { signal: opts.signal, maxCycles: opts.maxCycles, stage: opts.stage, revision: opts.revision, source: opts.source })
}

export type DirectChatResult = { text: string; model: string; local: boolean; ms: number }

/**
 * Yerel Model sekmesindeki sohbet kutusu için TEK mesajlık doğrudan istek.
 * Burada zincir/tekrar yoktur: cevabı bekleyen kullanıcıya hatayı gecikmeden söylemek gerekir.
 * `local:` ile başlayan model yerel tabana gider (gövdede öneksiz ad), diğerleri OpenRouter'a.
 * `allowLocal === false` iken yerel satır açıkça reddedilir; sessizce OpenRouter'a kaymaz.
 */
export async function directChat(opts: {
  apiKey: string
  model: string
  prompt: string
  allowLocal: boolean
  signal?: AbortSignal
}): Promise<DirectChatResult> {
  const requested = String(opts.model ?? '').trim()
  if (!requested) throw new ModelRejected('Model adı boş; Yerel Model sekmesinden bir model seç.')
  if (isLocalName(requested) && !opts.allowLocal) {
    throw new ModelRejected('Yerel model kapalı; bu sohbet turu yalnız OpenRouter ile yapılabilir.')
  }
  const prompt = String(opts.prompt ?? '').trim()
  if (!prompt) throw new ModelRejected('Mesaj boş.')
  // Hedef burada çözülür; adres kapalı/eksikse targetFor mevcut ModelRejected davranışını korur.
  const target = targetFor(requested)
  const started = Date.now()
  const text = await chatOnce(opts.apiKey, requested, [{ role: 'user', content: prompt }], false, { json: false, signal: opts.signal })
  if (!text.trim()) throw new ModelRejected('Model boş yanıt verdi.')
  return { text, model: target.model, local: target.local, ms: Date.now() - started }
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

/** Invalid/truncated output is a model failure, not an observed absent target. */
export function validateTargetReply(content: string): void {
  if (content.trim() === 'null') return // legacy explicit no-match
  const parsed = parseJson(content)
  if (parsed.give_up !== undefined && (typeof parsed.give_up !== 'boolean' || parsed.give_up && (parsed.id !== null || typeof parsed.reason !== 'string' || !parsed.reason.trim()))) {
    throw new ModelRejected('MODEL_TARGET_JSON_INVALID: give_up yalnız id:null ve açık gerekçeyle boolean olabilir.')
  }
  if (!Object.prototype.hasOwnProperty.call(parsed, 'id') && !Object.prototype.hasOwnProperty.call(parsed, 'i') && !Object.prototype.hasOwnProperty.call(parsed, 'index')) {
    throw new ModelRejected('MODEL_TARGET_JSON_INVALID: Geçerli hedef JSON yanıtı alınamadı; hedef bulunamadı sayılmadı')
  }
}

/** A condition is a boolean judgement, including absence; id alone cannot express that. */
export function validateConditionReply(content: string): void {
  const parsed = parseJson(content)
  if (typeof parsed.satisfied !== 'boolean' || !(parsed.id === null || typeof parsed.id === 'number' && Number.isInteger(parsed.id))) {
    throw new ModelRejected('MODEL_CONDITION_JSON_INVALID: Koşul için satisfied:boolean ve id:number|null yanıtı gerekli; geçersiz yanıt yokluk sayılmaz.')
  }
}

export type ScreenChoice = { giveUp?: boolean; satisfied?: boolean; id: number | null; text?: string; reason: string; usedImage: boolean; wordIndex?: number; candidateId?: number; /** Modelin döndürdüğü ham numara ve çözülemediyse sebebi: günlükte dürüst rapor için (1.9.110). */ rawId?: number; rejected?: 'absent' | 'not-selectable' | 'not-listed' | 'contradicts'; /** Numara aday listesinde yoktu ama GERÇEKTEN gönderilen marked görüntünün rozetinden çözüldü (1.9.116): ajan bu satırı kısa ikinci kelime seçimine sokar. */ badgeResolved?: boolean }

export async function chooseScreenTarget(opts: {
  apiKey: string
  model: string | string[]
  prompt: string
  kind: NodeKind
  scan: ScanResult
  stepTitle: string
  signal?: AbortSignal
  context?: string
  sendImage: boolean
  onImageFallback?: (msg: string) => void
  /** What worked on earlier laps, or why this lap looks different. */
  hint?: string
  /** Replaces the built-in system prompt when set in the LLM panel. */
  system?: string
  /** Kayıt revizyonu ve bu aşamanın listesi. Çağrı anındaki ayardan gelir. */
  revision?: number
  chainSource?: string
}): Promise<ScreenChoice> {
  const { scan } = opts
  const candidates = wordCandidates(scan)
  // Eylem cumlesi + yerlesik/kayitli secim tek yerde (saf, test edilir): listPromptFor.
  const system = listPromptFor(opts.kind, opts.system)

  const listText = `Screen area: ${scan.area.w}x${scan.area.h} (top-left ${scan.area.x},${scan.area.y})${scan.window ? `, window: ${scan.window}` : ''}
${opts.kind === 'condition' ? `Reader coverage: ${candidates.length} candidate(s) observed; ${Math.min(candidates.length, WORD_CANDIDATE_LIMIT)} supplied below. ${candidates.length > WORD_CANDIDATE_LIMIT ? 'PARTIAL candidate list: omitted items cannot be assumed absent.' : 'All candidates from this reader result are listed; this does not prove the reader captured every screen element.'}` : ''}
Items (#number type "text" @x,y widthxheight):
${describeWordCandidates(scan, candidates, undefined, { fullText: opts.kind === 'condition' })}

${spatialContext(scan)}

${opts.kind === 'condition' ? CONDITION_TARGET_RULES : WORD_TARGET_RULES}
${OCR_READER_RULES}
Reply with JSON only: ${opts.kind === 'condition' ? '{"satisfied": <boolean: does the user condition hold?>, "id": <one listed evidence id or null for absence>, "text": "<observed evidence>", "reason": "<short evidence-based reason>"}' : '{"id": <one listed candidate id or null>, "text": "<observed selected word/control text>", "reason": "<short reason>"}'}

${opts.kind === 'condition' ? '' : 'If you deliberately conclude that the requested target is definitely absent, you may add "give_up":true ONLY with id:null and a reason. If evidence is incomplete or you are unsure, do not give up; return id:null without give_up. A technical failure is never evidence of absence.'}
Step: ${opts.stepTitle}
Instruction: ${opts.prompt}${opts.context ? `\n\nContext: ${opts.context}` : ''}${opts.hint ? `\n\nMemory: ${opts.hint}\nMemory is only a hint; if the screen differs, follow the screen.` : ''}`

  const withImage = opts.sendImage && !!scan.image
  // KANIT (1.9.113): gövdeden ÖNCE tek satırlık KESİLMEYEN özet + aynı istek kimliğiyle diske kanıt.
  const istekId = nextRequestId()
  const gonderimOzeti = (goruntusuzDonus: boolean) => {
    // KANIT gerçek istek GÖVDESİNDEN üretilir: image_url parçası varsa görüntü oradan alınır (ham base64
    // dahil); yoksa görüntü nesnesine düşülür. Böylece istekte duran görüntü "YOK" diye yazılmaz.
    const gonderilenResim = goruntusuzDonus ? false : withImage
    const resim = imageFromMessages(build(gonderilenResim), scan.image?.mime) ?? (gonderilenResim ? imageBytes(scan.image?.data, scan.image?.mime) : null)
    const ilk = Array.isArray(opts.model) ? opts.model[0] : opts.model
    const ozet = sendSummaryText({
      id: istekId, node: opts.stepTitle, stage: String(opts.kind), model: asModelChain(opts.model)[0] ?? '',
      revision: opts.revision, source: opts.chainSource, chain: asModelChain(opts.model).join(' > '),
      target: isLocalName(ilk) ? 'local' : 'api',
      image: resim
        ? { sent: true, w: scan.image?.w, h: scan.image?.h, bytes: resim.buffer.length, mime: resim.mime, marked: (scan.image as { marked?: boolean } | null | undefined)?.marked === true }
        : { sent: false, reason: !opts.sendImage ? 'ayar kapalı: numaralı ekran görüntüsü gönder' : scan.image ? 'görüntü nesnesi var ama istek gövdesine image_url eklenmedi' : 'tarama görüntüsü boş (kare alınamadı)' },
      fallbackNoImage: goruntusuzDonus,
      candidates: { built: candidates.length, sent: countSentCandidates(listText) },
      promptChars: listText.length,
    })
    chatLogger?.(ozet)
    const sentIds = new Set(Array.from(listText.matchAll(/^#(\d+)\s/gm), match => Number(match[1])))
    const evidenceDir = saveRequestEvidence(istekId, { summary: ozet, system, instruction: opts.prompt, candidates: listText, image: resim ?? undefined,
      mapping: { requestId: istekId, instruction: opts.prompt, area: scan.area,
        imageSent: !!resim, imageMarked: !!resim && (scan.image as { marked?: boolean } | null)?.marked === true,
        fallbackNoImage: goruntusuzDonus,
        originalItems: scan.items,
        candidates: candidates.map(c => ({ ...c, sent: sentIds.has(c.item.id) })) } })
    if (evidenceDir) chatLogger?.(`OCR-KANIT id=${istekId} | klasor=${evidenceDir}`)
  }
  const build = (img: boolean): Message[] => [
    { role: 'system', content: system },
    {
      role: 'user',
      content: img
        ? [
            { type: 'text', text: `${listText}\n\nScreenshot labels may show original phrase/control IDs; use the list coordinates to select an OCR word ID.` },
            imagePart(scan.image!),
          ]
        : listText,
    },
  ]

  const validateChoice = (content: string) => {
    if (opts.kind === 'condition') validateConditionReply(content)
    else validateTargetReply(content)
    const parsed = parseJson(content)
    const id = Object.prototype.hasOwnProperty.call(parsed, 'id') ? parseListedId(parsed.id) : parseListedId(parsed.i ?? parsed.index)
    if (id === null) return // A legitimate missing/uncertain answer is not malformed output.
    const candidate = candidates.find(c => c.item.id === id && (!c.contextOnly || opts.kind === 'condition'))
    const badge = !candidate && usedImage && opts.kind !== 'condition' && (scan.image as { marked?: boolean } | null)?.marked === true
      ? scan.items.find(item => item.id === id && item.w > 0 && item.h > 0) : undefined
    const actual = candidate?.item ?? badge
    if (!actual || !listedTextAgrees(parsed.text, actual.text)) {
      const reason = !actual ? `id=${id} bu istekte seçilebilir değil` : `id=${id} metin=${String(parsed.text ?? '')} çözülen=${actual.text}`
      chatLogger?.(`CIKTI-RET asama=${opts.kind} ${reason}`)
      const textClash = !!actual && !listedTextAgrees(parsed.text, actual.text)
      const candidate = candidates.find(c => c.item.id === id)
      const rejected = textClash ? 'contradicts' : !candidate ? 'absent' : candidate.contextOnly ? 'not-selectable' : 'not-listed'
      if (textClash) chatLogger?.(`CELISKI id=${istekId} | donen-id=${id} | model-metni=${String(parsed.text ?? '').slice(0, 80)} | cozulen=${actual!.text.slice(0, 80)} | tiklama yok`)
      // Keep evidence even when we continue waiting and never reach the final result.
      saveRequestEvidence(istekId, { response: content, resolution: {
        requestId: istekId, returnedId: id, modelText: parsed.text ?? null, rawResponse: content,
        originalItemWithReturnedId: scan.items.find(item => item.id === id) ?? null,
        candidateWithReturnedId: candidate ?? null, textClash, rejected,
        acceptedCandidate: null, acceptedBadge: null,
      } })
      throw new CandidateOutputRejected(`MODEL_TARGET_REJECTED: ${reason}`, content)
    }
  }
  let content: string
  let usedImage = withImage
  // Özet gövdeden ÖNCE yazılır; `build` artık tanımlı olduğu için görüntü GERÇEK istekten okunur (1.9.115).
  gonderimOzeti(false)
  try {
    content = await chat(opts.apiKey, opts.model, build(withImage), withImage, { validate: validateChoice, signal: opts.signal, requestId: istekId, stage: String(opts.kind), revision: opts.revision, source: opts.chainSource }, withImage ? build(false) : undefined)
  } catch (e) {
    if (!(e instanceof ImageUnsupportedError)) throw e
    opts.onImageFallback?.('Seçili model ekran görüntüsünü desteklemiyor, sadece yazı listesiyle deneniyor.')
    usedImage = false
    gonderimOzeti(true)
    content = await chat(opts.apiKey, opts.model, build(false), false, { validate: validateChoice, signal: opts.signal, requestId: istekId, stage: String(opts.kind), revision: opts.revision, source: opts.chainSource })
  }

  const decoded = parseJson(content)
  const parsed = decoded && typeof decoded === 'object' && !Array.isArray(decoded) ? decoded : {}
  const parsedId = Object.prototype.hasOwnProperty.call(parsed, 'id') ? parseListedId(parsed.id) : parseListedId(parsed.i ?? parsed.index)
  const id = typeof parsedId === 'number' ? parsedId : null
  const selected = id !== null ? candidates.find(c => c.item.id === id && (!c.contextOnly || opts.kind === 'condition')) : undefined
  // GÖRÜNTÜ ROZETİ ÇÖZÜMLEMESİ (1.9.116): model numarayı görüntüdeki rozetten okuyor; rozetler ASIL öğe
  // kimlikleridir (küçük numaralar), liste ise kelime adayı kimliklerini taşır. Yalnız GERÇEKTEN gönderilen
  // "marked" görüntünün AYNI karesindeki öğeler için çözülür; görüntüsüz/plain istekte ret aynen kalır.
  // Çok kelimeli OCR satırı burada MERKEZE düşürülmez: kelime indeksi verilmez, seçimi ajanın mevcut kısa
  // ikinci kelime isteği yapar ve tıklama gerçek kelime kutusuna gider.
  const rozet = !selected && id !== null && Number.isInteger(id) && opts.kind !== 'condition' && (scan.image as { marked?: boolean } | null | undefined)?.marked === true
    ? scan.items.find((i) => i.id === id && i.w > 0 && i.h > 0)
    : undefined
  // Ölçülen kusur (1.9.110): reddin SEBEBİ kaydedilmiyordu, günlük yalnız "uygun öğe bulamadı" diyordu.
  // Artık: numara bu listede yok / var ama tıklanabilir değil / listeye alınmamış / numara yok.
  const aday = id !== null ? candidates.find(c => c.item.id === id) : undefined
  const actualText = selected?.item.text ?? rozet?.text ?? ''
  const clash = !!(selected || rozet) && !listedTextAgrees(parsed.text, actualText)
  const chosen = clash ? undefined : selected
  const badge = clash ? undefined : rozet
  const rejected = clash ? 'contradicts' as const : id === null || selected || rozet ? undefined : !aday ? 'absent' as const : aday.contextOnly ? 'not-selectable' as const : 'not-listed' as const
  // YANIT KANITI (1.9.113): ham cevap, dönen id, listede var mı, seçilebilir mi, red sebebi ve çözülen öğe.
  const gonderilenMi = id !== null && Number.isInteger(id) ? new RegExp(`^#${id}\\s`, 'm').test(listText) : false
  if (badge) chatLogger?.(`GORUNTU-ROZETI id=${istekId} | donen-id=${id} listede YOK ama marked goruntude #${badge.id} “${badge.text.slice(0, 60)}” | cok-kelimeli=${(badge.words?.length ?? 0) > 1 ? (opts.kind === 'click' ? 'evet (kisa ikinci kelime secimine gidiyor)' : 'evet (tikla disi tur: kelime secimi yok)') : 'hayir (kendi kutusuna)'}`)
  if (clash) chatLogger?.(`CELISKI id=${istekId} | donen-id=${id} | model-metni=${String(parsed.text ?? '').slice(0, 80)} | cozulen=${actualText.slice(0, 80)} | tiklama yok`)
  chatLogger?.(responseSummaryText({
    id: istekId, raw: content, returnedId: id ?? null, inSentList: gonderilenMi, selectable: !!(chosen || badge), rejected,
    resolvedItem: chosen ? `${chosen.item.src}/${chosen.item.type} "${chosen.item.text.slice(0, 60)}"` : badge ? `${badge.src}/${badge.type} "${badge.text.slice(0, 60)}" (görüntü rozeti #${badge.id})` : undefined,
    resolvedWord: chosen?.wordIndex !== undefined ? `#${chosen.item.id} w${chosen.wordIndex}` : undefined,
    targetText: (chosen?.item ?? badge)?.text.slice(0, 80),
  }))
  saveRequestEvidence(istekId, { response: content, resolution: {
    requestId: istekId, returnedId: id, modelText: parsed.text ?? null, rawResponse: content,
    inSentList: gonderilenMi, imageUsed: usedImage,
    candidateWithReturnedId: aday ?? null,
    originalItemWithReturnedId: scan.items.find(item => item.id === id) ?? null,
    selectedBeforeTextCheck: selected ?? null, badgeBeforeTextCheck: rozet ?? null,
    textClash: clash, rejected: rejected ?? null,
    acceptedCandidate: chosen ?? null, acceptedBadge: badge ?? null,
    resolvedParentId: chosen?.parentId ?? badge?.id ?? null,
  } })
  return {
    ...(opts.kind !== 'condition' && parsed.id === null && parsed.give_up === true ? { giveUp: true } : {}),
    ...(opts.kind === 'condition' ? { satisfied: parsed.satisfied === true && (parsed.id === null || !!chosen) } : {}),
    id: chosen?.parentId ?? badge?.id ?? null,
    ...(rejected ? { rejected, rawId: id ?? undefined } : {}),
    ...(badge ? { badgeResolved: true } : {}),
    ...(chosen?.wordIndex !== undefined ? { wordIndex: chosen.wordIndex, candidateId: chosen.item.id } : {}),
    text: chosen?.wordIndex !== undefined ? chosen.item.text : typeof parsed.text === 'string' ? parsed.text : undefined,
    reason: String(parsed.reason ?? ''),
    usedImage,
  }
}

/**
 * Bu isteğin aday numarası: tam sayı, yalnız rakamlardan oluşan yazı, ya da başında tek #.
 * Başka metinden sayı çekilmez. Koordinat, gerekçe veya başka isteğin numarası bu kapıdan geçmez.
 * Üyelik kontrolü çağırandadır: dönen sayı bu isteğin listesinde yoksa kabul edilmez.
 */
export function parseListedId(raw: unknown): number | null | undefined {
  if (raw === null) return null
  if (typeof raw === 'number') return Number.isInteger(raw) ? raw : undefined
  if (typeof raw !== 'string') return undefined
  const text = raw.trim()
  if (/^\d+$/.test(text)) return Number(text)
  if (/^#\d+$/.test(text)) return Number(text.slice(1))
  return undefined
}

/** Modelin yazdığı metin, çözülen adayın metniyle çelişiyorsa seçim tıklama hakkı doğurmaz. */
export function listedTextAgrees(stated: unknown, actual: string): boolean {
  if (typeof stated !== 'string' || !stated.trim()) return true
  const a = stated.trim().toLocaleLowerCase('tr')
  const b = actual.trim().toLocaleLowerCase('tr')
  if (!a || !b) return true
  return a === b || b.includes(a) || a.includes(b)
}

/** A small independent decision: only this OCR line, no screenshot/history or first-answer bias. */
export async function chooseOcrWord(opts: {
  apiKey: string
  model: string | string[]
  scan: ScanResult
  parentId: number
  prompt: string
  nodeId?: string
  system?: string
  revision?: number
  chainSource?: string
}): Promise<{ wordIndex: number; candidateId: number; text: string } | null> {
  const candidates = wordCandidates(opts.scan).filter(c => c.parentId === opts.parentId && c.wordIndex !== undefined)
  if (candidates.length < 2) throw new Error('Kelime seçimi için en az iki gerçek kelime kutusu gerekli.')
  const list = candidates.map(c => `#${c.item.id} ${JSON.stringify(c.item.text)}`).join('\n')
  const user = `Instruction: ${opts.prompt}\nWords:\n${list}`
  const system = opts.system?.trim() || WORD_CHOICE_PROMPT
  const id = nextRequestId()
  const validate = (content: string) => {
    const parsed = parseJson(content)
    const id = parseListedId(parsed.id)
    const allowed = id === null || (typeof id === 'number' && candidates.some(c => c.item.id === id))
    if (!Object.prototype.hasOwnProperty.call(parsed, 'id') || id === undefined || !allowed) {
      throw new ModelRejected('WORD_CHOICE_INVALID: Bu kısa istekteki bir kelime ID’si veya null gerekli.')
    }
  }
  const summary = sendSummaryText({ id, node: opts.nodeId, stage: 'ocr-word-choice',
    model: asModelChain(opts.model)[0] ?? '', revision: opts.revision, source: opts.chainSource, chain: asModelChain(opts.model).join(' > '), target: isLocalName(asModelChain(opts.model)[0]) ? 'local' : 'api',
    image: { sent: false, reason: 'kısa kelime seçimi: yalnız talimat ve kelimeler' },
    candidates: { built: candidates.length, sent: candidates.length }, promptChars: user.length })
  chatLogger?.(summary)
  saveRequestEvidence(id, { summary, system, instruction: opts.prompt, candidates: list })
  const content = await chat(opts.apiKey, opts.model, [{ role: 'system', content: system }, { role: 'user', content: user }], false,
    { validate, reasoningOff: true, stage: 'ocr-word-choice', revision: opts.revision, source: opts.chainSource })
  const parsed = parseJson(content)
  const pickedId = parseListedId(parsed.id)
  const picked = typeof pickedId === 'number' ? candidates.find(c => c.item.id === pickedId) : undefined
  chatLogger?.(responseSummaryText({ id, raw: content, returnedId: pickedId ?? null,
    inSentList: !!picked, selectable: !!picked, rejected: picked ? undefined : 'model belirsiz: null',
    resolvedWord: picked ? `#${picked.item.id} w${picked.wordIndex}` : undefined, targetText: picked?.item.text }))
  saveRequestEvidence(id, { response: content })
  return picked ? { wordIndex: picked.wordIndex!, candidateId: picked.item.id, text: picked.item.text } : null
}

type Img = { data: string; w: number; h: number; mime?: string }

function imagePart(img: Img) {
  return { type: 'image_url', image_url: { url: `data:${img.mime ?? 'image/jpeg'};base64,${img.data}` } }
}

async function visionChat(apiKey: string, model: string | string[], system: string, text: string, images: Img[], meta?: { stage?: string; revision?: number; source?: string; onAnsweredModel?: (model: string) => void }): Promise<Record<string, unknown>> {
  try {
    const content = await chat(
      apiKey,
      model,
      [
        { role: 'system', content: system },
        { role: 'user', content: [{ type: 'text', text }, ...images.map(imagePart)] },
      ],
      true,
      meta
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
  revision?: number
  chainSource?: string
}): Promise<{ verdict: ReactionVerdict; reason: string }> {
  const system = opts.system?.trim() || REACTION_PROMPT
  const text = `Yapılan adım: ${opts.step}
Sıradaki adımlar: ${opts.ahead || '(yok)'}
Beklenen yazı veya hedef: ${opts.expected || '(yok)'}
Sonra ekrana yeni gelen yazılar: ${opts.fresh.length ? opts.fresh.join(' | ') : '(yok)'}
İlk görüntü adımdan önce, ikinci görüntü adımdan sonradır.`
  const p = await visionChat(opts.apiKey, opts.model, system, text, [opts.before, opts.after], { stage: 'reaction', revision: opts.revision, source: opts.chainSource })
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

export async function visionDescribe(opts: { apiKey: string; model: string | string[]; image: Img; onAnsweredModel?: (model: string) => void }): Promise<string> {
  const p = await visionChat(
    opts.apiKey,
    opts.model,
    'Ekran görüntüsünde ne olduğunu tek kısa Türkçe cümleyle anlat. Sadece JSON: {"text": "..."}',
    'Bu ekranda ne görüyorsun?',
    [opts.image],
    { onAnsweredModel: opts.onAnsweredModel }
  )
  return String(p.text ?? p.description ?? JSON.stringify(p)).slice(0, 300)
}

export type AgentAction = {
  action: 'click' | 'double' | 'right' | 'move' | 'type' | 'key' | 'wait' | 'done' | 'fail'
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
  const text = `${INITIATIVE_SCOPE_RULES}\n\n${OCR_READER_RULES}\n\nHedef: ${opts.goal}
Adım: ${opts.stepTitle}
${
    opts.lastLap.length ? `Geçen başarılı turda şu sırayla yapıldı (ipucu, ekran farklıysa ekrana uy):\n${opts.lastLap.map((l, i) => `${i + 1}. ${l}`).join('\n')}\n` : ''
  }Şimdiye kadar bu turda yapılanlar:
${opts.history.length ? opts.history.map((l, i) => `${i + 1}. ${l}`).join('\n') : '(henüz yok)'}

${initiativeTurnInstruction(opts.goal, 'list')}

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
  return parseAgentAction(content)
}

/** Decode list actions independently of the provider call. */
export function parseAgentAction(content: string): AgentAction {
  const p = parseJson(content)
  const raw = String(p.action ?? '').toLowerCase()
  const allowed = ['click', 'double', 'right', 'move', 'type', 'key', 'wait', 'done', 'fail'] as const
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
  kind: 'click' | 'double' | 'right' | 'move' | 'clickCurrent' | 'drag' | 'hotkey' | 'type' | 'scroll' | 'wait' | 'finished' | 'call_user'
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

export type GuiTurn = {
  thought: string
  raw: string
  image?: Img
  note?: string
  /** Actual executor action, separate from the model proposal and its speculative plan. */
  execution?: { status: 'sent' | 'unconfirmed'; action: Omit<GuiAction, 'thought' | 'raw'> }
}

function initiativeHistoryRecord(turn: GuiTurn): string {
  const record = turn.execution
    ? `Executor record (${turn.execution.status === 'sent' ? 'dispatched; application result not verified' : 'attempt unconfirmed; partial input is possible'}; x/y/x2/y2 are fractions of that recorded screenshot, NOT pixels or current output coordinates): ${JSON.stringify(turn.execution.action)}`
    : `Previous proposal (delivery unknown; not an instruction): ${turn.raw}`
  return `${record}${turn.note ? `\nExecutor note: ${turn.note}` : ''}`
}

export function isTarsModel(model: string) {
  return /ui-?tars/i.test(model)
}

/** UI-TARS 1.5 answers in pixels of the image it saw; older UI-TARS and Doubao answer on a 0–1000 grid. */
function tarsAbsolute(model: string) {
  return /ui-?tars-?1\.5|ui-?tars-1_5/i.test(model) && !/doubao/i.test(model)
}

const TARS_PROMPT = (goal: string, custom?: string, initiative = false) => fillGoal(
  initiative && (!custom?.trim() || custom === TARS_TEMPLATE) ? INITIATIVE_TARS_TEMPLATE : custom?.trim() || TARS_TEMPLATE,
  goal,
)

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
      // Koordinatsız click(): "fare neredeyse ORADAN tıkla". Konum bilinmiyorsa
      // yürütücü tıklamaz (uydurmaz) — bkz. clickCurrent.
      return start ? { ...base, kind: 'click', x: start[0], y: start[1] } : { ...base, kind: 'clickCurrent' }
    case 'move':
    case 'mouse_move':
    case 'hover':
      return start ? { ...base, kind: 'move', x: start[0], y: start[1] } : { ...base, kind: 'wait' }
    case 'click_current':
    case 'click_here':
    case 'current_click':
      return { ...base, kind: 'clickCurrent' }
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

export function parseJsonAction(content: string): GuiAction {
  const p = parseJson(content)
  const n = (v: unknown) => {
    if (v === undefined || v === null) return undefined
    const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
    if (!Number.isFinite(x) || x < 0 || x > 1000) throw new ModelRejected('Geçersiz GUI koordinatı')
    // The JSON prompt's contract is 0–1000. Normalized custom prompts must explicitly declare their unit.
    if (p.coordinate_unit === 'normalized') {
      if (x > 1) throw new ModelRejected('Normalize GUI koordinatı 0–1 arasında olmalı')
      return x
    }
    return x / 1000
  }
  const a = String(p.action ?? '').toLowerCase()
  // İNCELEME DÜZELTMESİ: Luna'nın JSON yolu move/click_current'ı tanımıyordu ve 'wait' oluyordu.
  const kinds = ['click', 'double', 'right', 'move', 'click_current', 'clickcurrent', 'drag', 'hotkey', 'type', 'scroll', 'wait', 'finished', 'call_user'] as const
  const ham = a === 'click_current' || a === 'clickcurrent' ? 'clickCurrent' : a
  const kind = ((kinds as readonly string[]).includes(a) ? ham : a === 'done' ? 'finished' : a === 'fail' ? 'call_user' : 'wait') as GuiAction['kind']
  const keys = Array.isArray(p.keys) ? p.keys.map((k) => String(k).toLowerCase()) : typeof p.keys === 'string' ? p.keys.toLowerCase().split(/[\s+]+/) : []
  const d = String(p.direction ?? '').toLowerCase()
  const x = n(p.x), y = n(p.y), x2 = n(p.x2), y2 = n(p.y2)
  if (['click', 'double', 'right', 'drag', 'move'].includes(kind) && (x === undefined || y === undefined)) {
    throw new ModelRejected('GUI tıklama/sürükleme yanıtında başlangıç koordinatları eksik')
  }
  if (kind === 'drag' && (x2 === undefined || y2 === undefined)) {
    throw new ModelRejected('GUI sürükleme yanıtında bitiş koordinatları eksik')
  }
  return {
    thought: String(p.thought ?? p.reason ?? '').trim(),
    kind,
    x,
    y,
    x2,
    y2,
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
  initiative?: boolean
}): Promise<GuiAction> {
  const runtime = localRuntime()
  const keep = Math.max(1, opts.keepImages ?? 4)
  const recent = opts.history.slice(-keep + 1)
  const older = opts.history.slice(0, Math.max(0, opts.history.length - recent.length))
  return runModelChain(asModelChain(opts.model), async (model) => {
    if (isTarsModel(model)) {
      const messages: Message[] = [{ role: 'user', content: TARS_PROMPT(opts.goal, opts.tarsPrompt, opts.initiative) + (opts.initiative ? '\n\n' + INITIATIVE_RULES : '') }]
      for (const t of older) {
        if (opts.initiative) { messages.push({ role: 'user', content: initiativeHistoryRecord(t) }); continue }
        messages.push({ role: 'assistant', content: `Thought: ${t.thought}\nAction: ${t.raw}` })
        if (t.note) messages.push({ role: 'user', content: t.note })
      }
      for (const t of recent) {
        if (t.image) messages.push({ role: 'user', content: [imagePart(t.image)] })
        if (opts.initiative) { messages.push({ role: 'user', content: initiativeHistoryRecord(t) }); continue }
        messages.push({ role: 'assistant', content: `Thought: ${t.thought}\nAction: ${t.raw}` })
        if (t.note) messages.push({ role: 'user', content: t.note })
      }
      messages.push({ role: 'user', content: [...(opts.initiative ? [{ type: 'text', text: initiativeTurnInstruction(opts.goal, 'tars') }] : []), imagePart(opts.screen)] })
      const content = await chatOnce(opts.apiKey, model, messages, true, { json: false, runtime })
      if (!content.trim()) throw new ModelOutputRejected('boş yanıt')
      return parseTars(content, opts.screen.w, opts.screen.h, tarsAbsolute(model))
    }
    const lines = opts.history.map((t, i) => `${i + 1}. ${opts.initiative ? initiativeHistoryRecord(t) : `${t.thought ? `${t.thought} → ` : ''}${t.raw}${t.note ? ` (${t.note})` : ''}`}`)
    const text = `${opts.initiative ? INITIATIVE_RULES + '\n\n' : ''}Hedef: ${opts.goal}

Önceki adımlar:
${lines.length ? lines.join('\n') : '(henüz yok)'}

${opts.initiative ? initiativeTurnInstruction(opts.goal, 'screen') + '\n\n' : ''}Son ekran görüntüsü ektedir.`
    const messages: Message[] = [
      { role: 'system', content: opts.initiative && (!opts.jsonPrompt?.trim() || opts.jsonPrompt === SCREEN_PROMPT) ? INITIATIVE_SCREEN_PROMPT : opts.jsonPrompt?.trim() || SCREEN_PROMPT },
      { role: 'user', content: [{ type: 'text', text }, imagePart(opts.screen)] },
    ]
    const content = await chatOnce(opts.apiKey, model, messages, true, { runtime })
    if (!content.trim()) throw new ModelOutputRejected('boş yanıt')
    try { return parseJsonAction(content) }
    catch (error) {
      if (error instanceof ModelRejected) throw new ModelOutputRejected(error.message)
      throw error
    }
  })
}

export type VisualTargetResult = VisualToolCall & {
  model?: string
  reason: string
  /** Existing UI-TARS popup classification only; not accepted in computer_use replies. */
  dismiss?: boolean
}

/** A separate, strict reply contract; normal GUI/initiative parsers are untouched. */
function parseVisualReply(content: string, fields: readonly string[]): Record<string, unknown> {
  try { return visualReplyJson(content, fields) }
  catch (error) { throw new ModelOutputRejected(`VISUAL_JSON_INVALID: ${(error as Error).message}`) }
}

export function validateVisualTargetReply(content: string, model: string, screen: Img, allowDismiss: boolean): VisualTargetResult {
  if (!Number.isFinite(screen.w) || !Number.isFinite(screen.h) || screen.w <= 0 || screen.h <= 0) throw new ModelRejected('Görsel hedef görüntü boyutu geçersiz')
  let intent: unknown, reason = '', point: [number, number] | null = null
  let maxX = 1000, maxY = 1000
  if (isTarsModel(model)) {
    const tags = [...content.matchAll(/^\s*Intent:\s*(\w+)\s*$/gim)]
    if (tags.length !== 1) throw new ModelOutputRejected('Görsel hedef yanıtında tek bir Intent alanı gerekli')
    intent = tags[0][1].toLowerCase()
    reason = (content.match(/Thought:\s*([\s\S]*?)(?:\n\s*Intent:|\n\s*Action:|$)/i)?.[1] ?? '').trim()
    const actions = [...content.matchAll(/^\s*Action:\s*(.+)$/gim)]
    if (actions.length !== 1) throw new ModelOutputRejected('Görsel hedef yanıtında tek bir Action gerekli')
    const raw = actions[0][1].trim()
    if (intent === 'missing') {
      if (!/^call_user\(\s*\)$/.test(raw)) throw new ModelOutputRejected('Eksik hedef için call_user() gerekli')
    } else {
      const match = raw.match(/^click\(\s*start_box\s*=\s*(['"])([^'"\r\n]+)\1\s*\)$/)
      if (!match) throw new ModelOutputRejected('Görsel hedef yalnız tek koordinatlı click kabul eder')
      const box = match[2].replace(/<\|box_start\|>|<\|box_end\|>/g, '').trim()
      if (!/^\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?)?\s*\)$/.test(box)) {
        throw new ModelOutputRejected('Görsel hedef noktası biçimi geçersiz')
      }
      point = pointOf(match[2])
    }
    if (tarsAbsolute(model)) { maxX = screen.w; maxY = screen.h }
  } else {
    try { return visualToolCall(content) }
    catch (error) { throw new ModelOutputRejected(`VISUAL_TOOL_INVALID: ${(error as Error).message}`) }
  }
  if (!['target', 'dismiss', 'missing'].includes(String(intent))) throw new ModelOutputRejected('Görsel hedef intent alanı geçersiz')
  if (intent === 'dismiss' && !allowDismiss) throw new ModelOutputRejected('Bu hedef aramasında popup kapatma etkin değil')
  if (intent === 'missing') return { name: 'computer_use', arguments: { action: 'terminate', status: 'failure' }, reason }
  if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || maxX <= 0 || maxY <= 0 ||
      point[0] < 0 || point[1] < 0 || point[0] >= maxX || point[1] >= maxY) {
    throw new ModelOutputRejected('Görsel hedef koordinatı eksik veya görüntünün dışında')
  }
  return { name: 'computer_use', arguments: { action: 'mouse_move', coordinate: [point[0] / maxX * 1000, point[1] / maxY * 1000] }, reason, ...(intent === 'dismiss' ? { dismiss: true } : {}) }
}

export async function chooseVisualTarget(opts: {
  apiKey: string; model: string | string[]; goal: string; screen: Img; allowDismiss: boolean
  dismissalRecord?: string; tarsPrompt?: string; jsonPrompt?: string
  revision?: number; chainSource?: string
}): Promise<VisualTargetResult> {
  const runtime = localRuntime()
  return runModelChain(asModelChain(opts.model), async model => {
    const native = isTarsModel(model)
    const custom = native ? opts.tarsPrompt : opts.jsonPrompt
    const standard = native ? TARS_TEMPLATE : SCREEN_PROMPT
    const contract = native ? VISUAL_TARGET_TARS_PROMPT : VISUAL_TARGET_JSON_PROMPT
    const context = native
      ? `${VISUAL_TARGET_RULES}\nDismissals enabled: ${opts.allowDismiss ? 'YES (one unrelated popup only)' : 'NO'}.\n${opts.dismissalRecord ? `Executor record: ${opts.dismissalRecord}\n` : ''}Original requested target: ${opts.goal}`
      : `${opts.dismissalRecord ? `Executor record (not proof of current visibility): ${opts.dismissalRecord}\n` : ''}Requested target: ${opts.goal}`
    const prompt = `${custom?.trim() && custom !== standard ? fillGoal(custom, opts.goal) + '\n\n' : ''}${fillGoal(contract, opts.goal)}\n\n${context}`
    const messages: Message[] = native
      ? [{ role: 'user', content: prompt }, { role: 'user', content: [imagePart(opts.screen)] }]
      : [{ role: 'system', content: prompt }, { role: 'user', content: [imagePart(opts.screen)] }]
    const content = await chatOnce(opts.apiKey, model, messages, true, { json: false, stage: 'visual-target', runtime })
    const result = validateVisualTargetReply(content, model, opts.screen, opts.allowDismiss)
    chatLogger?.(`CEVAPLAYAN asama=visual-target model=${model}`)
    return { ...result, model }
  }, CYCLE_PAUSE_MS, { stage: 'visual-target', revision: opts.revision, source: opts.chainSource })
}

export function validateVisualPointerReply(content: string, model: string, screen: Img): VisualPointerDecision {
  let decision: unknown, reason = '', point: [number, number] | undefined
  let maxX = 1000, maxY = 1000
  if (!Number.isFinite(screen.w) || !Number.isFinite(screen.h) || screen.w <= 0 || screen.h <= 0) throw new ModelRejected('Görsel konum görüntüsü boyutları geçersiz')
  if (isTarsModel(model)) {
    const tags = [...content.matchAll(/^\s*Decision:\s*(\w+)\s*$/gim)]
    const actions = [...content.matchAll(/^\s*Action:\s*(.+)$/gim)]
    if (tags.length !== 1 || actions.length !== 1) throw new ModelOutputRejected('Görsel konum yanıtında tek Decision ve Action gerekli')
    decision = tags[0][1].toLowerCase()
    reason = (content.match(/Thought:\s*([\s\S]*?)(?:\n\s*Decision:|\n\s*Action:|$)/i)?.[1] ?? '').trim()
    const raw = actions[0][1].trim()
    if (decision === 'confirm' && !/^click_current\(\s*\)$/.test(raw) || decision === 'uncertain' && !/^call_user\(\s*\)$/.test(raw)) throw new ModelOutputRejected('Görsel konum kararı ile Action uyuşmuyor')
    if (decision === 'adjust') {
      const match = raw.match(/^move\(\s*start_box\s*=\s*(['"])([^'"\r\n]+)\1\s*\)$/)
      const box = match?.[2].replace(/<\|box_start\|>|<\|box_end\|>/g, '').trim()
      if (!box || !/^\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)$/.test(box)) throw new ModelOutputRejected('Görsel konum düzeltmesi yalnız tek move noktası kabul eder')
      point = pointOf(box) ?? undefined
    }
    if (tarsAbsolute(model)) { maxX = screen.w; maxY = screen.h }
  } else {
    const p = parseVisualReply(content, ['decision', 'x', 'y', 'reason'])
    decision = p.decision; reason = String(p.reason ?? '').trim()
    if (Object.prototype.hasOwnProperty.call(p, 'action') || Object.prototype.hasOwnProperty.call(p, 'mode')) throw new ModelOutputRejected('Görsel konum yanıtı eylem veya tıklama modu seçemez')
    if (decision !== 'adjust' && (p.x !== undefined || p.y !== undefined)) throw new ModelOutputRejected('Konum onayı yeni koordinat taşıyamaz')
    if (decision === 'adjust' && typeof p.x === 'number' && typeof p.y === 'number') point = [p.x, p.y]
  }
  if (decision === 'confirm' || decision === 'uncertain') return { decision, reason }
  if (decision !== 'adjust' || !point || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || point[0] < 0 || point[1] < 0 || point[0] >= maxX || point[1] >= maxY) throw new ModelOutputRejected('Görsel konum kararı veya düzeltme noktası geçersiz')
  return { decision, x: point[0] / maxX, y: point[1] / maxY, reason }
}

/** Always image-bearing; a text-only fallback can never authorize a visual pointer. */
export async function verifyVisualPointer(opts: {
  apiKey: string; model: string | string[]; goal: string; screen: Img
  area: ScanResult['area']; pointer: { x: number; y: number }; system?: string; nodeId?: string
  revision?: number; chainSource?: string
}): Promise<VisualPointerDecision & { model?: string }> {
  if (!opts.screen.data) throw new ModelRejected('Görsel konum doğrulaması için yeni görüntü yok')
  const runtime = localRuntime()
  return runModelChain(asModelChain(opts.model), async model => {
    const native = isTarsModel(model), absolute = native && tarsAbsolute(model)
    const px = (opts.pointer.x - opts.area.x) / opts.area.w, py = (opts.pointer.y - opts.area.y) / opts.area.h
    const cursor = `Actual red-crosshair center: (${(px * (absolute ? opts.screen.w : 1000)).toFixed(2)}, ${(py * (absolute ? opts.screen.h : 1000)).toFixed(2)}), ${absolute ? 'image pixels' : '0-1000 screenshot grid'}.`
    const system = `${opts.system?.trim() || VISUAL_POINTER_PROMPT}\n\n${native ? VISUAL_POINTER_TARS_CONTRACT : VISUAL_POINTER_JSON_CONTRACT}`
    const instruction = `Requested target: ${opts.goal}\n${cursor}\nOnly the pointer was moved. NO target click has been sent. Judge the current image independently.`
    const messages: Message[] = [
      { role: native ? 'user' : 'system', content: system },
      { role: 'user', content: [{ type: 'text', text: instruction }, imagePart(opts.screen)] },
    ]
    const id = nextRequestId(), image = imageFromMessages(messages, opts.screen.mime)
    if (!image) throw new ModelRejected('Görsel konum isteğinin görüntü baytları okunamadı')
    const summary = sendSummaryText({ id, node: opts.nodeId, stage: 'visual-pointer-check', model, revision: opts.revision, source: opts.chainSource, chain: asModelChain(opts.model).join(' > '), target: isLocalName(model) ? 'local' : 'api', image: { sent: true, w: opts.screen.w, h: opts.screen.h, bytes: image.buffer.length, mime: image.mime, marked: false }, candidates: { built: 0, sent: 0 }, promptChars: system.length + instruction.length })
    chatLogger?.(summary); saveRequestEvidence(id, { summary, system, instruction, image })
    try {
      const content = await chatOnce(opts.apiKey, model, messages, true, { json: !native, stage: 'visual-pointer-check', runtime })
      saveRequestEvidence(id, { response: content })
      const result = validateVisualPointerReply(content, model, opts.screen)
      chatLogger?.(`CEVAPLAYAN asama=visual-pointer-check model=${model}`)
      chatLogger?.(`YANIT id=${id} | karar=${result.decision} | imlec=${opts.pointer.x},${opts.pointer.y} | neden=${result.reason.replace(/\s+/g, ' ').slice(0, 180)}`)
      return { ...result, model }
    } catch (e) {
      chatLogger?.(`YANIT id=${id} | karar=reddedildi | neden=${brief(e)}`)
      throw e
    }
  }, CYCLE_PAUSE_MS, { stage: 'visual-pointer-check', revision: opts.revision, source: opts.chainSource })
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
  revision?: number
  chainSource?: string
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
  const content = await chat(opts.apiKey, opts.model, messages, !!opts.image?.data, { stage: 'stall', revision: opts.revision, source: opts.chainSource })
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

export async function listModels(): Promise<{ id: string; vision: boolean; pricing?: { promptPerM: number; completionPerM: number } }[]> {
  chatLogger?.('API → GET /api/v1/models')
  const res = await guardedFetch('https://openrouter.ai/api/v1/models', {}, 30000)
  if (!res.ok) {
    chatLogger?.(`API ← hata ${res.status}`)
    throw new Error(`Model listesi alınamadı (${res.status}).`)
  }
  const data = JSON.parse(res.text) as { data?: { id: string; architecture?: { input_modalities?: string[] }; pricing?: { prompt?: string; completion?: string } }[] }
  const list = (data.data ?? [])
    .map((m) => {
      // OpenRouter prices are USD per token as strings; the panel shows per million. Unknown stays unknown.
      const promptPerM = Number(m.pricing?.prompt) * 1_000_000
      const completionPerM = Number(m.pricing?.completion) * 1_000_000
      const known = Number.isFinite(promptPerM) && Number.isFinite(completionPerM) && (promptPerM > 0 || completionPerM > 0)
      return { id: m.id, vision: !!m.architecture?.input_modalities?.includes('image'), ...(known ? { pricing: { promptPerM, completionPerM } } : {}) }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
  chatLogger?.(`API ← ${list.length} model`)
  return list
}
