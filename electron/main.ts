import { app, BrowserWindow, dialog, globalShortcut, ipcMain, powerSaveBlocker, screen, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { WindowCloseGuard } from './window-close'
import ElectronStore from 'electron-store'
import * as bridge from './a11y-bridge'
import { createAgent } from './agent'
import { windowEventAllowed } from './run-events'
import { isTestProfile, storeCwd, testToolsEnabled } from './profile'
import { bayatCikarmaKlasorleri, geciciGirdileriTopla } from './temp-sweep'
import { withFastFind } from './tools'
import { callTool, toolList, type ToolSource, type ToolContext } from './tools'
import { recoverySettings } from './recovery-settings'
import { runRecovery, type RecoveryReport } from './recovery'
import { recoveryExecutor } from './recovery-runtime'
import { endpointInfo, startEndpoint, stopEndpoint } from './tool-http'
import {
  beginRun,
  completeFailure,
  endRun,
  noteError,
  noteFailureShot,
  noteLogLine,
  noteReview,
  noteRunFailed,
  noteStep,
  noteUserStop,
  probing,
  recentLogLines,
  setDebugRun,
  setErrorStopHook,
  setStopAtHook,
} from './tool-state'
import { listModels, recoveryToolTurn, setChatLogger, setStopCheck, setVoiceLogger, testKey, visionDescribe } from './openrouter'
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
import { toolLayerSave, windowSave } from './tool-branch'
import { listDirEntries } from './list-dir'
import { DEFAULT_FIND_OFF, normalizeFind, normalizePrompts } from './llm-flow'

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
const closeGuard = new WindowCloseGuard()
let hudWindow: BrowserWindow | null = null
let reportBoot: (pct: number, line: string) => void = () => {}
let closeBoot: () => void = () => {}
let appRevealed = false
let hudHideTimer: ReturnType<typeof setTimeout> | null = null
let running = false
let stopRequested = false
/** "Bu oturumda hep izin ver" from the approval dialog; the app restart clears it. */
let sessionApproved = false
let recoveryToolContext: ToolContext | undefined
let recoveryAbort: () => boolean = () => false
let recoveryActive = false

function getSettings(): AppSettings {
  const s = { ...DEFAULT_SETTINGS, ...store.get('settings') }
  if (s.maxSteps === 500) s.maxSteps = DEFAULT_SETTINGS.maxSteps
  s.ocrEngine = 'combined'
  const ramp = clampRamp(s.valueLo, s.valueHi)
  s.valueLo = ramp.lo
  s.valueHi = ramp.hi
  bridge.setValueRamp(ramp.lo, ramp.hi)
  const find = normalizeFind(s.findOrder, s.findOff === undefined ? DEFAULT_FIND_OFF : s.findOff)
  s.findOrder = find.order
  s.findOff = find.off
  s.llmPrompts = normalizePrompts(s.llmPrompts)
  s.modelBackups = cleanBackups(s.modelBackups)
  s.visionBackups = cleanBackups(s.visionBackups)
  s.agentBackups = cleanBackups(s.agentBackups)
  s.recovery = recoverySettings(s.recovery)
  bridge.setOcrEngine(s.ocrEngine)
  return s
}

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

function recoveryReportsDir(): string {
  const dir = path.join(logsRoot(), 'kurtarma')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function saveRecoveryReport(report: RecoveryReport) {
  const dir = recoveryReportsDir()
  const file = path.join(dir, `${report.id}.json`)
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(report, null, 2), 'utf8')
  fs.renameSync(`${file}.tmp`, file)
  const reports = fs.readdirSync(dir).filter(name => /^recovery-[\w-]+\.json$/.test(name)).sort().reverse()
  for (const name of reports.slice(100)) fs.rmSync(path.join(dir, name), { force: true })
}

function readRecoveryReports(): RecoveryReport[] {
  try {
    const dir = recoveryReportsDir()
    return fs.readdirSync(dir).filter(name => /^recovery-[\w-]+\.json$/.test(name)).sort().reverse().slice(0, 20).flatMap(name => {
      try { return [JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as RecoveryReport] }
      catch { return [] }
    })
  } catch { return [] }
}

/**
 * Screenshots the worker writes into the temp folder are deleted on the normal path. A run
 * that was killed leaves them behind, and nothing will ever read them again. An hour is
 * long enough that a live run cannot own them.
 */
function sweepStaleTempShots() {
  sweepStaleExtractions()
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

/**
 * Portable paket kendini %TEMP% altına açar ve NORMAL çıkışta siler; süreç zorla
 * öldürülürse klasör kalır (~330 MB). Ölçüldü: 5 günde 16 klasör · 4,93 GB. Seçim kuralı
 * `temp-sweep.ts` içinde saf fonksiyondur; burada yalnız dosya sistemiyle konuşulur.
 * Kendi klasörümüz ve son 10 dakikada açılmış olanlar KORUNUR.
 */
function sweepStaleExtractions() {
  try {
    const dir = app.getPath('temp')
    const adlar = fs.readdirSync(dir).filter((ad) => {
      try {
        return fs.statSync(path.join(dir, ad)).isDirectory()
      } catch {
        return false
      }
    })
    const girdiler = geciciGirdileriTopla({
      tempDir: dir,
      adlar,
      varMi: (y) => fs.existsSync(y),
      mtimeMs: (y) => {
        try {
          return fs.statSync(y).mtimeMs
        } catch {
          return Date.now()
        }
      },
    })
    const secilen = bayatCikarmaKlasorleri(girdiler, { now: Date.now(), ownDir: path.dirname(process.execPath) })
    let mb = 0
    for (const g of secilen) {
      try {
        mb += boyutMB(g.yol)
        fs.rmSync(g.yol, { recursive: true, force: true })
      } catch {
        /* kilitliyse bir sonraki açılışta denenir */
      }
    }
    if (secilen.length) {
      log('info', `Geçici · ${secilen.length} bayat portable klasörü silindi (${mb.toFixed(0)} MB). Zorla kapatılan örneklerden kalıyordu.`)
    }
  } catch {
    /* süpürme yapılamadı; açılış engellenmez */
  }
}

/** Bir klasörün yaklaşık boyutu (MB) — yalnız günlük için. */
function boyutMB(dir: string): number {
  let toplam = 0
  const gez = (d: string) => {
    for (const ad of fs.readdirSync(d)) {
      const yol = path.join(d, ad)
      try {
        const st = fs.statSync(yol)
        if (st.isDirectory()) gez(yol)
        else toplam += st.size
      } catch {
        /* atla */
      }
    }
  }
  try {
    gez(dir)
  } catch {
    /* atla */
  }
  return toplam / (1024 * 1024)
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
  // A sent action whose reaction was not clear is not a failure - the engine says so and carries
  // on - but it is not a confirmed success either. Counting those lines is what keeps a clean
  // "0 hata" from being read as "everything happened", which it once was not.
  if (/Tepki net değil|hedefi göstermedi|Akış bozulmadan sıradaki adım|doğrulanmış sayılmıyor|değeri okunamadı/.test(message)) noteReview(message)
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
setStopCheck(() => running && (stopRequested || recoveryAbort()))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const agent = createAgent({
  log: (level, message) => log(recoveryActive && level === 'error' ? 'warn' : level, recoveryActive ? `Kurtarma · ${message}` : message),
  send: (channel, payload) => {
    if (recoveryActive && ['agent:patch', 'agent:step', 'agent:edge'].includes(channel)) return
    send(channel, payload)
  },
  // A fast run keeps to the screen stages: same engine, same checks, no model call in the ladder.
  settings: () => (fastRun ? withFastFind(getSettings()) : getSettings()),
  shouldStop: () => stopRequested || recoveryAbort(),
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
// A bounded region test stops once its boundary node has finished, for the same reason.
setStopAtHook(() => {
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

  mainWindow.on('close', (event) => {
    if (!closeGuard.request(id => mainWindow?.webContents.send('window:close-requested', id))) {
      event.preventDefault()
      return
    }
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

/**
 * The build stamp that was written into the package when it was built, if it is there. Reading it
 * from inside the exe is what makes the stamp describe the code that is actually running.
 */
function embeddedBuild(): string {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'build.json') : '',
    path.join(app.getAppPath(), 'resources', 'build.json'),
  ]
  for (const file of candidates) {
    try {
      if (!file || !fs.existsSync(file)) continue
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { build?: unknown }
      if (typeof parsed.build === 'string' && parsed.build) return parsed.build
    } catch {
      /* an unreadable stamp is not worth failing a start over */
    }
  }
  return ''
}

function showSelf(focus = true) {  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  // Putting the window back is not the same as taking the foreground: during a sequence of actions
  // the dialog the next action must type into has to keep the focus.
  if (focus) {
    mainWindow.show()
    mainWindow.focus()
  } else {
    mainWindow.showInactive()
  }
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
  opts?: { derived?: boolean; debug?: boolean; fast?: boolean; resumeLoopId?: string; resumeItem?: string; requireEnd?: boolean }
): Promise<{ ok: boolean; failed?: number; steps?: number; stopped?: boolean; runId?: string; reachedEnd?: boolean }> {
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
  let outcome: { ok: boolean; failed?: number; steps?: number; stopped?: boolean; error?: string; reachedEnd?: boolean } | undefined
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
      if (running) noteUserStop()
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
    let recoveries = 0
    const pendingReports = new Map<string, RecoveryReport>()
    const executor = { ...agent.executor,
      recover: async (request: import('./runner').RecoveryRequest) => {
        const settings = recoverySettings(getSettings().recovery)
        if (!settings.enabled || opts?.fast || opts?.debug) return undefined
        if (++recoveries > settings.maxRecoveries) {
          log('warn', `Bu koşunun ${settings.maxRecoveries} kurtarma sınırı doldu; mevcut öğede kalınıyor.`)
          return 'stop' as const
        }
        pushMethod('Kurtarma ajanı')
        if (!hidden) {
          hidden = await hideSelf()
          revealHud()
        }
        recoveryActive = true
        try {
          const result = await runRecovery(request, {
            settings, shouldStop: () => stopRequested, log,
            recentLog: recentLogLines(),
            previousReports: readRecoveryReports().slice(0, 5).map(({ nodeTitle, error, probableCause, evidence, summary, result, resumed, actions }) => ({ nodeTitle, error, probableCause, evidence, summary, result, resumed, actions: actions?.slice(-10) })),
            saveReport: saveRecoveryReport,
            makeExecute: (shouldStop) => {
              recoveryAbort = shouldStop
              if (!recoveryToolContext) return async () => { throw new Error('Kurtarma araçları henüz hazır değil.') }
              return recoveryExecutor(request, recoveryToolContext, shouldStop, agent.executor)
            },
            turn: (args) => {
              if (!s.apiKey) throw new Error('OpenRouter API anahtarı gerekli.')
              if (!settings.model) throw new Error('Kurtarma sekmesinden bir model seç.')
              return recoveryToolTurn({ ...args, apiKey: s.apiKey, models: modelChain(settings.model, settings.backups) })
            },
          })
          if (result.report) pendingReports.set(request.node.id, result.report)
          return result.decision
        } finally {
          recoveryAbort = () => false
          recoveryActive = false
          pushMethod('')
        }
      },
      recoveryFinished: (nodeId: string, ok: boolean, error?: string) => {
        const report = pendingReports.get(nodeId)
        if (!report) return
        report.resumed = ok
        report.resumeError = error
        try { saveRecoveryReport(report) }
        catch (e) { log('warn', `Kurtarma sonucu kaydedilemedi: ${(e as Error).message}`) }
        pendingReports.delete(nodeId)
        log(ok ? 'success' : 'warn', ok ? `Kurtarma: “${report.nodeTitle}” ${report.completionBasis === 'model-observed' ? 'hedefinin gerçekleştiği model gözlemine göre bildirildi' : 'tamamlandı'}; aynı öğenin sıradaki adımından devam ediliyor.` : `Kurtarma: “${report.nodeTitle}” devam denemesi başarısız: ${error}`)
      },
    }
    const summary = await runGraph(graph, executor, {
      maxSteps: Math.max(1, s.maxSteps),
      ...(opts?.requireEnd ? { reportEnd: true } : {}),
      stepDelayMs: Math.max(0, s.stepDelayMs),
      startId,
      resume: !!startId,
      // Debug koşusu runner'a da bildirilir: aynı hata kümesi tekrarında durma koruması
      // yalnız debug'da çalışır (normal kullanıcı akışlarının davranışı değişmez).
      ...(opts?.debug ? { debug: true } : {}),
      // Kimlikle devam (varsa): motor öğeyi yeni listede arar, indekse güvenmez.
      ...(opts?.resumeLoopId && opts?.resumeItem ? { resumeLoopId: opts.resumeLoopId, resumeItem: opts.resumeItem } : {}),
      packagePath: Array.isArray(packagePath) && packagePath.length ? packagePath : undefined,
    })
    // A run that went through every step but had loop items end on an error is not a success.
    outcome = { ok: summary.failed === 0, failed: summary.failed, steps: summary.steps, ...(opts?.requireEnd ? { reachedEnd: summary.reachedEnd === true } : {}) }
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
    closeGuard.ready = true
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
  ipcMain.handle('window:finish-close', (event, id: unknown, allow: unknown) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return
    if (closeGuard.reply(id, allow)) mainWindow.close()
  })

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_e, partial: Partial<AppSettings>) => {
    const next = { ...getSettings(), ...partial }
    next.ocrEngine = 'combined'
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
    next.recovery = recoverySettings(next.recovery)
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

  // Developer/test tool layer; ordinary agent settings do not call these tools.
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
    // Suggestions are no longer displayed or merged through the user window.
    // Keep explicit failure replies so legacy test callers do not hang or report success.
    applyMerge: async () => ({ ok: false, error: 'Öneri merge arayüzü kaldırıldı; hiçbir akış değiştirilmedi.' }),
    showBranch: async () => ({ ok: false, error: 'Öneri inceleme arayüzü kaldırıldı; tuval değiştirilmedi.' }),
    // One action at a time may step aside from the desktop, exactly like a run does.
    hideApp: () => hideSelf(),
    showApp: async (opts?: { focus?: boolean }) => {
      // focus:false means "do not take the foreground back", and on Windows there is no way to
      // restore a minimised window without activating it - restore() alone brings it to the front.
      // So the honest reading of "bring it back without stealing focus" is: leave it minimised. It
      // comes back when asked for, which is what a run does at its end.
      if (opts?.focus === false) return true
      showSelf(true)
      return true
    },
    takeMergeUndo: undefined,
    peekMergeUndo: () => null,
    commitMergeUndo: () => false,
  }
  recoveryToolContext = toolContext
  ipcMain.handle('recovery:reports', () => readRecoveryReports())
  ipcMain.handle('recovery:openReports', async () => {
    const dir = recoveryReportsDir()
    await shell.openPath(dir)
    return dir
  })
  const toolsEnabled = testToolsEnabled(process.env.NUBBO_PROFILE, process.env.NUBBO_TEST_TOOLS)
  ipcMain.handle('tools:call', (_e, name: string, args?: unknown, source?: ToolSource) => {
    if (!toolsEnabled) return { ok: false, tool: name, outcome: 'hata', message: 'Geliştirme araçları yalnız ayrı test oturumunda kullanılabilir.' }
    return callTool(name, args, toolContext, source === 'agent' ? 'agent' : 'panel')
  })
  ipcMain.handle('tools:list', () => toolsEnabled ? toolList() : [])

  // Test-only local endpoint. The user's saved endpoint setting is preserved,
  // but cannot enable tools in a normal session.
  const endpointFile = path.join(app.getPath('userData'), 'tool-endpoint.json')
  async function syncEndpoint() {
    const want = toolsEnabled
    const live = endpointInfo()
    if (want && !live) {
      try {
        const started = await startEndpoint(toolContext, endpointFile, {
          app: app.getVersion(),
          profile: String(process.env.NUBBO_PROFILE ?? ''),
          // The stamp that was written into the package when it was built wins. The environment
          // variable is only a fallback for development runs: taking the current commit at launch
          // time let an old exe claim to come from newer code.
          build: embeddedBuild() || String(process.env.NUBBO_BUILD ?? ''),
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
  /** An explicitly empty session must not fall back to the old graph and resurrect a tab. */
  function loadCanvases(): CanvasBook {
    const saved = store.get('canvases') as CanvasBook | undefined
    if (saved && Array.isArray(saved.tabs)) return normalizeCanvasBook(saved)
    const legacy = normalizeGraph(store.get('graph'))
    return legacy.nodes.length ? normalizeCanvasBook(undefined, legacy) : normalizeCanvasBook({ activeId: '', tabs: [] })
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
    if (running) noteUserStop()
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

app.on('before-quit', (event) => {
  if (mainWindow && !mainWindow.isDestroyed() && closeGuard.ready && !closeGuard.approved) {
    event.preventDefault()
    mainWindow.close()
  }
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
