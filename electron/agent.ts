import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import * as bridge from './a11y-bridge'
import * as browser from './browser'
import { describeAhead, expectation, judgeScreen, type Verdict } from './confirm'
import { renderTemplate, type AgentNode, type AppSettings, type LogLevel, type TargetMemo } from './graph-types'
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
} from './matcher'
import { conflict, describeMemory, likeness, memoOf, remember } from './memory'
import {
  chooseScreenTarget,
  judgeReaction,
  nextAction,
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

  /** Called when a run starts: forget this run's memory copies, note which files already exist. */
  function beginRun(folders: string[]) {
    runMemo.clear()
    runTrace.clear()
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
    log('info', `Ekran tarandı: ${res.items.length} yazı/öğe (UIA ${res.uiaCount}, OCR ${res.ocr ? res.ocrCount : 'kapalı'})${res.window ? ` — ${res.window}` : ''}`)
    if (!res.ocr) log('warn', 'Windows OCR kullanılamıyor; sadece uygulamanın bildirdiği isimler görülebiliyor.')
    return res
  }

  // ---------- finding targets ----------

  type Pick = { item: ScreenItem; target: Target; memo: TargetMemo; how: string }

  /**
   * Fresh search on this lap's screen. Memory only breaks ties between near-equal matches,
   * and a pick that clearly disagrees with the recent laps is looked at twice.
   */
  async function pickFrom(node: AgentNode, scan: ScanResult, win: string, allowLlm: boolean): Promise<Pick | null> {
    const s = getSettings()
    const items = scan.items
    const area = scan.area
    const prompt = node.prompt?.trim() ?? ''
    const explicit = extractTarget(prompt)
    const loc = node.locator
    const recordedText = loc?.text || loc?.name || ''
    const mem = memoFor(node)
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

    if (await browserInFront()) {
      const d = await browser.items()
      log('info', `[sayfa] ${d.items.length} öğe okundu${d.host ? ` (${d.host})` : ''}.`)
      const pick = await pickFrom(node, pseudoScan(d.items, d.area, d.host), `web:${d.host}`, true)
      if (pick) return { x: 0, y: 0, dom: pick.item.id, memo: pick.memo, label: `[sayfa] “${pick.target.text}” (${pick.how})` }
      log('info', '[sayfa] Sayfada bulunamadı; ekran okunuyor (açılır pencere ya da sistem penceresi olabilir).')
    }

    const loc = node.locator
    const win = s.targetWindow || loc?.windowTitle || ''
    if (loc && win && (loc.automationId || loc.name)) {
      try {
        const r = await bridge.locate(loc, win)
        if (r) return { ...center(r), label: `kayıtlı öğe “${r.name || loc.text || loc.name}”` }
      } catch {
        /* fall through to reading the screen */
      }
    }

    const scanRes = await scanFor(!!s.apiKey && !!prompt && s.sendScreenshot, wide)
    const pick = await pickFrom(node, scanRes, scanRes.window || win, true)
    if (pick) return { ...center(pick.target), memo: pick.memo, label: `“${pick.target.text}” (${pick.how})` }

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

  async function visionExists(text: string): Promise<boolean> {
    const { apiKey, model } = visionModelOrThrow()
    const res = await bridge.scan({ image: 'plain', uia: false, ocr: false, maxImageW: 1400, fresh: true })
    if (!res.image) throw new Error('Ekran görüntüsü alınamadı.')
    const r = await visionCheck({ apiKey, model, question: text, image: res.image })
    log('info', `[görsel] “${text}” → ${r.answer ? 'evet' : 'hayır'}${r.reason ? ` (${r.reason})` : ''}`)
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
  async function ensureActed(node: AgentNode, ahead: StepAhead | undefined, onPage: boolean, act: () => Promise<void>) {
    if (ahead?.next?.kind === 'waitFor' || ahead?.next?.kind === 'waitFile') {
      await act()
      if (onPage) await browser.settle(1500)
      log('info', `“${node.title}” bir kez yapıldı. Sıradaki adım zaten beklediği için kontrol edilmeden geçiliyor.`)
      return
    }
    if (onPage) {
      await act()
      await browser.settle()
      if (await aheadIsReady(ahead, true)) return
      await pause(2000)
      await browser.settle()
      if (await aheadIsReady(ahead, true)) return
      log('info', 'Sayfada sıradaki öğe henüz yok; sıradaki adım kendisi arayıp bekleyecek.')
      return
    }
    if (process.platform !== 'win32') {
      await act()
      return
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
      return
    }
    if (verdict.kind === 'blocked' || verdict.kind === 'unknown') {
      verdict = await lookCloser(verdict, before, after, node, ahead)
      if (verdict.kind === 'ready') {
        log('success', `Emin: ${verdict.reason}.`)
        return
      }
    }

    log('info', `Tepki net değil (${verdict.reason}). Akış bozulmadan sıradaki adım kontrol edilecek.`)
    if (await aheadIsReady(ahead)) return

    log('info', 'Sıradaki öğe henüz yok. Karar vermeden önce beklenecek.')
    await pause(2500)
    if (await aheadIsReady(ahead)) return

    const plan = await askPlan(node, ahead, verdict.reason)
    if (plan) {
      log('info', `Plan: ${planLabel(plan.action, plan.waitMs)}. ${plan.reason}`)
      if (plan.action === 'wait') await pause(plan.waitMs)
      if (plan.action !== 'stop' && (await aheadIsReady(ahead))) return
      if (plan.action === 'continue') {
        log('info', 'Plan sıradaki adımı denemeyi seçti. Operasyon bozulmadan devam ediliyor.')
        return
      }
      if (await aheadIsReady(ahead)) return
      throw new Error(`“${node.title}” sonrası duruldu. ${plan.reason || verdict.reason}`)
    }

    if (await aheadIsReady(ahead)) return
    throw new Error(`“${node.title}” tepki vermedi ve sıradaki öğe ekranda yok. Beklendi, yine de bulunamadı.`)
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

  // ---------- typing ----------

  /** Types into the focused field, reads it back, retypes once if it holds something else. */
  async function typeVerified(text: string, enter: boolean, clear: boolean) {
    await bridge.typeText(text, false, clear)
    if (text) {
      let v = await bridge.focusedValue()
      if (v !== null && !fieldHolds(v, text)) {
        log('warn', `Alanda “${v.slice(0, 60)}” yazıyor, beklenen bu değil. Alan temizlenip bir kez daha yazılıyor.`)
        await bridge.typeText(text, false, true)
        v = await bridge.focusedValue()
        if (v !== null && !fieldHolds(v, text)) throw new Error(`Yazı alana gitmedi: alanda “${v.slice(0, 60)}” var.`)
      }
      if (v !== null) log('success', 'Alan doğrulandı: yazı yerinde.')
    }
    if (enter) {
      await sleep(240)
      await bridge.sendKeys('{ENTER}')
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
        const size1 = fs.statSync(full).size
        await pause(1500)
        const st = fs.existsSync(full) ? fs.statSync(full) : null
        if (st && st.size > 0 && st.size === size1) {
          known.set(name, st.mtimeMs)
          log('success', `Dosya geldi: ${name} (${Math.round(st.size / 1024)} KB)`)
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
      const t = await withScreenRetry(node.title, (wide) => findTarget(node, stepNo, wide), () => recoverTarget(node, ahead))
      const mode = node.clickMode ?? 'left'
      await ensureActed(node, ahead, t.dom !== undefined, async () => {
        if (t.dom !== undefined) await browser.clickItem(t.dom, mode)
        else await bridge.clickAt(t.x, t.y, mode)
        const verb = mode === 'double' ? 'Çift tıklandı' : mode === 'right' ? 'Sağ tıklandı' : 'Tıklandı'
        log('success', `${verb}: ${t.label}${t.dom === undefined ? ` @${Math.round(t.x)},${Math.round(t.y)}` : ''}`)
      })
      saveMemo(node, t.memo)
    },
    type: async (node, stepNo, ahead) => {
      const text = node.text ?? ''
      const enter = !!node.pressEnter
      const clear = node.clearFirst !== false
      if (browser.isOpen() && (await browser.feedChooser(text))) return
      let t: Resolved | null = null
      if (node.prompt?.trim() || node.locator) {
        t = await withScreenRetry(node.title, (wide) => findTarget(node, stepNo, wide), () => recoverTarget(node, ahead))
      }
      await ensureActed(node, ahead, t?.dom !== undefined, async () => {
        if (t?.dom !== undefined) {
          const v = await browser.fillItem(t.dom, text, clear, enter)
          if (v !== null && text && !fieldHolds(v, text)) throw new Error(`Yazı alana gitmedi: alanda “${v.slice(0, 60)}” var.`)
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
      saveMemo(node, t?.memo)
    },
    key: async (node, ahead) => {
      const keys = node.keys
      if (!keys) throw new Error(`“${node.title}”: gönderilecek tuş boş.`)
      let t: Resolved | null = null
      if (node.useVision && node.prompt?.trim()) {
        t = await withScreenRetry(node.title, (wide) => resolveVision(node, wide), () => recoverTarget(node, ahead))
      }
      await ensureActed(node, ahead, false, async () => {
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
      saveMemo(node, t?.memo)
    },
    exists: async (text, node) => {
      if (node.useVision) return visionExists(text)
      if (browser.isOpen() && (await browser.hasText(text))) return true
      const res = await bridge.scan({ image: 'none', fresh: true })
      log('info', `Ekran yenilendi: ${res.items.length} yazı/öğe (UIA ${res.uiaCount}, OCR ${res.ocr ? res.ocrCount : 'kapalı'})`)
      return containsText(res.items, text)
    },
    initiative,
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
