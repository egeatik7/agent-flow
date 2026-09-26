import {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  screen,
} from 'electron'
import path from 'path'
import ElectronStore from 'electron-store'
import { runOpenRouterAgentStep } from './openrouter'
import {
  captureAccessibilityTree,
  clickElementByPath,
  getElementAtPoint,
  listWindows,
  type A11yNode,
} from './a11y-bridge'

export type AppSettings = {
  apiKey: string
  model: string
  targetWindow: string
  maxTreeDepth: number
  stepDelayMs: number
}

export type AgentNode = {
  id: string
  title: string
  prompt: string
  x: number
  y: number
  recorded?: {
    name: string
    controlType: string
    automationId?: string
    path: string
  }
}

export type AgentGraph = {
  nodes: AgentNode[]
  edges: { id: string; from: string; to: string }[]
}

// electron-store CJS/ESM interop
const StoreCtor =
  (ElectronStore as unknown as { default?: typeof ElectronStore }).default ??
  ElectronStore

const store = new StoreCtor<{
  settings: AppSettings
  graph: AgentGraph
}>({
  name: 'xp-agent-studio',
  defaults: {
    settings: {
      apiKey: '',
      model: 'openai/gpt-4o-mini',
      targetWindow: '',
      maxTreeDepth: 8,
      stepDelayMs: 800,
    },
    graph: { nodes: [], edges: [] },
  },
})

let mainWindow: BrowserWindow | null = null
let recording = false
let lastClickAt = 0

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  mainWindow = new BrowserWindow({
    width: Math.min(1180, width),
    height: Math.min(780, height),
    minWidth: 960,
    minHeight: 640,
    frame: false,
    backgroundColor: '#3a6ea5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    title: 'XP Agent Studio',
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function sendToRenderer(channel: string, payload: unknown) {
  mainWindow?.webContents.send(channel, payload)
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function onGlobalClickRecord() {
  if (!recording) return
  const now = Date.now()
  if (now - lastClickAt < 250) return
  lastClickAt = now

  try {
    const el = await getElementAtPoint()
    if (!el) return
    sendToRenderer('record:event', {
      kind: 'click',
      at: now,
      element: el,
      suggestedPrompt: buildPromptFromElement(el),
    })
  } catch (err) {
    sendToRenderer('agent:log', {
      level: 'error',
      message: `Kayıt hatası: ${String(err)}`,
    })
  }
}

function buildPromptFromElement(el: A11yNode): string {
  const parts = [
    el.controlType ? `${el.controlType} öğesine` : 'öğeye',
    el.name ? `"${el.name}"` : el.automationId ? `id=${el.automationId}` : 'isimsiz',
    'bas',
  ]
  return parts.join(' ')
}

function topologicalOrder(graph: AgentGraph): AgentNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const indeg = new Map(graph.nodes.map((n) => [n.id, 0]))
  const outs = new Map<string, string[]>()
  for (const e of graph.edges) {
    indeg.set(e.to, (indeg.get(e.to) || 0) + 1)
    if (!outs.has(e.from)) outs.set(e.from, [])
    outs.get(e.from)!.push(e.to)
  }
  const q = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id)
  const order: AgentNode[] = []
  while (q.length) {
    const id = q.shift()!
    const n = byId.get(id)
    if (n) order.push(n)
    for (const t of outs.get(id) || []) {
      indeg.set(t, (indeg.get(t) || 0) - 1)
      if (indeg.get(t) === 0) q.push(t)
    }
  }
  if (order.length < graph.nodes.length) {
    return [...graph.nodes]
  }
  return order
}

async function runGraph(graph: AgentGraph) {
  const settings = store.get('settings')
  if (!settings.apiKey) {
    throw new Error('OpenRouter API anahtarı kayıtlı değil. Ayarlar’dan kaydet.')
  }
  const steps = topologicalOrder(graph)
  sendToRenderer('agent:log', {
    level: 'info',
    message: `${steps.length} aşama çalıştırılacak…`,
  })

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    sendToRenderer('agent:step', { index: i, id: step.id, status: 'running' })
    sendToRenderer('agent:log', {
      level: 'info',
      message: `Aşama ${i + 1}: ${step.title || step.prompt.slice(0, 60)}`,
    })

    const tree = await captureAccessibilityTree({
      windowTitle: settings.targetWindow,
      maxDepth: settings.maxTreeDepth,
    })

    let targetPath = step.recorded?.path
    let targetName = step.recorded?.name

    if (!targetPath) {
      const decision = await runOpenRouterAgentStep({
        apiKey: settings.apiKey,
        model: settings.model,
        prompt: step.prompt,
        tree,
        stageTitle: step.title,
        stageIndex: i + 1,
      })
      targetPath = decision.path
      targetName = decision.name
      sendToRenderer('agent:log', {
        level: 'info',
        message: `LLM seçimi: ${decision.name} (${decision.controlType}) — ${decision.reason}`,
      })
    } else {
      sendToRenderer('agent:log', {
        level: 'info',
        message: `Kayıtlı öğe kullanılıyor: ${targetName || targetPath}`,
      })
    }

    if (!targetPath) {
      sendToRenderer('agent:step', { index: i, id: step.id, status: 'error' })
      throw new Error(`Aşama ${i + 1} için tıklanacak öğe bulunamadı.`)
    }

    await clickElementByPath(targetPath, settings.targetWindow)
    sendToRenderer('agent:step', { index: i, id: step.id, status: 'done' })
    await sleep(settings.stepDelayMs)
  }

  sendToRenderer('agent:log', { level: 'success', message: 'Tüm aşamalar tamamlandı.' })
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

  ipcMain.handle('settings:get', () => store.get('settings'))
  ipcMain.handle('settings:save', (_e, partial: Partial<AppSettings>) => {
    const next = { ...store.get('settings'), ...partial }
    store.set('settings', next)
    return next
  })

  ipcMain.handle('graph:get', () => store.get('graph'))
  ipcMain.handle('graph:save', (_e, graph: AgentGraph) => {
    store.set('graph', graph)
    return true
  })

  ipcMain.handle('windows:list', async () => listWindows())
  ipcMain.handle('a11y:tree', async (_e, opts?: { windowTitle?: string }) => {
    const settings = store.get('settings')
    return captureAccessibilityTree({
      windowTitle: opts?.windowTitle ?? settings.targetWindow,
      maxDepth: settings.maxTreeDepth,
    })
  })

  ipcMain.handle('record:start', () => {
    recording = true
    try {
      globalShortcut.register('CommandOrControl+Shift+R', () => {
        /* reserved */
      })
    } catch {
      /* ignore */
    }
    sendToRenderer('agent:log', {
      level: 'info',
      message:
        'Kayıt açık. Hedef uygulamada Ctrl+Shift+Click ile öğe yakala (veya kayıt tuşunu kullan).',
    })
    return true
  })

  ipcMain.handle('record:stop', () => {
    recording = false
    return true
  })

  ipcMain.handle('record:captureNow', async () => {
    const el = await getElementAtPoint()
    if (!el) return null
    return {
      kind: 'click',
      at: Date.now(),
      element: el,
      suggestedPrompt: buildPromptFromElement(el),
    }
  })

  ipcMain.handle('agent:run', async (_e, graph: AgentGraph) => {
    store.set('graph', graph)
    await runGraph(graph)
    return true
  })

  ipcMain.handle('agent:testOpenRouter', async () => {
    const settings = store.get('settings')
    if (!settings.apiKey) throw new Error('API anahtarı yok')
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${settings.apiKey}` },
    })
    if (!res.ok) throw new Error(`OpenRouter hata: ${res.status}`)
    return { ok: true }
  })

  // Simulate click capture via IPC from renderer "yakala" button
  ipcMain.on('record:simulateClick', () => {
    void onGlobalClickRecord()
  })
})

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
