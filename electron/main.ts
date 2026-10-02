import { app, BrowserWindow, dialog, globalShortcut, ipcMain, powerSaveBlocker, screen, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import ElectronStore from 'electron-store'
import * as bridge from './a11y-bridge'
import { createAgent } from './agent'
import { listModels, setChatLogger, setStopCheck, setVoiceLogger, testKey, visionDescribe } from './openrouter'
import { runGraph, StoppedError } from './runner'
import {
  clampRamp,
  cleanBackups,
  DEFAULT_SETTINGS,
  modelChain,
  normalizeCanvasBook,
  normalizeGraph,
  type AgentGraph,
  type AppSettings,
  type CanvasBook,
  type LogLevel,
} from './graph-types'
import { listDirEntries } from './list-dir'
import { normalizeFind, normalizePrompts } from './llm-flow'

const STOP_HOTKEY = 'CommandOrControl+Shift+Q'

// Keep the existing profile folder. The visible name can change without moving saved flows or the API key.
app.setPath('userData', path.join(app.getPath('appData'), 'xp-agent-studio'))

const StoreCtor = (ElectronStore as unknown as { default?: typeof ElectronStore }).default ?? ElectronStore

const store = new StoreCtor<{ settings: AppSettings; graph: AgentGraph; canvases?: CanvasBook }>({
  name: 'xp-agent-studio',
  defaults: { settings: DEFAULT_SETTINGS, graph: { nodes: [], edges: [] } },
})

let mainWindow: BrowserWindow | null = null
let hudWindow: BrowserWindow | null = null
let hudHideTimer: ReturnType<typeof setTimeout> | null = null
let running = false
let stopRequested = false

function getSettings(): AppSettings {
  const s = { ...DEFAULT_SETTINGS, ...store.get('settings') }
  if (s.maxSteps === 500) s.maxSteps = DEFAULT_SETTINGS.maxSteps
  if (s.ocrEngine !== 'onnx') s.ocrEngine = 'windows'
  const ramp = clampRamp(s.valueLo, s.valueHi)
  s.valueLo = ramp.lo
  s.valueHi = ramp.hi
  bridge.setValueRamp(ramp.lo, ramp.hi)
  const find = normalizeFind(s.findOrder, s.findOff === undefined ? ['list'] : s.findOff)
  s.findOrder = find.order
  s.findOff = find.off
  s.llmPrompts = normalizePrompts(s.llmPrompts)
  s.modelBackups = cleanBackups(s.modelBackups)
  s.visionBackups = cleanBackups(s.visionBackups)
  s.agentBackups = cleanBackups(s.agentBackups)
  bridge.setOcrEngine(s.ocrEngine)
  return s
}

function send(channel: string, payload: unknown) {
  mainWindow?.webContents.send(channel, payload)
}

let runLog = ''

function logsRoot() {
  return path.join(app.getPath('userData'), 'logs')
}

function logsDir() {
  const raw = (app.getVersion() || '0').trim() || '0'
  const version = raw.replace(/[<>:"/\\|?*]/g, '_')
  return path.join(logsRoot(), version)
}

/** This version's log folder. Created as soon as the version runs, before a run or an error shot. */
function ensureLogsDir(): string {
  const dir = logsDir()
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** One text file per run under %APPDATA%/xp-agent-studio/logs/<version>; only the last 30 runs of that version are kept. */
function openRunLog() {
  const dir = ensureLogsDir()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  runLog = path.join(dir, `calistirma-${stamp}.txt`)
  const runs = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('calistirma-'))
    .sort()
  for (const old of runs.slice(0, Math.max(0, runs.length - 29))) fs.rmSync(path.join(dir, old), { force: true })
  const shots = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('hata-'))
    .sort()
  for (const old of shots.slice(0, Math.max(0, shots.length - 100))) fs.rmSync(path.join(dir, old), { force: true })
}

let voiceHoldUntil = 0

function log(level: LogLevel, message: string, forceHud = false) {
  send('agent:log', { level, message })
  const held = !forceHud && Date.now() < voiceHoldUntil && level !== 'error' && level !== 'warn'
  if (!held) pushHud(level, message)
  if (!runLog) return
  try {
    fs.appendFileSync(runLog, `[${new Date().toLocaleTimeString('tr-TR')}] ${level.toUpperCase().padEnd(7)} ${message}\n`)
  } catch {
    /* disk full or locked; the on-screen log still has it */
  }
}

setChatLogger((line) => log('chat', line))
setVoiceLogger((line) => {
  voiceHoldUntil = Date.now() + 1800
  log('info', line, true)
})
setStopCheck(() => running && stopRequested)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const agent = createAgent({
  log,
  send,
  settings: getSettings,
  shouldStop: () => stopRequested,
  setLoop: (text) => pushLoop(text),
  setMethod: (text) => pushMethod(text),
})

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 980,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: '#ece9d8',
    icon: path.join(__dirname, '../resources/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    title: 'Nubbo Agent Studio',
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.maximize()
    mainWindow?.show()
  })

  if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  else mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))

  mainWindow.on('close', () => {
    destroyHud()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function destroyHud() {
  const w = hudWindow
  if (!w || w.isDestroyed()) {
    hudWindow = null
    return
  }
  hudWindow = null
  w.removeAllListeners('closed')
  w.destroy()
}

const HUD_W = 456
const HUD_H = 164
const HUD_GAP = 4

function placeHud() {
  if (!hudWindow || hudWindow.isDestroyed()) return
  const area = screen.getPrimaryDisplay().workArea
  hudWindow.setBounds({
    x: Math.round(area.x + area.width - HUD_W - HUD_GAP),
    y: Math.round(area.y + area.height - HUD_H - HUD_GAP),
    width: HUD_W,
    height: HUD_H,
  })
}

function createHud() {
  hudWindow = new BrowserWindow({
    width: HUD_W,
    height: HUD_H,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    title: '',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  hudWindow.setAlwaysOnTop(true, 'floating')
  // Set once, before the first show. Applying it again after the window is
  // visible drops a transparent window off the Windows desktop.
  hudWindow.setContentProtection(true)
  hudWindow.setIgnoreMouseEvents(true)
  placeHud()
  const dev = process.env.VITE_DEV_SERVER_URL
  if (dev) void hudWindow.loadURL(`${dev}${dev.includes('?') ? '&' : '?'}hud=1`)
  else void hudWindow.loadFile(path.join(__dirname, '../dist/index.html'), { query: { hud: '1' } })
  hudWindow.on('closed', () => {
    if (hudWindow && !hudWindow.isDestroyed()) return
    hudWindow = null
  })
}

function raiseHud() {
  if (!hudWindow || hudWindow.isDestroyed()) return
  hudWindow.setAlwaysOnTop(true)
  hudWindow.moveTop()
}

function revealHud() {
  if (!hudWindow || hudWindow.isDestroyed()) return
  placeHud()
  hudWindow.showInactive()
  raiseHud()
  if (!hudWindow.isVisible()) hudWindow.show()
  raiseHud()
}

function deliverHud(channel: string, payload: unknown, show: boolean) {
  if (!hudWindow || hudWindow.isDestroyed()) return
  const deliver = () => {
    if (!hudWindow || hudWindow.isDestroyed()) return
    placeHud()
    hudWindow.webContents.send(channel, payload)
    if (show) revealHud()
  }
  if (hudWindow.webContents.isLoading()) hudWindow.webContents.once('did-finish-load', deliver)
  else deliver()
}

function pushLoop(text: string) {
  if (!running || !hudWindow || hudWindow.isDestroyed()) return
  deliverHud('hud:loop', { text }, false)
}

function pushMethod(text: string) {
  if (!running || !hudWindow || hudWindow.isDestroyed()) return
  deliverHud('hud:method', { text }, false)
}

function pushHud(level: LogLevel, message: string) {
  if (!running || level === 'chat' || !hudWindow || hudWindow.isDestroyed()) return
  const text = message.replace(/\s+/g, ' ').trim()
  if (!text) return
  if (hudHideTimer) {
    clearTimeout(hudHideTimer)
    hudHideTimer = null
  }
  const payload = { level, text: text.length > 220 ? `${text.slice(0, 217)}…` : text }
  deliverHud('hud:status', payload, true)
}

function hideHudSoon() {
  if (hudHideTimer) clearTimeout(hudHideTimer)
  hudHideTimer = setTimeout(() => {
    hudHideTimer = null
    if (hudWindow && !hudWindow.isDestroyed()) {
      hudWindow.hide()
      hudWindow.webContents.send('hud:loop', { text: '' })
      hudWindow.webContents.send('hud:method', { text: '' })
    }
  }, 2200)
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

app.whenReady().then(() => {
  createWindow()
  createHud()
  screen.on('display-metrics-changed', placeHud)
  getSettings()
  try {
    ensureLogsDir()
  } catch {
    /* the run path creates it again before writing a log or an error shot */
  }
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
    if (next.ocrEngine !== 'onnx') next.ocrEngine = 'windows'
    const ramp = clampRamp(next.valueLo, next.valueHi)
    next.valueLo = ramp.lo
    next.valueHi = ramp.hi
    bridge.setValueRamp(ramp.lo, ramp.hi)
    const find = normalizeFind(next.findOrder, next.findOff)
    next.findOrder = find.order
    next.findOff = find.off
    next.llmPrompts = normalizePrompts(next.llmPrompts)
    next.modelBackups = cleanBackups(next.modelBackups).filter((name) => name !== next.model.trim())
    next.visionBackups = cleanBackups(next.visionBackups).filter((name) => name !== next.visionModel.trim())
    next.agentBackups = cleanBackups(next.agentBackups).filter((name) => name !== next.agentModel.trim())
    store.set('settings', next)
    bridge.setOcrEngine(next.ocrEngine)
    return next
  })

  ipcMain.handle('graph:get', () => normalizeGraph(store.get('graph')))
  ipcMain.handle('graph:save', (_e, graph: AgentGraph) => {
    store.set('graph', graph)
    return true
  })
  ipcMain.handle('canvases:get', () => {
    const saved = store.get('canvases') as CanvasBook | undefined
    if (saved?.tabs?.length) return normalizeCanvasBook(saved)
    return normalizeCanvasBook(undefined, normalizeGraph(store.get('graph')))
  })
  ipcMain.handle('canvases:save', (_e, book: CanvasBook) => {
    const next = normalizeCanvasBook(book)
    store.set('canvases', next)
    const active = next.tabs.find((t) => t.id === next.activeId) ?? next.tabs[0]
    if (active) store.set('graph', active.graph)
    return true
  })

  ipcMain.handle('windows:list', () => bridge.listWindows())

  ipcMain.handle('dialog:listDir', (_e, dir: string) => listDirEntries(typeof dir === 'string' ? dir : ''))

  ipcMain.handle('dialog:pickFolder', async () => {
    if (!mainWindow) return null
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Klasör seç', properties: ['openDirectory'] })
    const dir = r.filePaths[0]
    if (r.canceled || !dir) return null
    return { folder: dir, files: listDirEntries(dir) ?? [] }
  })

  ipcMain.handle('dialog:pickDir', async () => {
    if (!mainWindow) return null
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Klasör seç', properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0] ?? null
  })

  ipcMain.handle('chrome:match', async (_e, rect: { x: number; y: number; w: number; h: number }) => {
    if (!rect || typeof rect.x !== 'number') return null
    const { matchUserChrome } = await import('./browser')
    return matchUserChrome(rect)
  })

  ipcMain.handle('screen:scan', async (_e, windowTitle?: string, ramp?: { lo?: number; hi?: number }) => {
    const hidden = await hideSelf()
    try {
      const s = getSettings()
      const saved = clampRamp(s.valueLo, s.valueHi)
      const next = clampRamp(ramp?.lo ?? saved.lo, ramp?.hi ?? saved.hi)
      bridge.setValueRamp(next.lo, next.hi)
      try {
        return await bridge.scan({ windowTitle: windowTitle || undefined, image: 'plain', maxImageW: 1600, tilt: true })
      } finally {
        bridge.setValueRamp(saved.lo, saved.hi)
      }
    } finally {
      if (hidden) showSelf()
    }
  })

  ipcMain.handle('screen:pick', async (_e, box: { x: number; y: number; w: number; h: number }) => {
    const hidden = await hideSelf()
    try {
      return await bridge.pickAt(box)
    } finally {
      if (hidden) showSelf()
    }
  })

  ipcMain.handle('capture:afterDelay', async (_e, ms: number) => {
    await sleep(Math.max(0, ms))
    return bridge.captureAtCursor()
  })

  ipcMain.handle('agent:run', async (_e, raw: AgentGraph, startId?: string, packagePath?: string[]) => {
    if (running) throw new Error('Ajan zaten çalışıyor.')
    running = true
    stopRequested = false
    const graph = normalizeGraph(raw)
    store.set('graph', graph)
    const s = getSettings()
    let shotDir = ''
    try {
      shotDir = ensureLogsDir()
      openRunLog()
    } catch {
      runLog = ''
    }
    agent.beginRun(shotDir)
    globalShortcut.register(STOP_HOTKEY, () => {
      stopRequested = true
    })
    const awake = powerSaveBlocker.start('prevent-display-sleep')
    if (runLog) log('info', `Günlük dosyası: ${runLog}`)
    let hidden = false
    try {
      if (s.hideWhileRunning) {
        log('info', 'Uygulama küçültülüyor; durdurmak için Ctrl+Shift+Q.')
        hidden = await hideSelf()
        revealHud()
      }
      await runGraph(graph, agent.executor, {
        maxSteps: Math.max(1, s.maxSteps),
        stepDelayMs: Math.max(0, s.stepDelayMs),
        startId,
        resume: !!startId,
        packagePath: Array.isArray(packagePath) && packagePath.length ? packagePath : undefined,
      })
      return { ok: true }
    } catch (e) {
      if (e instanceof StoppedError) {
        log('warn', 'Ajan durduruldu.')
        return { ok: false, stopped: true }
      }
      log('error', (e as Error).message)
      throw e
    } finally {
      globalShortcut.unregister(STOP_HOTKEY)
      if (powerSaveBlocker.isStarted(awake)) powerSaveBlocker.stop(awake)
      hideHudSoon()
      running = false
      runLog = ''
      if (hidden) showSelf()
    }
  })
  ipcMain.handle('logs:open', async () => {
    const dir = ensureLogsDir()
    await shell.openPath(dir)
    return dir
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
    const s = getSettings()
    if (!s.apiKey) throw new Error('Görsel mod için OpenRouter API anahtarı gerekli (Ayarlar > API Key > Kaydet).')
    const chain = modelChain(s.visionModel, s.visionBackups)
    const models = chain.length ? chain : modelChain(s.model, s.modelBackups)
    const hidden = await hideSelf()
    let shot: Awaited<ReturnType<typeof bridge.scan>>
    try {
      shot = await bridge.scan({ image: 'plain', uia: false, ocr: false, maxImageW: 1200 })
    } finally {
      if (hidden) showSelf()
    }
    if (!shot.image) throw new Error('Ekran görüntüsü alınamadı.')
    return { model: models[0] ?? '', text: await visionDescribe({ apiKey: s.apiKey, model: models, image: shot.image }) }
  })
})

app.on('before-quit', () => {
  destroyHud()
  bridge.shutdown()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  bridge.shutdown()
})

app.on('window-all-closed', () => {
  destroyHud()
  bridge.shutdown()
  app.quit()
})
