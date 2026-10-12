import { checkObservation, observeWithin, type ObservationOptions } from './observation-budget'
import { refineWordTarget } from './word-targets'
import { asksDesktopShortcut, taskbarItem } from './spatial-context'
import { screen as electronScreen } from 'electron'
import fs from 'fs'
import path from 'path'
import * as bridge from './a11y-bridge'
import * as browser from './browser'
import { conditionNeedle, describeAhead, expectation, judgeScreen, type Verdict } from './confirm'
import { NODE_SPECS, modelChain, screenCheckMode, type AgentNode, type AppSettings, type LogLevel, type TargetMemo } from './graph-types'
import { clickableBy, writableBy } from './target-match'
import {
  containsText,
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
  type TiePolicy,
} from './matcher'
import { activeFindOrder, promptOf, DEFAULT_PROMPTS } from './llm-flow'
import { conflict, describeMemory, likeness, memoOf, remember } from './memory'
import { clearHover, recordHover } from './hover'
import {
  chooseScreenTarget,
  chooseVisualTarget,
  type VisualTargetResult,
  isTarsModel,
  judgeReaction,
  chooseTypeField,
  planStall,
  type ReactionVerdict,
} from './openrouter'
import { localConfigured } from './openrouter'
import { interruptibleSleep, StoppedError, type Executor, type StepAhead } from './runner'
import { type Point } from './input-policy'
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
  /**
   * Hands the error screenshot's path to the tool layer as data, when one was written. An empty
   * string means the picture could not be taken, which the report says plainly instead of looking
   * for a path in a log line.
   */
  noteFailureShot?: (file: string) => void
  /** Opt-in developer evidence; never changes success/failure or the node schema. */
  onTargetTrace?: (event: TargetTrace) => void
  captureTargetImages?: boolean
}

type Resolved = { x: number; y: number; label: string; memo?: TargetMemo }

class NotFoundError extends Error {}
/** A popup input was attempted: never replay it through the generic target retry. */
class VisualTargetRecoveryError extends Error {}

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

function center(t: { x: number; y: number; w: number; h: number; clickPoint?: { x: number; y: number } }) {
  if (t.clickPoint) return t.clickPoint
  return { x: t.x + t.w / 2, y: t.y + t.h / 2 }
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
    clearHover()
    runMemo.clear()
    noted.clear()
    lastClickPoint = undefined
    guiReplace = false
    warnedMissing.clear()
  }

  function warnMissingWindow(res: ScanResult) {
    if (!res.missingWindow || warnedMissing.has(res.missingWindow)) return
    warnedMissing.add(res.missingWindow)
    log('warn', `Hedef pencere “${res.missingWindow}” açık değil, tüm ekran okunuyor. Kalıcı çözüm: Ayarlar > Hedef pencere > “Tüm ekran” > Kaydet.`)
  }

  async function scanFor(withImage: boolean, wide = false, deferOnnx = false, readOnly = false, targetTrace = false, ocrOnly = false): Promise<ScanResult & { shot?: string }> {
    const s = getSettings()
    const res = await bridge.scan({
      windowTitle: wide ? undefined : s.targetWindow || undefined,
      image: withImage ? 'marked' : targetTrace && ctx.onTargetTrace && ctx.captureTargetImages ? 'plain' : 'none',
      fresh: wide,
      tilt: true,
      ocrEngine: 'combined',
      deferOnnx,
      readOnly,
      ...(ocrOnly ? { uia: false } : {}),
    })
    warnMissingWindow(res)
    noteCjk(res, 'scan')
    const ocrVia =
      res.ocrEngine === 'combined' ? `Windows ${res.ocrCount} + ONNX ${res.onnxAdded ?? 0} ek okuma` : res.ocrEngine === 'onnx' ? `ONNX ${res.onnxAdded ?? 0}` : res.ocr ? `${res.ocrCount}` : 'kapalı'
    const side = res.sideCount ? ` +yan ${res.sideCount}` : ''
    log('info', `Ekran tarandı: ${res.items.length} yazı/öğe (UIA ${res.uiaCount}, OCR ${ocrVia}${side})${res.window ? ` — ${res.window}` : ''}`)
    if (ocrVia === 'kapalı') log('warn', 'Windows OCR kullanılamıyor; sadece uygulamanın bildirdiği isimler görülebiliyor.')
    if (process.platform === 'win32' && res.onnx === false) noteOnce('scan', 'onnx', 'ONNX okuması kullanılamadı veya ek yazı bulamadı; mevcut Windows OCR sonuçları korunuyor.')
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
    const items = asksDesktopShortcut(node.prompt ?? '') ? scan.items.filter(i => !taskbarItem(scan, i)) : scan.items
    const scopedScan = { ...scan, items }
    const area = scan.area
    const prompt = node.prompt?.trim() ?? ''
    const explicit = extractTarget(prompt)
    const loc = node.locator
    const recordedText = loc?.text || loc?.name || ''
    // A target that contains {{öğe}} changes every lap; last lap's spot would point at last lap's item.
    const mem = node.templated ? undefined : memoFor(node)
    const prefer = mem?.length ? (it: ScreenItem) => likeness(mem, memoOf(it, area, win)) : undefined
    const anchor = mem?.length ? undefined : node.anchor ?? (loc?.x !== undefined && loc?.y !== undefined ? { x: loc.x, y: loc.y } : undefined)
    const useLlm = allowLlm && (!!s.apiKey || localConfigured()) && !!prompt
    // Eşit adaylar (aynı yazıdan birden fazla): model varsa ayırt edici yoksa SEÇİM YAPILMAZ ve
    // karar modele bırakılır. Model yoksa eski deterministik davranış (ilk aday) korunur; yoksa
    // modelsiz çalışan akışlar hedef bulamayıp durur.
    const tie: TiePolicy = useLlm ? 'ask' : 'first'
    const tieNote = (m: string) => log('warn', m)

    let hit: Target | null = null
    let how = ''
    let exact = false
    if (!llmOnly && explicit?.quoted) {
      hit = matchText(items, explicit.text, { anchor, minScore: 60, prefer, tie, note: tieNote }) ?? matchFuzzy(items, explicit.text, { anchor, minScore: 80, prefer, tie, note: tieNote })
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
        scan: scopedScan,
        stepTitle: NODE_SPECS[node.kind].label,
        sendImage: node.kind !== 'condition' && s.sendScreenshot && !!scan.image,
        onImageFallback: (m) => log('warn', m),
        hint: describeMemory(mem) || undefined,
        system: promptOf(s.llmPrompts, 'list'),
      })
      trace(node, { kind: 'model', source: win === 'chrome' ? 'chrome' : 'list', value: choice })
      const item = choice.id !== null ? items.find((i) => i.id === choice.id) : undefined
      if (item) {
        log('info', `Seçilen hedef #${item.id}: ${item.src}/${item.type} “${item.text.slice(0, 120)}” @${item.x},${item.y} ${item.w}x${item.h}${scan.window ? ` / ${scan.window}` : ''}`)
        hit = choice.wordIndex !== undefined ? refineWordTarget(item, choice.wordIndex) : refineTarget(item, choice.text)
        if (!hit) return null
        if (choice.wordIndex !== undefined) log('info', `Seçilen OCR kelimesi #${choice.candidateId ?? '?'}: “${hit.text}” @${hit.x},${hit.y} ${hit.w}x${hit.h}; yalnız bu kelimeye tıklanacak.`)
        how = `LLM${choice.reason ? ` — ${choice.reason}` : ''}`
        byLlm = true
      } else {
        log('warn', `LLM uygun öğe bulamadı${choice.reason ? `: ${choice.reason}` : ''}.`)
      }
    }
    if (!hit && !llmOnly) {
      hit =
        matchPrompt(items, prompt || recordedText, anchor, prefer, { tie, note: tieNote }) ??
        (explicit ? matchText(items, explicit.text, { anchor, prefer, tie, note: tieNote }) : null) ??
        (recordedText ? matchText(items, recordedText, { anchor, prefer, tie, note: tieNote }) : null) ??
        matchFuzzy(items, explicit?.text || prompt || recordedText, { anchor, prefer, tie, note: tieNote }) ??
        (recordedText && prompt ? matchFuzzy(items, recordedText, { anchor, prefer, tie, note: tieNote }) : null)
      how = 'yazı eşleşmesi'
    }
    if (!hit) return null

    let memo = memoOf(hit.item, area, win)
    const why = exact ? null : conflict(mem, memo)
    if (why) {
      log('warn', `Bu tur farklı: ${why}. Tıklamadan önce bir kez daha bakılıyor.`)
      if ((s.apiKey || localConfigured()) && prompt && !byLlm) {
        try {
          const second = await chooseScreenTarget({
            apiKey: s.apiKey,
            model: textModels(s),
            prompt,
            kind: node.kind,
            scan: scopedScan,
            stepTitle: NODE_SPECS[node.kind].label,
            sendImage: node.kind !== 'condition' && s.sendScreenshot && !!scan.image,
            hint: `${describeMemory(mem)}. Bu tur yazı eşleşmesi #${hit.item.id} “${hit.item.text}” öğesini buldu ama ${why}. Talimata göre doğru öğe hangisi?`,
            system: promptOf(s.llmPrompts, 'list'),
          })
          trace(node, { kind: 'model', source: win === 'chrome' ? 'chrome' : 'list', value: second })
          const item = second.id !== null ? items.find((i) => i.id === second.id) : undefined
          if (item && (item.id !== hit.item.id || second.wordIndex !== undefined)) {
            log('info', `İkinci bakış başka öğe seçti: #${item.id} “${item.text}”${second.reason ? ` — ${second.reason}` : ''}`)
            const refined = second.wordIndex !== undefined ? refineWordTarget(item, second.wordIndex) : refineTarget(item, second.text)
            if (!refined) return null
            hit = refined
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
    // Conditions with a literal-only instruction are handled in exists().
    // Quotes embedded inside a descriptive condition must not erase its numbers/negations.
    const marked = node.kind === 'condition' ? null : extractTarget(prompt)
    const quoted = marked?.quoted ? marked.text : ''
    const requestedOrder = activeFindOrder(s.findOrder, s.findOff)
    // Conditions reuse the Click resolver and its OCR/list handlers, but may never
    // use a picture, UIA/DOM control, saved icon or coordinate as state evidence.
    const ocrOnly = node.kind === 'condition'
    const order = ocrOnly ? requestedOrder.filter(stage => ['windows', 'onnx', 'list'].includes(stage)) : requestedOrder
    // A visual-only configuration still has an OCR/text alternative for conditions.
    // Fast find removes tars before this point, so it does not enable a model call.
    if (ocrOnly && requestedOrder.includes('tars') && !order.includes('list')) order.push('list')
    trace(node, { kind: 'request', node, order, readOnly, windowTitle: win, modelEnabled: !!s.apiKey || localConfigured(), memory: memoFor(node) })
    const resolved = (target: Resolved, source: FindStageId, rect?: TargetRect, item?: ScreenItem): Resolved => {
      if (asksDesktopShortcut(prompt) && winScan && taskbarItem(winScan, { x: target.x, y: target.y, w: 0, h: 0 })) {
        throw new NotFoundError('Masaüstü kısayolu istendi, ancak hedef görev çubuğunda bulundu; tıklama gönderilmedi.')
      }
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
    let seenItems: ScreenItem[] = []

    const windowsScan = async () => {
      if (!winScan) {
        winScan = await scanFor(false, wide, false, readOnly, !ocrOnly, ocrOnly)
        const { shot: _temporary, ...snapshot } = winScan
        trace(node, { kind: 'observation', source: 'windows', scan: snapshot })
        // A diagnostic screenshot must not become a new model input. This path
        // normally scans with image:none; keep the live resolver's inputs identical.
        winScan = { ...winScan, image: null, ...(ocrOnly ? { items: winScan.items.filter(item => item.src === 'ocr') } : {}) }
        shotFile = winScan.shot || ''
        seenItems = winScan.items
      }
      return winScan
    }
    const quoteOnScreen = (scan: ScanResult, text: string, where: string): TargetPick | null => {
      const mem = node.templated ? undefined : memoFor(node)
      const prefer = mem?.length ? (it: ScreenItem) => likeness(mem, memoOf(it, scan.area, where)) : undefined
      const anchor = mem?.length ? undefined : node.anchor ?? (loc?.x !== undefined && loc?.y !== undefined ? { x: loc.x, y: loc.y } : undefined)
      const items = asksDesktopShortcut(prompt) ? scan.items.filter(i => !taskbarItem(scan, i)) : scan.items
      // Birebir tırnaklı hedefte de iki aday eşit olabilir: model varsa seçim modele bırakılır.
      const tie: TiePolicy = s.apiKey || localConfigured() ? 'ask' : 'first'
      const hit = matchText(items, text, { anchor, minScore: 100, prefer, tie, note: (m) => log('warn', m) })
      if (!hit) return null
      return { item: hit.item, target: hit, memo: memoOf(hit.item, scan.area, where), how: 'yazı' }
    }

    try {
      if (asksDesktopShortcut(prompt)) await windowsScan()
      for (const stage of order) {
        if (stopped()) throw new StoppedError()
        if (stage === 'chrome') {
          const userChrome = await browser.userChromeItems(win || undefined)
          trace(node, { kind: 'observation', source: 'chrome', scan: userChrome ? pseudoScan(userChrome.items, userChrome.area, userChrome.host) : null })
          if (!userChrome) continue
          ctx.setMethod?.('Chrome sayfası')
          log('info', `[chrome] Sayfada ${userChrome.items.length} yazı okundu.`)
          const pick = await pickFrom(node, pseudoScan(userChrome.items, userChrome.area, userChrome.host), 'chrome', true, node.kind === 'condition')
          if (pick) return resolved({ ...center(pick.target), memo: pick.memo, label: `[chrome] “${pick.target.text}” (${pick.how})` }, 'chrome', pick.target, pick.item)
          log('info', '[chrome] Sayfada bulunamadı.')
        }
        if (stage === 'uia' && !loc && node.kind === 'click' && hasText) {
          // A written click command with no saved element. The uia tree names the control itself,
          // which is a better target than the text drawn on it - the middle of a caption's box is
          // not always the middle of the button.
          ctx.setMethod?.('Uygulama öğesi (UIA)')
          const scan = await windowsScan()
          const hit = clickableBy(scan.items, (quoted || prompt || '').trim(), lastClickPoint)
          if (hit) {
            log('info', `[uia] Uygulama öğesi bulundu: “${hit.text}” (${hit.type}) @${Math.round(hit.x + hit.w / 2)},${Math.round(hit.y + hit.h / 2)}`)
            return resolved(
              { ...center(hit), label: `uygulama öğesi “${hit.text || hit.type}”`, memo: memoOf(hit, scan.area, 'uia') },
              'uia',
              hit,
              hit
            )
          }
        }
        if (stage === 'uia' && !loc && node.kind === 'type' && hasText) {
          // A write node whose only command is written text, with no saved element. Typing needs the
          // field itself, and the field is only in the uia tree: the visual text stages can find the
          // label next to it and click it, which focuses the field, but they cannot type into it.
          // Only an editable control type is accepted, and the value read back after typing is the
          // proof - a read-only or disabled field simply fails that check instead of being trusted.
          ctx.setMethod?.('Yazılabilir alan (UIA)')
          const scan = await windowsScan()
          const wanted = (quoted || prompt || '').trim()
          const hit = writableBy(scan.items, wanted, lastClickPoint)
          if (hit) {
            log('info', `[uia] Yazılabilir alan bulundu: “${hit.text}” (${hit.type}) @${Math.round(hit.x + hit.w / 2)},${Math.round(hit.y + hit.h / 2)}`)
            return resolved(
              { ...center(hit), label: `yazılabilir alan “${hit.text || hit.type}”`, memo: memoOf(hit, scan.area, 'uia') },
              'uia',
              hit,
              hit
            )
          }
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
        if (stage === 'windows' && !quoted) {
          if (stage === 'windows') log('info', 'Tırnak içi kesin metin yok; doğrudan OCR metin eşleştirmesi atlanıyor. Ekran taraması ve modelle seçim devam eder.')
          continue
        }
        if (stage === 'windows' && quoted) {
          ctx.setMethod?.('Windows + ONNX OCR')
          log('info', `“${quoted}” birleşik OCR ile aranıyor.`)
          const scan = await windowsScan()
          const pick = quoteOnScreen(scan, quoted, scan.window || win)
          if (pick) {
            const reader = pick.item.src === 'ocr' ? (pick.item.ocrSources ?? ['windows']).join('+') : 'uygulama öğesi'
            return resolved({ ...center(pick.target), memo: pick.memo, label: `“${pick.target.text}” (${reader}, ${pick.how})` }, 'windows', pick.target, pick.item)
          }
          log('info', `“${quoted}” birleşik OCR’da yok.`)
        }
        if (stage === 'list' && hasText) {
          ctx.setMethod?.('Kelime listesi')
          const scan = await windowsScan()
          log('info', 'OCR kelime listesi yazı modeline gidiyor.')
          const pick = await pickFrom(node, scan, scan.window || win, true, true)
          if (pick) return resolved({ ...center(pick.target), memo: pick.memo, label: `“${pick.target.text}” (yazı modeli, ${pick.how})` }, 'list', pick.target, pick.item)
        }
        if (stage === 'tars' && (s.apiKey || localConfigured()) && (hasText || loc?.icon)) {
          ctx.setMethod?.('Görsel hedefleme')
          try {
            log('info', 'Görsel model ekran görüntüsüne bakıyor.')
            return await locateWithTars(node, wide, readOnly)
          } catch (e) {
            if (e instanceof StoppedError || e instanceof VisualTargetRecoveryError) throw e
            if (node.kind === 'condition' && !(e instanceof NotFoundError)) throw e
            if (e instanceof NotFoundError) log('warn', e.message)
            else log('warn', `Görsel hedefleme atlandı: ${(e as Error).message}`)
          }
        }
        if (stage === 'offset' && loc?.offsetX !== undefined && loc.offsetY !== undefined && win) {
          // A recorded point is never evidence on its own. When the locator carries a picture,
          // the icon stage above already searched for it and did not find it; when it carries
          // none, there is nothing to check at all. Either way, clicking the old point would be
          // the "click somewhere and hope" the product forbids, so the step stops with a reason
          // instead. Every target captured on screen stores a picture, so a locator without one
          // is a legacy or hand-made entry.
          try {
            const r = await bridge.windowRect(win)
            trace(node, { kind: 'observation', source: 'offset', value: r })
          } catch {
            /* window gone */
          }
          log('warn', `Kayıtlı konuma tıklanmadı: ${loc.icon ? 'kayıtlı resim ekranda bulunamadı' : 'kayıtlı resim yok'} — tıklamayı destekleyen ekran kanıtı yok.`)
          continue
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
    const message = `“${explicit?.text || prompt || loc?.text || node.title}” ekranda bulunamadı.${s.apiKey || localConfigured() ? '' : ' (API anahtarı ya da yerel adres yok, sadece yazı eşleşmesi denendi.)'}${
        seen ? ` Ekranda görülenlerden bazıları: ${seen}` : ''
      }`
    trace(node, { kind: 'failure', message })
    throw new NotFoundError(message)
  }

  function visionPrompt(node: AgentNode): string {
    const p = node.prompt?.trim()
    if (p && node.kind === 'condition') return `Read-only existence/state check. Find visible evidence for the whole condition, preserving required counters and negations. If the condition is not supported by the current screen, return missing. Do not point to an action that would make it true, open menus, or dismiss popups. Condition: ${p}`
    if (p) return p
    if (node.locator?.icon) return 'İkinci resimdeki simgenin/düğmenin ekrandaki yerini bul'
    const t = node.locator?.text || node.locator?.name
    if (t) return `“${t}” yazan yere`
    throw new Error(`“${node.title}”: görsel mod için ekranda neyin bulunacağını yaz.`)
  }

  function validVisualPoint(result: VisualTargetResult): boolean {
    return Number.isFinite(result.x) && Number.isFinite(result.y) && result.x! >= 0 && result.x! < 1 && result.y! >= 0 && result.y! < 1
  }

  /** Last stage: UI-TARS looks at the original upright screenshot and points. The ramp and the 90° turn stay on the OCR copies. */
  async function locateWithTars(node: AgentNode, wide = false, readOnly = false): Promise<Resolved> {
    const s = getSettings()
    if (!s.apiKey && !localConfigured()) throw new NotFoundError('Görsel hedefleme için API anahtarı yok.')
    const model = agentModels(s)
    const prompt = visionPrompt(node)
    const canDismiss = !readOnly && node.kind === 'click' && node.clickMode !== 'move'
    let dismissalRecord: string | undefined
    let didDismiss = false
    const capture = () => bridge.scan({
      windowTitle: wide ? undefined : s.targetWindow || undefined,
      image: 'plain', uia: false, ocr: false, fresh: wide || didDismiss,
      maxImageW: isTarsModel(model[0] || '') ? 1288 : 1400,
      snap: isTarsModel(model[0] || '') ? 28 : 0, fit: true, readOnly,
    })
    try {
      let res = await capture()
      let action: VisualTargetResult
      while (true) {
        checkStopped()
        trace(node, { kind: 'observation', source: 'tars', scan: res })
        warnMissingWindow(res)
        if (!res.image) throw new NotFoundError('Görsel hedefleme için ekran görüntüsü alınamadı.')
        action = await chooseVisualTarget({
          apiKey: s.apiKey, model, goal: prompt, screen: res.image,
          allowDismiss: canDismiss && !didDismiss, dismissalRecord,
          tarsPrompt: promptOf(s.llmPrompts, 'tars'), jsonPrompt: promptOf(s.llmPrompts, 'screen'),
        })
        checkStopped()
        trace(node, { kind: 'model', source: 'tars', value: action })
        if (action.intent !== 'dismiss') break
        if (!canDismiss || didDismiss) throw new VisualTargetRecoveryError('Bu aramada ikinci bir popup kapatma veya salt okunur aramada tıklama gönderilmedi.')
        if (!validVisualPoint(action)) throw new VisualTargetRecoveryError('Popup kapatma yanıtında geçerli nokta yok; tıklama gönderilmedi.')
        const x = res.area.x + action.x! * res.area.w, y = res.area.y + action.y! * res.area.h
        await waitUnlocked()
        checkStopped()
        clearHover()
        lastClickPoint = undefined
        guiReplace = false
        // Flag before dispatch: a thrown native call can have partially sent input.
        didDismiss = true
        try { await sendClick(x, y, 'left') }
        catch (e) { throw new VisualTargetRecoveryError(`Popup kapatma girdisi başarısız; tekrar gönderilmeyecek: ${(e as Error).message}`) }
        checkStopped()
        trace(node, { kind: 'input', point: { x: Math.round(x), y: Math.round(y) }, mode: 'popup-dismiss', phase: 'sent' })
        log('info', `Popup kapatma tıklaması gönderildi @${Math.round(x)},${Math.round(y)}; node tamamlanmadı, asıl hedef yeni görüntüde aranacak.`)
        dismissalRecord = `One LEFT click was dispatched at screen (${Math.round(x)},${Math.round(y)}) to dismiss an unrelated popup. No click on the requested target has been sent. The popup's disappearance is NOT verified. Do not reuse that point; find the original requested target in this new image.`
        await pause(FOCUS_MS)
        res = await capture()
      }
      let pointed = action.intent === 'target' && validVisualPoint(action)
      let a = res.area
      let thought = action.reason
      // A small, wordless target - a colour swatch, a tiny icon - is easy to miss on a whole screen and
      // easy to point at inside a small frame. If the first look found nothing and we know roughly
      // where to look (the point just clicked, or a recorded hint), the same question is asked again
      // about a crop around that point, and the answer is mapped back onto the screen. A crop is not
      // new detail, but it removes everything else the model was looking at.
      if (!pointed) {
        const anchor =
          node.locator?.x !== undefined && node.locator?.y !== undefined
            ? { x: node.locator.x, y: node.locator.y }
            : lastClickPoint
        if (anchor) {
          const zoomW = 420
          const zoomH = 240
          const rect = {
            x: Math.max(0, Math.round(anchor.x - zoomW / 2)),
            y: Math.max(0, Math.round(anchor.y - zoomH / 2)),
            w: zoomW,
            h: zoomH,
          }
          try {
            const crop = await bridge.crop(rect, 1080, true, isTarsModel(model[0] || '') ? 28 : 0)
            trace(node, { kind: 'observation', source: 'tars', scan: { ...crop, zoomed: rect } as unknown as ScanResult })
            if (crop.image) {
              const again = await chooseVisualTarget({
                apiKey: s.apiKey,
                model,
                goal: `This is a ZOOMED-IN crop of one part of the screen, ${crop.area.w}x${crop.area.h} pixels of it. Find the requested target inside the crop: ${prompt}.`,
                allowDismiss: false, dismissalRecord,
                screen: crop.image,
                tarsPrompt: promptOf(s.llmPrompts, 'tars'),
                jsonPrompt: promptOf(s.llmPrompts, 'screen'),
              })
              trace(node, { kind: 'model', source: 'tars', value: again })
              const ok2 = again.intent === 'target' && validVisualPoint(again)
              log('info', `[Görsel model] Tam ekranda bulunamadı; ${rect.w}×${rect.h} bölge büyütülüp tekrar soruldu${ok2 ? ' ve bulundu' : ''}.`)
              if (ok2) {
                pointed = true
                a = crop.area
                thought = again.reason
                action.x = again.x
                action.y = again.y
              }
            }
          } catch (e) {
            if (e instanceof StoppedError) throw e
            log('warn', `[Görsel model] Kırpılmış bölge sorulamadı: ${(e as Error).message}`)
          }
        }
      }
      checkStopped()
      if (!pointed) {
        const message = `Görsel model asıl hedefi göstermedi${action.reason ? `: ${action.reason}` : ''}.`
        if (didDismiss) throw new VisualTargetRecoveryError(`${message} Popup tıklaması tekrarlanmayacak; sonraki node'a geçilmedi.`)
        throw new NotFoundError(message)
      }
      const x = a.x + action.x! * a.w
      const y = a.y + action.y! * a.h
      trace(node, { kind: 'resolved', source: 'tars', target: { x, y, label: '[Görsel model] ekran görüntüsü' } })
      log('info', `[Görsel model] ${thought || action.intent}`)
      return {
        x,
        y,
        label: '[Görsel model] ekran görüntüsü',
        memo: { win: res.window || '', type: 'Nokta', src: 'ocr', rx: a.w ? (x - a.x) / a.w : 0.5, ry: a.h ? (y - a.y) / a.h : 0.5, text: prompt.slice(0, 80), at: Date.now() },
      }
    } catch (e) {
      if (e instanceof StoppedError || e instanceof VisualTargetRecoveryError) throw e
      if (didDismiss) throw new VisualTargetRecoveryError(`Popup girdisinden sonra asıl hedef aranamadı; kapatma tekrarlanmayacak: ${(e as Error).message}`)
      throw e
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
    if ((!s.apiKey && !localConfigured()) || !model.length || !before.image || !after.image) return v
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
    if ((!s.apiKey && !localConfigured()) || !model.length) return null
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
      // CLAUDE.md §17: the decision is log-only by default, and "off" means the action is taken
      // at its word - no screen scans, no waiting and no model calls. This is the answer to the
      // cost the decision note describes, and why the threshold is not being tuned again.
      const mode = screenCheckMode(getSettings())
      if (mode === 'off') {
        await act()
        return true
      }
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
    // §17: the closer look and the plan question cost model calls, so only "on" asks for them.
    if (mode === 'on' && expected && (verdict.kind === 'blocked' || verdict.kind === 'unknown')) {
      verdict = await lookCloser(verdict, before, after, node, ahead)
      if (verdict.kind === 'ready') {
        log('success', `Emin: ${verdict.reason}.`)
        return true
      }
    }

    // Log-only: what was seen is written down in full, but the step is not judged and no model is
    // asked. The next step looks for its own target, so an unclear reaction costs nothing here.
    if (mode === 'log') {
      log('info', `Tepki net değil (${verdict.reason}). Yalnızca günlük modu: adım hata sayılmadı, sıradaki adım kendi hedefini arayacak.`)
      return false
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
    // The dedicated recovery agent receives the original goal and full run context.
    // Do not let the legacy plan replace it with the next node's target first.
    if (getSettings().recovery?.enabled) return null
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
  async function savedTargetVisible(node: AgentNode, options?: ObservationOptions): Promise<string | null> {
    const loc = node.locator!
    const win = loc.windowTitle || getSettings().targetWindow || ''
    if (win && (loc.automationId || loc.name?.trim()) && !['Pane', 'Window', 'Document', 'Point', 'Custom'].includes(loc.controlType)) {
      try {
        const r = await observeWithin(bridge.locate(loc, win, true, options?.signal), options?.signal)
        if (r && r.w * r.h < 600 * 400) {
          if (r.enabled === false) {
            noteOnce(node.id, 'disabled', `“${r.name || loc.name}” ekranda ama pasif (tıklanamaz); hazır sayılmıyor.`)
          } else return `uygulama öğesi “${r.name || loc.name}”`
        }
      } catch (e) {
        if (!(e instanceof Error) || !/^(WINDOW_NOT_FOUND|NO_TARGET_WINDOW|Hedef pencere bulunamadı)/.test(e.message)) throw e
        // Missing window is absence; a worker/permission error is not.
      }
    }
    if (loc.icon) {
      try {
        const hit = await observeWithin(bridge.findImage(loc.icon, undefined, undefined, options?.signal), options?.signal)
        if (hit && hit.score >= ICON_CHECK_MIN) return `simge resmi (%${Math.round(hit.score * 100)} benzer, @${hit.x},${hit.y})`
      } catch (e) {
        throw e
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

  let guiReplace = false

  async function activateInputWindow(node: AgentNode) {
    const title = getSettings().targetWindow || node.locator?.windowTitle
    if (process.platform !== 'win32' || !title) return
    checkStopped()
    try { await bridge.inputTarget({ windowTitle: title }) }
    catch (e) { log('warn', `Pencere öne alınamadı; güncel ekrandan hedef aranacak: ${(e as Error).message.split('\n')[0]}`) }
    checkStopped()
  }

  async function sendClick(...args: Parameters<typeof bridge.clickAt>) {
    const result = await bridge.clickAt(...args)
    if (result?.warning) log('warn', `Tıklama uyarısı: ${result.warning}`)
    return result
  }

  async function clickInput(point: Point, node?: AgentNode, mode: 'left' | 'double' | 'right' = 'left') {
    clearHover()
    checkStopped()
    // Explicit desktop action: the chosen point is not reclassified as an input field.
    await sendClick(point.x, point.y, mode)
    if (node) trace(node, { kind: 'input', point: { x: Math.round(point.x), y: Math.round(point.y) }, mode, phase: 'sent' })
    lastClickPoint = mode === 'right' ? undefined : { x: point.x, y: point.y }
  }

  /** Send explicit keyboard input once; do not classify or read the selected field. */
  async function typeDirect(
    text: string,
    enter: boolean,
    clear: boolean,
    at?: { x: number; y: number },
  ) {
    clearHover()
    checkStopped()
    // The user/flow already selected the field. Send the requested input once;
    // UIA labels, caret geometry and the old contents do not authorize or veto it.
    const hasInput = !!text || clear
    const typed = hasInput ? await bridge.typeText(text, false, clear, at) : null
    checkStopped()
    if (hasInput && (!typed || typed.skippedClear || typed.needChoice || typed.writeSent !== true)) {
      throw new Error('INPUT_NOT_SENT: Yazma işçisi girdiyi gönderemedi; Enter gönderilmedi.')
    }
    reportTyping(typed)
    if (hasInput) log('info', clear ? 'Ctrl+A → Delete → yazma gönderildi; alan içeriği okunmadı.' : 'Yazma gönderildi; alan içeriği okunmadı.')
    if (enter) {
      await pause(240)
      checkStopped()
      await bridge.sendKeys('{ENTER}')
    }
    if (enter) lastClickPoint = undefined
    // Sending input is not a claim that an unreadable field contains the expected value.
    return false
  }

  // ---------- safety around input ----------

  async function waitUnlocked(signal?: AbortSignal) {
    if (!(await observeWithin(bridge.isLocked(), signal))) return
    log('warn', 'Ekran kilitli ya da güvenlik ekranı açık; kilit açılana kadar bekleniyor (Ctrl+Shift+Q durdurur).')
    while (await observeWithin(bridge.isLocked(), signal)) await observeWithin(pause(5000), signal)
    log('info', 'Kilit açıldı, devam ediliyor.')
    await pause(1500)
  }

  let lastClickPoint: { x: number; y: number } | undefined

  // ---------- Yap ----------

  // ---------- executor ----------

  const executor: Executor = {
    log,
    pointerPosition: () => bridge.cursorPos(),
    pointerAction: async (action) => {
      await waitUnlocked()
      checkStopped()
      const point = action.current ? await bridge.cursorPos() : { x: action.x!, y: action.y! }
      checkStopped()
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Fare konumu okunamadı; girdi gönderilmedi.')
      clearHover()
      if (action.mode === 'move') {
        const moved = await bridge.moveMouse(point.x, point.y)
        checkStopped()
        if (moved.warning) log('warn', moved.warning)
        recordHover(point, moved.hwnd)
        log('info', `Fare hizalandı @${Math.round(point.x)},${Math.round(point.y)} (tıklama yok). Güncel ekranla hedefe bak.`)
      } else {
        await sendClick(point.x, point.y, action.mode)
        checkStopped()
        log('info', `${action.mode === 'double' ? 'Çift tıklama' : action.mode === 'right' ? 'Sağ tıklama' : 'Tıklama'} gönderildi @${Math.round(point.x)},${Math.round(point.y)}. Sonuç henüz gözlenmedi.`)
      }
      lastClickPoint = action.mode === 'right' || action.mode === 'double' ? undefined : point
      return { ...point, sent: action.mode !== 'move' }
    },
    step: (id, status) => send('agent:step', { id, status }),
    edge: (id, from, to) => send('agent:edge', { id, from, to }),
    patchNode: (id, patch) => send('agent:patch', { id, patch }),
    shouldStop: stopped,
    setLoop: (text) => ctx.setLoop?.(text),
    click: async (node, stepNo, ahead) => {
      await waitUnlocked()
      // A click on a window that is not active only activates it - Windows eats the first click, and
      // a menu that should have opened does not. Written commands have no saved element to fall back
      // on, so they get the same window activation the typing path already does.
      if (ahead?.next?.kind === 'type' || !node.locator) await activateInputWindow(node)
      const t = await withScreenRetry(node.title, (wide) => findTarget(node, stepNo, wide), () => recoverTarget(node, ahead))
      const mode = node.clickMode ?? 'left'
      const confirmed = await ensureActed(node, ahead, async () => {
        checkStopped()
        if (mode === 'left' && ahead?.next?.kind === 'type') await clickInput(t, node)
        else {
          // "Fareyi Oynat" modu: hedef bulunur ama TIKLANMAZ; imleç oraya taşınır ve konum
          // hatırlanır (sonraki adım/ajan o noktadan tıklayabilsin).
          if (mode === 'move') {
            clearHover()
            const tasima = await bridge.moveMouse(t.x, t.y)
            checkStopped()
            // İNCELEME DÜZELTMESİ: node'un "Fareyi Oynat" modu kaydı GERÇEKTEN güncellemeli;
            // yoksa "Fareyi Oynat node'u → Yap'te click_current" zinciri konumu bulamaz.
            recordHover({ x: t.x, y: t.y }, tasima?.hwnd)
            lastClickPoint = { x: t.x, y: t.y }
            trace(node, { kind: 'input', point: { x: Math.round(t.x), y: Math.round(t.y) }, mode, phase: 'sent' })
            log('success', `Fare oynatıldı: ${t.label} @${Math.round(t.x)},${Math.round(t.y)} (tıklama yok)`)
            return
          }
          clearHover()
          await sendClick(t.x, t.y, mode)
          lastClickPoint = mode === 'left' ? { x: t.x, y: t.y } : undefined
          trace(node, { kind: 'input', point: { x: Math.round(t.x), y: Math.round(t.y) }, mode, phase: 'sent' })
        }
        const verb = mode === 'double' ? 'Çift tıklandı' : mode === 'right' ? 'Sağ tıklandı' : 'Tıklandı'
        log('success', `${verb}: ${t.label} @${Math.round(t.x)},${Math.round(t.y)}`)
      })
      if (confirmed) saveMemo(node, t.memo)
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
      }
      let valueVerified = false
      const write = async () => {
        checkStopped()
        if (t) {
          await clickInput(t, node)
          await sleep(FOCUS_MS)
          log('info', `Alan seçildi: ${t.label}`)
        }
        valueVerified = await typeDirect(text, enter, clear, lastClickPoint)
        if (enter) lastClickPoint = undefined
      }
      // Explicit keyboard dispatch needs no screen-transition or field-value judge.
      await write()
      const confirmed = valueVerified
      if (confirmed) saveMemo(node, t?.memo)
    },
    key: async (node, ahead) => {
      await waitUnlocked()
      clearHover()
      const keys = node.keys
      if (!keys) throw new Error(`“${node.title}”: gönderilecek tuş boş.`)
      lastClickPoint = undefined
      guiReplace = false
      checkStopped()
      await bridge.sendKeys(keys, getSettings().targetWindow || undefined)
    },
    exists: async (text, node, options) => {
      const signal = options?.signal
      checkObservation(signal)
      await waitUnlocked(signal)
      checkStopped()
      // The runner may pass an extracted needle. Always keep the full user's instruction.
      checkObservation(signal)
      const instruction = node.text?.trim() || text.trim()
      const found = (how: string) => {
        log('info', `“${node.title}” gördü: ${how}.`)
        return true
      }
      // Same readers and target-list model as Click, but one UIA pass then one
      // combined OCR pass. No Click retries, popup recovery, input or memory writes.
      const preferredWindow = node.conditionWindow?.trim() || ''
      const match = node.conditionWindowMatch || 'exact'
      let scoped = !!preferredWindow
      const scanCondition = async (source: 'uia' | 'ocr'): Promise<ScanResult> => {
        const scanOptions = { signal, image: 'none' as const, uia: source === 'uia', ocr: source === 'ocr',
          fresh: true, readOnly: true, tilt: source === 'ocr', ocrEngine: 'combined' as const }
        if (scoped) {
          try {
            const res = await observeWithin(bridge.scan({ ...scanOptions, windowTitle: preferredWindow, strictWindow: match }), signal)
            checkStopped()
            const title = res.window?.toLocaleLowerCase() || ''
            const wanted = preferredWindow.toLocaleLowerCase()
            if (!res.missingWindow && title && (match === 'exact' ? title === wanted : title.includes(wanted))) return res
          } catch (e) {
            if (!(e instanceof Error) || !e.message.includes('WINDOW_AMBIGUOUS')) throw e
          }
          scoped = false
          log('warn', `Koşul penceresi “${preferredWindow}” bulunamadı veya tekil değil; tüm ekranda arama sürüyor.`)
        }
        const res = await observeWithin(bridge.scan(scanOptions), signal)
        checkStopped()
        checkObservation(signal)
        return res
      }
      // An explicitly picked element (from an older saved flow) is still observed by its live
      // UIA identity or saved icon. The condition box itself no longer offers "pick from screen".
      if (!instruction && node.locator) {
        const visible = await savedTargetVisible(node, options)
        checkStopped()
        return visible ? found(visible) : false
      }
      if (!instruction) throw new Error(`“${node.title}”: koşul için ne aradığını yaz.`)
      // Every condition text is a plain sentence handed to the text model; there is no
      // quoted "exact text" shortcut and no local full-text equality any more.
      if (!getSettings().apiKey && !localConfigured()) {
        throw new Error('Koşul artık her zaman metin modeline sorar; API anahtarı ya da yerel model gerekli.')
      }
      for (const source of ['uia', 'ocr'] as const) {
        ctx.setMethod?.(source === 'uia' ? 'Koşul: uygulama öğeleri (UIA)' : 'Koşul: Windows + ONNX OCR')
        const res = await scanCondition(source)
        if (source === 'ocr') noteCjk(res, node.id)
        const items = res.items.filter(item => item.src === source)
        // A preferred window that could not be used goes to the model as context: it decides
        // whether broader evidence still belongs to the intended application (needsContextJudge).
        if (!items.length) continue
        const s = getSettings()
        const promptId = source === 'uia' ? 'conditionUia' : 'conditionOcr'
        const choice = await observeWithin(chooseScreenTarget({ apiKey: s.apiKey, model: textModels(s), signal,
          context: preferredWindow ? `Preferred application/window: ${preferredWindow}. ${scoped ? 'Evidence is from the selected window.' : 'That window was missing or ambiguous; this is a broader screen search. Accept only evidence belonging to the intended application/task; a status from an unrelated application or historical log is not proof. If the application context cannot be established, return id:null. A changed title alone does not disqualify the same application.'}` : undefined,
          kind: 'condition', prompt: instruction, scan: { ...res, items, image: null },
          stepTitle: 'Koşul', sendImage: false,
          system: promptOf(s.llmPrompts, promptId) || DEFAULT_PROMPTS[promptId] }), signal)
        checkStopped()
        checkObservation(signal)
        const hit = choice.id === null ? undefined : items.find(item => item.id === choice.id)
        if (hit) return found(`${source}: “${hit.text}”${choice.reason ? ` — ${choice.reason}` : ''}`)
        log('info', `Koşul ${source}: açık kanıt yok${choice.reason ? ` — ${choice.reason}` : ''}.`)
      }
      return false
    },
    captureFailure: async (label) => {
      if (!failDir) return
      fs.mkdirSync(failDir, { recursive: true })
      const res = await bridge.scan({ image: 'plain', uia: false, ocr: false, fresh: true, maxImageW: 1600 }).catch(() => null)
      if (!res?.image?.data) {
        // No picture at all: say so, rather than leaving a report that looks like it is still coming.
        ctx.noteFailureShot?.('')
        return
      }
      const safe = label.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 60)
      const file = path.join(failDir, `hata-${new Date().toISOString().replace(/[:.]/g, '-')}-${safe}.jpg`)
      fs.writeFileSync(file, Buffer.from(res.image.data, 'base64'))
      // A long run with many failing items must not grow this folder without bound; the
      // pruning that happens when a run starts cannot help while the run is still going.
      try {
        const shots = fs.readdirSync(failDir).filter((f) => f.startsWith('hata-')).sort()
        for (const old of shots.slice(0, Math.max(0, shots.length - 100))) fs.rmSync(path.join(failDir, old), { force: true })
      } catch {
        /* a screenshot folder that cannot be pruned is not worth failing the lap for */
      }
      log('info', `Hata anının ekran görüntüsü kaydedildi: ${file}`)
      ctx.noteFailureShot?.(file)
    },

  }

  /** Same resolver, one read-only pass. No click, typing, recovery actions or memory write. */
  const previewTarget = (node: AgentNode) => resolveTarget(node, 0, false, true)
  return { executor, beginRun, previewTarget }
}
