import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron'
import path from 'path'
import ElectronStore from 'electron-store'
import * as bridge from './a11y-bridge'
import { chooseScreenTarget, listModels, testKey } from './openrouter'
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
let recorder: bridge.Recorder | null = null
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
  shouldStop: () => stopRequested,
  click: async (node, stepNo) => {
    const t = await resolveTarget(node, stepNo)
    const mode = node.clickMode ?? 'left'
    await bridge.clickAt(t.x, t.y, mode)
    log('success', `${mode === 'double' ? 'Çift tıklandı' : mode === 'right' ? 'Sağ tıklandı' : 'Tıklandı'}: ${t.label} @${Math.round(t.x)},${Math.round(t.y)}`)
    send('agent:anchor', { id: node.id, x: Math.round(t.x), y: Math.round(t.y) })
  },
  type: async (node, stepNo) => {
    if (node.prompt?.trim() || node.locator) {
      const t = await resolveTarget(node, stepNo)
      await bridge.clickAt(t.x, t.y, 'left')
      await sleep(120)
      log('info', `Alan seçildi: ${t.label}`)
      send('agent:anchor', { id: node.id, x: Math.round(t.x), y: Math.round(t.y) })
    }
    await bridge.typeText(node.text ?? '', !!node.pressEnter, node.clearFirst !== false)
  },
  key: async (node) => {
    if (!node.keys) throw new Error(`“${node.title}”: gönderilecek tuş boş.`)
    await bridge.sendKeys(node.keys, getSettings().targetWindow || undefined)
  },
  exists: async (text) => {
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

  ipcMain.handle('screen:scan', async (_e, windowTitle?: string) => {
    const hidden = await hideSelf()
    try {
      return await bridge.scan({ windowTitle: windowTitle || undefined, image: 'plain', maxImageW: 1600 })
    } finally {
      if (hidden) showSelf()
    }
  })

  ipcMain.handle('record:start', () => {
    recorder?.stop()
    recorder = bridge.startRecorder(
      (loc) => send('record:event', loc),
      (msg) => log('error', `Kaydedici: ${msg}`)
    )
    return process.platform === 'win32'
  })
  ipcMain.handle('record:stop', () => {
    recorder?.stop()
    recorder = null
    return true
  })
  ipcMain.handle('record:captureAfter', async (_e, ms: number) => {
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
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  recorder?.stop()
  bridge.shutdown()
  app.quit()
})
