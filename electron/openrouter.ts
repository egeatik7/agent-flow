import { spawnSync } from 'node:child_process'
import { sendSummaryText, responseSummaryText, saveRequestEvidence, imageBytes, imageFromMessages, nextRequestId, countSentCandidates } from './send-log'
import { checkObservation } from './observation-budget'
import { spatialContext } from './spatial-context'
import { wordCandidates, describeWordCandidates, WORD_TARGET_RULES, OCR_READER_RULES, CONDITION_TARGET_RULES, WORD_CANDIDATE_LIMIT } from './word-targets'
import type { NodeKind } from './graph-types'
import { fillGoal, INITIATIVE_PROMPT, INITIATIVE_RULES, INITIATIVE_SCOPE_RULES, INITIATIVE_TARS_TEMPLATE, INITIATIVE_SCREEN_PROMPT, VISUAL_TARGET_RULES, VISUAL_TARGET_TARS_PROMPT, VISUAL_TARGET_JSON_PROMPT, WORD_CHOICE_PROMPT, LIST_PROMPT, REACTION_PROMPT, SCREEN_PROMPT, STALL_PROMPT, TARS_TEMPLATE, listPromptFor, initiativeTurnInstruction } from './llm-flow'
import { describeItems, type ScanResult } from './matcher'
import { StoppedError } from './runner'

/** A model request that has not answered by then is abandoned (and retried once). */
const REQUEST_TIMEOUT_MS = 90000

let stopCheck: () => boolean = () => false

/** Lets Ctrl+Shift+Q cut a pending model request instead of waiting for it. */
export function setStopCheck(fn: () => boolean) {
  stopCheck = fn
}

class TransientError extends Error { readonly serviceFailure = true }

/** fetch + body read, with a time limit and the stop hotkey. */
async function guardedFetch(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS, localStop: () => boolean = () => false, signal?: AbortSignal): Promise<{ ok: boolean; status: number; text: string }> {
  checkObservation(signal)
  if (stopCheck() || localStop()) throw new StoppedError()
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
export async function recoveryToolTurn(args: {
  allowLocal?: boolean
  apiKey: string
  models: string[]
  messages: ToolMessage[]
  tools: ModelTool[]
  shouldStop: () => boolean
  timeoutMs: number
}): Promise<ToolMessage> {
  const deadline = Date.now() + args.timeoutMs
  let last: unknown = new Error('Kurtarma modeli belirtilmedi.')
  for (const model of asModelChain(args.models)) {
    if (args.shouldStop() || stopCheck()) throw new StoppedError()
    if (Date.now() >= deadline) throw new Error('Kurtarma modelinin süresi doldu.')
    try {
      const target = args.allowLocal ? targetFor(model) : { url: 'https://openrouter.ai/api/v1/chat/completions', model, local: false }
      chatLogger?.(`Kurtarma ${targetTag(target.local)} → ${target.model} · ${args.messages.length} mesaj · ${args.tools.length} araç`)
      if (!target.local && !args.apiKey.trim()) throw new ModelRejected('OpenRouter API anahtarı yok; model atlandı.')
      if (target.local && args.messages.some(m => Array.isArray(m.content)) && !localVision) throw new ImageUnsupportedError('Yerel model için görüntü desteği kapalı.')
      const res = await guardedFetch(target.url, {
        method: 'POST', headers: target.local ? { 'Content-Type': 'application/json' } : HEADERS(args.apiKey),
        body: JSON.stringify({ model: target.model, messages: args.messages, tools: args.tools, tool_choice: 'auto', parallel_tool_calls: false, usage: { include: true } }),
      }, Math.min(REQUEST_TIMEOUT_MS, Math.max(1, deadline - Date.now())), args.shouldStop)
      if (args.shouldStop() || stopCheck()) throw new StoppedError()
      if (!res.ok) {
        if (res.status === 401 || res.status === 402) throw new FatalApiError(`OpenRouter kurtarma çağrısı (${res.status}): ${res.status === 401 ? 'API anahtarı geçersiz' : 'bakiye yetersiz'}.`)
        throw new Error(`OpenRouter kurtarma çağrısı (${res.status}): ${res.text.slice(0, 300)}`)
      }
      const data = JSON.parse(res.text)
      if (data.error) throw new ModelRejected(`OpenRouter: ${providerError(data.error).slice(0, 300)}`)
      const choice = data.choices?.[0]
      if (!choice?.message || choice.finish_reason === 'length') throw new Error('Kurtarma modelinin yanıtı boş veya kesilmiş.')
      const m = choice.message
      if (m.tool_calls !== undefined && (!Array.isArray(m.tool_calls) || m.tool_calls.some((c: ModelToolCall) =>
        !c || typeof c.id !== 'string' || !c.id || c.type !== 'function' || typeof c.function?.name !== 'string' || typeof c.function?.arguments !== 'string'))) {
        throw new Error('Kurtarma modeli geçersiz araç çağrısı verdi.')
      }
      reportIn(target.local, JSON.stringify({ content: m.content, tool_calls: m.tool_calls, usage: data.usage }))
      const billed = data.usage && typeof data.usage === 'object' ? { prompt_tokens: data.usage.prompt_tokens, completion_tokens: data.usage.completion_tokens, total_tokens: data.usage.total_tokens, cost: typeof data.usage.cost === 'number' ? data.usage.cost : undefined } : undefined
      const answered = typeof data.model === 'string' && data.model ? data.model : model
      chatLogger?.(`Kurtarma ${targetTag(target.local)} ← ${answered}${billed?.total_tokens ? ` · ${billed.total_tokens} token` : ''}${typeof billed?.cost === 'number' ? ` · $${billed.cost.toFixed(4)}` : ''}`)
      return { role: 'assistant', content: m.content == null ? null : responseText(m.content),
        ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}),
        ...(m.reasoning_details ? { reasoning_details: m.reasoning_details } : {}),
        model: answered,
        ...(billed && (billed.total_tokens || typeof billed.cost === 'number') ? { usage: billed } : {}) }
    } catch (error) {
      if (error instanceof StoppedError || error instanceof FatalApiError) throw error
      last = error
      chatLogger?.(`Kurtarma modeli ${model} yanıtlayamadı: ${brief(error)}`)
    }
  }
  throw last
}

async function stoppableWait(ms: number) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (stopCheck()) throw new StoppedError()
    await new Promise((r) => setTimeout(r, 200))
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
function targetFor(model: string): { url: string; model: string; local: boolean } {
  const openRouter = 'https://openrouter.ai/api/v1/chat/completions'
  if (!/^local:/i.test(model)) return { url: openRouter, model, local: false }
  // "Şimdilik OpenRouter'a dön" açıkken veya adres boşken yerel satır ATLANIR; zincir sıradakine geçer.
  if (localOff || !localBase) throw new ModelRejected('Yerel model kapalı; satır atlandı (adres boş ya da "OpenRouter\'a dön" açık).')
  try {
    const url = new URL(localBase)
    if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash || url.username || url.password) throw new Error('invalid')
  } catch { throw new ModelRejected('Yerel sunucu adresi geçersiz. http:// veya https:// ile başlayan taban adresi yaz.') }
  const name = model.replace(/^local:/i, '').trim()
  if (!name) throw new ModelRejected('Yerel model adı boş.')
  return { url: `${localBase}/chat/completions`, model: name, local: true }
}
/**
 * Yerel adres bir Ollama sunucusu mu. Ollama'nın OpenAI uyumlu ucu düşünmeyi YALNIZCA
 * `reasoning_effort: "none"` alanıyla kapatıyor (11 Ekim 2026 ölçümü, qwen3.5:9b:
 * 9995 ms / 289 karakter düşünme -> 151 ms / 0 karakter). Modelfile'da `think`/`thinking`
 * parametresi reddediliyor ve `/no_think` işe yaramıyor; bu yüzden alanı istek gövdesine
 * biz ekliyoruz. Başka yerel sunucular bilinmeyen alanı reddedebildiği için yalnız
 * Ollama adreslerine gönderilir; diğer yerel adreslerde gövde eskisi gibi kalır.
 */
function localNeedsNoThinking(): boolean {
  try {
    const u = new URL(localBase)
    return u.port === '11434' || /ollama/i.test(u.hostname) || /ollama/i.test(u.pathname)
  } catch { return false }
}

/**
 * Yerel istekte gönderilecek `reasoning_effort` değeri; null = alan hiç gönderilmez.
 * Kullanıcı Yerel Model sekmesinden bir seviye seçtiyse o gönderilir (her yerel sunucuya).
 * Seçim yoksa (otomatik) yalnız Ollama adreslerinde kapatılır; başka yerel sunucular
 * bilinmeyen alanı reddedebildiği için gövde eskisi gibi kalır.
 */
function localReasoningEffort(): string | null {
  if (localThink) return localThink
  return localNeedsNoThinking() ? 'none' : null
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
 * Stops when the user stops, the key / balance is rejected, or every model was rejected for good
 * in MAX_REJECTED_CYCLES rounds in a row. Outages, timeouts and rate limits retry within the total cycle/time bound.
 */
export async function runModelChain<T>(models: string[], run: (model: string) => Promise<T>, pauseMs = CYCLE_PAUSE_MS, limits: { maxCycles?: number; maxWaitMs?: number; signal?: AbortSignal } = {}): Promise<T> {
  const chain = asModelChain(models)
  if (!chain.length) throw new Error('Model adı yok. Ayarlar’dan bir model yaz.')
  let rejectedCycles = 0
  const maxCycles = Math.max(1, limits.maxCycles ?? 256)
  const deadline = Date.now() + Math.max(1, limits.maxWaitMs ?? 15 * 60_000)
  let cycles = 0
  for (;;) {
    let allRejected = true
    let lastError = ''
    for (let i = 0; i < chain.length; i++) {
      checkObservation(limits.signal)
      if (stopCheck()) throw new StoppedError()
      if (Date.now() >= deadline) throw new ModelFailed('Model deneme süresi doldu (15 dakika varsayılan sınır).')
      const model = chain[i]
      try {
        return await run(model)
      } catch (e) {
        checkObservation(limits.signal)
        if (e instanceof StoppedError || e instanceof FatalApiError) throw e
        if (!(e instanceof ModelRejected)) allRejected = false
        lastError = brief(e)
        const last = i === chain.length - 1
        const next = chain[(i + 1) % chain.length]
        chatLogger?.(last ? `${targetTag(isLocalName(model))} ${model} olmadı (${brief(e)}). ${cycles + 1 >= maxCycles ? 'Deneme zinciri bitti.' : 'Sıra başa dönüyor.'}` : `${targetTag(isLocalName(model))} ${model} olmadı (${brief(e)}). ${next} deneniyor.`)
      }
    }
    rejectedCycles = allRejected ? rejectedCycles + 1 : 0
    if (rejectedCycles >= MAX_REJECTED_CYCLES) {
      throw new Error(`Hiçbir model cevap vermedi: ${rejectedCycles} tur üst üste reddedildi (model adını ve ayarları kontrol et). Son hata: ${lastError}`)
    }
    if (++cycles >= maxCycles || Date.now() >= deadline) throw new ModelFailed(`Model deneme sınırı doldu (${cycles} tur). Son hata: ${lastError}`)
    chatLogger?.(`Modellerin hepsi susuyor. ${Math.round(pauseMs / 1000)} sn sonra ${chain[0]} yeniden denenecek.`)
    await stoppableWait(Math.min(pauseMs, Math.max(0, deadline - Date.now())))
  }
}

export function responseText(content: unknown): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(part => {
    if (part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') return part.text
    throw new ModelRejected('Model yanıtında desteklenmeyen içerik parçası var.')
  }).join('\n')
  throw new ModelRejected('Model yanıtının içerik biçimi geçersiz.')
}
function providerError(error: unknown): string {
  if (typeof error === 'string') return redact(error)
  if (error && typeof error === 'object') return redact(String((error as { message?: unknown }).message ?? 'Yanıt hatası'))
  return ''
}
function permanentFailure(status: number, text: string): boolean {
  return [400, 403, 404, 405, 413, 415, 422, 431].includes(status) || /invalid[_ ]request|invalid parameter|out of memory|not enough (?:gpu |vram |system )?memory|failed to allocate|context (?:length|window).*(?:exceed|limit)|invalid base64/i.test(text)
}

/** One request to one model. No second try here; the chain does that. */
async function chatOnce(
  apiKey: string,
  model: string,
  messages: Message[],
  hasImage: boolean,
  opts: { json?: boolean; signal?: AbortSignal; reasoningOff?: boolean } = {}
): Promise<string> {
  const once = async (json: boolean) => {
    checkObservation(opts.signal)
    const target = targetFor(model)
    if (!target.local) validateApiKey(apiKey)
    // Anahtar yoksa OpenRouter satırı atlanır; zincir varsa yerel satıra geçer (1.9.81).
    if (!target.local && !String(apiKey ?? '').trim()) throw new ModelRejected('OpenRouter anahtarı yok; satır atlandı.')
    if (target.local && hasImage && !localVision) throw new ImageUnsupportedError('Yerel model için görüntü desteği kapalı.')
    const where = target.local ? 'Yerel sunucu' : 'OpenRouter'
    // Düşünme tercihi tek yerde çözülür: sekmede seçilen seviye ya da otomatik (Ollama'da kapalı).
    const effort = target.local ? opts.reasoningOff ? 'none' : localReasoningEffort() : null
    reportOut(target.model, target.local, messages)
    const res = await guardedFetch(target.url, {
      method: 'POST',
      headers: target.local ? { 'Content-Type': 'application/json' } : HEADERS(apiKey),
      body: JSON.stringify({
        model: target.model,
        temperature: 0,
        // Ollama'da düşünme varsayılan açık; kapatılmazsa model cevabı beklerken tokenı
        // düşünmeye harcıyor (ölçüldü: 1,4-10 sn ve boş cevap; kapalıyken 0,1 sn).
        ...(effort ? { reasoning_effort: effort } : {}),
        ...(!target.local && opts.reasoningOff ? { reasoning: { enabled: false } } : {}),
        // Leave output/reasoning token limits to the provider's model defaults.
        messages,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    }, target.local ? localTimeoutMs : REQUEST_TIMEOUT_MS, () => false, opts.signal)
    checkObservation(opts.signal)
    if (!res.ok) {
      reportIn(target.local, `hata ${res.status}: ${res.text.slice(0, 2000)}`)
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
    if (data.error) {
      const msg = providerError(data.error)
      reportIn(target.local, `hata: ${msg}`)
      if (!target.local && /invalid api key|unauthorized/i.test(msg)) throw new FatalApiError(`OpenRouter: ${msg}`)
      if (!target.local && /insufficient credits|payment required|402/i.test(msg)) throw new FatalApiError(`OpenRouter: ${msg}`)
      throw permanentFailure(0, msg) ? new ModelRejected(`${where}: ${msg.slice(0, 200)}`) : new ModelFailed(`${where}: ${msg.slice(0, 200)}`)
    }
    const content = responseText(data.choices?.[0]?.message?.content)
    reportIn(target.local, content)
    if (data.choices?.[0]?.finish_reason === 'length') throw new ModelRejected('MODEL_OUTPUT_TRUNCATED: Yanıt token sınırında kesildi; hedef yok sayılmadı')
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
  opts: { json?: boolean; validate?: (text: string) => void; signal?: AbortSignal; maxCycles?: number; reasoningOff?: boolean } = {},
  /** Same request with the picture removed, used when this model cannot see images. */
  withoutImage?: Message[]
): Promise<string> {
  return runModelChain(asModelChain(model), async (name) => {
    checkObservation(opts.signal)
    try {
      const text = await chatOnce(apiKey, name, messages, hasImage, opts)
      if (!text.trim()) throw new ModelRejected('boş yanıt')
      opts.validate?.(text)
      return text
    } catch (e) {
      if (!(e instanceof ImageUnsupportedError)) throw e
      if (!withoutImage) throw new ModelRejected(`${name} ekran görüntüsü kabul etmiyor.`)
      chatLogger?.(`${name} görüntü kabul etmiyor, yazı listesiyle deneniyor.`)
      const text = await chatOnce(apiKey, name, withoutImage, false, opts)
      if (!text.trim()) throw new ModelRejected('boş yanıt')
      opts.validate?.(text)
      return text
    }
  }, CYCLE_PAUSE_MS, { signal: opts.signal, maxCycles: opts.maxCycles })
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

export type ScreenChoice = { satisfied?: boolean; id: number | null; text?: string; reason: string; usedImage: boolean; wordIndex?: number; candidateId?: number; /** Modelin döndürdüğü ham numara ve çözülemediyse sebebi: günlükte dürüst rapor için (1.9.110). */ rawId?: number; rejected?: 'absent' | 'not-selectable' | 'not-listed'; /** Numara aday listesinde yoktu ama GERÇEKTEN gönderilen marked görüntünün rozetinden çözüldü (1.9.116): ajan bu satırı kısa ikinci kelime seçimine sokar. */ badgeResolved?: boolean }

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
      id: istekId, node: opts.stepTitle, stage: String(opts.kind), model: Array.isArray(opts.model) ? opts.model.join(',') : opts.model,
      target: isLocalName(ilk) ? 'local' : 'api',
      image: resim
        ? { sent: true, w: scan.image?.w, h: scan.image?.h, bytes: resim.buffer.length, mime: resim.mime, marked: (scan.image as { marked?: boolean } | null | undefined)?.marked === true }
        : { sent: false, reason: !opts.sendImage ? 'ayar kapalı: numaralı ekran görüntüsü gönder' : scan.image ? 'görüntü nesnesi var ama istek gövdesine image_url eklenmedi' : 'tarama görüntüsü boş (kare alınamadı)' },
      fallbackNoImage: goruntusuzDonus,
      candidates: { built: candidates.length, sent: countSentCandidates(listText) },
      promptChars: listText.length,
    })
    chatLogger?.(ozet)
    saveRequestEvidence(istekId, { summary: ozet, system, instruction: opts.prompt, candidates: listText, image: resim ?? undefined })
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

  let content: string
  let usedImage = withImage
  // Özet gövdeden ÖNCE yazılır; `build` artık tanımlı olduğu için görüntü GERÇEK istekten okunur (1.9.115).
  gonderimOzeti(false)
  try {
    content = await chat(opts.apiKey, opts.model, build(withImage), withImage, { validate: opts.kind === 'condition' ? validateConditionReply : validateTargetReply, signal: opts.signal, maxCycles: opts.kind === 'condition' ? 1 : undefined }, withImage ? build(false) : undefined)
  } catch (e) {
    if (!(e instanceof ImageUnsupportedError)) throw e
    opts.onImageFallback?.('Seçili model ekran görüntüsünü desteklemiyor, sadece yazı listesiyle deneniyor.')
    usedImage = false
    gonderimOzeti(true)
    content = await chat(opts.apiKey, opts.model, build(false), false, { validate: opts.kind === 'condition' ? validateConditionReply : validateTargetReply, signal: opts.signal, maxCycles: opts.kind === 'condition' ? 1 : undefined })
  }

  const decoded = parseJson(content)
  const parsed = decoded && typeof decoded === 'object' && !Array.isArray(decoded) ? decoded : {}
  const raw = parsed.id ?? parsed.i ?? parsed.index
  const id = (typeof raw !== 'number' && typeof raw !== 'string') || raw === '' ? null : Number(String(raw).replace(/^#/, ''))
  const selected = id !== null && Number.isInteger(id) ? candidates.find(c => c.item.id === id && (!c.contextOnly || opts.kind === 'condition')) : undefined
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
  const aday = id !== null && Number.isInteger(id) ? candidates.find(c => c.item.id === id) : undefined
  const rejected = id === null || selected || rozet ? undefined : !aday ? 'absent' as const : aday.contextOnly ? 'not-selectable' as const : 'not-listed' as const
  // YANIT KANITI (1.9.113): ham cevap, dönen id, listede var mı, seçilebilir mi, red sebebi ve çözülen öğe.
  const gonderilenMi = id !== null && Number.isInteger(id) ? new RegExp(`^#${id}\\s`, 'm').test(listText) : false
  if (rozet) chatLogger?.(`GORUNTU-ROZETI id=${istekId} | donen-id=${id} listede YOK ama marked goruntude #${rozet.id} “${rozet.text.slice(0, 60)}” | cok-kelimeli=${(rozet.words?.length ?? 0) > 1 ? (opts.kind === 'click' ? 'evet (kisa ikinci kelime secimine gidiyor)' : 'evet (tikla disi tur: kelime secimi yok)') : 'hayir (kendi kutusuna)'}`)
  chatLogger?.(responseSummaryText({
    id: istekId, raw: content, returnedId: id ?? null, inSentList: gonderilenMi, selectable: !!(selected || rozet), rejected,
    resolvedItem: selected ? `${selected.item.src}/${selected.item.type} "${selected.item.text.slice(0, 60)}"` : rozet ? `${rozet.src}/${rozet.type} "${rozet.text.slice(0, 60)}" (görüntü rozeti #${rozet.id})` : undefined,
    resolvedWord: selected?.wordIndex !== undefined ? `#${selected.item.id} w${selected.wordIndex}` : undefined,
    targetText: (selected?.item ?? rozet)?.text.slice(0, 80),
  }))
  saveRequestEvidence(istekId, { response: content })
  return {
    ...(opts.kind === 'condition' ? { satisfied: parsed.satisfied === true && (parsed.id === null || !!selected) } : {}),
    id: selected?.parentId ?? rozet?.id ?? null,
    ...(rejected ? { rejected, rawId: id ?? undefined } : {}),
    ...(rozet ? { badgeResolved: true } : {}),
    ...(selected?.wordIndex !== undefined ? { wordIndex: selected.wordIndex, candidateId: selected.item.id } : {}),
    text: selected?.wordIndex !== undefined ? selected.item.text : typeof parsed.text === 'string' ? parsed.text : undefined,
    reason: String(parsed.reason ?? ''),
    usedImage,
  }
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
}): Promise<{ wordIndex: number; candidateId: number; text: string } | null> {
  const candidates = wordCandidates(opts.scan).filter(c => c.parentId === opts.parentId && c.wordIndex !== undefined)
  if (candidates.length < 2) throw new Error('Kelime seçimi için en az iki gerçek kelime kutusu gerekli.')
  const list = candidates.map(c => `#${c.item.id} ${JSON.stringify(c.item.text)}`).join('\n')
  const user = `Instruction: ${opts.prompt}\nWords:\n${list}`
  const system = opts.system?.trim() || WORD_CHOICE_PROMPT
  const id = nextRequestId()
  const validate = (content: string) => {
    const parsed = parseJson(content)
    if (!Object.prototype.hasOwnProperty.call(parsed, 'id') || !(parsed.id === null || typeof parsed.id === 'number' && Number.isInteger(parsed.id) && candidates.some(c => c.item.id === parsed.id))) {
      throw new ModelRejected('WORD_CHOICE_INVALID: Bu kısa istekteki bir kelime ID’si veya null gerekli.')
    }
  }
  const summary = sendSummaryText({ id, node: opts.nodeId, stage: 'ocr-word-choice',
    model: asModelChain(opts.model).join(' → '), target: isLocalName(asModelChain(opts.model)[0]) ? 'local' : 'api',
    image: { sent: false, reason: 'kısa kelime seçimi: yalnız talimat ve kelimeler' },
    candidates: { built: candidates.length, sent: candidates.length }, promptChars: user.length })
  chatLogger?.(summary)
  saveRequestEvidence(id, { summary, system, instruction: opts.prompt, candidates: list })
  const content = await chat(opts.apiKey, opts.model, [{ role: 'system', content: system }, { role: 'user', content: user }], false,
    { validate, maxCycles: 1, reasoningOff: true })
  const parsed = parseJson(content)
  const picked = candidates.find(c => c.item.id === parsed.id)
  chatLogger?.(responseSummaryText({ id, raw: content, returnedId: parsed.id as number | null,
    inSentList: !!picked, selectable: !!picked, rejected: picked ? undefined : 'model belirsiz: null',
    resolvedWord: picked ? `#${picked.item.id} w${picked.wordIndex}` : undefined, targetText: picked?.item.text }))
  saveRequestEvidence(id, { response: content })
  return picked ? { wordIndex: picked.wordIndex!, candidateId: picked.item.id, text: picked.item.text } : null
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
      const content = await chatOnce(opts.apiKey, model, messages, true, { json: false })
      if (!content.trim()) throw new ModelRejected('boş yanıt')
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
    const content = await chatOnce(opts.apiKey, model, messages, true)
    if (!content.trim()) throw new ModelRejected('boş yanıt')
    return parseJsonAction(content)
  })
}

export type VisualTargetResult = {
  intent: 'target' | 'dismiss' | 'missing'
  x?: number
  y?: number
  reason: string
}

/** A separate, strict reply contract; normal GUI/initiative parsers are untouched. */
export function validateVisualTargetReply(content: string, model: string, screen: Img, allowDismiss: boolean): VisualTargetResult {
  if (!Number.isFinite(screen.w) || !Number.isFinite(screen.h) || screen.w <= 0 || screen.h <= 0) throw new ModelRejected('Görsel hedef görüntü boyutu geçersiz')
  let intent: unknown, reason = '', point: [number, number] | null = null
  let maxX = 1000, maxY = 1000
  if (isTarsModel(model)) {
    const tags = [...content.matchAll(/^\s*Intent:\s*(\w+)\s*$/gim)]
    if (tags.length !== 1) throw new ModelRejected('Görsel hedef yanıtında tek bir Intent alanı gerekli')
    intent = tags[0][1].toLowerCase()
    reason = (content.match(/Thought:\s*([\s\S]*?)(?:\n\s*Intent:|\n\s*Action:|$)/i)?.[1] ?? '').trim()
    const actions = [...content.matchAll(/^\s*Action:\s*(.+)$/gim)]
    if (actions.length !== 1) throw new ModelRejected('Görsel hedef yanıtında tek bir Action gerekli')
    const raw = actions[0][1].trim()
    if (intent === 'missing') {
      if (!/^call_user\(\s*\)$/.test(raw)) throw new ModelRejected('Eksik hedef için call_user() gerekli')
    } else {
      const match = raw.match(/^click\(\s*start_box\s*=\s*(['"])([^'"\r\n]+)\1\s*\)$/)
      if (!match) throw new ModelRejected('Görsel hedef yalnız tek koordinatlı click kabul eder')
      const box = match[2].replace(/<\|box_start\|>|<\|box_end\|>/g, '').trim()
      if (!/^\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?)?\s*\)$/.test(box)) {
        throw new ModelRejected('Görsel hedef noktası biçimi geçersiz')
      }
      point = pointOf(match[2])
    }
    if (tarsAbsolute(model)) { maxX = screen.w; maxY = screen.h }
  } else {
    const p = parseJson(content)
    intent = p.intent
    reason = String(p.reason ?? '').trim()
    if (p.action != null) throw new ModelRejected('Görsel hedef JSON yanıtı eylem değil intent taşımalı')
    if (intent !== 'missing' && typeof p.x === 'number' && typeof p.y === 'number') point = [p.x, p.y]
    if (intent === 'missing' && (p.x != null || p.y != null)) throw new ModelRejected('Eksik hedef koordinat taşıyamaz')
  }
  if (!['target', 'dismiss', 'missing'].includes(String(intent))) throw new ModelRejected('Görsel hedef intent alanı geçersiz')
  if (intent === 'dismiss' && !allowDismiss) throw new ModelRejected('Bu hedef aramasında popup kapatma etkin değil')
  if (intent === 'missing') return { intent, reason }
  if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || maxX <= 0 || maxY <= 0 ||
      point[0] < 0 || point[1] < 0 || point[0] >= maxX || point[1] >= maxY) {
    throw new ModelRejected('Görsel hedef koordinatı eksik veya görüntünün dışında')
  }
  return { intent: intent as 'target' | 'dismiss', x: point[0] / maxX, y: point[1] / maxY, reason }
}

export async function chooseVisualTarget(opts: {
  apiKey: string; model: string | string[]; goal: string; screen: Img; allowDismiss: boolean
  dismissalRecord?: string; tarsPrompt?: string; jsonPrompt?: string
}): Promise<VisualTargetResult> {
  const context = `${VISUAL_TARGET_RULES}\nDismissals enabled: ${opts.allowDismiss ? 'YES (one unrelated popup only)' : 'NO'}.\n${opts.dismissalRecord ? `Executor record: ${opts.dismissalRecord}\n` : ''}Original requested target: ${opts.goal}`
  return runModelChain(asModelChain(opts.model), async model => {
    const native = isTarsModel(model)
    const custom = native ? opts.tarsPrompt : opts.jsonPrompt
    const standard = native ? TARS_TEMPLATE : SCREEN_PROMPT
    const contract = native ? VISUAL_TARGET_TARS_PROMPT : VISUAL_TARGET_JSON_PROMPT
    const prompt = `${custom?.trim() && custom !== standard ? fillGoal(custom, opts.goal) + '\n\n' : ''}${fillGoal(contract, opts.goal)}\n\n${context}`
    const messages: Message[] = native
      ? [{ role: 'user', content: prompt }, { role: 'user', content: [imagePart(opts.screen)] }]
      : [{ role: 'system', content: prompt }, { role: 'user', content: [imagePart(opts.screen)] }]
    const content = await chatOnce(opts.apiKey, model, messages, true, { json: !native })
    return validateVisualTargetReply(content, model, opts.screen, opts.allowDismiss)
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
