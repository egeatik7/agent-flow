import { app, BrowserWindow, ipcMain, screen } from 'electron'
import path from 'path'
import ElectronStore from 'electron-store'
import * as bridge from './a11y-bridge'
import { chooseElement, listModels, testKey } from './openrouter'
import { runGraph, StoppedError, type Executor } from './runner'
import {
  normalizeGraph,
  type AgentGraph,
  type AgentNode,
  type AppSettings,
  type Locator,
  type LogLevel,
} from './graph-types'

const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  model: 'openai/gpt-4o-mini',
  targetWindow: '',
  maxTreeDepth: 12,
  stepDelayMs: 800,
  maxSteps: 500,
}

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

function targetWindowFor(node?: AgentNode): string {
  const w = getSettings().targetWindow || node?.locator?.windowTitle || ''
  if (!w) throw new Error('Hedef pencere seçilmedi. Ayarlar > Hedef pencere kısmından seç ve Kaydet.')
  return w
}

async function locateWithLlm(node: AgentNode, stepNo: number, windowTitle: string): Promise<Locator> {
  const s = getSettings()
  if (!s.apiKey) throw new Error('OpenRouter API anahtarı kayıtlı değil. Ayarlar’dan girip Kaydet’e bas.')
  if (!node.prompt?.trim()) {
    throw new Error(`“${node.title}”: prompt boş ve kayıtlı öğe yok. Prompt yaz veya öğe yakala.`)
  }
  const tree = await bridge.captureTree(windowTitle, s.maxTreeDepth)
  const d = await chooseElement({
    apiKey: s.apiKey,
    model: s.model,
    prompt: node.prompt,
    tree,
    kind: node.kind,
    stageTitle: node.title,
    stageIndex: stepNo,
    windowTitle,
  })
  log('info', `LLM seçti: ${d.controlType} “${d.name}”${d.reason ? ` (${d.reason})` : ''}`)
  return { name: d.name, controlType: d.controlType, automationId: d.automationId, path: d.path, windowTitle }
}

async function resolveTarget(
  node: AgentNode,
  stepNo: number,
  act: (loc: Locator, windowTitle: string) => Promise<void>
) {
  const windowTitle = targetWindowFor(node)
  if (node.locator) {
    try {
      await act(node.locator, windowTitle)
      return
    } catch (e) {
      if (!node.prompt?.trim()) throw e
      log('warn', `Kayıtlı öğe kullanılamadı (${(e as Error).message}); LLM ile aranıyor…`)
    }
  }
  const loc = await locateWithLlm(node, stepNo, windowTitle)
  await act(loc, windowTitle)
}

const executor: Executor = {
  log,
  step: (id, status) => send('agent:step', { id, status }),
  shouldStop: () => stopRequested,
  click: (node, stepNo) =>
    resolveTarget(node, stepNo, async (loc, w) => {
      await bridge.clickLocator(loc, w)
    }),
  type: (node, stepNo) =>
    resolveTarget(node, stepNo, (loc, w) => bridge.typeInto(loc, w, node.text ?? '', !!node.pressEnter)),
  key: async (node) => {
    if (!node.keys) throw new Error(`“${node.title}”: gönderilecek tuş boş.`)
    await bridge.sendKeys(node.keys, targetWindowFor(node))
  },
  exists: (text, node) => bridge.elementExists(text, targetWindowFor(node)),
}

app.whenReady().then(() => {
  createWindow()

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
  ipcMain.handle('a11y:tree', (_e, windowTitle?: string) => {
    const s = getSettings()
    const w = windowTitle || s.targetWindow
    if (!w) throw new Error('Önce hedef pencere seç.')
    return bridge.captureTree(w, s.maxTreeDepth)
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
    await new Promise((r) => setTimeout(r, Math.max(0, ms)))
    return bridge.captureAtCursor()
  })

  ipcMain.handle('agent:run', async (_e, graph: AgentGraph, startId?: string) => {
    if (running) throw new Error('Ajan zaten çalışıyor.')
    running = true
    stopRequested = false
    store.set('graph', graph)
    const s = getSettings()
    try {
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
      running = false
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

app.on('window-all-closed', () => {
  recorder?.stop()
  app.quit()
})