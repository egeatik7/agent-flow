import { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen } from 'electron'
import fs from 'fs'
import path from 'path'
import ElectronStore from 'electron-store'
import * as bridge from './a11y-bridge'
import {
  chooseScreenTarget,
  listModels,
  testKey,
  visionCheck,
  visionDescribe,
  visionLocate,
  visionRefine,
} from './openrouter'
import { runGraph, StoppedError, type Executor } from './runner'
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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

async function scanFor(node: AgentNode, withImage: boolean): Promise<ScanResult> {
  const s = getSettings()
  const res = await bridge.scan({ windowTitle: s.targetWindow || undefined, image: withImage ? 'marked' : 'none' })
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
async function resolveVision(node: AgentNode): Promise<{ x: number; y: number; label: string }> {
  const { apiKey, model } = visionModelOrThrow()
  const prompt = visionPrompt(node)
  const s = getSettings()
  const scanRes = await bridge.scan({ windowTitle: s.targetWindow || undefined, image: 'marked', maxImageW: 1600 })
  warnMissingWindow(scanRes)
  log('info', `[görsel] Ekran görüntüsü ${model} modeline gönderildi (${scanRes.items.length} işaretli öğe).`)
  const pick = await visionLocate({ apiKey, model, prompt, kind: node.kind, scan: scanRes, stepTitle: node.title })

  if (pick.kind === 'item') {
    const item = scanRes.items.find((i) => i.id === pick.id)!
    log('info', `[görsel] Seçilen: #${item.id} “${item.text}”${pick.reason ? ` — ${pick.reason}` : ''}`)
    return { ...center(item), label: `[görsel] “${item.text}”` }
  }
  if (pick.kind === 'none') {
    throw new Error(`[görsel] Model “${prompt}” hedefini ekranda bulamadı${pick.reason ? `: ${pick.reason}` : ''}.`)
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
  const s = getSettings()
  const res = await bridge.scan({ windowTitle: s.targetWindow || undefined, image: 'plain', uia: false, ocr: false, maxImageW: 1400 })
  warnMissingWindow(res)
  if (!res.image) throw new Error('Ekran görüntüsü alınamadı.')
  const r = await visionCheck({ apiKey, model, question: text, image: res.image })
  log('info', `[görsel] “${text}” → ${r.answer ? 'evet' : 'hayır'}${r.reason ? ` (${r.reason})` : ''}`)
  return r.answer
}

const findTarget = (node: AgentNode, stepNo: number) => (node.useVision ? resolveVision(node) : resolveTarget(node, stepNo))

/** Resolves where to click for a Click/Type node, from the most to the least deterministic source. */
async function resolveTarget(node: AgentNode, stepNo: number): Promise<{ x: number; y: number; label: string }> {
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
  const scanRes = await scanFor(node, wantLlm && s.sendScreenshot)
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
  throw new Error(
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
  click: async (node, stepNo) => {
    const t = await findTarget(node, stepNo)
    const mode = node.clickMode ?? 'left'
    await bridge.clickAt(t.x, t.y, mode)
    log('success', `${mode === 'double' ? 'Çift tıklandı' : mode === 'right' ? 'Sağ tıklandı' : 'Tıklandı'}: ${t.label} @${Math.round(t.x)},${Math.round(t.y)}`)
    send('agent:anchor', { id: node.id, x: Math.round(t.x), y: Math.round(t.y) })
  },
  type: async (node, stepNo) => {
    if (node.prompt?.trim() || node.locator) {
      const t = await findTarget(node, stepNo)
      await bridge.clickAt(t.x, t.y, 'left')
      await sleep(120)
      log('info', `Alan seçildi: ${t.label}`)
      send('agent:anchor', { id: node.id, x: Math.round(t.x), y: Math.round(t.y) })
    }
    await bridge.typeText(node.text ?? '', !!node.pressEnter, node.clearFirst !== false)
  },
  key: async (node) => {
    if (!node.keys) throw new Error(`“${node.title}”: gönderilecek tuş boş.`)
    if (node.useVision && node.prompt?.trim()) {
      const t = await resolveVision(node)
      await bridge.clickAt(t.x, t.y, 'left')
      await sleep(150)
      log('info', `Odaklanıldı: ${t.label} @${Math.round(t.x)},${Math.round(t.y)}`)
      await bridge.sendKeys(node.keys)
      return
    }
    await bridge.sendKeys(node.keys, getSettings().targetWindow || undefined)
  },
  exists: async (text, node) => {
    if (node.useVision) return visionExists(node, text)
    const s = getSettings()
    const res = await bridge.scan({ windowTitle: s.targetWindow || undefined, image: 'none' })
    warnMissingWindow(res)
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
