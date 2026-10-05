import { screen as electronScreen } from 'electron'
import fs from 'fs'
import path from 'path'
import * as bridge from './a11y-bridge'
import * as browser from './browser'
import { conditionNeedle, describeAhead, expectation, judgeScreen, type Verdict } from './confirm'
import { NODE_SPECS, modelChain, renderTemplate, type AgentNode, type AppSettings, type LogLevel, type PathStep, type TargetMemo } from './graph-types'
import {
  containsText,
  containsTextStrict,
  describeItems,
  extractTarget,
  matchFuzzy,
  matchPrompt,
  matchText,
  norm,
  refineTarget,
  sampleTexts,
  type ScanResult,
  type ScreenItem,
  type Target,
} from './matcher'
import { activeFindOrder, promptOf } from './llm-flow'
import { conflict, describeMemory, likeness, memoOf, remember } from './memory'
import {
  chooseScreenTarget,
  guiStep,
  isTarsModel,
  judgeReaction,
  nextAction,
  type GuiAction,
  type GuiTurn,
  chooseTypeField,
  planStall,
  visionCheck,
  type ReactionVerdict,
} from './openrouter'
import { interruptibleSleep, StoppedError, type Executor, type StepAhead } from './runner'
import { inside, movedPoint, focusAt, repeatedClick, clickFeedback, type InputGuard, type InputWindow, type Point } from './input-policy'
import { rememberShot } from './shots'
import type { TargetTrace, TargetTraceData, TargetRect } from './target-trace'
import type { FindStageId } from './llm-flow'

export type AgentContext = {
  log: (level: LogLevel, message: string) => void
  send: (channel: string, payload: unknown) => void
  settings: () => AppSettings
  shouldStop: () => boolean
  setLoop?: (text: string) => void
  setMethod?: (text: string) => void
  /** Opt-in developer evidence; never changes success/failure or the node schema. */
  onTargetTrace?: (event: TargetTrace) => void
  captureTargetImages?: boolean
}

type Resolved = { x: number; y: number; label: string; memo?: TargetMemo }

class NotFoundError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** After a click, before keys: lets the field take focus. */
const FOCUS_MS = 420
/** Built-in: if a target is missing, wait, rescan the whole screen, try once more. */
const REFRESH_RETRY_MS = 3000
/** Mean grey difference (0–255) of two 32x18 signatures below which the screen counts as unchanged. */
const STILL_DIFF = 1.5
/** Above this, a replayed step no longer sees the screen it was recorded on. */
const REPLAY_DIFF = 14

/** Mean grey difference of two 32x18 signatures. The bottom row (taskbar, clock) is left out. */
function sigDiff(a?: string, b?: string): number {
  if (!a || !b) return 255
  const x = Buffer.from(a, 'base64')
  const y = Buffer.from(b, 'base64')
  if (!x.length || x.length !== y.length) return 255
  const n = x.length === 32 * 18 ? 32 * 17 : x.length
  let sum = 0
  for (let i = 0; i < n; i++) sum += Math.abs(x[i] - y[i])
  return sum / n
}

/** A replayed click only goes ahead when the recorded picture around the point is found this close to it. */
const PATCH_MIN = 0.85
const PATCH_RADIUS = 90

/** Normalized correlation above which a saved icon picture counts as found. */
const ICON_MIN = 0.82
/** Koşul decides a branch on the picture alone, so it asks for a closer match. */
const ICON_CHECK_MIN = 0.88

function center(t: { x: number; y: number; w: number; h: number }) {
  return { x: t.x + t.w / 2, y: t.y + t.h / 2 }
}

/** Replace this lap's values with their placeholders so the trace fits the next lap too. */
function generalize(line: string, vars: Record<string, string>): string {
  let out = line
  const pairs = Object.entries(vars)
    .filter(([, v]) => v && v.length >= 3)
    .sort((a, b) => b[1].length - a[1].length)
  for (const [k, v] of pairs) out = out.split(v).join(`{{${k}}}`)
  return out
}

function textModels(s: AppSettings): string[] {
  return modelChain(s.model, s.modelBackups)
}

function visionModels(s: AppSettings): string[] {
  const vision = modelChain(s.visionModel, s.visionBackups)
  return vision.length ? vision : textModels(s)
}

function agentModels(s: AppSettings): string[] {
  const agent = modelChain(s.agentModel, s.agentBackups)
  return agent.length ? agent : visionModels(s)
}

export function createAgent(ctx: AgentContext) {
  const { log, send } = ctx
  const getSettings = ctx.settings
  const stopped = ctx.shouldStop
  const pause = (ms: number) => interruptibleSleep(ms, stopped)

  function trace(node: AgentNode, data: TargetTraceData) {
    if (!ctx.onTargetTrace) return
    try {
      // An observer must not mutate the live candidates, node or chosen point.
      ctx.onTargetTrace(structuredClone({ version: 1, at: new Date().toISOString(), nodeId: node.id, ...data }) as TargetTrace)
    } catch (e) {
      log('warn', `Hedef tanılama kaydı yazılamadı: ${(e as Error).message}`)
    }
  }

  const runMemo = new Map<string, TargetMemo[]>()
  const runTrace = new Map<string, string[]>()
  const runPath = new Map<string, PathStep[]>()

  function screenArea() {
    const d = electronScreen.getPrimaryDisplay()
    const f = d.scaleFactor || 1
    return { x: Math.round(d.bounds.x * f), y: Math.round(d.bounds.y * f), w: Math.max(1, Math.round(d.bounds.width * f)), h: Math.max(1, Math.round(d.bounds.height * f)) }
  }
  const warnedMissing = new Set<string>()

  function checkStopped() {
    if (stopped()) throw new StoppedError()
  }

  /** An edited literal target must not keep using the previously picked label. */
  function locatorFitsText(node: AgentNode, text: string): boolean {
    const selected = (node.locator?.text || node.locator?.name || '').trim()
    return !text.trim() || (!!selected && norm(conditionNeedle(text)) === norm(selected))
  }

  const memoFor = (node: AgentNode) => runMemo.get(node.id) ?? node.memory
  const saveMemo = (node: AgentNode, m?: TargetMemo) => {
    if (!m) return
    const list = remember(memoFor(node), m)
    runMemo.set(node.id, list)
    send('agent:patch', { id: node.id, patch: { memory: list } })
  }

  let failDir = ''

  /** Called when a run starts: forget this run's memory copies. */
  function beginRun(logDir = '') {
    failDir = logDir
    runMemo.clear()
    runTrace.clear()
    runPath.clear()
    noted.clear()
    lastFg = null
    lastClickPoint = undefined
    lastInput = undefined
    guiReplace = false
    warnedMissing.clear()
  }

  function warnMissingWindow(res: ScanResult) {
    if (!res.missingWindow || warnedMissing.has(res.missingWindow)) return
    warnedMissing.add(res.missingWindow)
    log('warn', `Hedef pencere “${res.missingWindow}” açık değil, tüm ekran okunuyor. Kalıcı çözüm: Ayarlar > Hedef pencere > “Tüm ekran” > Kaydet.`)
  }

  async function scanFor(withImage: boolean, wide = false, deferOnnx = false, readOnly = false, targetTrace = false): Promise<ScanResult & { shot?: string }> {
    const s = getSettings()
    const res = await bridge.scan({
      windowTitle: wide ? undefined : s.targetWindow || undefined,
      image: withImage ? 'marked' : targetTrace && ctx.onTargetTrace && ctx.captureTargetImages ? 'plain' : 'none',
      fresh: wide,
      tilt: true,
      ocrEngine: deferOnnx ? 'windows' : undefined,
      deferOnnx,
      readOnly,
    })
    warnMissingWindow(res)
    noteCjk(res, 'scan')
    const ocrVia =
      res.ocrEngine === 'onnx' ? `ONNX ${res.onnxAdded ?? 0}` : res.ocr ? `${res.ocrCount}${res.onnxAdded ? ` +çince ${res.onnxAdded}` : ''}` : 'kapalı'
    const side = res.sideCount ? ` +yan ${res.sideCount}` : ''
    log('info', `Ekran tarandı: ${res.items.length} yazı/öğe (UIA ${res.uiaCount}, OCR ${ocrVia}${side})${res.window ? ` — ${res.window}` : ''}`)
    if (ocrVia === 'kapalı') log('warn', 'Windows OCR kullanılamıyor; sadece uygulamanın bildirdiği isimler görülebiliyor.')
    if (process.platform === 'win32' && res.onnx === false) noteOnce('scan', 'onnx', 'Çince okuyucu açılamadı; Windows OCR ile devam ediliyor.')
    return res
  }

  // ---------- finding targets ----------

  type TargetPick = { item: ScreenItem; target: Target; memo: TargetMemo; how: string }

  /**
   * Fresh search on this lap's screen. Memory only breaks ties between near-equal matches,
   * and a pick that clearly disagrees with the recent laps is looked at twice.
   */
  async function pickFrom(node: AgentNode, scan: ScanResult, win: string, allowLlm: boolean, llmOnly = false): Promise<TargetPick | null> {
    const s = getSettings()
    const items = scan.items
    const area = scan.area
    const prompt = node.prompt?.trim() ?? ''
    const explicit = extractTarget(prompt)
    const loc = node.locator
    const recordedText = loc?.text || loc?.name || ''
    // A target that contains {{öğe}} changes every lap; last lap's spot would point at last lap's item.
    const mem = node.templated ? undefined : memoFor(node)
    const prefer = mem?.length ? (it: ScreenItem) => likeness(mem, memoOf(it, area, win)) : undefined
    const anchor = mem?.length ? undefined : node.anchor ?? (loc?.x !== undefined && loc?.y !== undefined ? { x: loc.x, y: loc.y } : undefined)
    const useLlm = allowLlm && !!s.apiKey && !!prompt

    let hit: Target | null = null
    let how = ''
    let exact = false
    if (!llmOnly && explicit?.quoted) {
      hit = matchText(items, explicit.text, { anchor, minScore: 60, prefer }) ?? matchFuzzy(items, explicit.text, { anchor, minScore: 80, prefer })
      exact = !!hit
      how = 'yazı'
    }
    if (!llmOnly && !hit && !prompt && recordedText) {
      hit = matchText(items, recordedText, { anchor, minScore: 60, prefer }) ?? matchFuzzy(items, recordedText, { anchor, minScore: 80, prefer })
      how = 'yakalanan yazı'
    }
    let byLlm = false
    if (!hit && useLlm) {
      const choice = await chooseScreenTarget({
        apiKey: s.apiKey,
        model: textModels(s),
        prompt,
        kind: node.kind,
        scan,
        stepTitle: NODE_SPECS[node.kind].label,
        sendImage: s.sendScreenshot && !!scan.image,
        onImageFallback: (m) => log('warn', m),
        hint: describeMemory(mem) || undefined,
        system: promptOf(s.llmPrompts, 'list'),
      })
      trace(node, { kind: 'model', source: win === 'chrome' ? 'chrome' : 'list', value: choice })
      const item = choice.id !== null ? items.find((i) => i.id === choice.id) : undefined
      if (item) {
        log('info', `Seçilen hedef #${item.id}: ${item.src}/${item.type} “${item.text.slice(0, 120)}” @${item.x},${item.y} ${item.w}x${item.h}${scan.window ? ` / ${scan.window}` : ''}`)
        hit = refineTarget(item, choice.text)
        how = `LLM${choice.reason ? ` — ${choice.reason}` : ''}`
        byLlm = true
      } else {
        log('warn', `LLM uygun öğe bulamadı${choice.reason ? `: ${choice.reason}` : ''}.`)
      }
    }
    if (!hit && !llmOnly) {
      hit =
        matchPrompt(items, prompt || recordedText, anchor, prefer) ??
        (explicit ? matchText(items, explicit.text, { anchor, prefer }) : null) ??
        (recordedText ? matchText(items, recordedText, { anchor, prefer }) : null) ??
        matchFuzzy(items, explicit?.text || prompt || recordedText, { anchor, prefer }) ??
        (recordedText && prompt ? matchFuzzy(items, recordedText, { anchor, prefer }) : null)
      how = 'yazı eşleşmesi'
    }
    if (!hit) return null

    let memo = memoOf(hit.item, area, win)
    const why = exact ? null : conflict(mem, memo)
    if (why) {
      log('warn', `Bu tur farklı: ${why}. Tıklamadan önce bir kez daha bakılıyor.`)
      if (s.apiKey && prompt && !byLlm) {
        try {
          const second = await chooseScreenTarget({
            apiKey: s.apiKey,
            model: textModels(s),
            prompt,
            kind: node.kind,
            scan,
            stepTitle: NODE_SPECS[node.kind].label,
            sendImage: s.sendScreenshot && !!scan.image,
            hint: `${describeMemory(mem)}. Bu tur yazı eşleşmesi #${hit.item.id} “${hit.item.text}” öğesini buldu ama ${why}. Talimata göre doğru öğe hangisi?`,
            system: promptOf(s.llmPrompts, 'list'),
          })
          trace(node, { kind: 'model', source: win === 'chrome' ? 'chrome' : 'list', value: second })
          const item = second.id !== null ? items.find((i) => i.id === second.id) : undefined
          if (item && item.id !== hit.item.id) {
            log('info', `İkinci bakış başka öğe seçti: #${item.id} “${item.text}”${second.reason ? ` — ${second.reason}` : ''}`)
            hit = refineTarget(item, second.text)
            memo = memoOf(item, area, win)
            how = 'ikinci bakış'
          } else if (item) {
            log('info', `İkinci bakış aynı öğeyi onayladı${second.reason ? `: ${second.reason}` : ''}.`)
          }
        } catch (e) {
          log('warn', `İkinci bakış atlandı: ${(e as Error).message}`)
        }
      } else {
        log('info', 'Değişken içerikli sayfalarda bu normal olabilir; bulunan öğe kullanılıyor.')
      }
    }
    return { item: hit.item, target: hit, memo, how }
  }

  const pseudoScan = (items: ScreenItem[], area: ScanResult['area'], window: string): ScanResult => ({
    area,
    items,
    ocr: false,
    uiaCount: items.length,
    ocrCount: 0,
    image: null,
    window,
  })

  async function resolveTarget(node: AgentNode, _stepNo: number, wide = false, readOnly = false): Promise<Resolved> {
    const s = getSettings()
    const prompt = node.prompt?.trim() ?? ''
    const loc = node.locator
    const win = s.targetWindow || loc?.windowTitle || ''
    const hasText = !!prompt || !!(loc?.text || loc?.name)?.trim()
    const marked = extractTarget(prompt)
    const quoted = marked?.quoted ? marked.text : ''
    const order = activeFindOrder(s.findOrder, s.findOff)
    trace(node, { kind: 'request', node, order, readOnly, windowTitle: win, modelEnabled: !!s.apiKey, memory: memoFor(node) })
    const resolved = (target: Resolved, source: FindStageId, rect?: TargetRect, item?: ScreenItem): Resolved => {
      trace(node, { kind: 'resolved', source, target: { x: target.x, y: target.y, label: target.label }, rect, item })
      return target
    }
    const frame = async (source: FindStageId) => {
      if (!ctx.onTargetTrace || !ctx.captureTargetImages) return
      try {
        const scan = await bridge.scan({ windowTitle: win || undefined, image: 'plain', uia: false, ocr: false, readOnly: true })
        trace(node, { kind: 'observation', source, scan })
      } catch (e) {
        log('warn', `Tanılama görüntüsü alınamadı: ${(e as Error).message}`)
      }
    }
    let winScan: (ScanResult & { shot?: string }) | null = null
    let shotFile = ''
    let onnxScan: ScanResult | null = null
    let seenItems: ScreenItem[] = []

    const windowsScan = async () => {
      if (!winScan) {
        winScan = await scanFor(false, wide, true, readOnly, true)
        const { shot: _temporary, ...snapshot } = winScan
        trace(node, { kind: 'observation', source: 'windows', scan: snapshot })
        // A diagnostic screenshot must not become a new model input. This path
        // normally scans with image:none; keep the live resolver's inputs identical.
        winScan = { ...winScan, image: null }
        shotFile = winScan.shot || ''
        seenItems = winScan.items
      }
      return winScan
    }
    const onnxReady = async () => {
      if (onnxScan) return onnxScan
      const base = await windowsScan()
      try {
        onnxScan = await bridge.applyOnnx(base)
      } catch (e) {
        log('warn', `ONNX okunamadı: ${(e as Error).message}`)
        onnxScan = base
      }
      seenItems = onnxScan.items
      trace(node, { kind: 'observation', source: 'onnx', scan: onnxScan })
      return onnxScan
    }

    const quoteOnScreen = (scan: ScanResult, text: string, where: string): TargetPick | null => {
      const mem = node.templated ? undefined : memoFor(node)
      const prefer = mem?.length ? (it: ScreenItem) => likeness(mem, memoOf(it, scan.area, where)) : undefined
      const anchor = mem?.length ? undefined : node.anchor ?? (loc?.x !== undefined && loc?.y !== undefined ? { x: loc.x, y: loc.y } : undefined)
      const hit = matchText(scan.items, text, { anchor, minScore: 100, prefer })
      if (!hit) return null
      return { item: hit.item, target: hit, memo: memoOf(hit.item, scan.area, where), how: 'yazı' }
    }

    try {
      for (const stage of order) {
        if (stopped()) throw new StoppedError()
        if (stage === 'chrome') {
          const userChrome = await browser.userChromeItems(win || undefined)
          trace(node, { kind: 'observation', source: 'chrome', scan: userChrome ? pseudoScan(userChrome.items, userChrome.area, userChrome.host) : null })
          if (!userChrome) continue
          ctx.setMethod?.('Chrome sayfası')
          log('info', `[chrome] Sayfada ${userChrome.items.length} yazı okundu.`)
          const pick = await pickFrom(node, pseudoScan(userChrome.items, userChrome.area, userChrome.host), 'chrome', true)
          if (pick) return resolved({ ...center(pick.target), memo: pick.memo, label: `[chrome] “${pick.target.text}” (${pick.how})` }, 'chrome', pick.target, pick.item)
          log('info', '[chrome] Sayfada bulunamadı.')
        }
        if (stage === 'uia' && loc && win && (loc.automationId || loc.name?.trim()) && !['Pane', 'Window', 'Document', 'Point'].includes(loc.controlType)
          && (!quoted || locatorFitsText(node, quoted))) {
          ctx.setMethod?.('Kayıtlı öğe')
          try {
            const r = await bridge.locate(loc, win, readOnly)
            trace(node, { kind: 'observation', source: 'uia', value: r })
            if (r && r.enabled !== false && r.w * r.h < 600 * 400) {
              if (ctx.onTargetTrace && ctx.captureTargetImages) await frame('uia')
              return resolved({ ...center(r), label: `kayıtlı öğe “${r.name || loc.text || loc.name}”` }, 'uia', r)
            }
          } catch {
            /* next stage */
          }
        }
        if (stage === 'icon' && loc?.icon) {
          ctx.setMethod?.('Kayıtlı resim')
          try {
            const hit = (await bridge.findImage(loc.icon, loc.windowTitle)) ?? null
            const again = hit && hit.score < ICON_MIN && loc.windowTitle ? await bridge.findImage(loc.icon) : null
            const best = again && hit && again.score > hit.score ? again : hit
            trace(node, { kind: 'observation', source: 'icon', value: { hit, again } })
            if (best && best.score >= ICON_MIN) {
              if (ctx.onTargetTrace && ctx.captureTargetImages) await frame('icon')
              log('info', `[simge] Kayıtlı resim ekranda bulundu (%${Math.round(best.score * 100)} benzer).`)
              const sa = screenArea()
              return resolved({
                x: best.x,
                y: best.y,
                label: '[simge] kayıtlı resim',
                memo: { win: best.window || win, type: 'Simge', src: 'ocr', rx: (best.x - sa.x) / sa.w, ry: (best.y - sa.y) / sa.h, text: loc.text || 'simge', at: Date.now() },
              }, 'icon')
            }
            if (best) log('info', `[simge] Kayıtlı resim ekranda net değil (en iyi %${Math.round(best.score * 100)}).`)
          } catch (e) {
            log('warn', `[simge] Resim araması atlandı: ${(e as Error).message}`)
          }
        }
        if ((stage === 'windows' || stage === 'onnx') && !quoted) {
          if (stage === 'windows') log('info', 'Tırnak içi yazı yok, yerel OCR atlanıyor.')
          continue
        }
        if (stage === 'windows' && quoted) {
          ctx.setMethod?.('Windows OCR')
          log('info', `“${quoted}” Windows OCR ile aranıyor.`)
          const scan = await windowsScan()
          const pick = quoteOnScreen(scan, quoted, scan.window || win)
          if (pick) {
            const reader = pick.item.src === 'ocr' ? 'Windows OCR' : 'uygulama öğesi'
            return resolved({ ...center(pick.target), memo: pick.memo, label: `“${pick.target.text}” (${reader}, ${pick.how})` }, 'windows', pick.target, pick.item)
          }
          log('info', `“${quoted}” Windows OCR’da yok.`)
        }
        if (stage === 'onnx' && quoted) {
          ctx.setMethod?.('ONNX OCR')
          log('info', `“${quoted}” ONNX ile aranıyor.`)
          const scan = await onnxReady()
          const side = scan.sideCount ? ` +yan ${scan.sideCount}` : ''
          log('info', `ONNX ${scan.onnxAdded ?? 0}${side} satır.`)
          const pick = quoteOnScreen(scan, quoted, scan.window || win)
          if (pick) {
            const reader = pick.item.src === 'ocr' ? 'ONNX' : 'uygulama öğesi'
            return resolved({ ...center(pick.target), memo: pick.memo, label: `“${pick.target.text}” (${reader}, ${pick.how})` }, 'onnx', pick.target, pick.item)
          }
          log('info', `“${quoted}” ONNX’te yok.`)
        }
        if (stage === 'list' && hasText) {
          ctx.setMethod?.('Kelime listesi')
          const scan = onnxScan ?? (await windowsScan())
          log('info', 'OCR kelime listesi yazı modeline gidiyor.')
          const pick = await pickFrom(node, scan, scan.window || win, true, true)
          if (pick) return resolved({ ...center(pick.target), memo: pick.memo, label: `“${pick.target.text}” (yazı modeli, ${pick.how})` }, 'list', pick.target, pick.item)
        }
        if (stage === 'tars' && s.apiKey && (hasText || loc?.icon)) {
          ctx.setMethod?.('UI-TARS')
          try {
            log('info', 'UI-TARS ekran görüntüsüne bakıyor.')
            return await locateWithTars(node, wide, readOnly)
          } catch (e) {
            if (e instanceof NotFoundError) log('warn', e.message)
            else log('warn', `UI-TARS atlandı: ${(e as Error).message}`)
          }
        }
        if (stage === 'offset' && loc?.offsetX !== undefined && loc.offsetY !== undefined && win) {
          ctx.setMethod?.('Kayıtlı konum')
          try {
            const r = await bridge.windowRect(win)
            trace(node, { kind: 'observation', source: 'offset', value: r })
            if (ctx.onTargetTrace && ctx.captureTargetImages) await frame('offset')
            log('warn', 'Yazı bulunamadı, kayıttaki konuma tıklanıyor.')
            return resolved({ x: r.x + loc.offsetX, y: r.y + loc.offsetY, label: 'kayıtlı konum' }, 'offset')
          } catch {
            /* window gone */
          }
        }
      }
    } catch (e) {
      trace(node, { kind: 'failure', message: (e as Error).message })
      throw e
    } finally {
      bridge.discardShot(shotFile)
    }

    const explicit = extractTarget(prompt)
    const seen = sampleTexts(seenItems)
    const message = `“${explicit?.text || prompt || loc?.text || node.title}” ekranda bulunamadı.${s.apiKey ? '' : ' (API anahtarı yok, sadece yazı eşleşmesi denendi.)'}${
        seen ? ` Ekranda görülenlerden bazıları: ${seen}` : ''
      }`
    trace(node, { kind: 'failure', message })
    throw new NotFoundError(message)
  }

  function visionPrompt(node: AgentNode): string {
    const p = node.prompt?.trim()
    if (p) return p
    if (node.locator?.icon) return 'İkinci resimdeki simgenin/düğmenin ekrandaki yerini bul'
    const t = node.locator?.text || node.locator?.name
    if (t) return `“${t}” yazan yere`
    throw new Error(`“${node.title}”: görsel mod için ekranda neyin bulunacağını yaz.`)
  }

  /** Last stage: UI-TARS looks at the original upright screenshot and points. The ramp and the 90° turn stay on the OCR copies. */
  async function locateWithTars(node: AgentNode, wide = false, readOnly = false): Promise<Resolved> {
    const s = getSettings()
    if (!s.apiKey) throw new NotFoundError('UI-TARS için API anahtarı yok.')
    const model = agentModels(s)
    const prompt = visionPrompt(node)
    const res = await bridge.scan({
      windowTitle: wide ? undefined : s.targetWindow || undefined,
      image: 'plain',
      uia: false,
      ocr: false,
      fresh: wide,
      maxImageW: isTarsModel(model[0] || '') ? 1288 : 1400,
      snap: isTarsModel(model[0] || '') ? 28 : 0,
      fit: true,
      readOnly,
    })
    trace(node, { kind: 'observation', source: 'tars', scan: res })
    warnMissingWindow(res)
    if (!res.image) throw new NotFoundError('UI-TARS için ekran görüntüsü alınamadı.')
    const action = await guiStep({
      apiKey: s.apiKey,
      model,
      goal: `Find this on the screen and click it once: ${prompt}. Do nothing else.`,
      history: [],
      screen: res.image,
      tarsPrompt: promptOf(s.llmPrompts, 'tars'),
      jsonPrompt: promptOf(s.llmPrompts, 'screen'),
    })
    trace(node, { kind: 'model', source: 'tars', value: action })
    const pointed = (action.kind === 'click' || action.kind === 'double' || action.kind === 'right') && typeof action.x === 'number' && typeof action.y === 'number'
    if (!pointed) throw new NotFoundError(`UI-TARS hedefi göstermedi${action.thought ? `: ${action.thought}` : ''}.`)
    const a = res.area
    const x = a.x + action.x! * a.w
    const y = a.y + action.y! * a.h
    trace(node, { kind: 'resolved', source: 'tars', target: { x, y, label: '[UI-TARS] ekran görüntüsü' } })
    log('info', `[UI-TARS] ${action.thought || action.raw}`)
    return {
      x,
      y,
      label: '[UI-TARS] ekran görüntüsü',
      memo: { win: res.window || '', type: 'Nokta', src: 'ocr', rx: a.w ? (x - a.x) / a.w : 0.5, ry: a.h ? (y - a.y) / a.h : 0.5, text: prompt.slice(0, 80), at: Date.now() },
    }
  }

  const findTarget = (node: AgentNode, stepNo: number, wide = false) => resolveTarget(node, stepNo, wide)

  type Snap = { texts: string[]; image: string | null }

  async function snap(label: string): Promise<Snap> {
    const res = await bridge.scan({ image: 'plain', fresh: true, maxImageW: 1100 })
    if (res.image?.data) rememberShot(res.image.data, label)
    return { texts: res.items.map((i) => i.text), image: res.image?.data ?? null }
  }

  function labelOf(k: ReactionVerdict): string {
    if (k === 'ready') return 'hazır'
    if (k === 'missed') return 'tepki yok'
    if (k === 'loading') return 'yükleniyor'
    if (k === 'blocked') return 'başka bir şey açıldı'
    return 'belirsiz'
  }

  async function lookCloser(v: Verdict, before: Snap, after: Snap, node: AgentNode, ahead?: StepAhead): Promise<Verdict> {
    const s = getSettings()
    const model = visionModels(s)
    if (!s.apiKey || !model.length || !before.image || !after.image) return v
    if (v.kind !== 'blocked' && v.kind !== 'unknown' && v.kind !== 'missed') return v
    try {
      const r = await judgeReaction({
        apiKey: s.apiKey,
        model,
        system: promptOf(s.llmPrompts, 'reaction'),
        step: `${NODE_SPECS[node.kind].label}${node.prompt?.trim() ? `: ${node.prompt.trim()}` : node.text?.trim() ? `: ${node.text.trim()}` : ''}`,
        expected: v.expected,
        ahead: describeAhead(ahead),
        fresh: v.fresh,
        before: { data: before.image, w: 0, h: 0 },
        after: { data: after.image, w: 0, h: 0 },
      })
      log('info', `Görsel yorum (${labelOf(r.verdict)}): ${r.reason || 'gerekçe yok'}`)
      return { ...v, kind: r.verdict, reason: r.reason || v.reason }
    } catch (e) {
      log('warn', `Görsel yorum atlandı: ${(e as Error).message}`)
      return v
    }
  }

  function firstGoal(ahead?: StepAhead): { text: string; label: string } | null {
    for (const n of [ahead?.next, ahead?.then]) {
      if (!n) continue
      if (['loop', 'end', 'start', 'wait', 'browser', 'waitFile', 'moveFile', 'ai'].includes(n.kind)) continue
      const text = expectation({ next: n }).trim()
      if (!text) continue
      return { text, label: `“${n.title}” için “${text}”` }
    }
    return null
  }

  /** The next step's own target, without clicking it. Empty goal means there is nothing that should block the run. */
  async function aheadIsReady(ahead?: StepAhead, quiet = false): Promise<boolean> {
    const goal = firstGoal(ahead)
    if (!goal) {
      if (!quiet) log('info', 'Sırada kontrol edilecek bir öğe yok. Devam ediliyor.')
      return true
    }
    if (process.platform === 'win32') {
      const res = await bridge.scan({ image: 'none', fresh: true, tilt: true })
      if (containsText(res.items, goal.text) || matchPrompt(res.items, goal.text)) {
        log('info', `${goal.label} ekranda; bu, önceki eylemin başarı kanıtı değil. Sonraki adım kendi hedefini kullanacak.`)
        return true
      }
    }
    if (!quiet) log('info', `${goal.label} henüz görünmüyor.`)
    return false
  }

  async function askPlan(node: AgentNode, ahead: StepAhead | undefined, problem: string) {
    const s = getSettings()
    const model = visionModels(s)
    if (!s.apiKey || !model.length) return null
    let image: { data: string; w: number; h: number } | null = null
    try {
      const shot = await snap(`${node.title} plan`)
      if (shot.image) image = { data: shot.image, w: 0, h: 0 }
    } catch {
      /* plan from the text of the problem */
    }
    try {
      return await planStall({
        apiKey: s.apiKey,
        system: promptOf(s.llmPrompts, 'stall'),
        model,
        step: `${NODE_SPECS[node.kind].label}${node.prompt?.trim() ? `: ${node.prompt.trim()}` : node.text?.trim() ? `: ${node.text.trim()}` : ''}`,
        problem,
        ahead: describeAhead(ahead),
        expected: expectation(ahead),
        image,
      })
    } catch (e) {
      log('warn', `Plan alınamadı: ${(e as Error).message}`)
      return null
    }
  }

  function planLabel(action: 'continue' | 'wait' | 'stop', waitMs: number): string {
    if (action === 'wait') return `${Math.round(waitMs / 1000)} sn bekle`
    if (action === 'continue') return 'sıradaki adımı dene'
    return 'dur'
  }

  /**
   * After one click, type, or key. The same command is never pressed twice, and this never fails the step:
   * if the reaction cannot be confirmed, the next step looks for its own target, waits, and recovers.
   * Returns whether the reaction was confirmed (only confirmed targets go into memory).
   */
  async function ensureActed(node: AgentNode, ahead: StepAhead | undefined, act: () => Promise<void>): Promise<boolean> {
    // Selecting a field need not change any screen text. The following type
    // operation resolves and verifies that field using this click's point.
    if (node.kind === 'click' && ahead?.next?.kind === 'type' && !ahead.next.prompt?.trim() && !ahead.next.locator) {
      await act()
      const state = await bridge.inputState()
      log('info', state
        ? `Tıklama sonrası odak: ${state.type || 'bilinmiyor'} / “${state.window}”${state.name ? ` / ${state.name}` : ''}. Yaz node’u alanı kendisi kontrol edecek.`
        : 'Tıklama sonrası alan odağı okunamadı. Yaz node’u alanı kendisi kontrol edecek.')
      return false
    }
    if (ahead?.next?.kind === 'condition') {
      await act()
      log('info', `“${node.title}” bir kez yapıldı. Sıradaki adım (${ahead.next.title}) ekrana kendisi baktığı için kontrol edilmeden geçiliyor.`)
      return true
    }
    if (process.platform !== 'win32') {
      await act()
      return true
    }

    const expected = expectation(ahead)
    const before = await snap(`${node.title} önce`)
    await act()

    await pause(900)
    const after = await snap(`${node.title} sonra`)
    let verdict = judgeScreen(before.texts, after.texts, expected)
    if (verdict.kind === 'loading') {
      log('info', `Sayfa henüz oturmadı (${verdict.reason}). Basılmadan beklenecek.`)
      for (let i = 0; i < 3 && verdict.kind === 'loading'; i++) {
        await pause(2000)
        const later = await snap(`${node.title} yükleniyor`)
        verdict = judgeScreen(before.texts, later.texts, expected)
      }
    }
    if (verdict.kind === 'ready') {
      log('success', `Emin: ${verdict.reason}.`)
      return true
    }
    if (expected && (verdict.kind === 'blocked' || verdict.kind === 'unknown')) {
      verdict = await lookCloser(verdict, before, after, node, ahead)
      if (verdict.kind === 'ready') {
        log('success', `Emin: ${verdict.reason}.`)
        return true
      }
    }

    log('info', `Tepki net değil (${verdict.reason}). Akış bozulmadan sıradaki adım kontrol edilecek.`)
    if (await aheadIsReady(ahead)) return false

    log('info', 'Sıradaki öğe henüz yok. Karar vermeden önce beklenecek.')
    await pause(2500)
    if (await aheadIsReady(ahead)) return false

    const plan = await askPlan(node, ahead, verdict.reason)
    if (plan) {
      log('info', `Plan: ${planLabel(plan.action, plan.waitMs)}. ${plan.reason}`)
      if (plan.action === 'wait') await pause(plan.waitMs)
      if (await aheadIsReady(ahead)) return false
    }
    log('info', `“${node.title}” sonrası tepki doğrulanamadı; sıradaki adım kendi hedefini arayıp bekleyecek (bu adım hata sayılmadı).`)
    return false
  }

  let inRecover = false

  async function withScreenRetry<T>(title: string, run: (wide: boolean) => Promise<T>, recover?: () => Promise<T | null>): Promise<T> {
    try {
      return await run(false)
    } catch (e) {
      if (!(e instanceof NotFoundError) || stopped()) throw e
      log('warn', `“${title}” bulunamadı. 3 sn sonra ekran yenilenip bir kez daha denenecek.`)
      await pause(REFRESH_RETRY_MS)
      try {
        return await run(true)
      } catch (e2) {
        if (!(e2 instanceof NotFoundError) || stopped() || inRecover || !recover) throw e2
        log('warn', `“${title}” hâlâ yok. Durup düşünülecek, hemen vazgeçilmiyor.`)
        inRecover = true
        try {
          const alt = await recover()
          if (alt) return alt
          throw e2
        } finally {
          inRecover = false
        }
      }
    }
  }

  /** The click/type target was not on screen. Wait, ask for a plan, then look once more before the step fails. */
  async function recoverTarget(node: AgentNode, ahead: StepAhead | undefined): Promise<Resolved | null> {
    await pause(2000)
    const plan = await askPlan(node, ahead, `“${node.title}” istediği öğeyi ekranda bulamadı`)
    if (!plan) return null
    log('info', `Plan: ${planLabel(plan.action, plan.waitMs)}. ${plan.reason}`)
    if (plan.action === 'wait') await pause(plan.waitMs)
    if (plan.action === 'stop') return null
    try {
      return await resolveTarget(plan.lookFor ? { ...node, prompt: `“${plan.lookFor}”` } : node, 0, true)
    } catch {
      return null
    }
  }


  /**
   * Koşul with a picked element: its own UI element (enabled), or its saved picture, is on screen right now.
   * Returns how it was seen, or null.
   */
  async function savedTargetVisible(node: AgentNode): Promise<string | null> {
    const loc = node.locator!
    const win = loc.windowTitle || getSettings().targetWindow || ''
    if (win && (loc.automationId || loc.name?.trim()) && !['Pane', 'Window', 'Document', 'Point', 'Custom'].includes(loc.controlType)) {
      try {
        const r = await bridge.locate(loc, win)
        if (r && r.w * r.h < 600 * 400) {
          if (r.enabled === false) {
            noteOnce(node.id, 'disabled', `“${r.name || loc.name}” ekranda ama pasif (tıklanamaz); hazır sayılmıyor.`)
          } else return `uygulama öğesi “${r.name || loc.name}”`
        }
      } catch {
        /* not there, try the picture */
      }
    }
    if (loc.icon) {
      try {
        const hit = await bridge.findImage(loc.icon)
        if (hit && hit.score >= ICON_CHECK_MIN) return `simge resmi (%${Math.round(hit.score * 100)} benzer, @${hit.x},${hit.y})`
      } catch (e) {
        log('warn', `[simge] Resim araması atlandı: ${(e as Error).message}`)
      }
    }
    return null
  }

  const noted = new Set<string>()
  let ocrLangs: { main: string; extra: string[]; available: string[] } | null | undefined

  /**
   * The screen shows Chinese/Japanese/Korean text (seen in UI Automation names) but Windows OCR cannot read it.
   * Said once per run, with what to do about it.
   */
  function noteCjk(res: ScanResult, id: string) {
    if ((res.uiaSkipped ?? 0) > 0) {
      noteOnce('scan', 'uiaSkipped', `${res.uiaSkipped} pencerenin öğe ağacı çok büyük olduğu için süresinde okunamadı; o pencerelerde yalnızca OCR kullanıldı.`)
    }
    if (process.platform !== 'win32' || noted.has('scan:cjk')) return
    const cjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/
    if (!res.items.some((i) => i.src === 'uia' && cjk.test(i.text))) return
    if (res.onnx && res.items.some((i) => i.src === 'ocr' && cjk.test(i.text))) return
    void (async () => {
      if (ocrLangs === undefined) ocrLangs = await bridge.ocrInfo()
      const tags = [ocrLangs?.main ?? '', ...(ocrLangs?.extra ?? [])]
      if (tags.some((t) => /^(zh|ja|ko)/i.test(t))) return
      noteOnce(
        'scan',
        'cjk',
        'Ekranda Çince/Japonca/Korece yazı var ama Windows OCR bu dili okuyamıyor (yüklü OCR dilleri: ' +
          (tags.filter(Boolean).join(', ') || 'yok') +
          '). Chrome 9222 ile açıldıysa sayfanın kendi yazısı kullanılır.'
      )
    })()
    void id
  }
  function noteOnce(id: string, key: string, msg: string) {
    const k = `${id}:${key}`
    if (noted.has(k)) return
    noted.add(k)
    log('info', msg)
  }

  // ---------- typing ----------

  function reportTyping(r: bridge.TypeResult | null) {
    if (!r) return
    if (r.skippedClear) {
      log('warn', `Odaktaki öğe bir yazı alanı değil (${r.focusType || 'bilinmiyor'}); yazı ve temizleme tuşları gönderilmedi.`)
    }
    if (r.pasted) log('info', 'Metinde klavyeyle yazılamayan karakterler vardı; pano üzerinden yapıştırıldı.')
  }

  /** How the field compares with what was typed. */
  function fieldState(value: string, text: string, replace: boolean): 'ok' | 'partial' | 'empty' | 'wrong' {
    const v = value.normalize('NFC')
    const t = text.normalize('NFC')
    if (replace ? v === t : v.includes(t)) return 'ok'
    if (!v) return 'empty'
    // Locale decimal formatting is valid; matching digits or half a filename
    // is not. In replacement mode the complete path/text must survive.
    const number = /^[+-]?\d+(?:[.,]\d+)?$/
    if (number.test(v.trim()) && number.test(t.trim()) && Number(v.trim().replace(',', '.')) === Number(t.trim().replace(',', '.'))) return 'partial'
    return 'wrong'
  }

  type InputBinding = { window: InputWindow; at?: Point; instruction: string; mustRetarget?: boolean }
  let lastInput: InputBinding | undefined
  let guiReplace = false

  async function inputBinding(at?: Point, node?: AgentNode, fresh = false): Promise<InputBinding | undefined> {
    if (process.platform !== 'win32') return undefined
    const previous = !fresh && lastInput && at && lastInput.at && Math.hypot(at.x - lastInput.at.x, at.y - lastInput.at.y) < 1 ? lastInput : undefined
    const windowTitle = getSettings().targetWindow || node?.locator?.windowTitle || undefined
    checkStopped()
    const win = await bridge.inputTarget(previous ? { target: previous.window, followOwnedDialog: true } : { windowTitle, at })
    checkStopped()
    if (!win) throw new Error('INPUT_TARGET_INVALID: Yazılacak pencere bulunamadı.')
    const point = previous ? movedPoint(previous.window.rect, win.rect, at) : at
    const changedWindow = previous && previous.window.hwnd !== win.hwnd
    const binding = { window: win, at: changedWindow ? undefined : point, instruction: node?.prompt?.trim() || previous?.instruction || '', mustRetarget: !!previous && (!!changedWindow || !point) }
    if (previous && at && !binding.at) log('info', 'Pencere/diyalog veya yerleşim değişti; eski yazı alanı noktası kullanılmıyor.')
    return binding
  }

  async function activateInputWindow(node: AgentNode) {
    const title = getSettings().targetWindow || node.locator?.windowTitle
    if (process.platform !== 'win32' || !title) return
    checkStopped()
    await bridge.inputTarget({ windowTitle: title })
    checkStopped()
  }

  async function clickInput(point: Point, instruction: string, node?: AgentNode, mode: 'left' | 'double' | 'right' = 'left') {
    const binding = await inputBinding(point, node, true)
    checkStopped()
    const p = binding?.at || point
    if (binding && !inside(binding.window.rect, p)) throw new Error('INPUT_TARGET_INVALID: Alan noktası hedef pencerenin dışında.')
    await bridge.clickAt(p.x, p.y, mode, binding?.window)
    if (node) trace(node, { kind: 'input', point: { x: Math.round(p.x), y: Math.round(p.y) }, mode, phase: 'sent' })
    lastClickPoint = mode === 'right' ? undefined : p
    lastInput = mode === 'right' ? undefined : binding ? { ...binding, instruction } : undefined
  }

  async function recoverInput(binding: InputBinding, error: bridge.TypeResult, turns: GuiTurn[]): Promise<InputBinding | null> {
    const settings = getSettings()
    const models = agentModels(settings)
    if (!settings.apiKey || !models.length || !binding.instruction.trim()) return null
    checkStopped()
    const win = await bridge.inputTarget({ target: binding.window })
    checkStopped()
    if (!win) return null
    const point = movedPoint(binding.window.rect, win.rect, binding.at)
    binding = { ...binding, window: win, at: point, mustRetarget: !point }
    const view = await bridge.crop(win.rect, 1008, true, models.some(isTarsModel) ? 28 : 0)
    checkStopped()
    rememberShot(view.image.data, 'yazı alanı kurtarma')
    const d = error.diagnostics
    const goal = 'ONLY restore keyboard focus to the editable input described below. Do not type any text,'
      + ' send keys, submit, save, close a window or perform the full workflow.'
      + ' Return one click on that input, a short wait if it is loading, or call_user if it cannot be identified.'
      + ' finished means ONLY that the described input already has keyboard focus; the executor will verify this.'
      + '\nInput instruction: ' + binding.instruction
      + '\nTarget window: ' + win.title
      + '\nInput was NOT sent. Error: ' + (error.code || 'INPUT_FOCUS_UNRESOLVED')
      + '\nCurrent focus: ' + (d?.type || error.focusType || 'unknown') + ', native=' + (d?.native || 'unknown')
      + '\nPrevious point: ' + (binding.at ? Math.round(binding.at.x) + ',' + Math.round(binding.at.y) : 'not valid on current layout')
      + '\nThe attached image is ONLY this window. Use its coordinates. Re-evaluate the field, not merely its text label.'
    const a = await guiStep({ apiKey: settings.apiKey, model: models, goal, history: turns, screen: view.image })
    checkStopped()
    await bridge.assertInputTarget(win)
    checkStopped()
    log('info', 'Yazı alanı kurtarma: ' + describeGui(a) + (a.thought ? ' — ' + a.thought : ''))
    turns.push({ thought: a.thought, raw: a.raw, image: view.image })
    if (a.kind === 'wait') { await pause(500); return { ...binding, window: win } }
    if (a.kind === 'finished') return binding.at ? { ...binding, window: win } : null
    if (a.kind !== 'click' || a.x === undefined || a.y === undefined) return null
    const p = { x: view.area.x + a.x * view.area.w, y: view.area.y + a.y * view.area.h }
    if (!inside(win.rect, p) || !inside(view.area, p)) throw new Error('INPUT_TARGET_INVALID: Kurtarma noktası hedef pencerenin dışında.')
    if (turns.slice(0, -1).some(t => t.note === 'click@' + Math.round(p.x) + ',' + Math.round(p.y))) {
      log('warn', 'Kurtarma aynı başarısız alan noktasını tekrar seçti; tıklama gönderilmedi.')
      return null
    }
    turns[turns.length - 1].note = 'click@' + Math.round(p.x) + ',' + Math.round(p.y)
    await bridge.clickAt(p.x, p.y, 'left', win)
    await pause(FOCUS_MS)
    return { ...binding, window: win, at: p, mustRetarget: false }
  }

  /** Types into the focused field, reads it back. Empty or unrelated content is typed once more; a formatted/shortened value only warns. */
  async function typeVerified(
    text: string,
    enter: boolean,
    clear: boolean,
    at?: { x: number; y: number },
    node?: AgentNode,
    ahead?: StepAhead
  ) {
    let binding = await inputBinding(at, node)
    const recoveryTurns: GuiTurn[] = []
    let recoveryCount = 0
    let inputWasSent = false
    let visual = false
    const write = async (clearField = clear): Promise<bridge.TypeResult | null> => {
      // Enter belongs to this function, after readback, never to the worker.
      checkStopped()
      const guard: InputGuard | undefined = binding ? { window: binding.window, at: binding.at, visual } : undefined
      let typed: bridge.TypeResult | null = binding?.mustRetarget
        ? { cleared: false, pasted: false, focusType: '', skippedClear: true, writeSent: false, code: 'INPUT_LAYOUT_CHANGED', diagnostics: await bridge.inputState() || undefined }
        : await bridge.typeText(text, false, clearField, binding ? binding.at : at, undefined, guard)
      checkStopped()
      if (typed?.needChoice && typed.choices?.length) {
        const s = getSettings()
        const model = textModels(s)
        if (!s.apiKey || !model.length || !node) {
          throw new Error('Öndeki pencerede birden fazla yazı kutusu var. Alanı seçmek için API anahtarı veya alanı hedefleyen bir tıklama gerekli.')
        }
        const windows = [...new Set(typed.choices.map((c) => c.window))]
        log('info', `${windows.join(', ')} içinde ${typed.choices.length} yazı kutusu var. Hangi alana yazılacağı soruluyor.`)
        const body = node.prompt?.trim() || binding?.instruction || ''
        const pick = await chooseTypeField({
          apiKey: s.apiKey,
          model,
          step: body ? `${NODE_SPECS[node.kind].label}: ${body}` : NODE_SPECS[node.kind].label,
          instruction: body,
          text,
          ahead: describeAhead(ahead),
          choices: typed.choices,
        })
        const chosen = typed.choices.find((c) => c.id === pick.id)
        if (!chosen) throw new Error(`Yazı kutusu seçilemedi${pick.reason ? `: ${pick.reason}` : ''}.`)
        if (!chosen.token) throw new Error('Yazı alanının kalıcı seçim anahtarı yok; yazı gönderilmedi.')
        log('info', `Yazı kutusu #${chosen.id}: “${chosen.window}” / ${chosen.type}${chosen.name ? ` / ${chosen.name}` : ''}. ${pick.reason}`)
        if (stopped()) throw new StoppedError()
        typed = await bridge.typeText(text, false, clearField, binding ? binding.at : at, chosen.token, guard)
        checkStopped()
      }
      if (typed?.skippedClear) {
        const d = typed.diagnostics
        log('warn', 'Yazı gönderilmedi: ' + (typed.code || 'INPUT_FOCUS_UNRESOLVED')
          + '; UIA=' + (d?.type || typed.focusType || '?') + ', native=' + (d?.native || '?')
          + ', pencere=' + (d?.window || typed.where || '?') + ', HWND=' + (d?.hwnd || '?')
          + ', odak HWND=' + (d?.focusHwnd || '?') + ', caret=' + (d?.caret ? 'var' : 'yok') + '.')
        if (!inputWasSent && typed.writeSent !== true && binding && recoveryCount < 2) {
          recoveryCount++
          ctx.setMethod?.('Yazı alanı kurtarma ' + recoveryCount + '/2')
          const recovered = await recoverInput(binding, typed, recoveryTurns)
          if (recovered) {
            binding = recovered
            visual = true
            return write(clearField)
          }
        }
        throw new Error('Odak bir yazı alanı değil (' + (typed.focusType || 'bilinmiyor')
          + ')' + (typed.where ? ' — ' + typed.where : '') + '. Yazı gönderilmedi; alan kurtarılamadı.')
      }
      inputWasSent = inputWasSent || (!typed?.needChoice && (typed?.writeSent !== false || clearField))
      if (binding && typed?.via === 'visual-caret' && typed.value == null) {
        throw new Error('INPUT_READBACK_UNAVAILABLE: Görsel alanın değeri doğrulanamadı; Enter gönderilmedi.')
      }
      reportTyping(typed)
      return typed
    }
    let typed = await write()
    let verified = false
    if (text) {
      let v = typed?.value !== undefined ? typed.value : await bridge.focusedValue()
      let state = v === null ? 'ok' : fieldState(v, text, clear)
      if (state === 'empty' || state === 'wrong') {
        if (!clear) {
          throw new Error(`Ekleme yazımı doğrulanamadı; mevcut alan silinmedi ve belirsiz yazı tekrar gönderilmedi. Alanda “${(v ?? '').slice(0, 60)}” var.`)
        }
        log('warn', `Alanda “${(v ?? '').slice(0, 60)}” yazıyor, beklenen bu değil. Bir kez daha yazılıyor.`)
        typed = await write(true)
        v = typed?.value !== undefined ? typed.value : await bridge.focusedValue()
        state = v === null ? 'ok' : fieldState(v, text, true)
        if (state === 'empty' || state === 'wrong') throw new Error(`Yazı alana gitmedi: alanda “${(v ?? '').slice(0, 60)}” var.`)
      }
      if (state === 'partial') log('warn', `Alan yazıyı biçimlendirmiş görünüyor (“${(v ?? '').slice(0, 60)}”); devam ediliyor.`)
      else if (v !== null) {
        verified = true
        log('success', 'Alan doğrulandı: yazı yerinde.')
      } else log('info', 'Yazı gönderildi; alan değeri okunamadığı için yazı doğrulanmış sayılmadı.')
    }
    if (enter) {
      await sleep(240)
      checkStopped()
      if (binding) await bridge.assertInputTarget(binding.window, typed?.focusHwnd)
      checkStopped()
      await bridge.sendKeys('{ENTER}', undefined, binding?.window, typed?.focusHwnd)
    }
    if (binding) { lastInput = binding; lastClickPoint = enter ? undefined : binding.at }
    return verified
  }

  // ---------- safety around input ----------

  async function waitUnlocked() {
    if (!(await bridge.isLocked())) return
    log('warn', 'Ekran kilitli ya da güvenlik ekranı açık; kilit açılana kadar bekleniyor (Ctrl+Shift+Q durdurur).')
    while (await bridge.isLocked()) await pause(5000)
    log('info', 'Kilit açıldı, devam ediliyor.')
    await pause(1500)
  }

  /** Windows that grab focus on their own; keys meant for the app must not go to them. */
  const FOCUS_THIEVES = /^(MusNotification(Ux)?|SecurityHealth(Host|Systray)|ShellExperienceHost|SearchHost|SearchApp|StartMenuExperienceHost|LockApp|Teams|ms-teams|Slack|Discord|OneDrive|XP Agent Studio|XP-Agent-Studio|Nubbo|Nubbo Agent Studio|electron)$/i
  let lastFg: { title: string; pid: number; proc?: string } | null = null
  let lastClickPoint: { x: number; y: number } | undefined

  async function noteForeground() {
    if (process.platform !== 'win32') return
    lastFg = await bridge.foreground()
  }

  /** Before keys or typing without a click: the window that had focus after our last action should still have it. */
  async function guardFocus(node: AgentNode) {
    if (process.platform !== 'win32' || !lastFg) return
    const fg = await bridge.foreground()
    if (!fg || fg.pid === lastFg.pid) return
    if (FOCUS_THIEVES.test(fg.proc ?? '') || fg.pid === process.pid) {
      if (!lastFg.title.trim()) {
        throw new Error(`Odak “${fg.title || fg.proc}” penceresine kaydı. Geri getirilecek pencerenin adı yok, tuş gönderilmiyor.`)
      }
      log('warn', `Odak “${fg.title || fg.proc}” penceresine kaymış; “${lastFg.title}” yeniden öne getiriliyor.`)
      try {
        await bridge.windowRect(lastFg.title)
        await sleep(300)
      } catch {
        throw new Error(`“${lastFg.title}” öne getirilemedi. Tuşlar “${fg.title || fg.proc}” penceresine gönderilmiyor.`)
      }
    } else {
      noteOnce(node.id, `fg:${fg.pid}`, `Not: öndeki pencere değişti (“${fg.title || fg.proc}”). “${node.title}” tuşları bu pencereye gönderilecek.`)
    }
  }

  // ---------- İnisiyatif ----------

  async function initiative(node: AgentNode, _stepNo: number, ahead?: StepAhead, vars: Record<string, string> = {}): Promise<boolean> {
    const s = getSettings()
    if (!s.apiKey) throw new Error('İnisiyatif için OpenRouter API anahtarı gerekli (Ayarlar > API Key).')
    const model = visionModels(s)
    const goal = node.prompt!.trim()
    const max = Math.min(40, Math.max(1, Math.floor(node.maxActions ?? 12)))
    const lastLap = (runTrace.get(node.id) ?? node.trace ?? []).map((l) => renderTemplate(l, vars) ?? l)
    const history: string[] = []
    const trace: string[] = []
    let lastSig = ''
    let repeats = 0
    const next = ahead?.next
      ? `${NODE_SPECS[ahead.next.kind].label}${ahead.next.prompt?.trim() ? `: ${ahead.next.prompt.trim()}` : ahead.next.text?.trim() ? `: ${ahead.next.text.trim()}` : ''}`
      : undefined

    for (let i = 1; i <= max; i++) {
      if (stopped()) throw new StoppedError()
      ctx.setMethod?.('İnisiyatif')
      const res = await bridge.scan({ image: s.sendScreenshot ? 'marked' : 'none', fresh: true, maxImageW: 1400, tilt: true })
      const items = res.items
      const image = res.image
      const a = await nextAction({
        apiKey: s.apiKey,
        model,
        system: promptOf(s.llmPrompts, 'initiative'),
        goal,
        stepTitle: NODE_SPECS[node.kind].label,
        history,
        lastLap,
        listText: describeItems(items, 300),
        image,
        next,
      })
      checkStopped()
      const item = a.id !== null ? items.find((x) => x.id === a.id) : undefined
      log(
        'info',
        `[inisiyatif ${i}/${max}] ${a.action}${item ? ` “${item.text}”` : a.id !== null ? ` #${a.id}` : ''}${a.text ? ` → “${a.text}”` : ''}${
          a.keys ? ` ${a.keys}` : ''
        }${a.reason ? ` — ${a.reason}` : ''}`
      )
      const sig = `${a.action}|${item?.text ?? a.id}|${a.text}|${a.keys}`
      repeats = sig === lastSig && a.action !== 'wait' ? repeats + 1 : 0
      lastSig = sig
      if (repeats >= 2) {
        log('warn', 'Aynı eylem üç kez sonuç vermedi. İnisiyatif burada duruyor.')
        return false
      }

      if (a.action === 'done') {
        const t = trace.map((l) => generalize(l, vars))
        runTrace.set(node.id, t)
        send('agent:patch', { id: node.id, patch: { trace: t } })
        log('success', `İnisiyatif hedefe ulaştı (${history.length} eylem).`)
        return true
      }
      if (a.action === 'fail') {
        log('warn', `İnisiyatif hedefe ulaşamadı: ${a.reason || 'gerekçe yok'}`)
        return false
      }
      try {
        if (a.action === 'wait') {
          await pause(a.seconds * 1000)
          history.push(`${a.seconds} sn beklendi`)
        } else if (a.action === 'key') {
          if (!a.keys) throw new Error('tuş boş')
          checkStopped()
          lastInput = undefined; lastClickPoint = undefined
          await bridge.sendKeys(a.keys)
          history.push(`tuş ${a.keys}`)
          trace.push(`tuş ${a.keys}`)
        } else if (a.action === 'type') {
          if (item) {
            checkStopped()
            await clickInput(center(item), item.text, node)
            await sleep(FOCUS_MS)
            await typeVerified(a.text, a.enter, true, lastClickPoint, node)
          } else {
            await typeVerified(a.text, a.enter, false, lastClickPoint, node)
          }
          const line = `yaz “${a.text}”${item ? ` → “${item.text}”` : ''}${a.enter ? ' + Enter' : ''}`
          history.push(line)
          trace.push(line)
        } else {
          if (!item) {
            history.push(`#${a.id} numaralı öğe yok (geçersiz seçim)`)
            continue
          }
          const mode = a.action === 'double' ? 'double' : a.action === 'right' ? 'right' : 'left'
          checkStopped()
          await clickInput(center(item), item.text, node, mode)
          const line = `${mode === 'double' ? 'çift tıkla' : mode === 'right' ? 'sağ tıkla' : 'tıkla'} “${item.text}”`
          history.push(line)
          trace.push(line)
        }
      } catch (e) {
        if (e instanceof StoppedError) throw e
        history.push(`hata: ${(e as Error).message.split('\n')[0]}`)
      }
      await pause(700)
    }
    log('warn', `İnisiyatif ${max} eylemde hedefe ulaşamadı.`)
    return false
  }

  // ---------- İnisiyatif: screenshots in, coordinates out (UI-TARS style) ----------

  type Shot = { img: { data: string; w: number; h: number; mime?: string }; area: { x: number; y: number; w: number; h: number }; sig: string }

  async function agentShot(tars: boolean, label: string): Promise<Shot> {
    const res = await bridge.scan({
      image: 'plain',
      uia: false,
      ocr: false,
      fresh: true,
      primary: true,
      // Under 1 megapixel, so a provider that downsizes images does not shift UI-TARS pixel coordinates.
      maxImageW: tars ? 1288 : 1400,
      snap: tars ? 28 : 0,
      fit: true,
      sig: true,
    })
    if (!res.image) throw new Error('Ekran görüntüsü alınamadı.')
    rememberShot(res.image.data, label)
    return { img: res.image, area: res.area, sig: res.sig ?? '' }
  }

  type Doable = Pick<GuiAction, 'kind' | 'x' | 'y' | 'x2' | 'y2' | 'keys' | 'text' | 'direction'>

  function describeGui(a: Doable): string {
    const pt = (x?: number, y?: number) => (x === undefined || y === undefined ? '' : ` (%${Math.round(x * 100)}, %${Math.round(y * 100)})`)
    switch (a.kind) {
      case 'click':
        return `tıkla${pt(a.x, a.y)}`
      case 'double':
        return `çift tıkla${pt(a.x, a.y)}`
      case 'right':
        return `sağ tıkla${pt(a.x, a.y)}`
      case 'drag':
        return `sürükle${pt(a.x, a.y)} →${pt(a.x2, a.y2)}`
      case 'hotkey':
        return `tuş ${(a.keys ?? []).join('+')}`
      case 'type':
        return `yaz “${(a.text ?? '').replace(/\n/g, '⏎')}”`
      case 'scroll':
        return `kaydır ${a.direction ?? 'down'}${pt(a.x, a.y)}`
      case 'wait':
        return 'bekle'
      default:
        return a.kind
    }
  }

  async function doGui(a: Doable, area: Shot['area'], node?: AgentNode) {
    checkStopped()
    const at = (x?: number, y?: number) => ({ x: area.x + (x ?? 0.5) * area.w, y: area.y + (y ?? 0.5) * area.h })
    switch (a.kind) {
      case 'click':
      case 'double':
      case 'right': {
        guiReplace = false
        const p = at(a.x, a.y)
        await clickInput(p, node?.prompt || 'The input clicked in the current GUI task', node, a.kind === 'double' ? 'double' : a.kind === 'right' ? 'right' : 'left')
        return
      }
      case 'drag': {
        guiReplace = false
        lastInput = undefined; lastClickPoint = undefined
        const p = at(a.x, a.y)
        const q = at(a.x2, a.y2)
        await bridge.drag(p.x, p.y, q.x, q.y)
        return
      }
      case 'hotkey':
        if (a.keys?.length) {
          guiReplace = a.keys.join('+') === 'ctrl+a'
          if (a.keys.join('+') !== 'ctrl+a') { lastInput = undefined; lastClickPoint = undefined }
          await bridge.hotkey(a.keys)
        }
        return
      case 'type': {
        const raw = a.text ?? ''
        const enter = /\n$/.test(raw)
        const body = raw.replace(/\n+$/, '')
        try { await typeVerified(body, enter, guiReplace, lastClickPoint, node) }
        finally { guiReplace = false }
        return
      }
      case 'scroll': {
        guiReplace = false
        lastInput = undefined; lastClickPoint = undefined
        const p = at(a.x, a.y)
        await bridge.scroll(p.x, p.y, a.direction ?? 'down', 5)
        return
      }
      case 'wait':
        await pause(5000)
        return
    }
  }

  /** A second look at the finished screen, by the vision model, before “bitti” is believed. */
  async function verifyGoal(goal: string, tars: boolean): Promise<{ ok: boolean; reason: string }> {
    checkStopped()
    const s = getSettings()
    const model = modelChain(s.visionModel, s.visionBackups)
    if (!s.apiKey || !model.length) return { ok: true, reason: 'kontrol modeli yok' }
    try {
      await pause(800)
      const shot = await agentShot(tars, 'inisiyatif kontrol')
      const r = await visionCheck({
        apiKey: s.apiKey,
        model,
        question: `Görev istenen sonuca ulaşmış mı? Bir programı açmak, penceresinin açık ve kullanılabilir olmasıdır. “bitir”, “finish” veya “complete” programı kapatmak değildir. Metinde kapat, çık, quit, exit veya kill yoksa uygulamayı kapatmayı isteme. Görev: ${goal}`,
        image: shot.img,
      })
      return { ok: r.answer, reason: r.reason }
    } catch (e) {
      if (e instanceof StoppedError) throw e
      log('warn', `Bitti kontrolü yapılamadı, modelin sözüne güveniliyor: ${(e as Error).message}`)
      return { ok: true, reason: '' }
    }
  }

  /** Replays the last good lap without the model while the screen still looks like it did then. */
  async function replayPath(steps: PathStep[], vars: Record<string, string>, tars: boolean): Promise<{ ok: boolean; done: PathStep[] }> {
    log('info', `Kayıtlı yol deneniyor (${steps.length} adım, model çağrılmadan).`)
    const done: PathStep[] = []
    for (const [i, st] of steps.entries()) {
      if (stopped()) throw new StoppedError()
      await waitUnlocked()
      const shot = await agentShot(tars, `kayıtlı yol ${i + 1}`)
      const diff = sigDiff(st.sig, shot.sig)
      if (st.sig && diff > REPLAY_DIFF) {
        log('info', `Kayıtlı yol ${i + 1}. adımda ayrıldı (ekran kayıttakinden farklı). Model buradan devam edecek.`)
        return { ok: false, done }
      }
      const a: Doable = {
        kind: st.action,
        x: st.rx,
        y: st.ry,
        x2: st.rx2,
        y2: st.ry2,
        keys: st.keys,
        text: renderTemplate(st.text, vars),
        direction: st.direction,
      }
      if (st.patch && a.x !== undefined && a.y !== undefined && process.platform === 'win32') {
        const px = shot.area.x + a.x * shot.area.w
        const py = shot.area.y + a.y * shot.area.h
        const hit = await bridge
          .findImage(st.patch, undefined, { x: px - PATCH_RADIUS, y: py - PATCH_RADIUS, w: PATCH_RADIUS * 2, h: PATCH_RADIUS * 2 })
          .catch(() => null)
        if (!hit || hit.score < PATCH_MIN) {
          log('info', `Kayıtlı yol ${i + 1}. adımda ayrıldı: tıklanacak yerdeki görüntü kayıttakiyle aynı değil (%${Math.round((hit?.score ?? 0) * 100)}). Model buradan devam edecek.`)
          return { ok: false, done }
        }
        const dx = (hit.x - px) / shot.area.w
        const dy = (hit.y - py) / shot.area.h
        a.x += dx
        a.y += dy
        if (a.x2 !== undefined && a.y2 !== undefined) {
          a.x2 += dx
          a.y2 += dy
        }
      }
      log('info', `[kayıtlı yol ${i + 1}/${steps.length}] ${describeGui(a)}`)
      await doGui(a, shot.area)
      done.push(st)
      await pause(a.kind === 'wait' ? 0 : a.kind === 'type' || a.kind === 'hotkey' ? 700 : 1000)
    }
    return { ok: true, done }
  }

  function savePath(node: AgentNode, steps: PathStep[], vars: Record<string, string>) {
    const out = steps.map((st) => (st.text ? { ...st, text: generalize(st.text, vars) } : st))
    runPath.set(node.id, out)
    send('agent:patch', { id: node.id, patch: { path: out } })
  }

  async function initiativeScreen(node: AgentNode, _stepNo: number, _ahead?: StepAhead, vars: Record<string, string> = {}): Promise<boolean> {
    const s = getSettings()
    if (!s.apiKey) throw new Error('İnisiyatif için OpenRouter API anahtarı gerekli (Ayarlar > API Key).')
    const model = agentModels(s)
    const tars = model.some((name) => isTarsModel(name))
    const goal = node.prompt!.trim()
    const max = Math.min(60, Math.max(1, Math.floor(node.maxActions ?? 25)))
    const history: GuiTurn[] = []
    let path: PathStep[] = []
    ctx.setMethod?.(tars ? 'UI-TARS' : 'İnisiyatif')
    log('info', `İnisiyatif (${model.join(' → ')}${tars ? ', UI-TARS sırada' : ''}): ${goal}`)
    if (!s.hideWhileRunning) log('warn', 'Ayarlarda “Çalışırken bu pencereyi küçült” kapalı; bu pencere ekran görüntüsünde görünür ve model ona tıklayabilir.')

    const saved = runPath.get(node.id) ?? node.path
    if (saved?.length && node.templated) {
      log('info', 'Hedefte her tur değişen bir değer ({{öğe}} gibi) var; geçen turun kayıtlı yolu bu tura uymayabileceği için oynatılmıyor, model ekrana bakarak yapacak.')
    } else if (saved?.length) {
      const r = await replayPath(saved, vars, tars)
      path = [...r.done]
      if (r.ok) {
        const v = await verifyGoal(goal, tars)
        if (v.ok) {
          log('success', `Kayıtlı yol hedefe ulaştı (${saved.length} adım).`)
          return true
        }
        log('info', `Kayıtlı yol bitti ama hedef tamam görünmüyor${v.reason ? ` (${v.reason})` : ''}. Model devam ediyor.`)
      }
      if (r.done.length) {
        history.push({
          thought: `Önceki turun kaydından ${r.done.length} adım oynatıldı: ${r.done.map((st) => describeGui({ ...st, kind: st.action })).join(', ')}`,
          raw: 'wait()',
          note: 'Kayıt buraya kadar oynatıldı. Ekrana bak ve görevin kalanını tamamla.',
        })
      }
    }

    let prev: Shot | null = null
    let still = 0
    let quietWaits = 0
    let rejected = 0
    let previousClick: (Point & { kind: string }) | undefined
    for (let i = 1; i <= max; i++) {
      if (stopped()) throw new StoppedError()
      ctx.setMethod?.(tars ? 'UI-TARS' : 'İnisiyatif')
      await waitUnlocked()
      const shot = await agentShot(tars, `inisiyatif ${i}`)
      const unchanged = !!prev && sigDiff(prev.sig, shot.sig) < STILL_DIFF
      if (unchanged) still++
      else still = 0
      if (still >= 6) {
        log('warn', 'Ekran 6 eylemdir değişmiyor. İnisiyatif burada duruyor.')
        return false
      }
      let unresolvedClick: (Point & { kind: string }) | undefined
      if (unchanged && previousClick && history.length) {
        const state = await bridge.inputState()
        checkStopped()
        if (!focusAt(state, previousClick)) {
          unresolvedClick = previousClick
          history[history.length - 1].note = clickFeedback(goal, previousClick, shot.area, state)
          log('info', 'Son tıklama görünür ilerleme üretmedi; koordinat ve odak bilgisiyle hedef yeniden değerlendiriliyor.')
        }
      }

      let a = await guiStep({
        apiKey: s.apiKey,
        model,
        goal,
        history,
        screen: shot.img,
        tarsPrompt: promptOf(s.llmPrompts, 'tars'),
        jsonPrompt: promptOf(s.llmPrompts, 'screen'),
      })
      checkStopped()
      if (unresolvedClick && repeatedClick(a, shot.area, unresolvedClick)) {
        log('warn', 'Model aynı sonuçsuz tıklama noktasını tekrar seçti; ikinci tıklama gönderilmedi.')
        history.push({ thought: a.thought, raw: a.raw, note: 'Bu tekrar yürütülmedi. ' + clickFeedback(goal, unresolvedClick, shot.area, null) })
        a = await guiStep({
          apiKey: s.apiKey, model, goal, history, screen: shot.img,
          tarsPrompt: promptOf(s.llmPrompts, 'tars'), jsonPrompt: promptOf(s.llmPrompts, 'screen'),
        })
        checkStopped()
        if (repeatedClick(a, shot.area, unresolvedClick)) {
          log('warn', 'Model hedefi yeniden bulamadı; aynı noktaya körlemesine tıklanmadan İnisiyatif duruyor.')
          return false
        }
      }
      checkStopped()
      log('info', `[inisiyatif ${i}/${max}] ${a.thought || '—'} → ${describeGui(a)}`)

      if (a.kind === 'finished') {
        const v = await verifyGoal(goal, tars)
        if (v.ok) {
          savePath(node, path, vars)
          log('success', `İnisiyatif hedefe ulaştı (${path.length} eylem)${a.text ? `: ${a.text}` : ''}.`)
          return true
        }
        rejected++
        log('warn', `Model “bitti” dedi ama kontrol onaylamadı${v.reason ? `: ${v.reason}` : ''}.`)
        if (rejected >= 2) return false
        history.push({ thought: a.thought, raw: a.raw, image: shot.img, note: `Kontrol: görev henüz tamamlanmamış görünüyor (${v.reason || 'eksik adım var'}). Eksik kalanı yap. Do not close the application.` })
        prev = shot
        continue
      }
      if (a.kind === 'call_user') {
        log('warn', `Model yardım istedi, İnisiyatif duruyor: ${a.thought || 'gerekçe yok'}`)
        return false
      }

      if (a.kind === 'wait' && unchanged) {
        quietWaits++
        if (quietWaits >= 2) {
          log('warn', 'Ekran beklerken değişmedi. Aynı bekleme tekrarlanmıyor.')
          history.push({
            thought: a.thought,
            raw: a.raw,
            image: shot.img,
            note: 'No visible change was observed during repeated waits. This alone does not prove the click failed. Check the goal and current screen; if loading is actually visible, wait briefly. Otherwise re-locate the target. Do not open unrelated menus or close the application merely to change the screen.',
          })
          prev = shot
          if (quietWaits >= 4) {
            log('warn', 'Bekleme ekranı açmadı. İnisiyatif burada duruyor.')
            return false
          }
          continue
        }
      } else if (a.kind !== 'wait') quietWaits = 0

      const turn: GuiTurn = { thought: a.thought, raw: a.raw, image: shot.img }
      try {
        let patch: string | undefined
        if (['click', 'double', 'right', 'drag'].includes(a.kind) && a.x !== undefined && a.y !== undefined) {
          const px = shot.area.x + a.x * shot.area.w
          const py = shot.area.y + a.y * shot.area.h
          patch = (await bridge.patchAt(px, py, 64))?.data
        }
        await doGui(a, shot.area, node)
        previousClick = ['click', 'double', 'right'].includes(a.kind) && a.x !== undefined && a.y !== undefined
          ? { x: shot.area.x + a.x * shot.area.w, y: shot.area.y + a.y * shot.area.h, kind: a.kind } : undefined
        path.push({
          patch,
          action: a.kind as PathStep['action'],
          rx: a.x,
          ry: a.y,
          rx2: a.x2,
          ry2: a.y2,
          keys: a.keys,
          text: a.text,
          direction: a.direction,
          thought: a.thought.slice(0, 160),
          sig: shot.sig,
        })
      } catch (e) {
        if (e instanceof StoppedError) throw e
        turn.note = `Bu eylem yapılamadı: ${(e as Error).message.split('\n')[0]}`
        log('warn', turn.note)
      }
      history.push(turn)
      prev = shot
      await pause(a.kind === 'wait' ? 0 : a.kind === 'type' || a.kind === 'hotkey' ? 700 : 1000)
    }
    log('warn', `İnisiyatif ${max} eylemde hedefe ulaşamadı.`)
    return false
  }

  // ---------- executor ----------

  const executor: Executor = {
    log,
    step: (id, status) => send('agent:step', { id, status }),
    patchNode: (id, patch) => send('agent:patch', { id, patch }),
    shouldStop: stopped,
    setLoop: (text) => ctx.setLoop?.(text),
    click: async (node, stepNo, ahead) => {
      await waitUnlocked()
      if (ahead?.next?.kind === 'type') await activateInputWindow(node)
      const t = await withScreenRetry(node.title, (wide) => findTarget(node, stepNo, wide), () => recoverTarget(node, ahead))
      const mode = node.clickMode ?? 'left'
      const confirmed = await ensureActed(node, ahead, async () => {
        checkStopped()
        if (mode === 'left' && ahead?.next?.kind === 'type') await clickInput(t, node.prompt || t.label, node)
        else {
          lastInput = undefined
          await bridge.clickAt(t.x, t.y, mode)
          lastClickPoint = mode === 'left' ? { x: t.x, y: t.y } : undefined
          trace(node, { kind: 'input', point: { x: Math.round(t.x), y: Math.round(t.y) }, mode, phase: 'sent' })
        }
        const verb = mode === 'double' ? 'Çift tıklandı' : mode === 'right' ? 'Sağ tıklandı' : 'Tıklandı'
        log('success', `${verb}: ${t.label} @${Math.round(t.x)},${Math.round(t.y)}`)
      })
      if (confirmed) saveMemo(node, t.memo)
      await noteForeground()
    },
    type: async (node, stepNo, ahead) => {
      await waitUnlocked()
      const text = node.text ?? ''
      const enter = !!node.pressEnter
      const clear = node.clearFirst !== false
      let t: Resolved | null = null
      if (node.prompt?.trim() || node.locator) {
        await activateInputWindow(node)
        t = await withScreenRetry(node.title, (wide) => findTarget(node, stepNo, wide), () => recoverTarget(node, ahead))
      } else {
        await guardFocus(node)
      }
      let valueVerified = false
      const write = async () => {
        checkStopped()
        if (t) {
          await clickInput(t, node.prompt || t.label, node)
          await sleep(FOCUS_MS)
          log('info', `Alan seçildi: ${t.label}`)
        }
        valueVerified = await typeVerified(text, enter, clear, lastClickPoint, node, ahead)
        if (enter) lastClickPoint = undefined
      }
      // A value readback is the postcondition for typing, not another label on
      // the same form. Only submission needs a screen-transition observation.
      const confirmed = enter ? await ensureActed(node, ahead, write) : (await write(), valueVerified)
      if (confirmed) saveMemo(node, t?.memo)
      await noteForeground()
    },
    key: async (node, ahead) => {
      await waitUnlocked()
      const keys = node.keys
      if (!keys) throw new Error(`“${node.title}”: gönderilecek tuş boş.`)
      if (!getSettings().targetWindow) await guardFocus(node)
      lastClickPoint = undefined
      lastInput = undefined
      guiReplace = false
      await ensureActed(node, ahead, async () => {
        checkStopped()
        await bridge.sendKeys(keys, getSettings().targetWindow || undefined)
      })
      await noteForeground()
    },
    exists: async (text, node) => {
      await waitUnlocked()
      const found = (how: string) => {
        log('info', `“${node.title}” gördü: ${how}.`)
        return true
      }
      if (node.locator && locatorFitsText(node, text)) {
        const how = await savedTargetVisible(node)
        if (how) return found(how)
      }
      if (text) {
        const res = await bridge.scan({ image: 'none', fresh: true, tilt: true, ocrEngine: 'windows', deferOnnx: true })
        try {
          noteCjk(res, node.id)
          const hit = containsTextStrict(res.items, text)
          if (hit) return found(`Windows OCR “${hit.text}”`)
          let onnxRes: ScanResult = res
          try {
            onnxRes = await bridge.applyOnnx(res)
          } catch {
            /* Windows lines stay */
          }
          const hit2 = containsTextStrict(onnxRes.items, text)
          if (hit2) return found(`ONNX “${hit2.text}”`)
          if (!node.locator && !noted.has(`${node.id}:loose`)) {
            const near = onnxRes.items.find((i) => containsText([i], text))
            if (near) noteOnce(node.id, 'loose', `“${text}” tam kelime olarak yok ama “${near.text}” içinde geçiyor; Koşul bunu “var” saymıyor. Gerekirse yazıyı “${near.text}” yap.`)
          }
        } finally {
          bridge.discardShot(res.shot)
        }
      }
      return false
    },
    captureFailure: async (label) => {
      if (!failDir) return
      fs.mkdirSync(failDir, { recursive: true })
      const res = await bridge.scan({ image: 'plain', uia: false, ocr: false, fresh: true, maxImageW: 1600 }).catch(() => null)
      if (!res?.image?.data) return
      const safe = label.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 60)
      const file = path.join(failDir, `hata-${new Date().toISOString().replace(/[:.]/g, '-')}-${safe}.jpg`)
      fs.writeFileSync(file, Buffer.from(res.image.data, 'base64'))
      log('info', `Hata anının ekran görüntüsü kaydedildi: ${file}`)
    },
    initiative: (node, stepNo, ahead, vars) =>
      node.engine === 'list' ? initiative(node, stepNo, ahead, vars) : initiativeScreen(node, stepNo, ahead, vars),
  }

  /** Same resolver, one read-only pass. No click, typing, recovery actions or memory write. */
  const previewTarget = (node: AgentNode) => resolveTarget(node, 0, false, true)
  return { executor, beginRun, previewTarget }
}
