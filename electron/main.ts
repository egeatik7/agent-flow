import { app, BrowserWindow, dialog, globalShortcut, ipcMain, powerSaveBlocker, screen, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import ElectronStore from 'electron-store'
import * as bridge from './a11y-bridge'
import { createAgent } from './agent'
import { listModels, setChatLogger, setStopCheck, testKey, visionDescribe } from './openrouter'
import { runGraph, StoppedError } from './runner'
import { DEFAULT_SETTINGS, normalizeGraph, type AgentGraph, type AppSettings, type LogLevel } from './graph-types'
import { listDirEntries } from './list-dir'

const STOP_HOTKEY = 'CommandOrControl+Shift+Q'

// Keep the existing profile folder. The visible name can change without moving saved flows or the API key.
app.setPath('userData', path.join(app.getPath('appData'), 'xp-agent-studio'))

const StoreCtor = (ElectronStore as unknown as { default?: typeof ElectronStore }).default ?? ElectronStore

const store = new StoreCtor<{ settings: AppSettings; graph: AgentGraph }>({
  name: 'xp-agent-studio',
  defaults: { settings: DEFAULT_SETTINGS, graph: { nodes: [], edges: [] } },
})

let mainWindow: BrowserWindow | null = null
let running = false
let stopRequested = false

function getSettings(): AppSettings {
  const s = { ...DEFAULT_SETTINGS, ...store.get('settings') }
  if (s.maxSteps === 500) s.maxSteps = DEFAULT_SETTINGS.maxSteps
  return s
}

function send(channel: string, payload: unknown) {
  mainWindow?.webContents.send(channel, payload)
}

let runLog = ''

function logsDir() {
  return path.join(app.getPath('userData'), 'logs')
}

/** One text file per run under %APPDATA%/xp-agent-studio/logs; only the last 30 runs are kept. */
function openRunLog() {
  const dir = logsDir()
  fs.mkdirSync(dir, { recursive: true })
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

function log(level: LogLevel, message: string) {
  send('agent:log', { level, message })
  if (!runLog) return
  try {
    fs.appendFileSync(runLog, `[${new Date().toLocaleTimeString('tr-TR')}] ${level.toUpperCase().padEnd(7)} ${message}\n`)
  } catch {
    /* disk full or locked; the on-screen log still has it */
  }
}

setChatLogger((line) => log('chat', line))
setStopCheck(() => running && stopRequested)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const agent = createAgent({ log, send, settings: getSettings, shouldStop: () => stopRequested })

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  mainWindow = new BrowserWindow({
    width: Math.min(1320, width),
    height: Math.min(860, height),
    minWidth: 980,
    minHeight: 640,
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

  ipcMain.handle('screen:scan', async (_e, windowTitle?: string) => {
    const hidden = await hideSelf()
    try {
      return await bridge.scan({ windowTitle: windowTitle || undefined, image: 'plain', maxImageW: 1600 })
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

  ipcMain.handle('agent:run', async (_e, raw: AgentGraph, startId?: string) => {
    if (running) throw new Error('Ajan zaten çalışıyor.')
    running = true
    stopRequested = false
    const graph = normalizeGraph(raw)
    store.set('graph', graph)
    const s = getSettings()
    try {
      openRunLog()
    } catch {
      runLog = ''
    }
    agent.beginRun(
      graph.nodes.filter((n) => n.kind === 'waitFile').map((n) => n.folder?.trim() ?? ''),
      runLog ? logsDir() : ''
    )
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
      }
      await runGraph(graph, agent.executor, {
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
      log('error', (e as Error).message)
      throw e
    } finally {
      globalShortcut.unregister(STOP_HOTKEY)
      if (powerSaveBlocker.isStarted(awake)) powerSaveBlocker.stop(awake)
      running = false
      runLog = ''
      if (hidden) showSelf()
    }
  })
  ipcMain.handle('logs:open', async () => {
    fs.mkdirSync(logsDir(), { recursive: true })
    await shell.openPath(logsDir())
    return logsDir()
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
    const model = (s.visionModel || s.model).trim()
    const hidden = await hideSelf()
    let shot: Awaited<ReturnType<typeof bridge.scan>>
    try {
      shot = await bridge.scan({ image: 'plain', uia: false, ocr: false, maxImageW: 1200 })
    } finally {
      if (hidden) showSelf()
    }
    if (!shot.image) throw new Error('Ekran görüntüsü alınamadı.')
    return { model, text: await visionDescribe({ apiKey: s.apiKey, model, image: shot.image }) }
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  void agent.closeBrowser()
})

app.on('window-all-closed', () => {
  bridge.shutdown()
  app.quit()
})
