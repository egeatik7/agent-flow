import { app, BrowserWindow, dialog, globalShortcut, ipcMain, powerSaveBlocker, screen, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import ElectronStore from 'electron-store'
import * as bridge from './a11y-bridge'
import { createAgent } from './agent'
import { windowEventAllowed } from './run-events'
import { isTestProfile, storeCwd } from './profile'
import { withFastFind } from './tools'
import { callTool, toolList, type ToolSource } from './tools'
import { endpointInfo, startEndpoint, stopEndpoint } from './tool-http'
import {
  beginRun,
  completeFailure,
  endRun,
  noteError,
  noteFailureShot,
  noteLogLine,
  noteRunFailed,
  noteStep,
  probing,
  setDebugRun,
  setErrorStopHook,
} from './tool-state'
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
import { branchesOf, toolLayerSave, windowSave } from './tool-branch'
import { listDirEntries } from './list-dir'
import { normalizeFind, normalizePrompts } from './llm-flow'

const STOP_HOTKEY = 'CommandOrControl+Shift+Q'
/** How long an approval question waits before the caller is told "no". */
const APPROVAL_TIMEOUT_MS = 120_000

const StoreCtor = (ElectronStore as unknown as { default?: typeof ElectronStore }).default ?? ElectronStore

const store = new StoreCtor<{ settings: AppSettings; graph: AgentGraph; canvases?: CanvasBook }>({
  name: 'xp-agent-studio',
  defaults: { settings: DEFAULT_SETTINGS, graph: { nodes: [], edges: [] } },
  // The real profile keeps the file exactly where it has always lived. A test profile
  // (NUBBO_PROFILE) gets its own, so developing with Nubbo cannot reach the real flows.
  ...(storeCwd(process.env.NUBBO_PROFILE, app.getPath('userData')) ? { cwd: app.getPath('userData') } : {}),
})

let mainWindow: BrowserWindow | null = null
let hudWindow: BrowserWindow | null = null
let reportBoot: (pct: number, line: string) => void = () => {}
let closeBoot: () => void = () => {}
let appRevealed = false
let hudHideTimer: ReturnType<typeof setTimeout> | null = null
let running = false
let stopRequested = false
/** "Bu oturumda hep izin ver" from the approval dialog; the app restart clears it. */
let sessionApproved = false

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

/** How long the window has to apply a merge and confirm it was saved. */
const MERGE_TIMEOUT_MS = 10_000

/** True while a branch is being tested: that run is not the flow on screen. */
let derivedRun = false
/** True while a run asked to keep to the screen stages only: no model calls during it. */
let fastRun = false

function send(channel: string, payload: unknown) {
  if (channel === 'agent:step') {
    // The tool layer watches the same step events the canvas does, so `run.state` never guesses.
    noteStep(payload)
  }
  // A branch test must change only its own copy: see electron/run-events.ts for why both steps
  // and patches are held back while the run is derived.
  if (!windowEventAllowed(channel, derivedRun)) return
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

/**
 * Screenshots the worker writes into the temp folder are deleted on the normal path. A run
 * that was killed leaves them behind, and nothing will ever read them again. An hour is
 * long enough that a live run cannot own them.
 */
function sweepStaleTempShots() {
  const dir = app.getPath('temp')
  let names: string[] = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return
  }
  const cutoff = Date.now() - 60 * 60 * 1000
  for (const name of names) {
    if (!/^xpas-(ocr|onnx|preview)-/i.test(name)) continue
    const file = path.join(dir, name)
    try {
      if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true })
    } catch {
      /* another instance may own it now */
    }
  }
}

let voiceHoldUntil = 0

function log(level: LogLevel, message: string, forceHud = false) {
  if (level === 'error') {
    noteError(message)
    // The real message of a failure usually arrives after the step event that opened the record.
    completeFailure(message)
  }
  // Kept in memory too: a report of a broken run can quote the engine's own lines without the
  // caller having to find and read a log file.
  noteLogLine(level, message)
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
  // A fast run keeps to the screen stages: same engine, same checks, no model call in the ladder.
  settings: () => (fastRun ? withFastFind(getSettings()) : getSettings()),
  shouldStop: () => stopRequested,
  setLoop: (text) => pushLoop(text),
  setMethod: (text) => pushMethod(text),
  // The screenshot writer hands its path over as data; nothing has to be read out of a log line.
  noteFailureShot: (file: string) => noteFailureShot(file),
})

// A debug run stops itself at the first failed step: the stop is checked between steps, so the
// failure's own screen, item and error are still the truth when the run ends.
setErrorStopHook(() => {
  stopRequested = true
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
    title: isTestProfile(process.env.NUBBO_PROFILE) ? 'TEST · Nubbo Agent Studio (ayrı profil)' : 'Nubbo Agent Studio',
  })

  mainWindow.webContents.on('did-finish-load', () => {
    reportBoot(94, 'Tuval yükleniyor…')
  })

  reportBoot(88, 'Arayüz yükleniyor…')
  if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  else mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  // The page writes its own title while loading, so the window's title is set once it has: a test
  // instance has to be unmistakable in the taskbar too, not only inside its own title bar.
  mainWindow.webContents.once('did-finish-load', () => {
    if (mainWindow && !mainWindow.isDestroyed() && isTestProfile(process.env.NUBBO_PROFILE)) {
      mainWindow.setTitle(`TEST · Nubbo Agent Studio — ${String(process.env.NUBBO_PROFILE)} profili`)
    }
  })

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

function hudNativeHandle(): string {
  if (!hudWindow || hudWindow.isDestroyed() || !hudWindow.isVisible()) return ''
  try {
    const buf = hudWindow.getNativeWindowHandle()
    if (buf.length >= 8) {
      const value = buf.readBigUInt64LE(0)
      return value === 0n ? '' : value.toString()
    }
    if (buf.length >= 4) {
      const value = buf.readUInt32LE(0)
      return value ? String(value) : ''
    }
  } catch {
    /* window is already gone */
  }
  return ''
}

bridge.setHudHandle(hudNativeHandle)

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

function revealApp() {
  if (appRevealed) return
  appRevealed = true
  reportBoot(100, 'Hazır')
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      closeBoot()
      return
    }
    mainWindow.maximize()
    mainWindow.show()
    closeBoot()
    mainWindow.focus()
  }, 280)
}

/** Called from boot.ts once the splash window is already on screen. */
/**
 * Run a flow, from the start or from a node.
 *
 * The Ajanı Çalıştır and Seçiliden Çalıştır buttons and the tool layer both go through here,
 * so a run an agent starts behaves exactly like a run started by hand: same target finding,
 * same stop, same resource cleanup.
 */
async function runFlow(
  raw: AgentGraph,
  startId?: string,
  packagePath?: string[],
  opts?: { derived?: boolean; debug?: boolean; fast?: boolean }
): Promise<{ ok: boolean; failed?: number; steps?: number; stopped?: boolean; runId?: string }> {
  if (running) throw new Error('Ajan zaten çalışıyor.')
  // A single step is driving the desktop; a run must not start on top of it.
  if (probing()) throw new Error('Tek adım sürüyor; koşu için bitmesini bekle.')
  running = true
  stopRequested = false
  derivedRun = !!opts?.derived
  fastRun = !!opts?.fast
  // Debug: the run stops itself at the first failed step, keeping that moment's context.
  setDebugRun(!!opts?.debug)
  let awake: number | undefined
  let hidden = false
  let outcome: { ok: boolean; failed?: number; steps?: number; stopped?: boolean; error?: string } | undefined
  let runId = ''
  try {
    const graph = normalizeGraph(raw)
    // A test of an agent branch is not the saved flow: it runs, but it is not written down as
    // the active flow, so a branch test can never overwrite what the user has open.
    if (!opts?.derived) store.set('graph', graph)
    // The tool layer keeps this graph so `run.state` can say which box and item the run is on.
    runId = beginRun(graph, startId)
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
    awake = powerSaveBlocker.start('prevent-display-sleep')
    if (runLog) log('info', `Günlük dosyası: ${runLog}`)
    if (isTestProfile(process.env.NUBBO_PROFILE)) {
      // Say it before anything else: this window is not the person's own, and its flows, key and
      // models are its own empty ones. Being unable to tell them apart looked like lost data.
      log('warn', `TEST profili çalışıyor (${process.env.NUBBO_PROFILE}): kendi boş profili, kendi akışları. Gerçek profilin verileri ayrı ve dokunulmadı.`)
    }
    if (s.hideWhileRunning) {
      log('info', 'Uygulama küçültülüyor; durdurmak için Ctrl+Shift+Q.')
      hidden = await hideSelf()
      revealHud()
    }
    const summary = await runGraph(graph, agent.executor, {
      maxSteps: Math.max(1, s.maxSteps),
      stepDelayMs: Math.max(0, s.stepDelayMs),
      startId,
      resume: !!startId,
      packagePath: Array.isArray(packagePath) && packagePath.length ? packagePath : undefined,
    })
    // A run that went through every step but had loop items end on an error is not a success.
    outcome = { ok: summary.failed === 0, failed: summary.failed, steps: summary.steps }
    return { ...outcome, runId }
  } catch (e) {
    if (e instanceof StoppedError) {
      log('warn', 'Ajan durduruldu.')
      outcome = { ok: false, stopped: true }
      return { ...outcome, runId }
    }
    // A failure of the run itself, with no failed step to hang it on: a broken output, a thrown
    // error. A debug run keeps it too, and a user's Stop never reaches this branch.
    noteRunFailed((e as Error).message)
    log('error', (e as Error).message)
    outcome = { ok: false, error: (e as Error).message }
    throw e
  } finally {
    // Reset the run state even when preparation failed before a resource
    // was created, or a later OS cleanup call throws. The outcome is kept so a caller can
    // still ask how the run ended after it is over.
    endRun(outcome)
    running = false
    derivedRun = false
    fastRun = false
    runLog = ''
    globalShortcut.unregister(STOP_HOTKEY)
    if (awake !== undefined && powerSaveBlocker.isStarted(awake)) powerSaveBlocker.stop(awake)
    hideHudSoon()
    if (hidden) showSelf()
  }
}

export async function startApp(report: (pct: number, line: string) => void, closeSplash: () => void) {
  reportBoot = report
  closeBoot = closeSplash
  const failsafe = setTimeout(revealApp, 20000)
  ipcMain.on('boot:ready', () => {
    clearTimeout(failsafe)
    revealApp()
  })

  report(58, 'Kayıtlar okunuyor…')
  getSettings()
  try {
    ensureLogsDir()
  } catch {
    /* the run path creates it again before writing a log or an error shot */
  }
  sweepStaleTempShots()
  report(68, 'Erişilebilirlik köprüsü…')
  await Promise.race([bridge.warmUp(), sleep(8000)])

  report(78, 'Pencere kuruluyor…')
  createWindow()
  createHud()
  screen.on('display-metrics-changed', placeHud)

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
    void syncEndpoint()
    return next
  })

  ipcMain.handle('graph:get', () => normalizeGraph(store.get('graph')))
  ipcMain.handle('graph:save', (_e, graph: AgentGraph) => {
    store.set('graph', graph)
    return true
  })

  // The tool layer an outside agent drives. The Ajan tab calls these same tools, so limits,
  // permissions and logging live in one place (electron/tools.ts) instead of per caller.
  const toolContext = {
    getGraph: () => normalizeGraph(store.get('graph')),
    getSettings,
    log,
    isRunning: () => running,
    userStop: () => stopRequested,
    sendStep: (payload: unknown) => send('agent:step', payload),
    permission: () => getSettings().agentPermission,
    askApproval: async (summary: string, note: string) => {
      if (!mainWindow) return false
      if (sessionApproved) return true
      // A question nobody can see is worse than no question: if the window was minimised (its own
      // hide-while-running, or the user), bring it back so the dialog is really in front.
      if (mainWindow.isMinimized()) mainWindow.restore()
      const answer = await Promise.race([
        dialog.showMessageBox(mainWindow, {
          type: 'question',
          buttons: ['İzin ver', 'Bu oturumda hep izin ver', 'Reddet'],
          defaultId: 2,
          cancelId: 2,
          noLink: true,
          title: 'Ajan izni',
          message: 'Bir ajan Nubbo’yu kullanmak istiyor',
          detail: `${summary}\n\n${note}\n\nUygulama kapanınca bu izin sıfırlanır.`,
        }),
        // Waiting forever would hang the caller with no explanation, so the answer expires.
        new Promise<{ response: number }>((resolve) => setTimeout(() => resolve({ response: -1 }), APPROVAL_TIMEOUT_MS)),
      ])
      if (answer.response === 1) {
        sessionApproved = true
        return true
      }
      if (answer.response === -1) {
        log('warn', `Ajan izni ${Math.round(APPROVAL_TIMEOUT_MS / 60000)} dakikada yanıtlanmadı; çağrı reddedildi sayıldı.`)
        return false
      }
      return answer.response === 0
    },
    requestStop: () => {
      stopRequested = true
    },
    clearStop: () => {
      stopRequested = false
    },
    startRun: (graph: AgentGraph, startId?: string, packagePath?: string[], opts?: { derived?: boolean; debug?: boolean }) =>
      runFlow(graph, startId, packagePath, opts),
    getCanvases: () => loadCanvases(),
    // Branch records are the only thing the tool layer writes here. The active flow is left
    // exactly as it was, which is why an agent can never reach the user's canvas this way.
    saveCanvases: (book: CanvasBook) => {
      store.set('canvases', toolLayerSave(loadCanvases(), book.branches ?? []))
    },
    applyMerge: (
      payload: { tabId: string; graph: AgentGraph; branchId: string; branchName: string; reason?: 'merge' | 'undo' },
      opts?: { snapshot?: boolean }
    ) => applyMergeInWindow(payload, opts),
    takeMergeUndo: undefined,
    // Reading the undo does not consume it: a window that never answers must leave the right to
    // try again, and must not have the recipe put back while the merge is still in the flow.
    peekMergeUndo: () => (lastMerge ? { tabId: lastMerge.tabId, graph: lastMerge.graph } : null),
    commitMergeUndo: () => {
      const snap = lastMerge
      lastMerge = null
      if (!snap) return false
      // The recipe was dropped when it was merged; put it back with the flow it was based on.
      if (snap.branch) {
        const book = loadCanvases()
        store.set('canvases', toolLayerSave(book, [...branchesOf(book), snap.branch]))
      }
      return true
    },
  }
  ipcMain.handle('tools:call', (_e, name: string, args?: unknown, source?: ToolSource) =>
    callTool(name, args, toolContext, source === 'agent' ? 'agent' : 'panel')
  )
  ipcMain.handle('tools:list', () => toolList())

  // The local door an outside agent uses. It exists only while the Ajan tab asks for it, and
  // every call it carries goes through the same gate as the panel (source 'agent'), so the
  // permission setting, the limits and the logging are the ones already written down.
  const endpointFile = path.join(app.getPath('userData'), 'tool-endpoint.json')
  async function syncEndpoint() {
    const want = getSettings().agentEndpoint
    const live = endpointInfo()
    if (want && !live) {
      try {
        const started = await startEndpoint(toolContext, endpointFile, {
          app: app.getVersion(),
          profile: String(process.env.NUBBO_PROFILE ?? ''),
          build: String(process.env.NUBBO_BUILD ?? ''),
        })
        log('info', `Ajan uç noktası açık: http://127.0.0.1:${started.port} · jeton dosyası: ${started.file}`)
      } catch (e) {
        log('error', `Ajan uç noktası açılamadı: ${(e as Error).message}`)
      }
    } else if (!want && live) {
      await stopEndpoint()
      log('info', 'Ajan uç noktası kapatıldı.')
    }
  }
  // Asking for the endpoint also makes sure it is really there: the setting can be on while the
  // door is shut (an older instance's token file, a failed start), and then the panel would say
  // "Açılıyor…" forever. Opening the Ajan tab is enough to put it right.
  ipcMain.handle('tools:endpoint', async () => {
    await syncEndpoint()
    return endpointInfo()
  })
  ipcMain.handle('tools:endpointOpen', () => {
    const info = endpointInfo()
    if (info) shell.showItemInFolder(info.file)
    return info ? info.file : null
  })
  void syncEndpoint()
  /** The canvas book as the app stores it, with a single canvas when nothing was saved yet. */
  function loadCanvases(): CanvasBook {
    const saved = store.get('canvases') as CanvasBook | undefined
    if (saved?.tabs?.length) return normalizeCanvasBook(saved)
    return normalizeCanvasBook(undefined, normalizeGraph(store.get('graph')))
  }

  // A merge is handed to the window, because the window owns the canvas book and saves it on
  // every change: writing it from here could be undone by a save the window already had queued.
  // Without an answer from the window, nothing is written anywhere.
  let mergePending: {
    requestId: string
    resolve: (a: { ok: boolean; error?: string }) => void
    timer: ReturnType<typeof setTimeout>
  } | null = null

  // The flow as it was just before the last merge, so a merge can be taken back once. Kept in
  // memory on purpose: it is a safety net for a wrong click, not a version history.
  let lastMerge: { tabId: string; graph: AgentGraph; branch: unknown; at: number } | null = null

  ipcMain.handle('canvas:mergeAnswer', (_e, answer: unknown) => {
    const pending = mergePending
    if (!pending) return false
    const a = answer as { ok?: unknown; error?: unknown; requestId?: unknown } | null
    // A late answer from an earlier question must never pass for the one being asked now.
    if (typeof a?.requestId !== 'string' || a.requestId !== pending.requestId) {
      log('warn', 'Ajan · merge · eşleşmeyen pencere cevabı yok sayıldı.')
      return false
    }
    mergePending = null
    clearTimeout(pending.timer)
    pending.resolve({ ok: a?.ok === true, error: typeof a?.error === 'string' ? a.error : undefined })
    return true
  })

  function applyMergeInWindow(
    payload: { tabId: string; graph: AgentGraph; branchId: string; branchName: string; reason?: 'merge' | 'undo' },
    opts?: { snapshot?: boolean }
  ): Promise<{ ok: boolean; error?: string }> {
    if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve({ ok: false, error: 'pencere yok' })
    if (mergePending) return Promise.resolve({ ok: false, error: 'başka bir merge sürüyor' })
    if (opts?.snapshot !== false) {
      const cur = loadCanvases()
      const tab = cur.tabs.find((t) => t.id === payload.tabId)
      const branch = (cur.branches ?? []).find((b) => (b as { id?: string }).id === payload.branchId) ?? null
      lastMerge = tab ? { tabId: payload.tabId, graph: structuredClone(tab.graph), branch, at: Date.now() } : null
    }
    // Every question carries its own id and its own deadline: the answer must match, and a window
    // that was busy for longer than the deadline applies nothing rather than applying it late.
    const requestId = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const expiresAt = Date.now() + MERGE_TIMEOUT_MS
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (mergePending && mergePending.resolve === resolve) {
          mergePending = null
          // Nothing confirmed: say so honestly instead of claiming the flow is untouched. The
          // caller keeps the recipe and the undo right, so this is recoverable either way.
          resolve({
            ok: false,
            error: `pencere ${Math.round(MERGE_TIMEOUT_MS / 1000)} sn içinde yanıt vermedi (uygulanmış olabilir); tarif ve geri alma hakkı korundu`,
          })
        }
      }, MERGE_TIMEOUT_MS)
      mergePending = { requestId, resolve, timer }
      log('info', `Ajan · merge · pencereye soruldu: “${payload.branchName}” (${requestId}).`)
      mainWindow?.webContents.send('canvas:merge', { ...payload, requestId, expiresAt })
    })
  }

  ipcMain.handle('canvases:get', () => loadCanvases())
  ipcMain.handle('canvases:save', (_e, book: CanvasBook) => {
    // The window writes the flows; the branch records belong to the tool layer, so they are
    // taken from what the tool layer last wrote instead of from the window's own copy.
    const next = windowSave(normalizeCanvasBook(book), loadCanvases())
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
    const files = listDirEntries(dir)
    if (!files) {
      // An unreadable folder is not an empty one: say so instead of handing back an empty
      // list that makes the box look like it has nothing to do.
      log('warn', `“${dir}” okunamadı; liste boş bırakıldı.`)
      return { folder: dir, files: [] }
    }
    return { folder: dir, files }
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

  ipcMain.handle('agent:run', (_e, raw: AgentGraph, startId?: string, packagePath?: string[], opts?: { derived?: boolean }) =>
    runFlow(raw, startId, packagePath, opts)
  )
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
}

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
