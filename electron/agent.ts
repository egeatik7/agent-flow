import { app, screen as electronScreen } from 'electron'
import fs from 'fs'
import path from 'path'
import * as bridge from './a11y-bridge'
import * as browser from './browser'
import { describeAhead, expectation, judgeScreen, type Verdict } from './confirm'
import { renderTemplate, type AgentNode, type AppSettings, type LogLevel, type PathStep, type TargetMemo } from './graph-types'
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
import { conflict, describeMemory, likeness, memoOf, remember } from './memory'
import {
  chooseScreenTarget,
  guiStep,
  isTarsModel,
  judgeReaction,
  nextAction,
  type GuiAction,
  type GuiTurn,
  planStall,
  visionCheck,
  visionLocate,
  visionRefine,
  type ReactionVerdict,
} from './openrouter'
import { interruptibleSleep, StoppedError, type Executor, type StepAhead } from './runner'
import { rememberShot } from './shots'

export type AgentContext = {
  log: (level: LogLevel, message: string) => void
  send: (channel: string, payload: unknown) => void
  settings: () => AppSettings
  shouldStop: () => boolean
}

type Resolved = { x: number; y: number; label: string; memo?: TargetMemo; dom?: number }

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
const TEMP_FILE = /\.(crdownload|part|partial|tmp|download|opdownload|xpas-part)$/i

function center(t: { x: number; y: number; w: number; h: number }) {
  return { x: t.x + t.w / 2, y: t.y + t.h / 2 }
}

function globToRe(glob: string | undefined): RegExp | null {
  const g = (glob ?? '').trim()
  if (!g) return null
  const parts = g.split(/[;,]\s*/).filter(Boolean)
  const body = parts
    .map((p) => p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.'))
    .join('|')
  return new RegExp(`^(?:${body})$`, 'i')
}

function uniquePath(p: string): string {
  if (!fs.existsSync(p)) return p
  const ext = path.extname(p)
  const stem = p.slice(0, p.length - ext.length)
  for (let i = 2; i < 1000; i++) {
    const c = `${stem} (${i})${ext}`
    if (!fs.existsSync(c)) return c
  }
  return `${stem} (${Date.now()})${ext}`
}

function listFiles(folder: string): Map<string, number> {
  const out = new Map<string, number>()
  try {
    for (const d of fs.readdirSync(folder, { withFileTypes: true })) {
      if (!d.isFile()) continue
      try {
        out.set(d.name, fs.statSync(path.join(folder, d.name)).mtimeMs)
      } catch {
        /* vanished while listing */
      }
    }
  } catch {
    /* folder missing */
  }
  return out
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

function fieldHolds(value: string, text: string) {
  if (value === text) return true
  const v = norm(value)
  const t = norm(text)
  return !!t && v.includes(t)
}

export function createAgent(ctx: AgentContext) {
  const { log, send } = ctx
  const getSettings = ctx.settings
  const stopped = ctx.shouldStop
  const pause = (ms: number) => interruptibleSleep(ms, stopped)

  const runMemo = new Map<string, TargetMemo[]>()
  const runTrace = new Map<string, string[]>()
  const runPath = new Map<string, PathStep[]>()

  function screenArea() {
    const d = electronScreen.getPrimaryDisplay()
    const f = d.scaleFactor || 1
    return { x: Math.round(d.bounds.x * f), y: Math.round(d.bounds.y * f), w: Math.max(1, Math.round(d.bounds.width * f)), h: Math.max(1, Math.round(d.bounds.height * f)) }
  }
  const baselines = new Map<string, Map<string, number>>()
  const warnedMissing = new Set<string>()

  const memoFor = (node: AgentNode) => runMemo.get(node.id) ?? node.memory
  const saveMemo = (node: AgentNode, m?: TargetMemo) => {
    if (!m) return
    const list = remember(memoFor(node), m)
    runMemo.set(node.id, list)
    send('agent:patch', { id: node.id, patch: { memory: list } })
  }

  const downloadsDir = () => app.getPath('downloads')

  let failDir = ''

  /** Called when a run starts: forget this run's memory copies, note which files already exist. */
  function beginRun(folders: string[], logDir = '') {
    failDir = logDir
    runMemo.clear()
    runTrace.clear()
    runPath.clear()
    noted.clear()
    lastVisionAt.clear()
    lastFg = null
    warnedMissing.clear()
    baselines.clear()
    for (const f of new Set([downloadsDir(), ...folders.filter((x) => x && !x.includes('{{'))])) baselines.set(f, listFiles(f))
  }

  async function browserInFront(): Promise<boolean> {
    if (!browser.isOpen()) return false
    const fg = await bridge.foreground()
    return browser.looksForeground(fg ? fg.title : null)
  }

  function warnMissingWindow(res: ScanResult) {
    if (!res.missingWindow || warnedMissing.has(res.missingWindow)) return
    warnedMissing.add(res.missingWindow)
    log('warn', `Hedef pencere “${res.missingWindow}” açık değil, tüm ekran okunuyor. Kalıcı çözüm: Ayarlar > Hedef pencere > “Tüm ekran” > Kaydet.`)
  }

  async function scanFor(withImage: boolean, wide = false): Promise<ScanResult> {
    const s = getSettings()
    const res = await bridge.scan({
      windowTitle: wide ? undefined : s.targetWindow || undefined,
      image: withImage ? 'marked' : 'none',
      fresh: wide,
    })
    warnMissingWindow(res)
    noteCjk(res, 'scan')
    log('info', `Ekran tarandı: ${res.items.length} yazı/öğe (UIA ${res.uiaCount}, OCR ${res.ocr ? res.ocrCount : 'kapalı'}${res.onnxAdded ? ` +çince ${res.onnxAdded}` : ''})${res.window ? ` — ${res.window}` : ''}`)
    if (!res.ocr) log('warn', 'Windows OCR kullanılamıyor; sadece uygulamanın bildirdiği isimler görülebiliyor.')
    if (process.platform === 'win32' && res.onnx === false) noteOnce('scan', 'onnx', 'Çince okuyucu açılamadı; Windows OCR ile devam ediliyor.')
    return res
  }

  // ---------- finding targets ----------

  type TargetPick = { item: ScreenItem; target: Target; memo: TargetMemo; how: string }

  /**
   * Fresh search on this lap's screen. Memory only breaks ties between near-equal matches,
   * and a pick that clearly disagrees with the recent laps is looked at twice.
   */
  async function pickFrom(node: AgentNode, scan: ScanResult, win: string, allowLlm: boolean): Promise<TargetPick | null> {
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
    if (explicit?.quoted) {
      hit = matchText(items, explicit.text, { anchor, minScore: 60, prefer }) ?? matchFuzzy(items, explicit.text, { anchor, minScore: 80, prefer })
      exact = !!hit
      how = 'yazı'
    }
    if (!hit && !prompt && recordedText) {
      hit = matchText(items, recordedText, { anchor, minScore: 60, prefer }) ?? matchFuzzy(items, recordedText, { anchor, minScore: 80, prefer })
      how = 'yakalanan yazı'
    }
    let byLlm = false
    if (!hit && useLlm) {
      const choice = await chooseScreenTarget({
        apiKey: s.apiKey,
        model: s.model,
        prompt,
        kind: node.kind,
        scan,
        stepTitle: node.title,
        sendImage: s.sendScreenshot && !!scan.image,
        onImageFallback: (m) => log('warn', m),
        hint: describeMemory(mem) || undefined,
      })
      const item = choice.id !== null ? items.find((i) => i.id === choice.id) : undefined
      if (item) {
        hit = refineTarget(item, choice.text)
        how = `LLM${choice.reason ? ` — ${choice.reason}` : ''}`
        byLlm = true
      } else {
        log('warn', `LLM uygun öğe bulamadı${choice.reason ? `: ${choice.reason}` : ''}.`)
      }
    }
    if (!hit) {
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
            model: s.model,
            prompt,
            kind: node.kind,
            scan,
            stepTitle: node.title,
            sendImage: s.sendScreenshot && !!scan.image,
            hint: `${describeMemory(mem)}. Bu tur yazı eşleşmesi #${hit.item.id} “${hit.item.text}” öğesini buldu ama ${why}. Talimata göre doğru öğe hangisi?`,
          })
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

  async function resolveTarget(node: AgentNode, _stepNo: number, wide = false): Promise<Resolved> {
    const s = getSettings()
    const prompt = node.prompt?.trim() ?? ''

    const loc = node.locator
    const pickedInBrowser = !loc || /edge|chrome|firefox|opera/i.test(loc.windowTitle ?? '')
    if (pickedInBrowser && (await browserInFront())) {
      const d = await browser.items()
      log('info', `[sayfa] ${d.items.length} öğe okundu${d.host ? ` (${d.host})` : ''}.`)
      const pick = await pickFrom(node, pseudoScan(d.items, d.area, d.host), `web:${d.host}`, true)
      if (pick) return { x: 0, y: 0, dom: pick.item.id, memo: pick.memo, label: `[sayfa] “${pick.target.text}” (${pick.how})` }
      log('info', '[sayfa] Sayfada bulunamadı; ekran okunuyor (açılır pencere ya da sistem penceresi olabilir).')
    }

    const win = s.targetWindow || loc?.windowTitle || ''
    const userChrome = await browser.userChromeItems(win || undefined)
    if (userChrome) {
      log('info', `[chrome] Sayfada ${userChrome.items.length} yazı okundu.`)
      const pick = await pickFrom(node, pseudoScan(userChrome.items, userChrome.area, userChrome.host), 'chrome', true)
      if (pick) return { ...center(pick.target), memo: pick.memo, label: `[chrome] “${pick.target.text}” (${pick.how})` }
      log('info', '[chrome] Sayfada bulunamadı; ekran okunuyor.')
    }

    if (loc && win && (loc.automationId || loc.name?.trim()) && !['Pane', 'Window', 'Document', 'Point'].includes(loc.controlType)) {
      try {
        const r = await bridge.locate(loc, win)
        if (r && r.w * r.h < 600 * 400) return { ...center(r), label: `kayıtlı öğe “${r.name || loc.text || loc.name}”` }
      } catch {
        /* fall through to the picture and the screen text */
      }
    }

    if (loc?.icon) {
      try {
        const hit = (await bridge.findImage(loc.icon, loc.windowTitle)) ?? null
        const again = hit && hit.score < ICON_MIN && loc.windowTitle ? await bridge.findImage(loc.icon) : null
        const best = again && hit && again.score > hit.score ? again : hit
        if (best && best.score >= ICON_MIN) {
          log('info', `[simge] Kayıtlı resim ekranda bulundu (%${Math.round(best.score * 100)} benzer).`)
          const sa = screenArea()
          return {
            x: best.x,
            y: best.y,
            label: '[simge] kayıtlı resim',
            memo: { win: best.window || win, type: 'Simge', src: 'ocr', rx: (best.x - sa.x) / sa.w, ry: (best.y - sa.y) / sa.h, text: loc.text || 'simge', at: Date.now() },
          }
        }
        if (best) log('info', `[simge] Kayıtlı resim ekranda net değil (en iyi %${Math.round(best.score * 100)}).`)
      } catch (e) {
        log('warn', `[simge] Resim araması atlandı: ${(e as Error).message}`)
      }
    }

    const hasText = !!prompt || !!(loc?.text || loc?.name)?.trim()
    const scanRes = await scanFor(!!s.apiKey && !!prompt && s.sendScreenshot, wide)
    const pick = hasText ? await pickFrom(node, scanRes, scanRes.window || win, true) : null
    if (pick) return { ...center(pick.target), memo: pick.memo, label: `“${pick.target.text}” (${pick.how})` }

    if (loc?.icon && s.apiKey) {
      try {
        log('info', '[simge] Görsel modele kayıtlı resimle soruluyor.')
        return await resolveVision(node, true)
      } catch (e) {
        log('warn', `[simge] Görsel model de bulamadı: ${(e as Error).message}`)
      }
    }

    if (loc?.offsetX !== undefined && loc.offsetY !== undefined && win) {
      try {
        const r = await bridge.windowRect(win)
        log('warn', 'Yazı bulunamadı, kayıttaki konuma tıklanıyor.')
        return { x: r.x + loc.offsetX, y: r.y + loc.offsetY!, label: 'kayıtlı konum' }
      } catch {
        /* window gone */
      }
    }

    const explicit = extractTarget(prompt)
    const seen = sampleTexts(scanRes.items)
    throw new NotFoundError(
      `“${explicit?.text || prompt || loc?.text || node.title}” ekranda bulunamadı.${s.apiKey ? '' : ' (API anahtarı yok, sadece yazı eşleşmesi denendi.)'}${
        seen ? ` Ekranda görülenlerden bazıları: ${seen}` : ''
      }`
    )
  }

  function visionModelOrThrow(): { apiKey: string; model: string } {
    const s = getSettings()
    if (!s.apiKey) throw new Error('Görsel mod için OpenRouter API anahtarı gerekli (Ayarlar > API Key > Kaydet).')
    return { apiKey: s.apiKey, model: (s.visionModel || s.model).trim() }
  }

  function visionPrompt(node: AgentNode): string {
    const p = node.prompt?.trim()
    if (p) return p
    if (node.locator?.icon) return 'İkinci resimdeki simgenin/düğmenin ekrandaki yerini bul'
    const t = node.locator?.text || node.locator?.name
    if (t) return `“${t}” yazan yere`
    throw new Error(`“${node.title}”: görsel mod için ekranda neyin bulunacağını yaz.`)
  }

  /** Screenshot mode: the vision model looks at the screen, picks a marked box or a raw point, then a zoomed crop refines it. */
  async function resolveVision(node: AgentNode, wide = false): Promise<Resolved> {
    const { apiKey, model } = visionModelOrThrow()
    const prompt = visionPrompt(node)
    const s = getSettings()
    const scanRes = await bridge.scan({
      windowTitle: wide ? undefined : s.targetWindow || undefined,
      image: 'marked',
      maxImageW: 1600,
      fresh: wide,
    })
    warnMissingWindow(scanRes)
    const mem = memoFor(node)
    const hint = describeMemory(mem)
    log('info', `[görsel] Ekran görüntüsü ${model} modeline gönderildi (${scanRes.items.length} işaretli öğe).`)
    const pick = await visionLocate({
      apiKey,
      model,
      prompt: hint ? `${prompt}\n(Hafıza, sadece ipucu: ${hint})` : prompt,
      kind: node.kind,
      scan: scanRes,
      stepTitle: node.title,
      reference: node.locator?.icon ? { data: node.locator.icon, w: 0, h: 0, mime: 'image/png' } : undefined,
    })
    const win = scanRes.window || ''

    if (pick.kind === 'item') {
      const item = scanRes.items.find((i) => i.id === pick.id)!
      log('info', `[görsel] Seçilen: #${item.id} “${item.text}”${pick.reason ? ` — ${pick.reason}` : ''}`)
      return { ...center(item), memo: memoOf(item, scanRes.area, win), label: `[görsel] “${item.text}”` }
    }
    if (pick.kind === 'none') {
      throw new NotFoundError(`[görsel] Model “${prompt}” hedefini ekranda bulamadı${pick.reason ? `: ${pick.reason}` : ''}.`)
    }

    const a = scanRes.area
    const gx = a.x + (pick.nx / 1000) * a.w
    const gy = a.y + (pick.ny / 1000) * a.h
    const pointMemo = (x: number, y: number): TargetMemo => ({
      win,
      type: 'Nokta',
      src: 'ocr',
      rx: a.w ? (x - a.x) / a.w : 0.5,
      ry: a.h ? (y - a.y) / a.h : 0.5,
      text: prompt.slice(0, 80),
      at: Date.now(),
    })
    log('info', `[görsel] İlk tahmin @${Math.round(gx)},${Math.round(gy)}${pick.reason ? ` — ${pick.reason}` : ''}; yakınlaştırılıp netleştiriliyor…`)
    try {
      const cw = Math.min(520, a.w)
      const ch = Math.min(340, a.h)
      const c = await bridge.crop({ x: Math.round(gx - cw / 2), y: Math.round(gy - ch / 2), w: cw, h: ch }, 1040)
      const r = await visionRefine({ apiKey, model, prompt, image: c.image })
      if (r) {
        const fx = c.area.x + (r.x / 1000) * c.area.w
        const fy = c.area.y + (r.y / 1000) * c.area.h
        return { x: fx, y: fy, memo: pointMemo(fx, fy), label: '[görsel] netleştirilmiş nokta' }
      }
      log('warn', '[görsel] Yakın planda hedef görülmedi, ilk tahmin kullanılıyor.')
    } catch (e) {
      log('warn', `[görsel] Netleştirme atlandı: ${(e as Error).message}`)
    }
    return { x: gx, y: gy, memo: pointMemo(gx, gy), label: '[görsel] tahmini nokta' }
  }

  async function visionExists(text: string, node?: AgentNode): Promise<boolean> {
    const { apiKey, model } = visionModelOrThrow()
    const res = await bridge.scan({ image: 'plain', uia: false, ocr: false, maxImageW: 1400, fresh: true })
    if (!res.image) throw new Error('Ekran görüntüsü alınamadı.')
    const icon = node?.locator?.icon
    const r = await visionCheck({
      apiKey,
      model,
      question: text,
      image: res.image,
      reference: icon ? { data: icon, w: 0, h: 0, mime: 'image/png' } : undefined,
    })
    log('info', `[görsel] ${text ? `“${text}”` : 'seçilen öğe'} → ${r.answer ? 'evet' : 'hayır'}${r.reason ? ` (${r.reason})` : ''}`)
    return r.answer
  }

  const findTarget = (node: AgentNode, stepNo: number, wide = false) =>
    node.useVision ? resolveVision(node, wide) : resolveTarget(node, stepNo, wide)

  // ---------- after an action: did it land? ----------

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
    const model = (s.visionModel || s.model).trim()
    if (!s.apiKey || !model || !before.image || !after.image) return v
    if (v.kind !== 'blocked' && v.kind !== 'unknown' && v.kind !== 'missed') return v
    try {
      const r = await judgeReaction({
        apiKey: s.apiKey,
        model,
        step: `${node.title}${node.prompt?.trim() ? ` — ${node.prompt.trim()}` : ''}`,
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
    if (browser.isOpen() && (await browser.hasText(goal.text))) {
      log('success', `${goal.label} sayfada. Devam ediliyor.`)
      return true
    }
    if (process.platform === 'win32') {
      const res = await bridge.scan({ image: 'none', fresh: true })
      if (containsText(res.items, goal.text) || matchPrompt(res.items, goal.text)) {
        log('success', `${goal.label} ekranda. Operasyon bozulmadan devam ediliyor.`)
        return true
      }
    }
    if (!quiet) log('info', `${goal.label} henüz görünmüyor.`)
    return false
  }

  async function askPlan(node: AgentNode, ahead: StepAhead | undefined, problem: string) {
    const s = getSettings()
    const model = (s.visionModel || s.model).trim()
    if (!s.apiKey || !model) return null
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
        model,
        step: `${node.title}${node.prompt?.trim() ? ` — ${node.prompt.trim()}` : ''}`,
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
   * After one click, type, or key. The same command is never pressed twice here.
   * Page actions confirm through the page; screen actions compare two frames and then check the next target.
   */
  /**
   * After one click, type, or key. The same command is never pressed twice here, and this never fails the step:
   * if the reaction cannot be confirmed, the next step looks for its own target, waits, and recovers.
   * Returns whether the reaction was confirmed (only confirmed targets go into memory).
   */
  async function ensureActed(node: AgentNode, ahead: StepAhead | undefined, onPage: boolean, act: () => Promise<void>): Promise<boolean> {
    if (ahead?.next?.kind === 'condition' || ahead?.next?.kind === 'waitFile') {
      await act()
      if (onPage) await browser.settle(1500)
      log('info', `“${node.title}” bir kez yapıldı. Sıradaki adım (${ahead.next.title}) ekrana kendisi baktığı için kontrol edilmeden geçiliyor.`)
      return true
    }
    if (onPage) {
      await act()
      await browser.settle()
      if (await aheadIsReady(ahead, true)) return true
      await pause(2000)
      await browser.settle()
      if (await aheadIsReady(ahead, true)) return true
      log('info', 'Sayfada sıradaki öğe henüz yok; sıradaki adım kendisi arayıp bekleyecek.')
      return false
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
    if (verdict.kind === 'blocked' || verdict.kind === 'unknown') {
      verdict = await lookCloser(verdict, before, after, node, ahead)
      if (verdict.kind === 'ready') {
        log('success', `Emin: ${verdict.reason}.`)
        return true
      }
    }

    log('info', `Tepki net değil (${verdict.reason}). Akış bozulmadan sıradaki adım kontrol edilecek.`)
    if (await aheadIsReady(ahead)) return true

    log('info', 'Sıradaki öğe henüz yok. Karar vermeden önce beklenecek.')
    await pause(2500)
    if (await aheadIsReady(ahead)) return true

    const plan = await askPlan(node, ahead, verdict.reason)
    if (plan) {
      log('info', `Plan: ${planLabel(plan.action, plan.waitMs)}. ${plan.reason}`)
      if (plan.action === 'wait') await pause(plan.waitMs)
      if (await aheadIsReady(ahead)) return true
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
      /* the plan's text is not there either */
    }
    if (!node.useVision && getSettings().apiKey) {
      try {
        return await resolveVision(node, true)
      } catch {
        return null
      }
    }
    return null
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

  const lastVisionAt = new Map<string, number>()

  // ---------- typing ----------

  function reportTyping(r: bridge.TypeResult | null) {
    if (!r) return
    if (r.skippedClear) {
      log('warn', `Odaktaki öğe bir yazı alanı değil (${r.focusType || 'bilinmiyor'}); Ctrl+A / Delete gönderilmedi, sadece yazıldı. Alana tıklandığından emin ol.`)
    }
    if (r.pasted) log('info', 'Metinde klavyeyle yazılamayan karakterler vardı; pano üzerinden yapıştırıldı.')
  }

  /** How the field compares with what was typed. */
  function fieldState(value: string, text: string): 'ok' | 'partial' | 'empty' | 'wrong' {
    if (fieldHolds(value, text)) return 'ok'
    const v = norm(value)
    const t = norm(text)
    if (!v) return 'empty'
    const digits = (x: string) => x.replace(/[^\p{N}]/gu, '')
    if (digits(v) && digits(v) === digits(t)) return 'partial'
    if (t.includes(v) && v.length >= t.length * 0.5) return 'partial'
    if (v.includes(t.slice(0, Math.max(3, Math.floor(t.length * 0.6))))) return 'partial'
    return 'wrong'
  }

  /** Types into the focused field, reads it back. Empty or unrelated content is typed once more; a formatted/shortened value only warns. */
  async function typeVerified(text: string, enter: boolean, clear: boolean) {
    reportTyping(await bridge.typeText(text, false, clear))
    if (text) {
      let v = await bridge.focusedValue()
      let state = v === null ? 'ok' : fieldState(v, text)
      if (state === 'empty' || state === 'wrong') {
        log('warn', `Alanda “${(v ?? '').slice(0, 60)}” yazıyor, beklenen bu değil. Bir kez daha yazılıyor.`)
        reportTyping(await bridge.typeText(text, false, true))
        v = await bridge.focusedValue()
        state = v === null ? 'ok' : fieldState(v, text)
        if (state === 'empty' || state === 'wrong') throw new Error(`Yazı alana gitmedi: alanda “${(v ?? '').slice(0, 60)}” var.`)
      }
      if (state === 'partial') log('warn', `Alan yazıyı biçimlendirmiş görünüyor (“${(v ?? '').slice(0, 60)}”); devam ediliyor.`)
      else if (v !== null) log('success', 'Alan doğrulandı: yazı yerinde.')
    }
    if (enter) {
      await sleep(240)
      await bridge.sendKeys('{ENTER}')
    }
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
      log('warn', `Odak “${fg.title || fg.proc}” penceresine kaymış; “${lastFg.title}” yeniden öne getiriliyor.`)
      try {
        await bridge.windowRect(lastFg.title)
        await sleep(300)
      } catch {
        log('warn', `“${lastFg.title}” öne getirilemedi; tuşlar şu an öndeki pencereye gidecek.`)
      }
    } else {
      noteOnce(node.id, `fg:${fg.pid}`, `Not: öndeki pencere değişti (“${fg.title || fg.proc}”). “${node.title}” tuşları bu pencereye gönderilecek.`)
    }
  }

  // ---------- İnisiyatif ----------

  async function initiative(node: AgentNode, _stepNo: number, ahead?: StepAhead, vars: Record<string, string> = {}): Promise<boolean> {
    const s = getSettings()
    if (!s.apiKey) throw new Error('İnisiyatif için OpenRouter API anahtarı gerekli (Ayarlar > API Key).')
    const model = (s.visionModel || s.model).trim()
    const goal = node.prompt!.trim()
    const max = Math.min(40, Math.max(1, Math.floor(node.maxActions ?? 12)))
    const lastLap = (runTrace.get(node.id) ?? node.trace ?? []).map((l) => renderTemplate(l, vars) ?? l)
    const history: string[] = []
    const trace: string[] = []
    let lastSig = ''
    let repeats = 0
    const next = ahead?.next ? `${ahead.next.title}${ahead.next.prompt ? `: ${ahead.next.prompt}` : ahead.next.text ? `: ${ahead.next.text}` : ''}` : undefined

    for (let i = 1; i <= max; i++) {
      if (stopped()) throw new StoppedError()
      const onPage = await browserInFront()
      let items: ScreenItem[]
      let image: ScanResult['image'] = null
      if (onPage) {
        items = (await browser.items()).items
      } else {
        const res = await bridge.scan({ image: s.sendScreenshot ? 'marked' : 'none', fresh: true, maxImageW: 1400 })
        items = res.items
        image = res.image
      }
      const a = await nextAction({
        apiKey: s.apiKey,
        model,
        goal,
        stepTitle: node.title,
        history,
        lastLap,
        listText: `${onPage ? '(web sayfası)\n' : ''}${describeItems(items, 300)}`,
        image,
        next,
      })
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
          await bridge.sendKeys(a.keys)
          history.push(`tuş ${a.keys}`)
          trace.push(`tuş ${a.keys}`)
        } else if (a.action === 'type') {
          if (item) {
            if (onPage) await browser.fillItem(item.id, a.text, true, a.enter)
            else {
              await bridge.clickAt(center(item).x, center(item).y, 'left')
              await sleep(FOCUS_MS)
              await typeVerified(a.text, a.enter, true)
            }
          } else if (!(browser.isOpen() && (await browser.feedChooser(a.text)))) {
            await typeVerified(a.text, a.enter, false)
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
          if (onPage) await browser.clickItem(item.id, mode)
          else await bridge.clickAt(center(item).x, center(item).y, mode)
          const line = `${mode === 'double' ? 'çift tıkla' : mode === 'right' ? 'sağ tıkla' : 'tıkla'} “${item.text}”`
          history.push(line)
          trace.push(line)
        }
      } catch (e) {
        if (e instanceof StoppedError) throw e
        history.push(`hata: ${(e as Error).message.split('\n')[0]}`)
      }
      await pause(700)
      if (onPage) await browser.settle(1500)
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

  async function doGui(a: Doable, area: Shot['area']) {
    const at = (x?: number, y?: number) => ({ x: area.x + (x ?? 0.5) * area.w, y: area.y + (y ?? 0.5) * area.h })
    switch (a.kind) {
      case 'click':
      case 'double':
      case 'right': {
        const p = at(a.x, a.y)
        await bridge.clickAt(p.x, p.y, a.kind === 'double' ? 'double' : a.kind === 'right' ? 'right' : 'left')
        return
      }
      case 'drag': {
        const p = at(a.x, a.y)
        const q = at(a.x2, a.y2)
        await bridge.drag(p.x, p.y, q.x, q.y)
        return
      }
      case 'hotkey':
        if (a.keys?.length) await bridge.hotkey(a.keys)
        return
      case 'type': {
        const raw = a.text ?? ''
        const enter = /\n$/.test(raw)
        const body = raw.replace(/\n+$/, '')
        if (browser.isOpen() && (await browser.feedChooser(body))) return
        await bridge.typeText(body, enter, false)
        return
      }
      case 'scroll': {
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
    const s = getSettings()
    const model = (s.visionModel || '').trim()
    if (!s.apiKey || !model) return { ok: true, reason: 'kontrol modeli yok' }
    try {
      await pause(800)
      const shot = await agentShot(tars, 'inisiyatif kontrol')
      const r = await visionCheck({
        apiKey: s.apiKey,
        model,
        question: `Şu görev bu ekranda tamamlanmış görünüyor mu (son hâline bak)? Görev: ${goal}`,
        image: shot.img,
      })
      return { ok: r.answer, reason: r.reason }
    } catch (e) {
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
    const model = (s.agentModel || s.visionModel || s.model).trim()
    const tars = isTarsModel(model)
    const goal = node.prompt!.trim()
    const max = Math.min(60, Math.max(1, Math.floor(node.maxActions ?? 25)))
    const history: GuiTurn[] = []
    let path: PathStep[] = []
    log('info', `İnisiyatif (${model}${tars ? ', UI-TARS biçimi' : ''}): ${goal}`)
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
    let lastKind: GuiAction['kind'] | null = null
    let still = 0
    let rejected = 0
    for (let i = 1; i <= max; i++) {
      if (stopped()) throw new StoppedError()
      await waitUnlocked()
      const shot = await agentShot(tars, `inisiyatif ${i}`)
      if (prev && lastKind !== 'wait' && sigDiff(prev.sig, shot.sig) < STILL_DIFF) still++
      else still = 0
      if (still >= 6) {
        log('warn', 'Ekran 6 eylemdir değişmiyor. İnisiyatif burada duruyor.')
        return false
      }
      if (still === 3 && history.length) {
        history[history.length - 1].note = 'Ekran son 3 eylemde hiç değişmedi. Aynı şeyi tekrar etme, başka bir yol dene (kısayol, başka menü, kaydırma).'
        log('info', 'Ekran 3 eylemdir değişmedi; modele başka yol denemesi söylendi.')
      }

      const a = await guiStep({ apiKey: s.apiKey, model, goal, history, screen: shot.img })
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
        history.push({ thought: a.thought, raw: a.raw, image: shot.img, note: `Kontrol: görev henüz tamamlanmamış görünüyor (${v.reason || 'eksik adım var'}). Eksik kalanı yap.` })
        prev = shot
        lastKind = 'wait'
        continue
      }
      if (a.kind === 'call_user') {
        log('warn', `Model yardım istedi, İnisiyatif duruyor: ${a.thought || 'gerekçe yok'}`)
        return false
      }

      const turn: GuiTurn = { thought: a.thought, raw: a.raw, image: shot.img }
      try {
        let patch: string | undefined
        if (['click', 'double', 'right', 'drag'].includes(a.kind) && a.x !== undefined && a.y !== undefined) {
          const px = shot.area.x + a.x * shot.area.w
          const py = shot.area.y + a.y * shot.area.h
          patch = (await bridge.patchAt(px, py, 64))?.data
        }
        await doGui(a, shot.area)
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
      lastKind = a.kind
      await pause(a.kind === 'wait' ? 0 : a.kind === 'type' || a.kind === 'hotkey' ? 700 : 1000)
    }
    log('warn', `İnisiyatif ${max} eylemde hedefe ulaşamadı.`)
    return false
  }

  // ---------- files ----------

  async function waitFile(node: AgentNode, stepNo: number): Promise<string | null> {
    const folder = node.folder?.trim() || downloadsDir()
    const re = globToRe(node.pattern)
    const timeout = Math.max(1000, node.timeoutMs ?? 300000)
    if (!baselines.has(folder)) baselines.set(folder, listFiles(folder))
    const known = baselines.get(folder)!
    log('info', `[${stepNo}] ${folder} klasörüne ${node.pattern?.trim() ? `“${node.pattern.trim()}” ` : ''}yeni dosya bekleniyor…`)
    const until = Date.now() + timeout
    let lastNote = Date.now()
    while (Date.now() < until) {
      if (stopped()) throw new StoppedError()
      const now = listFiles(folder)
      let partial = false
      const fresh = [...now.entries()]
        .filter(([name, mtime]) => {
          if (name.startsWith('.') || TEMP_FILE.test(name)) {
            partial = true
            return false
          }
          if (re && !re.test(name)) return false
          return known.get(name) !== mtime
        })
        .sort((a, b) => b[1] - a[1])
      if (fresh.length) {
        const [name] = fresh[0]
        const full = path.join(folder, name)
        // Finished = size and time unchanged for about 4 seconds (three looks), and no partial download left.
        let prev = fs.statSync(full)
        let quiet = 0
        while (quiet < 3) {
          await pause(1300)
          const st = fs.existsSync(full) ? fs.statSync(full) : null
          if (!st) break
          const stillPartial = [...listFiles(folder).keys()].some((n) => TEMP_FILE.test(n) && n.toLowerCase().startsWith(name.toLowerCase().slice(0, 12)))
          if (st.size > 0 && st.size === prev.size && st.mtimeMs === prev.mtimeMs && !stillPartial) quiet++
          else quiet = 0
          prev = st
        }
        if (quiet >= 3) {
          known.set(name, prev.mtimeMs)
          log('success', `Dosya geldi: ${name} (${Math.round(prev.size / 1024)} KB)`)
          return full
        }
        continue
      }
      if (Date.now() - lastNote > 20000) {
        lastNote = Date.now()
        log('info', partial ? 'İndirme sürüyor…' : `Hâlâ bekleniyor (${Math.round((until - Date.now()) / 1000)} sn kaldı).`)
      }
      await pause(1000)
    }
    log('warn', `${Math.round(timeout / 1000)} sn içinde yeni dosya gelmedi.`)
    return null
  }

  async function moveFile(from: string, to: string): Promise<string> {
    if (!fs.existsSync(from)) throw new Error(`Taşınacak dosya yok: ${from}`)
    let dst = path.isAbsolute(to) ? to : path.join(path.dirname(from), to)
    const dirTarget = /[\\/]$/.test(to) || (fs.existsSync(dst) && fs.statSync(dst).isDirectory())
    if (dirTarget) dst = path.join(dst, path.basename(from))
    else if (!path.extname(dst) && path.extname(from)) dst += path.extname(from)
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    if (path.resolve(dst) !== path.resolve(from) && fs.existsSync(dst)) {
      const alt = uniquePath(dst)
      log('warn', `${path.basename(dst)} zaten var; ${path.basename(alt)} olarak kaydediliyor.`)
      dst = alt
    }
    try {
      fs.renameSync(from, dst)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
      fs.copyFileSync(from, dst)
      fs.unlinkSync(from)
    }
    for (const known of baselines.values()) known.delete(path.basename(from))
    log('success', `Taşındı: ${path.basename(from)} → ${dst}`)
    return dst
  }

  // ---------- executor ----------

  const executor: Executor = {
    log,
    step: (id, status) => send('agent:step', { id, status }),
    patchNode: (id, patch) => send('agent:patch', { id, patch }),
    shouldStop: stopped,
    click: async (node, stepNo, ahead) => {
      await waitUnlocked()
      const t = await withScreenRetry(node.title, (wide) => findTarget(node, stepNo, wide), () => recoverTarget(node, ahead))
      const mode = node.clickMode ?? 'left'
      const confirmed = await ensureActed(node, ahead, t.dom !== undefined, async () => {
        if (t.dom !== undefined) await browser.clickItem(t.dom, mode)
        else await bridge.clickAt(t.x, t.y, mode)
        const verb = mode === 'double' ? 'Çift tıklandı' : mode === 'right' ? 'Sağ tıklandı' : 'Tıklandı'
        log('success', `${verb}: ${t.label}${t.dom === undefined ? ` @${Math.round(t.x)},${Math.round(t.y)}` : ''}`)
      })
      if (browser.hasPendingChooser() && ahead?.next?.kind !== 'type') {
        log('warn', 'Sayfa bir dosya seçme penceresi açtı ama sıradaki adım Yazı Yaz değil. Dosya yolunu bir Yazı Yaz ile ver; 60 sn içinde verilmezse pencere iptal edilir.')
      }
      if (confirmed) saveMemo(node, t.memo)
      await noteForeground()
    },
    type: async (node, stepNo, ahead) => {
      await waitUnlocked()
      const text = node.text ?? ''
      const enter = !!node.pressEnter
      const clear = node.clearFirst !== false
      if (browser.isOpen() && (await browser.feedChooser(text))) return
      let t: Resolved | null = null
      if (node.prompt?.trim() || node.locator) {
        t = await withScreenRetry(node.title, (wide) => findTarget(node, stepNo, wide), () => recoverTarget(node, ahead))
      } else {
        await guardFocus(node)
      }
      const confirmed = await ensureActed(node, ahead, t?.dom !== undefined, async () => {
        if (t?.dom !== undefined) {
          const v = await browser.fillItem(t.dom, text, clear, enter)
          const state = v === null || !text ? 'ok' : fieldState(v, text)
          if (state === 'empty' || state === 'wrong') throw new Error(`Yazı alana gitmedi: alanda “${(v ?? '').slice(0, 60)}” var.`)
          if (state === 'partial') log('warn', `Alan yazıyı biçimlendirmiş görünüyor (“${(v ?? '').slice(0, 60)}”); devam ediliyor.`)
          log('success', `Yazıldı: ${t.label}`)
          return
        }
        if (t) {
          await bridge.clickAt(t.x, t.y, 'left')
          await sleep(FOCUS_MS)
          log('info', `Alan seçildi: ${t.label}`)
        }
        await typeVerified(text, enter, clear)
      })
      if (confirmed) saveMemo(node, t?.memo)
      await noteForeground()
    },
    key: async (node, ahead) => {
      await waitUnlocked()
      const keys = node.keys
      if (!keys) throw new Error(`“${node.title}”: gönderilecek tuş boş.`)
      let t: Resolved | null = null
      if (node.useVision && node.prompt?.trim()) {
        t = await withScreenRetry(node.title, (wide) => resolveVision(node, wide), () => recoverTarget(node, ahead))
      } else if (!getSettings().targetWindow) {
        await guardFocus(node)
      }
      const confirmed = await ensureActed(node, ahead, false, async () => {
        if (t) {
          await bridge.clickAt(t.x, t.y, 'left')
          await sleep(FOCUS_MS)
          log('info', `Odaklanıldı: ${t.label} @${Math.round(t.x)},${Math.round(t.y)}`)
          await bridge.sendKeys(keys)
          return
        }
        const onPage = await browserInFront()
        await bridge.sendKeys(keys, onPage ? undefined : getSettings().targetWindow || undefined)
      })
      if (confirmed) saveMemo(node, t?.memo)
      await noteForeground()
    },
    exists: async (text, node) => {
      await waitUnlocked()
      const found = (how: string) => {
        log('info', `“${node.title}” gördü: ${how}.`)
        return true
      }
      if (text && browser.isOpen() && (await browser.hasText(text))) return found(`sayfada “${text}” yazısı`)
      if (node.locator) {
        const how = await savedTargetVisible(node)
        if (how) return found(how)
      }
      if (text) {
        const res = await bridge.scan({ image: 'none', fresh: true })
        noteCjk(res, node.id)
        const hit = containsTextStrict(res.items, text)
        if (hit) return found(`ekranda “${hit.text}” (${hit.src === 'ocr' ? 'okunan yazı' : hit.type})`)
        if (!node.locator && !noted.has(`${node.id}:loose`)) {
          const near = res.items.find((i) => containsText([i], text))
          if (near) noteOnce(node.id, 'loose', `“${text}” tam kelime olarak yok ama “${near.text}” içinde geçiyor; Koşul bunu “var” saymıyor. Gerekirse yazıyı “${near.text}” yap.`)
        }
      }
      if (node.useVision && (text || node.locator?.icon)) {
        const last = lastVisionAt.get(node.id) ?? 0
        if (Date.now() - last < 5000) return false
        lastVisionAt.set(node.id, Date.now())
        if (await visionExists(text, node)) return found('görsel model')
      }
      return false
    },
    captureFailure: async (label) => {
      if (!failDir) return
      const res = await bridge.scan({ image: 'plain', uia: false, ocr: false, fresh: true, maxImageW: 1600 }).catch(() => null)
      if (!res?.image?.data) return
      const safe = label.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 60)
      const file = path.join(failDir, `hata-${new Date().toISOString().replace(/[:.]/g, '-')}-${safe}.jpg`)
      fs.writeFileSync(file, Buffer.from(res.image.data, 'base64'))
      log('info', `Hata anının ekran görüntüsü kaydedildi: ${file}`)
    },
    initiative: (node, stepNo, ahead, vars) =>
      node.engine === 'list' ? initiative(node, stepNo, ahead, vars) : initiativeScreen(node, stepNo, ahead, vars),
    openBrowser: async (node) => {
      await browser.open({
        url: node.url ?? '',
        browser: node.browser ?? 'auto',
        profileDir: path.join(app.getPath('userData'), 'browser-profile'),
        downloadsDir: downloadsDir(),
        log: (l, m) => log(l, m),
      })
    },
    waitFile,
    moveFile: (from, to) => moveFile(from, to),
  }

  return { executor, beginRun, closeBrowser: () => browser.close() }
}
