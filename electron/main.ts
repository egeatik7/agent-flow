import { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen } from 'electron'
import fs from 'fs'
import path from 'path'
import ElectronStore from 'electron-store'
import * as bridge from './a11y-bridge'
import { describeAhead, expectation, judgeScreen, type Verdict } from './confirm'
import { rememberShot } from './shots'
import {
  chooseScreenTarget,
  judgeReaction,
  listModels,
  planStall,
  setChatLogger,
  testKey,
  visionCheck,
  visionDescribe,
  visionLocate,
  visionRefine,
  type ReactionVerdict,
} from './openrouter'
import { interruptibleSleep, runGraph, StoppedError, type Executor, type StepAhead } from './runner'
import {
  containsText,
  extractTarget,
  matchFuzzy,
  matchPrompt,
  matchText,
  refineTarget,
  sampleTexts,
  type ScanResult,
  type Target,
} from './matcher'
import {
  DEFAULT_SETTINGS,
  normalizeGraph,
  type AgentGraph,
  type AgentNode,
  type AppSettings,
  type LogLevel,
} from './graph-types'

const STOP_HOTKEY = 'CommandOrControl+Shift+Q'

const StoreCtor =
  (ElectronStore as unknown as { default?: typeof ElectronStore }).default ?? ElectronStore

const store = new StoreCtor<{ settings: AppSettings; graph: AgentGraph }>({
  name: 'xp-agent-studio',
  defaults: { settings: DEFAULT_SETTINGS, graph: { nodes: [], edges: [] } },
})

let mainWindow: BrowserWindow | null = null
let running = false
let stopRequested = false

function getSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS, ...store.get('settings') }
}

function send(channel: string, payload: unknown) {
  mainWindow?.webContents.send(channel, payload)
}

function log(level: LogLevel, message: string) {
  send('agent:log', { level, message })
}

setChatLogger((line) => log('chat', line))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** After a click, before keys: lets the field take focus. */
const FOCUS_MS = 420
/** Built-in: if a target is missing, wait, rescan the whole screen, try once more. */
const REFRESH_RETRY_MS = 3000

class NotFoundError extends Error {}

type Snap = { texts: string[]; image: string | null }

async function snap(label: string): Promise<Snap> {
  const res = await bridge.scan({ image: 'plain', fresh: true, maxImageW: 1100 })
  if (res.image?.data) rememberShot(res.image.data, label)
  return { texts: res.items.map((i) => i.text), image: res.image?.data ?? null }
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

function labelOf(k: ReactionVerdict): string {
  if (k === 'ready') return 'hazır'
  if (k === 'missed') return 'tepki yok'
  if (k === 'loading') return 'yükleniyor'
  if (k === 'blocked') return 'başka bir şey açıldı'
  return 'belirsiz'
}

function firstGoal(ahead?: StepAhead): { text: string; label: string } | null {
  for (const n of [ahead?.next, ahead?.then]) {
    if (!n) continue
    if (n.kind === 'loop' || n.kind === 'end' || n.kind === 'start' || n.kind === 'wait') continue
    const text = expectation({ next: n }).trim()
    if (!text) continue
    return { text, label: `“${n.title}” için “${text}”` }
  }
  return null
}

function sees(items: ScanResult['items'], text: string): boolean {
  if (containsText(items, text)) return true
  return !!matchPrompt(items, text)
}

/** The next step's own target, without clicking it. Empty goal means there is nothing that should block the run. */
async function aheadIsReady(ahead?: StepAhead): Promise<boolean> {
  const goal = firstGoal(ahead)
  if (!goal) {
    log('info', 'Sırada kontrol edilecek bir öğe yok. Devam ediliyor.')
    return true
  }
  const res = await bridge.scan({ image: 'none', fresh: true })
  if (sees(res.items, goal.text)) {
    log('success', `${goal.label} ekranda. Operasyon bozulmadan devam ediliyor.`)
    return true
  }
  log('info', `${goal.label} ekranda görünmüyor.`)
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
 * After one click, type, or key. A missing reaction does not break the run:
 * the next node's target is checked first. Only if that target cannot be reached
 * does the agent pause, look again, and plan before stopping.
 */
async function ensureActed(node: AgentNode, ahead: StepAhead | undefined, act: () => Promise<void>) {
  if (process.platform !== 'win32') {
    await act()
    return
  }
  if (ahead?.next?.kind === 'waitFor') {
    await act()
    log('info', `“${node.title}” bir kez yapıldı. Sıradaki adım öğe beklediği için kontrol edilmeden beklemeye geçiliyor.`)
    return
  }

  const pause = (ms: number) => interruptibleSleep(ms, () => stopRequested)
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
    if (!(e instanceof NotFoundError) || stopRequested) throw e
    log('warn', `“${title}” bulunamadı. 3 sn sonra ekran yenilenip bir kez daha denenecek.`)
    await interruptibleSleep(REFRESH_RETRY_MS, () => stopRequested)
    if (stopRequested) throw new StoppedError()
    try {
      return await run(true)
    } catch (e2) {
      if (!(e2 instanceof NotFoundError) || stopRequested || inRecover || !recover) throw e2
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

/** The click/type target was not on screen. Wait, ask for a plan, then look once more before the run stops. */
async function recoverTarget(
  node: AgentNode,
  ahead: StepAhead | undefined
): Promise<{ x: number; y: number; label: string } | null> {
  await interruptibleSleep(2000, () => stopRequested)
  if (stopRequested) throw new StoppedError()
  const plan = await askPlan(node, ahead, `“${node.title}” istediği öğeyi ekranda bulamadı`)
  if (!plan) return null
  log('info', `Plan: ${planLabel(plan.action, plan.waitMs)}. ${plan.reason}`)
  if (plan.action === 'wait') {
    await interruptibleSleep(plan.waitMs, () => stopRequested)
    if (stopRequested) throw new StoppedError()
  }
  const needle = plan.lookFor || expectation({ next: node }) || node.prompt?.trim() || node.locator?.text || node.locator?.name || ''
  if (needle && plan.action !== 'stop') {
    const res = await bridge.scan({ image: 'none', fresh: true })
    const hit = matchText(res.items, needle) ?? matchPrompt(res.items, needle) ?? matchFuzzy(res.items, needle)
    if (hit) {
      log('success', `Planın yazısı bulundu: “${hit.text}”.`)
      return { ...center(hit), label: `“${hit.text}” (plan)` }
    }
  }
  if (plan.action === 'stop') return null
  if (!node.useVision && getSettings().apiKey) {
    try {
      return await resolveVision(node, true)
    } catch {
      return null
    }
  }
  return null
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  mainWindow = new BrowserWindow({
    width: Math.min(1320, width),
    height: Math.min(860, height),
    minWidth: 980,
    minHeight: 640,
    frame: false,
    backgroundColor: '#3a6ea5',
    icon: path.join(__dirname, '../resources/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    title: 'XP Agent Studio',
  })

  if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  else mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

async function hideSelf() {
  if (!mainWindow || mainWindow.isMinimized()) return false
  mainWindow.minimize()
  await sleep(450)
  return true
}

function showSelf() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function center(t: { x: number; y: number; w: number; h: number }) {
  return { x: t.x + t.w / 2, y: t.y + t.h / 2 }
}

const warnedMissing = new Set<string>()

function warnMissingWindow(res: ScanResult) {
  if (!res.missingWindow || warnedMissing.has(res.missingWindow)) return
  warnedMissing.add(res.missingWindow)
  log(
    'warn',
    `Hedef pencere “${res.missingWindow}” açık değil, tüm ekran okunuyor. Kalıcı çözüm: Ayarlar > Hedef pencere > “Tüm ekran” > Kaydet.`
  )
}

async function scanFor(node: AgentNode, withImage: boolean, wide = false): Promise<ScanResult> {
  const s = getSettings()
  const res = await bridge.scan({
    windowTitle: wide ? undefined : s.targetWindow || undefined,
    image: withImage ? 'marked' : 'none',
    fresh: wide,
  })
  warnMissingWindow(res)
  log(
    'info',
    `Ekran tarandı: ${res.items.length} yazı/öğe (UIA ${res.uiaCount}, OCR ${res.ocr ? res.ocrCount : 'kapalı'})${res.window ? ` — ${res.window}` : ''}`
  )
  if (!res.ocr) log('warn', 'Windows OCR kullanılamıyor; sadece uygulamanın bildirdiği isimler görülebiliyor.')
  return res
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
async function resolveVision(node: AgentNode, wide = false): Promise<{ x: number; y: number; label: string }> {
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
  log('info', `[görsel] Ekran görüntüsü ${model} modeline gönderildi (${scanRes.items.length} işaretli öğe).`)
  const pick = await visionLocate({ apiKey, model, prompt, kind: node.kind, scan: scanRes, stepTitle: node.title })

  if (pick.kind === 'item') {
    const item = scanRes.items.find((i) => i.id === pick.id)!
    log('info', `[görsel] Seçilen: #${item.id} “${item.text}”${pick.reason ? ` — ${pick.reason}` : ''}`)
    return { ...center(item), label: `[görsel] “${item.text}”` }
  }
  if (pick.kind === 'none') {
    throw new NotFoundError(`[görsel] Model “${prompt}” hedefini ekranda bulamadı${pick.reason ? `: ${pick.reason}` : ''}.`)
  }

  const a = scanRes.area
  const gx = a.x + (pick.nx / 1000) * a.w
  const gy = a.y + (pick.ny / 1000) * a.h
  log('info', `[görsel] İlk tahmin @${Math.round(gx)},${Math.round(gy)}${pick.reason ? ` — ${pick.reason}` : ''}; yakınlaştırılıp netleştiriliyor…`)
  try {
    const cw = Math.min(520, a.w)
    const ch = Math.min(340, a.h)
    const c = await bridge.crop({ x: Math.round(gx - cw / 2), y: Math.round(gy - ch / 2), w: cw, h: ch }, 1040)
    const r = await visionRefine({ apiKey, model, prompt, image: c.image })
    if (r) {
      const fx = c.area.x + (r.x / 1000) * c.area.w
      const fy = c.area.y + (r.y / 1000) * c.area.h
      return { x: fx, y: fy, label: '[görsel] netleştirilmiş nokta' }
    }
    log('warn', '[görsel] Yakın planda hedef görülmedi, ilk tahmin kullanılıyor.')
  } catch (e) {
    log('warn', `[görsel] Netleştirme atlandı: ${(e as Error).message}`)
  }
  return { x: gx, y: gy, label: '[görsel] tahmini nokta' }
}

async function visionExists(node: AgentNode, text: string): Promise<boolean> {
  const { apiKey, model } = visionModelOrThrow()
  const res = await bridge.scan({ image: 'plain', uia: false, ocr: false, maxImageW: 1400, fresh: true })
  if (!res.image) throw new Error('Ekran görüntüsü alınamadı.')
  const r = await visionCheck({ apiKey, model, question: text, image: res.image })
  log('info', `[görsel] “${text}” → ${r.answer ? 'evet' : 'hayır'}${r.reason ? ` (${r.reason})` : ''}`)
  return r.answer
}

const findTarget = (node: AgentNode, stepNo: number, wide = false) =>
  node.useVision ? resolveVision(node, wide) : resolveTarget(node, stepNo, wide)

/** Resolves where to click for a Click/Type node, from the most to the least deterministic source. */
async function resolveTarget(node: AgentNode, stepNo: number, wide = false): Promise<{ x: number; y: number; label: string }> {
  const s = getSettings()
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

  const prompt = node.prompt?.trim() ?? ''
  const explicit = extractTarget(prompt)
  const recordedText = loc?.text || loc?.name || ''
  const wantLlm = !!s.apiKey && !!prompt
  const scanRes = await scanFor(node, wantLlm && s.sendScreenshot, wide)
  const anchor = node.anchor ?? (loc?.x !== undefined && loc?.y !== undefined ? { x: loc.x, y: loc.y } : undefined)

  let hit: Target | null = null
  if (explicit?.quoted) {
    hit =
      matchText(scanRes.items, explicit.text, { anchor, minScore: 60 }) ??
      matchFuzzy(scanRes.items, explicit.text, { anchor, minScore: 80 })
  }
  if (!hit && !prompt && recordedText) {
    hit =
      matchText(scanRes.items, recordedText, { anchor, minScore: 60 }) ??
      matchFuzzy(scanRes.items, recordedText, { anchor, minScore: 80 })
  }
  if (hit) return { ...center(hit), label: `“${hit.text}” yazısı` }

  if (wantLlm) {
    const choice = await chooseScreenTarget({
      apiKey: s.apiKey,
      model: s.model,
      prompt,
      kind: node.kind,
      scan: scanRes,
      stepTitle: node.title,
      sendImage: s.sendScreenshot,
      onImageFallback: (m) => log('warn', m),
    })
    const item = choice.id !== null ? scanRes.items.find((i) => i.id === choice.id) : undefined
    if (item) {
      const t = refineTarget(item, choice.text)
      log('info', `LLM seçti: #${item.id} “${item.text}”${choice.reason ? ` — ${choice.reason}` : ''}`)
      return { ...center(t), label: `“${t.text}”` }
    }
    log('warn', `LLM uygun öğe bulamadı${choice.reason ? `: ${choice.reason}` : ''}.`)
  }

  hit =
    matchPrompt(scanRes.items, prompt || recordedText, anchor) ??
    (explicit ? matchText(scanRes.items, explicit.text, { anchor }) : null) ??
    (recordedText ? matchText(scanRes.items, recordedText, { anchor }) : null) ??
    matchFuzzy(scanRes.items, explicit?.text || prompt || recordedText, { anchor }) ??
    (recordedText && prompt ? matchFuzzy(scanRes.items, recordedText, { anchor }) : null)
  if (hit) return { ...center(hit), label: `“${hit.text}” (yazı eşleşmesi)` }

  if (loc?.offsetX !== undefined && loc.offsetY !== undefined && win) {
    try {
      const r = await bridge.windowRect(win)
      log('warn', 'Yazı bulunamadı, kayıttaki konuma tıklanıyor.')
      return { x: r.x + loc.offsetX, y: r.y + loc.offsetY!, label: 'kayıtlı konum' }
    } catch {
      /* window gone */
    }
  }

  const seen = sampleTexts(scanRes.items)
  throw new NotFoundError(
    `“${explicit?.text || prompt || recordedText || node.title}” ekranda bulunamadı.${
      s.apiKey ? '' : ' (API anahtarı yok, sadece yazı eşleşmesi denendi.)'
    }${seen ? ` Ekranda görülenlerden bazıları: ${seen}` : ''}`
  )
}

const executor: Executor = {
  log,
  step: (id, status) => send('agent:step', { id, status }),
  loopProgress: (id, index) => send('agent:loop', { id, index }),
  shouldStop: () => stopRequested,
  click: async (node, stepNo, ahead) => {
    await ensureActed(node, ahead, async () => {
      const t = await withScreenRetry(node.title, (wide) => findTarget(node, stepNo, wide), () => recoverTarget(node, ahead))
      const mode = node.clickMode ?? 'left'
      await bridge.clickAt(t.x, t.y, mode)
      log('success', `${mode === 'double' ? 'Çift tıklandı' : mode === 'right' ? 'Sağ tıklandı' : 'Tıklandı'}: ${t.label} @${Math.round(t.x)},${Math.round(t.y)}`)
      send('agent:anchor', { id: node.id, x: Math.round(t.x), y: Math.round(t.y) })
    })
  },
  type: async (node, stepNo, ahead) => {
    await ensureActed(node, ahead, async () => {
      if (node.prompt?.trim() || node.locator) {
        const t = await withScreenRetry(node.title, (wide) => findTarget(node, stepNo, wide), () => recoverTarget(node, ahead))
        await bridge.clickAt(t.x, t.y, 'left')
        await sleep(FOCUS_MS)
        log('info', `Alan seçildi: ${t.label}`)
        send('agent:anchor', { id: node.id, x: Math.round(t.x), y: Math.round(t.y) })
      }
      await bridge.typeText(node.text ?? '', !!node.pressEnter, node.clearFirst !== false)
    })
  },
  key: async (node, ahead) => {
    const keys = node.keys
    if (!keys) throw new Error(`“${node.title}”: gönderilecek tuş boş.`)
    await ensureActed(node, ahead, async () => {
      if (node.useVision && node.prompt?.trim()) {
        const t = await withScreenRetry(node.title, (wide) => resolveVision(node, wide), () => recoverTarget(node, ahead))
        await bridge.clickAt(t.x, t.y, 'left')
        await sleep(FOCUS_MS)
        log('info', `Odaklanıldı: ${t.label} @${Math.round(t.x)},${Math.round(t.y)}`)
        await bridge.sendKeys(keys)
        return
      }
      await bridge.sendKeys(keys, getSettings().targetWindow || undefined)
    })
  },
  exists: async (text, node) => {
    if (node.useVision) return visionExists(node, text)
    const res = await bridge.scan({ image: 'none', fresh: true })
    log('info', `Ekran yenilendi: ${res.items.length} yazı/öğe (UIA ${res.uiaCount}, OCR ${res.ocr ? res.ocrCount : 'kapalı'})`)
    return containsText(res.items, text)
  },
}

app.whenReady().then(() => {
  createWindow()
  bridge.warmUp()

  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.handle('window:close', () => mainWindow?.close())

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_e, partial: Partial<AppSettings>) => {
    const next = { ...getSettings(), ...partial }
    store.set('settings', next)
    return next
  })

  ipcMain.handle('graph:get', () => normalizeGraph(store.get('graph')))
  ipcMain.handle('graph:save', (_e, graph: AgentGraph) => {
    store.set('graph', graph)
    return true
  })

  ipcMain.handle('windows:list', () => bridge.listWindows())

  ipcMain.handle('dialog:pickFolder', async (_e, extensions: string[]) => {
    if (!mainWindow) return null
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Klasör seç', properties: ['openDirectory'] })
    const dir = r.filePaths[0]
    if (r.canceled || !dir) return null
    const exts = extensions.map((e) => e.trim().replace(/^\./, '').toLowerCase()).filter(Boolean)
    const files = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name)
      .filter((n) => !exts.length || exts.includes(path.extname(n).slice(1).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, 'tr', { numeric: true, sensitivity: 'base' }))
      .map((n) => path.join(dir, n))
    return { folder: dir, files }
  })

  ipcMain.handle('screen:scan', async (_e, windowTitle?: string) => {
    const hidden = await hideSelf()
    try {
      return await bridge.scan({ windowTitle: windowTitle || undefined, image: 'plain', maxImageW: 1600 })
    } finally {
      if (hidden) showSelf()
    }
  })

  ipcMain.handle('capture:afterDelay', async (_e, ms: number) => {
    await sleep(Math.max(0, ms))
    return bridge.captureAtCursor()
  })

  ipcMain.handle('agent:run', async (_e, graph: AgentGraph, startId?: string) => {
    if (running) throw new Error('Ajan zaten çalışıyor.')
    running = true
    stopRequested = false
    warnedMissing.clear()
    store.set('graph', graph)
    const s = getSettings()
    globalShortcut.register(STOP_HOTKEY, () => {
      stopRequested = true
    })
    let hidden = false
    try {
      if (s.hideWhileRunning) {
        log('info', 'Uygulama küçültülüyor; durdurmak için Ctrl+Shift+Q.')
        hidden = await hideSelf()
      }
      await runGraph(graph, executor, {
        maxSteps: Math.max(1, s.maxSteps),
        stepDelayMs: Math.max(0, s.stepDelayMs),
        startId,
      })
      return { ok: true }
    } catch (e) {
      if (e instanceof StoppedError) {
        log('warn', 'Ajan durduruldu.')
        return { ok: false, stopped: true }
      }
      throw e
    } finally {
      globalShortcut.unregister(STOP_HOTKEY)
      running = false
      if (hidden) showSelf()
    }
  })
  ipcMain.handle('agent:stop', () => {
    stopRequested = true
    return true
  })

  ipcMain.handle('openrouter:test', async () => {
    const s = getSettings()
    if (!s.apiKey) throw new Error('Önce API anahtarını kaydet.')
    return testKey(s.apiKey)
  })
  ipcMain.handle('openrouter:models', () => listModels())
  ipcMain.handle('openrouter:testVision', async () => {
    const { apiKey, model } = visionModelOrThrow()
    const hidden = await hideSelf()
    let shot: Awaited<ReturnType<typeof bridge.scan>>
    try {
      shot = await bridge.scan({ image: 'plain', uia: false, ocr: false, maxImageW: 1200 })
    } finally {
      if (hidden) showSelf()
    }
    if (!shot.image) throw new Error('Ekran görüntüsü alınamadı.')
    return { model, text: await visionDescribe({ apiKey, model, image: shot.image }) }
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  bridge.shutdown()
  app.quit()
})
