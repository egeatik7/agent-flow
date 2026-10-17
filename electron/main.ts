import { HudWindowController } from './hud-window'
import { assertRunStructure, structureSummary } from './run-structure'
import { contextOf, findPlace } from './tool-context'
import { runYap } from './yap'
import { validateApiKey } from './openrouter'
import { pruneScreenFiles } from './screen-files'
import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, powerSaveBlocker, screen, session, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { CLOSE_REPLY_TIMEOUT_MS, WindowCloseGuard } from './window-close'
import ElectronStore from 'electron-store'
import * as bridge from './a11y-bridge'
import { createAgent } from './agent'
import { windowEventAllowed } from './run-events'
import { isTestProfile, storeCwd, testToolsEnabled } from './profile'
import { bayatCikarmaKlasorleri, geciciGirdileriTopla } from './temp-sweep'
import { withFastFind } from './tools'
import { callTool, toolList, type ToolSource, type ToolContext } from './tools'
import { recoverySettings } from './recovery-settings'
import { removeRecoveryReportFiles } from './recovery-report-files'
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
import { listModels, listLocalModels, directChat, gpuInfo, recoveryToolTurn, setBaglamLogger, setChatLogger, setLocalEndpoint, localConfigured, setStopCheck, setVoiceLogger, testKey, visionDescribe, type BaglamOlayi } from './openrouter'
import { newTally, runGraph, StoppedError } from './runner'
import {
  clampRamp,
  cleanBackups,
  DEFAULT_SETTINGS,
  modelChain,
  NODE_SPECS,
  normalizeCanvasBook,
  normalizeGraph,
  type AgentGraph,
  type AppSettings,
  type CanvasBook,
  type LogLevel,
} from './graph-types'
import { mergeSettingsPatch, type SettingsPatch } from './settings-patch'
import { nextModelRevision, resolveStage } from './model-chain'
type WorkspaceWriter = 'window' | 'tools' | 'session'
import { ZipLibraryStorage, type ZipLibrarySnapshot } from './zip-library-storage'
import { chooseLibraryDirectory, isProtectedPath } from './library-path'
import { adaySayisi, sendMarkerInfo, setDiagnosticsRoot, shortModelName, stageStripText, stopwatchText } from './send-log'
// Kanıt dosyaları kullanıcı veri klasörü altına yazılır; API anahtarı/başlık asla kaydedilmez.
setDiagnosticsRoot(path.join(app.getPath('userData'), 'diagnostics'))
import { zipDocumentFor } from './zip-workspace'
import { copyZipCanvas } from './zip-canvas-document'
import { sameCanvasContent } from './canvas-content'
import type { ZipLibraryAction, ZipLibraryResult } from './zip-library-api'
import { randomBytes, createHash } from 'node:crypto'
import QRCode from 'qrcode'
import { ViewerState } from './viewer-state'
import { startViewerServer } from './viewer-server'
import { configureViewerTailscale } from './viewer-tailscale'
import type { ViewerInfo } from './viewer-types'
import { baglamKartiDurumuYap, type BaglamKarti } from './hud-context'
import {
  BELLEK_OLCUM_MS, bellekKartiYap, bellekOlcumDongusu, olcumGunlukSatiri, gunlukKarari,
  type BellekKarti, type BellekOlcumu, type OlcumHatasi,
} from './memory-meter'
import { listDirEntries } from './list-dir'
import { DEFAULT_FIND_OFF, normalizeFind, normalizePrompts, promptOf } from './llm-flow'

const STOP_HOTKEY = 'CommandOrControl+Shift+Q'
/** How long an approval question waits before the caller is told "no". */
const APPROVAL_TIMEOUT_MS = 120_000

const StoreCtor = (ElectronStore as unknown as { default?: typeof ElectronStore }).default ?? ElectronStore

const store = new StoreCtor<{ settings: AppSettings; graph: AgentGraph; zipCanvases?: CanvasBook; zipLibraryPath?: string; viewerEnabled?:boolean; viewerSecret?:string; viewerOrigin?:string }>({
  name: 'xp-agent-studio',
  defaults: { settings: DEFAULT_SETTINGS, graph: { nodes: [], edges: [] } },
  // The real profile keeps the file exactly where it has always lived. A test profile
  // (NUBBO_PROFILE) gets its own, so developing with Nubbo cannot reach the real flows.
  ...(storeCwd(process.env.NUBBO_PROFILE, app.getPath('userData')) ? { cwd: app.getPath('userData') } : {}),
})

let zipStorage: ZipLibraryStorage | undefined
let zipSnapshot: ZipLibrarySnapshot | undefined
const viewerState=new ViewerState(app.getVersion())
let viewerServer:Awaited<ReturnType<typeof startViewerServer>>|undefined
let viewerPending:Promise<void>|undefined
const viewerPort=31389+(process.env.NUBBO_PROFILE?parseInt(createHash('sha256').update(process.env.NUBBO_PROFILE).digest('hex').slice(0,4),16)%500:0)
async function ensureViewer(){
 if(viewerServer)return
 if(viewerPending)return viewerPending
 viewerPending=(async()=>{if(!store.get('viewerSecret'))store.set('viewerSecret',randomBytes(32).toString('hex'));viewerServer=await startViewerServer(viewerState,path.join(app.getAppPath(),'dist'),store.get('viewerSecret')!,viewerPort)})()
 try{await viewerPending}finally{viewerPending=undefined}
}
async function viewerInfo():Promise<ViewerInfo>{
 const origin=store.get('viewerOrigin'),url=viewerServer&&origin?`${origin}/viewer#token=${store.get('viewerSecret')}`:undefined
 return {enabled:!!viewerServer,port:viewerServer?.port,url,qr:url?await QRCode.toDataURL(url,{width:240,margin:2}):undefined}
}
let mainWindow: BrowserWindow | null = null
const closeGuard = new WindowCloseGuard()
let hudWindow: BrowserWindow | null = null
let reportBoot: (pct: number, line: string) => void = () => {}
let closeBoot: () => void = () => {}
let appRevealed = false
let hudHideTimer: ReturnType<typeof setTimeout> | null = null
let running = false
/**
 * The graph the current run walks (packages included). The desktop card names the node that is
 * running NOW, and a step start is the moment that name changes: keeping the run's own graph here
 * lets the card resolve a step id without touching the saved workspace on every step.
 */
let hudRunGraph: AgentGraph | null = null
let stopRequested = false
/** "Bu oturumda hep izin ver" from the approval dialog; the app restart clears it. */
let sessionApproved = false
let recoveryToolContext: ToolContext | undefined
let recoveryAbort: () => boolean = () => false
let recoveryActive = false

try { pruneScreenFiles() } catch { /* Temp directory may be unavailable. */ }

function getSettings(): AppSettings {
  const s = { ...DEFAULT_SETTINGS, ...store.get('settings') }
  s.ocrEngine = 'combined'
  const ramp = clampRamp(s.valueLo, s.valueHi)
  s.valueLo = ramp.lo
  s.valueHi = ramp.hi
  const find = normalizeFind(s.findOrder, s.findOff === undefined ? DEFAULT_FIND_OFF : s.findOff)
  s.findOrder = find.order
  s.findOff = find.off
  s.llmPrompts = normalizePrompts(s.llmPrompts)
  s.wordChoiceModel = String(s.wordChoiceModel ?? '').trim()
  s.wordChoiceBackups = cleanBackups(s.wordChoiceBackups)
  s.modelBackups = cleanBackups(s.modelBackups)
  s.visionBackups = cleanBackups(s.visionBackups)
  s.agentBackups = cleanBackups(s.agentBackups)
  // Koşul zinciri de diğerleri gibi taşınır; eski ayar dosyasında yoksa boş kalır.
  s.conditionModel = String(s.conditionModel ?? '').trim()
  s.conditionBackups = cleanBackups(s.conditionBackups)
  s.recovery = recoverySettings(s.recovery)
  return s
}

/** True while a branch is being tested: that run is not the flow on screen. */
let derivedRun = false
/** True while a run asked to keep to the screen stages only: no model calls during it. */
let fastRun = false

function send(channel: string, payload: unknown) {
  // A branch test must not move the tablet's running canvas. The same filter keeps those
  // step, patch and edge events off the open desktop canvas.
  if (windowEventAllowed(channel, derivedRun)) viewerState.event(channel, payload)
  if (channel === 'agent:step') {
    // The tool layer watches the same step events the canvas does, so `run.state` never guesses.
    noteStep(payload)
    // The desktop card names the running node: a step start is when that name changes.
    hudStep(payload)
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

const removedRecoveryReportIds = new Set<string>()
function saveRecoveryReport(report: RecoveryReport) {
  // A retry may finish after its note was deleted; do not recreate that report.
  if (removedRecoveryReportIds.has(report.id)) return
  const dir = recoveryReportsDir()
  const file = path.join(dir, `${report.id}.json`)
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(report, null, 2), 'utf8')
  fs.renameSync(`${file}.tmp`, file)
  send('recovery:report', report)
  const reports = fs.readdirSync(dir).filter(name => /^recovery-[\w-]+\.json$/.test(name)).sort().reverse()
  for (const name of reports.slice(100)) fs.rmSync(path.join(dir, name), { force: true })
}

function readRecoveryReports(): RecoveryReport[] {
  try {
    const dir = recoveryReportsDir()
    return fs.readdirSync(dir).filter(name => /^recovery-[\w-]+\.json$/.test(name)).sort().reverse().slice(0, 100).flatMap(name => {
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

setChatLogger((line) => {
  // Kart kronometresi: model isteği başlarken sayaç, cevap gelince süre raporu (1.9.118).
  const denenen = line.match(/^\[(?:yerel|API)\] → (\S+)/)
  if (denenen) hudSonModel = shortModelName(denenen[1])
  const isaret = sendMarkerInfo(line)
  if (isaret?.kind === 'gonderim') {
    hudSonModel = shortModelName(isaret.model)
    const kelimeSecimi = (isaret.stage ?? '') === 'ocr-word-choice'
    // OCR/tarama aşaması burada kapanır: aday listesi hazır ve istek yazıldı (süresi aradan ölçülür).
    const aday = adaySayisi(line)
    pushAsama(kelimeSecimi ? 'Kelime seçimi' : 'OCR + liste', aday ? `${aday} aday` : '')
    startHudStopwatch(kelimeSecimi ? 'Kelime seçimi' : 'Model cevabı bekleniyor', hudSonModel)
  } else if (isaret?.kind === 'yanit') {
    finishHudStopwatch('Model cevabı', hudSonModel)
    pushAsama('Model', hudSonModel)
  }
  log('chat', line)
})
setVoiceLogger((line) => {
  voiceHoldUntil = Date.now() + 1800
  log('info', line, true)
})
// Bağlam ölçümü NESNE olarak gelir; kart günlük metninden ayrıştırılmaz (1.9.129).
setBaglamLogger((olay) => baglamOlayiniIsle(olay))
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
  setLoopProgress: (loops) => viewerState.event('hud:loops', { loops }),
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

/**
 * The app's own page may navigate (its own reload, the Vite server in development). Anything else is
 * refused: one stray link must not turn the window into a browser on someone else's page.
 */
function navigationAllowed(target: string): boolean {
  const dev = process.env.VITE_DEV_SERVER_URL
  if (dev) {
    try { return new URL(target).origin === new URL(dev).origin } catch { return false }
  }
  return target.startsWith('file://')
}

/** Applies to both windows: no new window is ever opened from the page, and no outside navigation. */
function hardenContents(contents: Electron.WebContents, label: string) {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event, target) => {
    if (navigationAllowed(target)) return
    event.preventDefault()
    log('warn', `${label}: sayfa dışı gezinme engellendi: ${target}`)
  })
}

/**
 * Paketlenmiş yolda içerik güvenliği ilkesi. Geliştirmede UYGULANMAZ: Vite HMR satır içi betik ve
 * websocket kullanır, bu ilke onu kırardı.
 *
 * Not: `img-src` içinde `blob:` var. Ekran Tarayıcı kareyi `URL.createObjectURL` ile çiziyor
 * (`src/components/ScreenScanner.tsx`), `blob:` olmadan o önizleme paketlenmiş sürümde boş kalırdı.
 */
/**
 * Applies a merged graph in the window (test sessions only). The window owns the canvas book, so the
 * change goes there and the window answers once it has been saved. No answer within the time limit is
 * reported as a failure and nothing is written.
 */
function applyMergeInWindow(payload: { tabId: string; graph: AgentGraph; branchId: string; branchName: string; reason?: 'merge' | 'undo' }): Promise<{ ok: boolean; error?: string }> {
  if (!testToolsEnabled(process.env.NUBBO_PROFILE, process.env.NUBBO_TEST_TOOLS)) return Promise.resolve({ ok: false, error: 'Öneri merge arayüzü kaldırıldı; hiçbir akış değiştirilmedi.' })
  const win = mainWindow
  if (!win || win.isDestroyed()) return Promise.resolve({ ok: false, error: 'Pencere açık değil; tuval değiştirilmedi.' })
  return new Promise((resolve) => {
    const onDone = (_event: unknown, answer: { ok: boolean; error?: string }) => { clearTimeout(timer); resolve(answer) }
    const timer = setTimeout(() => { ipcMain.removeListener('agent:graph-applied', onDone); resolve({ ok: false, error: 'Pencere uygulamayı onaylamadı; tuval değiştirilmedi.' }) }, 20000)
    ipcMain.once('agent:graph-applied', onDone)
    win.webContents.send('agent:graph', payload)
  })
}

function applyContentSecurityPolicy() {
  if (process.env.VITE_DEV_SERVER_URL) return
  const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...(details.responseHeaders ?? {}), 'Content-Security-Policy': [csp] } })
  })
}

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
  hardenContents(mainWindow.webContents, 'Ana pencere')

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
    if (!closeGuard.request(id => mainWindow?.webContents.send('window:close-requested', id),
      { timeoutMs: CLOSE_REPLY_TIMEOUT_MS, onTimeout: () => forceClose('Kapanış onayı gelmedi') })) {
      event.preventDefault()
      return
    }
    destroyHud()
  })
  // A renderer that crashed or stopped answering must not keep the app (and the session) open:
  // the same forced path closes the window after writing down why.
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    forceClose(`Arayüz süreci kapandı (${details.reason})`)
  })
  mainWindow.on('unresponsive', () => {
    forceClose('Arayüz yanıt vermiyor')
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/**
 * The bounded way out of a close that the renderer never confirmed. This path writes nothing: the
 * tabs and drafts belong to the window, and the main process cannot read the renderer’s unflushed edits. So the log
 * says out loud that whatever the window had not saved yet can be lost — it must not claim a save.
 */
function forceClose(reason: string): void {
  const w = mainWindow
  if (!w || w.isDestroyed()) return
  log('warn', `${reason} (${Math.round(CLOSE_REPLY_TIMEOUT_MS / 1000)} sn); pencere zorla kapatılıyor. Arayüzün henüz kaydetmediği son değişiklikler kaybolabilir.`)
  closeGuard.force()
  w.close()
}

function destroyHud() {
  hudController.reset()
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
// 1.9.121: karta iki satır eklendi (model kronometresi + aşama şeridi); yükseklik sabit kaldığı için
// içerik taşıyor ve satırlar üst üste biniyordu ("kart üst üste açılıyor"). Pencere içeriğe yer açacak
// kadar büyütüldü.
// 1.9.130: canlı bellek göstergesi kendi satırını aldı. Yükseklik ARTIRILDI çünkü aksi hâlde durum
// kartı satırı 36px'e düşüyor ve okunur metin kalmıyordu. GERÇEK tarayıcıda ÖLÇÜLDÜ (456×254):
// durum kartı satırı 84px, durum metnine ~31px kalır (1.9.129'da 27px'ti) ve iki ölçüm bloğu kendi
// içinde kaydırılır: hiçbir satır pencerenin dışında kalmaz, hiçbiri komşusunun üstüne binmez.
// Kart hâlâ EKRANIN ALT SAĞINA sabittir (placeHud) ve sınırlı yüksekliktedir; ölçüm
// `tests/render-overflow-audit.test.ts` içindedir.
const HUD_H = 254
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
  hudController.reset()
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
  hardenContents(hudWindow.webContents, 'HUD')
  // Set once, before the first show. Applying it again after the window is
  // visible drops a transparent window off the Windows desktop.
  hudWindow.setContentProtection(true)
  hudWindow.setIgnoreMouseEvents(true)
  placeHud()
  const dev = process.env.VITE_DEV_SERVER_URL
  if (dev) void hudWindow.loadURL(`${dev}${dev.includes('?') ? '&' : '?'}hud=1`)
  else void hudWindow.loadFile(path.join(__dirname, '../dist/index.html'), { query: { hud: '1' } })
  const w = hudWindow
  hudWindow.on('closed', () => {
    if (hudWindow !== w) return
    hudController.reset()
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

const hudController = new HudWindowController(() => hudWindow, () => running, placeHud)
bridge.setHudCapture(() => hudController.capture())
bridge.setInputLogger(state => log('chat',
  `KLAVYE id=${state.id} islem=${state.op} asama=${state.phase} masaustu=${state.available ? 'etkin' : 'bilinmiyor'} basili=${state.down.join(',') || '-'} birakma-denemesi=${state.repaired || '-'} ${state.context}`))

function revealHud() {
  hudController.show()
}

function deliverHud(channel: string, payload: unknown, show: boolean) {
  hudController.send(channel, payload, show)
}

function pushLoop(text: string) {
  viewerState.event('hud:loop',{text})
  if (!running || !hudWindow || hudWindow.isDestroyed()) return
  deliverHud('hud:loop', { text }, false)
}

function pushMethod(text: string) {
  viewerState.event('hud:method',{text})
  if (!running || !hudWindow || hudWindow.isDestroyed()) return
  deliverHud('hud:method', { text: recoveryActive ? `Kurtarma ajanı${text ? ` · ${text}` : ''}` : text }, false)
}

/** Zamanlayıcı adımı sürerken kartta canlı geri sayım; adım bitince veya koşu sonunda temizlenir. */
let hudCountdown: ReturnType<typeof setInterval> | null = null
/** Kart 5 kez/sn tazelenir: insan gözü için akıcı, IPC için ucuz. */
const HUD_COUNTDOWN_MS = 200

/** Saniyeyi Türkçe ondalık virgülle yazar: 3200 → "3,2". */
function sn(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(1).replace('.', ',')
}

function pushCountdown(text: string) {
  viewerState.event('hud:countdown', { text })
  if (!running || !hudWindow || hudWindow.isDestroyed()) return
  deliverHud('hud:countdown', { text }, false)
}

/**
 * BAĞLAM ÖLÇÜM KARTI (1.9.129). Ölçüm NESNE olarak taşınır: günlük metni AYRIŞTIRILMAZ. Kaynak,
 * ölçüm modülünün önbelleğidir (`olcumuTazele` çağrı sınırında oraya yazar). Karttaki ana satır
 * "Yüklü bağlam: … token"; ölçüm yoksa "bilinmiyor", yaşlıysa "eski ölçüm".
 */
const baglamDurumu = baglamKartiDurumuYap()

function baglamKartiYayinla(kart: BaglamKarti) {
  viewerState.event('hud:context', { kart })
  if (!running || !hudWindow || hudWindow.isDestroyed()) return
  deliverHud('hud:context', { kart }, false)
}

/** Ölçüm olayını karta çevirir ve yayar. Sıra koruması `hud-context` içinde (saf, test edilir). */
function baglamOlayiniIsle(olay: BaglamOlayi) {
  if (!running) return
  const sonuç = baglamDurumu.isle({ ...olay, simdi: Date.now() })
  if (sonuç) baglamKartiYayinla(sonuç.kart)
}

/** Koşu bittiğinde kart ölçümü de temizlenir: bir sonraki koşuya eski ölçüm taşınmaz. */
function baglamKartiniTemizle() {
  if (!baglamDurumu.temizle()) return
  viewerState.event('hud:context', { kart: null })
  if (hudWindow && !hudWindow.isDestroyed()) hudWindow.webContents.send('hud:context', { kart: null })
}

/**
 * CANLI BELLEK GÖSTERGESİ (1.9.130). Yalnız ÖLÇÜM ve RAPORLAMA: bu blok hiçbir şeyi temizlemez,
 * süreç kapatmaz, model boşaltmaz, ayar değiştirmez ve LLM çağırmaz. Ölçüm NESNE olarak taşınır
 * (main → HUD → izleyici); günlük METNİ AYRIŞTIRILMAZ.
 *
 * Ölçüm arka planda ~3 saniyede bir yenilenir; ÖNCEKİ ÖLÇÜM BİTMEDEN YENİSİ BAŞLATILMAZ (kural
 * `memory-meter` içindedir) ve sorgular asenkron çalışır: ana süreç ile otomasyon beklemez.
 */
const bellekGunlukDurumu = { esikte: false, baslangicYazildi: false }
const bellekDurumu = bellekOlcumDongusu({
  aralikMs: BELLEK_OLCUM_MS,
  dinleyici: (olcum) => {
    // Eşik GEÇİŞİ günlüğe yazılır (her örnek değil): bunun için ölçüm değil, GEÇİŞ sayılır.
    bellekGunlugu(gunlukKarari(bellekGunlukDurumu, { tur: 'olcum', olcum }))
    bellekKartiniYayinla(olcum)
  },
  hataDinleyici: (hata, sonGecerli) => {
    // Başarısız ölçüm uygulamayı ETKİLEMEZ. Son geçerli değer varsa kart onu "eski ölçüm" diye,
    // ölçüm zamanıyla birlikte gösterir; hata kaydında örneğin YAŞI yazılır.
    bellekGunlugu(gunlukKarari(bellekGunlukDurumu, { tur: 'hata', hata, sonGecerli }))
    bellekKartiniYayinla(sonGecerli)
  },
})
/** Son yayınlanan kart metni: aynı kart her 3 saniyede yeniden gönderilmez. */
let bellekSonKart = ''

/** Günlük kararını uygular: yalnız başlangıç, eşik GEÇİŞİ ve hata anı diske yazılır. */
function bellekGunlugu(karar: ReturnType<typeof gunlukKarari>) {
  if (karar.yaz) log(karar.neden === 'esik' ? 'warn' : 'info', karar.satir)
}

/** Koşu başlangıcında son örneği günlüğe ekler (her ölçüm DEĞİL, istenen üç an). */
function bellekGunlukBaslangic() {
  bellekGunlugu(gunlukKarari(bellekGunlukDurumu, { tur: 'baslangic' }))
  const son = bellekDurumu.olcum()
  if (son) log('info', olcumGunlukSatiri(son, 'Koşu başlangıcı bellek ölçümü'))
}

/** Koşu hatasında son örneği YAŞIYLA birlikte günlüğe ekler. */
function bellekGunlukHatasi(mesaj: string) {
  const son = bellekDurumu.olcum()
  const hata = bellekDurumu.sonHata()
  const yas = son ? `${Math.max(0, Date.now() - son.olcumAt)} ms önce alındı` : 'geçerli örnek yok'
  log('warn', `Bellek ölçümü (hata anı): son örnek ${yas}${hata ? ` · son ölçüm hatası: ${hata.mesaj}` : ''} · ${mesaj}`)
}

/**
 * Kart nesnesini ölçüm anında bir kez yayar (masaüstü + telefon AYNI nesne). İmza karşılaştırması
 * `yas` ve hata damgasını içerir: yaş metni değişmedikçe ve yeni bir hata doğmadıkça mesaj
 * yinelenmez, ama "eski ölçüm" bilgisi karta zamanında ulaşır.
 */
function bellekKartiniYayinla(olcum: BellekOlcumu | null) {
  const hata = olcum ? bellekDurumu.sonHata() : bellekDurumu.sonHata()
  const kart = bellekKartiYap({ olcum, hata, simdi: Date.now() })
  const imza = JSON.stringify({ ramVram: kart.ramVram, butce: kart.butce, eski: kart.eski, yas: kart.yas, hata: kart.hata, daraliyor: kart.daraliyor, surecSatirlari: kart.surecSatirlari, gpuSatirlari: kart.gpuSatirlari })
  if (imza === bellekSonKart) return
  bellekSonKart = imza
  bellekKartiniGonder(kart)
}

function bellekKartiniGonder(kart: BellekKarti) {
  if (!running) return
  viewerState.event('hud:memory', { kart })
  if (hudWindow && !hudWindow.isDestroyed()) deliverHud('hud:memory', { kart }, false)
}

/**
 * Geri sayımı durdurur ve karttaki satırı temizler. `sil=false` yalnız zamanlayıcıyı bırakır
 * (yeni bir geri sayım hemen ardından satırı zaten yeniden yazar).
 */
function stopHudCountdown(sil = true) {
  if (hudCountdown) {
    clearInterval(hudCountdown)
    hudCountdown = null
  }
  if (sil) pushCountdown('')
}

/**
 * Zamanlayıcı (wait) adımı sürerken kalan süre kartta görünür. Toplam süre adım başında node'dan
 * okunur; adım gerçekten bitince (`done`/`error`) veya koşu sonunda satır temizlenir. Süre bitince
 * sayaç kendini bırakır ama satır "0,0 sn" olarak kalır, ta ki adım olayı temizleyene kadar — böylece
 * kart, adımın gerçekten bittiğini söyleyen olayı beklerken yanlış bir "sürüyor" izlenimi vermez.
 */
function startHudCountdown(title: string, totalMs: number) {
  stopHudCountdown(false)
  if (!running || !hudWindow || hudWindow.isDestroyed() || totalMs <= 0) return
  const bitis = Date.now() + totalMs
  const yaz = () => {
    const kalan = Math.max(0, bitis - Date.now())
    pushCountdown(`Zamanlayıcı${title ? ` · ${title}` : ''} · kalan ${sn(kalan)} / ${sn(totalMs)} sn`)
    if (kalan <= 0 && hudCountdown) {
      clearInterval(hudCountdown)
      hudCountdown = null
    }
  }
  yaz()
  hudCountdown = setInterval(yaz, HUD_COUNTDOWN_MS)
}

/**
 * MODEL AŞAMASI KRONOMETRESİ (1.9.118). Ölçülen şikâyet: OCR bulunuyor ama model cevap verirken
 * kart hiçbir şey göstermiyordu ("kart her güncellemeyi geçmiyor"). Artık her model isteğinde sayaç
 * başlar (hangi model, hangi aşama), cevap geldiğinde geçen süre kartta KALICI olarak yazılır:
 *   "Model cevabı bekleniyor · qwen3.5-64k:latest · 1,4 sn"  →  "Model cevabı · qwen3.5-64k:latest · 3,1 sn"
 * Sayaç aynı satırı kullandığı için geri sayımla çakışmaz; 180 sn'de kendini bırakır (asılı model).
 */
let hudStopwatch: ReturnType<typeof setInterval> | null = null
let hudStopwatchBasi = 0
/** Süregelen model isteğinin kısa adı: cevap satırında hangi modelin kaç sn sürdüğü yazılsın. */
let hudSonModel = ''

function durdurHudStopwatch() {
  if (hudStopwatch) {
    clearInterval(hudStopwatch)
    hudStopwatch = null
  }
}

function startHudStopwatch(label: string, extra = '') {
  stopHudCountdown(false)
  durdurHudStopwatch()
  hudStopwatchBasi = Date.now()
  if (!running || !hudWindow || hudWindow.isDestroyed()) return
  const yaz = () => {
    const gecen = Date.now() - hudStopwatchBasi
    pushCountdown(stopwatchText(label, extra, gecen))
    if (gecen > 180_000) durdurHudStopwatch()
  }
  yaz()
  hudStopwatch = setInterval(yaz, HUD_COUNTDOWN_MS)
}

/** Kronometreyi bitirir ve süreyi kartta bırakır (kullanıcının istediği "kaç sn'de oluştu" raporu). */
function finishHudStopwatch(label: string, extra = ''): string {
  const sure = hudStopwatchBasi ? Date.now() - hudStopwatchBasi : 0
  durdurHudStopwatch()
  const metin = stopwatchText(label, extra, sure)
  pushCountdown(metin)
  return metin
}

/**
 * KART ŞERİDİ (1.9.119): son üç aşama ve süreleri. "Kart her güncellemeyi geçmiyor" şikâyetinin
 * çözümü: tek satırlık durum yerine aşamalar birikerek görünür (OCR + liste → Model → Kelime seçimi).
 * Süre, iki aşama arasındaki gerçek aralıktır; 60 sn'den uzun boşluk (adımlar arası bekleme) süre
 * sayılmaz ve "—" yazılır.
 */
let hudAsamalar: { ad: string; ms: number | null }[] = []
let hudSonAsamaTs = 0

function pushAsama(ad: string, extra = '') {
  const simdi = Date.now()
  const ara = hudSonAsamaTs ? simdi - hudSonAsamaTs : 0
  hudSonAsamaTs = simdi
  hudAsamalar = [...hudAsamalar, { ad: extra ? `${ad} · ${extra}` : ad, ms: ara > 0 && ara < 60_000 ? ara : null }].slice(-3)
  const metin = stageStripText(hudAsamalar)
  viewerState.event('hud:stages', { text: metin })
  if (running && hudWindow && !hudWindow.isDestroyed()) deliverHud('hud:stages', { text: metin }, false)
}

/** Node kinds whose step already logs its own opening line (see runner's execStep). */const LOGGED_STEP_KINDS = new Set(['click', 'type', 'key', 'wait', 'condition', 'ai'])

/**
 * The card must name the node that is running NOW.
 *
 * Ölçülen kusur: yöntem satırını yalnız Tıkla/Yaz/Koşul yolları yazıyordu ve hiçbir node
 * başlangıcında sıfırlanmıyordu; bu yüzden Koşul'dan Zamanlayıcı'ya (ya da Tuş Gönder/Yap/döngüye)
 * geçildiğinde kartta hâlâ "Koşul: …" yazıyordu. Her adım başlangıcı düğüm etiketini yazar; ajan
 * kendi yöntemini (ör. "Koşul: uygulama öğeleri (UIA)") sonra inceltir.
 *
 * Döngü/paket/Başlangıç/Bitir kendi günlük satırını yazmadığı için bu türlerde kart metni de
 * buradan güncellenir; diğer türler satırı zaten kendi adım günlüğüyle tazeler (çift satır olmasın).
 */
function hudStep(payload: unknown) {
  if (!running || derivedRun || !hudRunGraph || !hudWindow || hudWindow.isDestroyed()) return
  const p = payload as { id?: unknown; status?: unknown }
  if (typeof p.id !== 'string') return
  // Adım bitti ya da hata verdi: karttaki geri sayım bekleyeni yanıltmasın.
  if (p.status !== 'running') {
    stopHudCountdown()
    return
  }
  hudAsamalar = []
  hudSonAsamaTs = 0
  const place = findPlace(hudRunGraph, p.id)
  if (!place) return
  const kind = place.node.kind
  const label = NODE_SPECS[kind]?.label ?? kind
  const title = String(place.node.title ?? '').trim()
  pushMethod(title && title !== label ? `${label} · ${title}` : label)
  if (kind === 'wait') {
    // Zamanlayıcı: adı yöntem satırında kalır, kartın içinde canlı geri sayım yürür.
    startHudCountdown(title, Math.max(0, Number(place.node.ms ?? 0)))
    return
  }
  stopHudCountdown()
  if (!LOGGED_STEP_KINDS.has(kind)) pushHud('info', title ? `${label}: ${title}` : label)
}

function recoveryStatus(active: boolean, nodeTitle: string, message: string) {
  const payload = { active, nodeTitle, message }
  send('recovery:status', payload)
  deliverHud('recovery:status', payload, false)
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
  viewerState.event('hud:status', payload)
  deliverHud('hud:status', payload, true)
}

function hideHudSoon() {
  if (hudHideTimer) clearTimeout(hudHideTimer)
  hudHideTimer = setTimeout(() => {
    hudHideTimer = null
    viewerState.event('hud:loop', { text: '' })
    viewerState.event('hud:method', { text: '' })
    viewerState.event('hud:countdown', { text: '' })
    if (hudWindow && !hudWindow.isDestroyed()) {
      hudController.hide()
      hudWindow.webContents.send('hud:loop', { text: '' })
      hudWindow.webContents.send('hud:method', { text: '' })
      hudWindow.webContents.send('hud:countdown', { text: '' })
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
  opts?: { derived?: boolean; debug?: boolean; fast?: boolean; resumeLoopId?: string; resumeItem?: string; requireEnd?: boolean; canvasId?: string }
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
  // Koşunun sayaçları burada tutulur: hata ile biten bir koşuda runGraph sonuç nesnesini
  // döndüremez (hata yukarı çıkar), sayaç yine de çağırana ulaşmalı. Şeklin tek tanımı
  // runner'daki newTally()'dir; burada elle kopyalanmaz ki yeni bir alan sessizce düşmesin.
  const tally = newTally()
  try {
    // Before normalization can silently discard a broken edge; before any input.
    const structure = assertRunStructure(raw, { startId, packagePath, requireEnd: opts?.requireEnd })
    const warnings = structure.filter(issue => issue.severity === 'warning')
    if (warnings.length) log('warn', `Çalıştırma ön kontrolü:\n${structureSummary(warnings)}`)
    const graph = normalizeGraph(raw)
    // The desktop card resolves every step id in this run's own graph (packages included).
    hudRunGraph = graph
    // A test of an agent branch is not the saved flow: it runs, but it is not written down as
    // the active flow, so a branch test can never overwrite what the user has open.
    if (!opts?.derived) store.set('graph', graph)
    // The tool layer keeps this graph so `run.state` can say which box and item the run is on.
    runId = beginRun(graph, startId)
    if (!opts?.derived) viewerState.begin(runId, opts?.canvasId ?? '', graph)
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
    // Koşu başlangıcı: bellek ölçümünün son örneği (ve ölçüm başladıysa ilk kayıt) günlüğe girer.
    bellekGunlukBaslangic()
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
      initiative: async (node: import('./graph-types').AgentNode, stepNo: number, ahead: import('./runner').StepAhead = {}, vars: Record<string, string> = {}) => {
        if (opts?.fast || opts?.debug) throw new Error('Yap model gerektirir; hızlı/hata ayıklama koşusunda çalıştırılamaz.')
        const settings = getSettings()
        pushMethod('Yap')
        try {
          return await runYap(node, { nodeId: node.id, vars, packageContext: contextOf(graph, node.id), next: ahead.next, then: ahead.then }, {
            system: promptOf(settings.llmPrompts, 'yap'),
            shouldStop: () => stopRequested, log,
            makeExecute: shouldStop => {
              recoveryAbort = shouldStop
              if (!recoveryToolContext) throw new Error('Yap araçları hazır değil.')
              const request = { graph, node, live: node, stepNo, ahead, vars, error: new Error('') }
              return recoveryExecutor(request, recoveryToolContext, shouldStop, agent.executor, true)
            },
            turn: args => {
              const live = getSettings()
              const yap = resolveStage(live, 'yap')
              return recoveryToolTurn({ ...args, allowLocal: true, apiKey: live.apiKey, models: yap.chain, stage: 'yap', revision: live.modelRevision ?? 0, chainSource: yap.source })
            },
          })
        } catch (error) {
          if (stopRequested || error instanceof StoppedError) throw error
          throw error
        } finally { recoveryAbort = () => false; pushMethod('') }
      },
      recover: async (request: import('./runner').RecoveryRequest) => {
        const settings = recoverySettings(getSettings().recovery)
        if (!settings.enabled || opts?.fast || opts?.debug) {
          const reason = !settings.enabled ? 'Kurtarma sekmesinde kapalı.' : opts?.fast ? 'Hızlı koşu model çağırmaz.' : 'Hata ayıklama koşusu hata anında durur.'
          log('warn', `Kurtarma aşamasına ulaşıldı; ajan çalıştırılmadı: ${reason}`)
          recoveryStatus(false, request.node.title, `Kurtarma aşamasına ulaşıldı; ajan çalıştırılmadı: ${reason}`)
          return 'disabled' as const
        }
        if (++recoveries > settings.maxRecoveries) {
          log('warn', `Bu koşunun ${settings.maxRecoveries} kurtarma sınırı doldu; mevcut öğede kalınıyor.`)
          recoveryStatus(false, request.node.title, 'Koşunun kurtarma sınırı doldu; akış tamamlanamadı.')
          return 'failed' as const
        }
        recoveryStatus(true, request.node.title, 'Hata inceleniyor; akış kurtarma sonucunu bekliyor.')
        recoveryActive = true
        try {
          if (!hidden) {
            hidden = await hideSelf()
            revealHud()
          }
          pushMethod('')
          const result = await runRecovery(request, {
            settings, shouldStop: () => stopRequested, log: (level, message) => {
              log(level, message)
              recoveryStatus(true, request.node.title, message)
            },
            recentLog: recentLogLines(),
            previousReports: readRecoveryReports().slice(0, 5).map(({ nodeTitle, error, probableCause, evidence, summary, result, resumed, actions }) => ({ nodeTitle, error, probableCause, evidence, summary, result, resumed, actions: actions?.slice(-10) })),
            saveReport: report => { report.canvasId = opts?.canvasId; saveRecoveryReport(report) },
            makeExecute: (shouldStop) => {
              recoveryAbort = shouldStop
              if (!recoveryToolContext) return async () => { throw new Error('Kurtarma araçları henüz hazır değil.') }
              return recoveryExecutor(request, recoveryToolContext, shouldStop, agent.executor)
            },
            turn: (args) => {
              const live = recoverySettings(getSettings().recovery)
              const rev = getSettings().modelRevision ?? 0
              if (!live.apiKey) throw new Error('Kurtarma sekmesinden ayrı OpenRouter API anahtarını kaydet.')
              if (!live.model) throw new Error('Kurtarma sekmesinden bir model seç.')
              return recoveryToolTurn({ ...args, apiKey: live.apiKey, models: modelChain(live.model, live.backups), stage: 'recovery', revision: rev, chainSource: 'Kurtarma ajanı' })
            },
          })
          if (result.report) pendingReports.set(request.node.id, result.report)
          recoveryStatus(false, request.node.title, result.decision === 'retry' || result.decision === 'completed' || result.decision === 'var'
            ? 'Kurtarma tamamlandı; aynı öğede devam sonucu bekleniyor.'
            : result.report?.summary || 'Kurtarma ajanı sorunu çözemedi.')
          return result.decision
        } catch (error) {
          recoveryStatus(false, request.node.title, stopRequested ? 'Kurtarma kullanıcı tarafından durduruldu.' : `Kurtarma başarısız: ${(error as Error).message}`)
          throw error
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
        recoveryStatus(false, report.nodeTitle, ok ? 'Kurtarma başarılı; akış aynı öğede devam ediyor.' : `Kurtarma sonrası devam başarısız: ${error}`)
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
      tally,
    })
    // A run that went through every step but had loop items end on an error is not a success.
    outcome = { ok: summary.failed === 0 && !summary.incomplete, failed: summary.failed, steps: summary.steps, ...(opts?.requireEnd ? { reachedEnd: summary.reachedEnd === true } : {}) }
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
    // Hata anında son bellek örneği YAŞIYLA birlikte günlüğe eklenir (her örnek diske yazılmaz).
    bellekGunlukHatasi(`koşu hatası: ${(e as Error).message}`)
    // Sayaç yine de doğruyu söyler: döngü dışında hata ile biten adımlar da sayılır. Yoksa
    // "hata: …" ile "hatalı öğe yok" aynı cümlede çelişiyordu.
    const hatali = tally.failed + tally.stepFailures
    outcome = { ok: false, error: (e as Error).message, ...(hatali > 0 ? { failed: hatali } : {}) }
    throw e
  } finally {
    // Reset the run state even when preparation failed before a resource
    // was created, or a later OS cleanup call throws. The outcome is kept so a caller can
    // still ask how the run ended after it is over.
    agent.releaseRunSettings()
    endRun(outcome)
    if (runId && !derivedRun) viewerState.finish(outcome)
    hudRunGraph = null
    stopHudCountdown()
    // Koşu bitti: bağlam kartı da temizlenir, eski ölçüm bir sonraki koşuya taşınmaz.
    baglamKartiniTemizle()
    if (recoveryActive) recoveryStatus(false, '', 'Kurtarma durduruldu.')
    recoveryActive = false
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
  const initial = getSettings()
  setLocalEndpoint(initial.localBaseUrl, initial.localTimeoutMs, initial.localVision, initial.localOff, initial.localThink)
  bridge.setValueRamp(initial.valueLo, initial.valueHi)
  bridge.setOcrEngine(initial.ocrEngine)
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
  // CANLI BELLEK GÖSTERGESİ (1.9.130): ölçüm oturum boyunca arka planda döner (3 sn). Kart yalnız
  // koşu sürerken yayınlanır; kapanışta `will-quit` timer'ı ve bekleyen işi bırakır.
  bellekDurumu.basla()
  bellekGunlugu(gunlukKarari(bellekGunlukDurumu, { tur: 'baslangic' }))
  report(68, 'Erişilebilirlik köprüsü…')
  await Promise.race([bridge.warmUp(), sleep(8000)])

  report(78, 'Pencere kuruluyor…')
  applyContentSecurityPolicy()
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
  // `reply` returns `allow`: it is true only when the renderer said "kapat" (and only for the
  // request that is still pending). So `mainWindow.close()` runs exactly when closing is allowed;
  // with `allow: false` the gate stays shut and the window keeps running.
  ipcMain.handle('window:finish-close', (event, id: unknown, allow: unknown) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return
    if (closeGuard.reply(id, allow)) mainWindow.close()
  })

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_e, partial: SettingsPatch) => {
    const onceki = getSettings()
    const next = mergeSettingsPatch(onceki, partial)
    next.apiKey = validateApiKey(next.apiKey)
    if (next.recovery?.apiKey) next.recovery = { ...next.recovery, apiKey: validateApiKey(next.recovery.apiKey) }
    next.ocrEngine = 'combined'
    const ramp = clampRamp(next.valueLo, next.valueHi)
    next.valueLo = ramp.lo
    next.valueHi = ramp.hi
    const find = normalizeFind(next.findOrder, next.findOff)
    next.findOrder = find.order
    next.findOff = find.off
    next.llmPrompts = normalizePrompts(next.llmPrompts)
    next.wordChoiceModel = String(next.wordChoiceModel ?? '').trim()
    next.wordChoiceBackups = cleanBackups(next.wordChoiceBackups).filter(name => name !== next.wordChoiceModel)
    next.modelBackups = cleanBackups(next.modelBackups).filter((name) => name !== next.model.trim())
    next.visionBackups = cleanBackups(next.visionBackups).filter((name) => name !== next.visionModel.trim())
    next.agentBackups = cleanBackups(next.agentBackups).filter((name) => name !== next.agentModel.trim())
    next.conditionBackups = cleanBackups(next.conditionBackups).filter((name) => name !== next.conditionModel.trim())
    next.recovery = recoverySettings(next.recovery)
    next.modelRevision = nextModelRevision(onceki, next)
    store.set('settings', next)
    setLocalEndpoint(next.localBaseUrl, next.localTimeoutMs, next.localVision, next.localOff, next.localThink)
    bridge.setValueRamp(ramp.lo, ramp.hi)
    bridge.setOcrEngine(next.ocrEngine)
    void syncEndpoint()
    return next
  })

  const currentGraph = () => { const book = loadCanvases(false); return book.tabs.find(t => t.id === book.activeId)?.graph ?? { nodes: [], edges: [] } }
  ipcMain.handle('graph:get', currentGraph)
  ipcMain.handle('graph:save', (_e, graph: AgentGraph) => {
    const book = loadCanvases()
    if (!book.activeId) throw Error('Önce bir tuval aç.')
    storeWorkspace({ ...book, tabs: book.tabs.map(t => t.id === book.activeId ? { ...t, graph: normalizeGraph(graph) } : t) })
    return true
  })

  // Developer/test tool layer; ordinary agent settings do not call these tools.
  const toolContext = {
    getGraph: currentGraph,
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
      storeWorkspace(book, 'tools')
    },
    // Suggestions are no longer displayed or merged through the user window.
    // Keep explicit failure replies so legacy test callers do not hang or report success.
    autoApply: testToolsEnabled(process.env.NUBBO_PROFILE, process.env.NUBBO_TEST_TOOLS),
    applyMerge: (payload: Parameters<typeof applyMergeInWindow>[0]) => applyMergeInWindow(payload),
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
  const removeReports = (ids?: string[]) => {
    removeRecoveryReportFiles(recoveryReportsDir(), ids, removed => {
      removed.forEach(id => removedRecoveryReportIds.add(id))
      send('recovery:removed', removed)
    })
    return true
  }
  ipcMain.handle('recovery:removeReport', (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Geçersiz kurtarma raporu kimliği.')
    return removeReports([id])
  })
  ipcMain.handle('recovery:clearReports', () => removeReports())
  ipcMain.handle('recovery:copyText', (_e, text: unknown) => {
    if (typeof text !== 'string' || text.length > 2_000_000) throw new Error('Geçersiz rapor metni.')
    clipboard.writeText(text)
    return true
  })
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
  /** Windows Denetimli klasör erişimi kapsamındaki kökler (yazma engellenebilir). */
  function protectedRoots(): string[] {
    return (['documents', 'desktop', 'pictures', 'videos', 'music'] as const)
      .map((key) => app.getPath(key))
      .concat(path.join(app.getPath('home'), 'Favorites'))
  }
  /** Korumalı VE henüz yok olan bir klasörde `mkdirSync` süresiz bekleyebilir: oraya hiç gidilmez. */
  function unsafeLibraryPath(candidate: string): boolean {
    try { return isProtectedPath(candidate, protectedRoots()) && !fs.existsSync(candidate) } catch { return false }
  }
  /**
   * Kütüphane klasörü: korumalı bir klasörü ASLA oluşturmaya çalışmaz (ölçüldü: Denetimli klasör
   * erişimi açıkken `mkdirSync` Belgeler altında süresiz bekliyor ve arayüz "yükleniyor"da donuyordu).
   */
  function libraryDirectory(): string {
    const preferred = path.join(app.getPath('documents'), 'Nubbo', 'Kütüphane')
    const choice = chooseLibraryDirectory({
      configured: String(store.get('zipLibraryPath') ?? ''),
      documents: app.getPath('documents'),
      home: app.getPath('home'),
      exists: (candidate) => { try { return fs.existsSync(candidate) } catch { return false } },
      protectedRoots: protectedRoots(),
    })
    if (choice.fallback) {
      log('warn', `Varsayılan kütüphane klasörü “${preferred}” Windows Denetimli klasör erişimi kapsamında ve henüz yok; orada klasör açmak uygulamayı kilitleyebilir. Kütüphane “${choice.directory}” altına alındı. Kalıcı çözüm: Ayarlar > Kütüphane’den bir klasör seç ya da Windows Güvenliği > Fidye yazılımı koruması > Denetimli klasör erişimi altında bu uygulamaya izin ver.`)
      try { store.set('zipLibraryPath', choice.directory) } catch { /* seçim bu koşu için yine geçerli */ }
    }
    return choice.directory
  }
  function loadCanvases(refresh = true): CanvasBook {
    zipStorage ??= new ZipLibraryStorage(libraryDirectory())
    const raw = store.get('zipCanvases')
    const session = normalizeCanvasBook(raw ?? { workspaceVersion: 3, activeId: '', tabs: [] })
    if (refresh || !zipSnapshot) {
      try { zipSnapshot = zipStorage.load() }
      catch (error) {
        // Okunamayan bir kütüphane arayüzün açılmasını ASLA engellemez: boş kütüphaneyle devam edilir.
        log('error', `Kütüphane okunamadı (${(error as Error).message}); boş kütüphaneyle devam ediliyor.`)
        zipSnapshot = { directory: zipStorage.directory, groups: [] }
      }
    }
    const book = { ...session, workspaceVersion: 3 as const, zipLibrary: zipSnapshot }
    viewerState.setBook(book)
    return book
  }
  function storeWorkspace(book: CanvasBook, writer: WorkspaceWriter = 'window'): { conflict: boolean } {
    const current = loadCanvases(false)
    const { zipLibrary: _library, ...input } = writer === 'tools' ? { ...current, branches: book.branches ?? [] } : { ...book, workspaceVersion: 3 as const, branches: current.branches ?? [] }
    const session = normalizeCanvasBook(input)
    store.set({ zipCanvases: session, graph: session.tabs.find(t => t.id === session.activeId)?.graph ?? { nodes: [], edges: [] } })
    viewerState.setBook({ ...session, zipLibrary: current.zipLibrary })
    return { conflict: false }
  }
  ipcMain.handle('library:info', () => { const book = loadCanvases(); return { directory: book.zipLibrary!.directory } })
  ipcMain.handle('library:manage', async (_e, mode: string) => {
    if (running || recoveryActive || !mainWindow) throw Error('Çalışma sürerken kütüphane değiştirilemez.')
    const current = loadCanvases()
    if (mode === 'reveal') { await shell.openPath(zipStorage!.directory); return { directory: zipStorage!.directory } }
    if (mode === 'reload') return { directory: zipStorage!.directory, book: current }
    if (mode !== 'open') throw Error('Bu eski katalog işlemi kaldırıldı.')
    const answer = await dialog.showOpenDialog(mainWindow, { title: 'ZIP kütüphanesi klasörünü seç', properties: ['openDirectory','createDirectory'] })
    if (answer.canceled) return null
    // Seçilen klasör korumalı ve henüz yoksa klasör açma denemesi uygulamayı kilitleyebilir (ölçüldü).
    if (unsafeLibraryPath(answer.filePaths[0])) {
      throw Error(`“${answer.filePaths[0]}” Windows Denetimli klasör erişimi kapsamında ve henüz yok; orada klasör açmak uygulamayı kilitleyebilir. Korumasız bir klasör seç (ör. ${path.join(app.getPath('home'), 'NubboKutuphane')}) ya da Windows Güvenliği > Fidye yazılımı koruması > Denetimli klasör erişimi altında bu uygulamaya izin ver.`)
    }
    const target = new ZipLibraryStorage(answer.filePaths[0]), library = target.load()
    const book: CanvasBook = { workspaceVersion: 3, activeId: '', tabs: [], zipLibrary: library }
    zipStorage = target; zipSnapshot = library; store.set('zipLibraryPath', target.directory); storeWorkspace(book)
    return { directory: target.directory, book }
  })
  ipcMain.handle('zip-library:action', async (_e, action: ZipLibraryAction): Promise<ZipLibraryResult | null> => {
    if (running || recoveryActive || !mainWindow) throw Error('Çalışma sürerken ZIP kütüphanesi düzenlenemez.')
    const book = loadCanvases(), storage = zipStorage!, library = book.zipLibrary!
    const selected = 'id' in action ? library.groups.find(g => g.id === action.id) : undefined
    const requireGroup = () => { if (!selected || !('revision' in action) || selected.revision !== action.revision) throw Error('ZIP grubu değişti; yeniden yükle ve tekrar dene.'); if (selected.problem && action.action !== 'deleteGroup') throw Error(selected.problem); return selected }
    let next = library, canvas: import('./zip-canvas-document').ZipCanvasDocument | undefined
    switch (action.action) {
      case 'create': next = storage.createGroup(action.name, action.archived); break
      case 'rename': requireGroup(); next = storage.renameGroup(action.id, action.name, action.revision); break
      case 'archive': requireGroup(); next = storage.archiveGroup(action.id, action.archived, action.revision); break
      case 'deleteGroup': requireGroup(); next = storage.deleteGroup(action.id, action.revision); break
      case 'reorder': requireGroup(); next = storage.reorderGroup(action.id, action.order, action.revision); break
      case 'deleteCanvas':
      case 'deleteCanvases': {
        const g = requireGroup(), ids = action.action === 'deleteCanvas' ? [action.canvasId] : action.canvasIds
        if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !g.canvases.some(c => c.canvasId === id))) throw Error('Silinecek tuval seçimi değişti; yeniden seç.')
        next = storage.saveGroup(g.id, g.canvases.filter(c => !ids.includes(c.canvasId)), g.revision); break
      }
      case 'renameCanvas': { const g = requireGroup(); if (!g.canvases.some(c => c.canvasId === action.canvasId)) throw Error('Tuval bulunamadı.'); next = storage.saveGroup(g.id, g.canvases.map(c => c.canvasId === action.canvasId ? { ...c, name: action.name } : c), g.revision); break }
      case 'copyCanvas': { const g = requireGroup(), source = g.canvases.find(c => c.canvasId === action.canvasId); if (!source) throw Error('Tuval bulunamadı.'); canvas = copyZipCanvas(source, source.name.slice(0,152) + ' (Kopya)'); next = storage.saveGroup(g.id, [...g.canvases, canvas], g.revision); break }
      case 'saveCanvas': {
        canvas = zipDocumentFor(action.tab, action.copy)
        const owner = !action.copy && action.tab.savedId ? library.groups.find(g => g.canvases.some(c => c.canvasId === action.tab.savedId)) : undefined
        const old = owner?.canvases.find(c => c.canvasId === action.tab.savedId)
        if (action.tab.savedId && !action.copy && !owner) throw Error('Kayıtlı tuval artık ZIP’te yok; Farklı Kaydet gerekli.')
        if (!old && library.groups.some(g => g.canvases.some(c => c.canvasId === canvas!.canvasId))) throw Error('Bu tuval kimliği ZIP kütüphanesinde zaten var; Farklı Kaydet veya kopya olarak içe aktar.')
        if (owner && action.id && action.id !== owner.id) throw Error('Başka ZIP’e kaydetmek için Farklı Kaydet gerekli.')
        if (old && !action.tab.baseline) throw Error('Tuvalin kayıt tabanı yok; yeniden aç veya Farklı Kaydet.')
        if (old && action.tab.baseline && (old.name !== action.tab.baseline.name || !sameCanvasContent({ nodes: old.nodes, edges: old.edges }, action.tab.baseline.graph))) throw Error('Tuval dışarıda değişti; eski sekme üzerine yazamaz. Yeniden aç veya Farklı Kaydet.')
        const target = owner ?? selected
        if (target) {
          if (action.revision !== target.revision || target.problem) throw Error('ZIP grubu değişti; yeniden yükle ve tekrar dene.')
          const docs = target.canvases.some(c => c.canvasId === canvas!.canvasId) ? target.canvases.map(c => c.canvasId === canvas!.canvasId ? canvas! : c) : [...target.canvases, canvas]
          next = storage.saveGroup(target.id, docs, target.revision)
        } else next = storage.importDocuments(action.name ?? canvas.name, [canvas])
        break
      }
      case 'import': {
        const answer = await dialog.showOpenDialog(mainWindow, { title: 'Tuval JSON’larını içeren ZIP seç', properties: ['openFile'], filters: [{ name: 'ZIP grubu', extensions: ['zip'] }] })
        if (answer.canceled) return null
        const file = answer.filePaths[0]
        if (fs.statSync(file).size > 64 * 1024 * 1024) throw Error('ZIP çok büyük.')
        let name = path.basename(file).replace(/\.zip$/i, '')
        if (action.copy) { let count = 1; while (library.groups.some(g => g.name.toLocaleLowerCase() === name.toLocaleLowerCase())) name = `${path.basename(file).replace(/\.zip$/i, '')} (Kopya ${count++})` }
        next = storage.importZip(name, fs.readFileSync(file), action.archived, action.copy)
        break
      }
      case 'export': {
        const g = requireGroup(), bytes = storage.exportGroup(g.id, g.revision)
        const answer = await dialog.showSaveDialog(mainWindow, { title: 'ZIP grubunu dışa aktar', defaultPath: g.name + '.zip', filters: [{ name: 'ZIP grubu', extensions: ['zip'] }] })
        if (answer.canceled || !answer.filePath) return null
        fs.writeFileSync(answer.filePath, bytes); break
      }
      default: throw Error('Geçersiz ZIP işlemi.')
    }
    zipSnapshot = next
    viewerState.setBook({ ...book, zipLibrary: next })
    return { library: next, ...(canvas ? { canvas } : {}) }
  })

  ipcMain.handle('canvases:get', () => loadCanvases())
  ipcMain.handle('viewer:info',()=>viewerInfo())
  ipcMain.handle('viewer:manage',async(_e,action:string)=>{
    if(action==='disable'){store.set('viewerEnabled',false);await viewerServer?.close();viewerServer=undefined;return viewerInfo()}
    if(!['enable','rotate'].includes(action))throw Error('Geçersiz izleme işlemi.')
    loadCanvases();viewerState.setReports(readRecoveryReports())
    if(action==='rotate'){await viewerServer?.close();viewerServer=undefined;store.set('viewerSecret',randomBytes(32).toString('hex'))}
    await ensureViewer();store.set('viewerEnabled',true)
    try{store.set('viewerOrigin',await configureViewerTailscale(viewerServer!.port));return await viewerInfo()}
    catch(e){return {...await viewerInfo(),error:(e as Error).message}}
  })
  if(store.get('viewerEnabled'))void ensureViewer().then(()=>{try{loadCanvases();viewerState.setReports(readRecoveryReports())}catch(e){log('warn',`Tablet kayıtları açılamadı: ${(e as Error).message}`)}}).catch(e=>log('warn',`Tablet izleme açılamadı: ${(e as Error).message}`))
  ipcMain.handle('canvases:save', (_e, book: CanvasBook) => {
    // The window writes the flows; the branch records belong to the tool layer, so they are
    // taken from what the tool layer last wrote instead of from the window's own copy.
    return storeWorkspace(book)
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
  // Döngü listesindeki bir öğe için: "Yolu aç" (bulunduğu klasör + seçim) ve çift tık (öğeyi aç).
  ipcMain.handle('shell:showItem', (_e, target: unknown) => {
    const p = String(target ?? '').trim()
    if (!p) return false
    shell.showItemInFolder(p)
    return true
  })
  ipcMain.handle('shell:openPath', async (_e, target: unknown) => {
    const p = String(target ?? '').trim()
    if (!p) return false
    return (await shell.openPath(p)) === ''
  })
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
  ipcMain.handle('local:models', (_e, base?: string) => listLocalModels(base))
  /**
   * Yerel Model sekmesindeki sohbet kutusu: tek mesaj, tek tur. Hangi tarafın cevap verdiği
   * hem yanıtta (target/model) hem Ajan Günlüğü'nde ([yerel]/[API] etiketiyle) açıkça yazılır;
   * VRAM yalnız gerçekten ölçülebiliyorsa raporlanır, ölçülemiyorsa uydurulmaz.
   */
  ipcMain.handle('local:chat', async (_e, payload?: { prompt?: string; target?: 'local' | 'api'; model?: string }) => {
    const s = getSettings()
    const target: 'local' | 'api' = payload?.target === 'api' ? 'api' : 'local'
    const bosCevap = (error: string) => ({ ok: false, reply: '', target, model: '', ms: 0, gpu: '', error })
    const prompt = String(payload?.prompt ?? '').trim()
    if (!prompt) return bosCevap('Mesaj boş; bir şeyler yaz.')
    const secilen = String(payload?.model ?? '').trim()
    const zincir = modelChain(s.model, s.modelBackups)
    // Yerel: verilen `local:` model ya da ayarlardaki ilk `local:` satırı (bulut adı yerele kaçmaz).
    // API: OpenRouter metin zinciri; seçilen bulut modeli başa alınır.
    const secilenYerel = /^local:/i.test(secilen) ? secilen : ''
    const denemeler = (target === 'api'
      ? (secilen && !/^local:/i.test(secilen)
        ? [secilen, ...zincir.filter((m) => !/^local:/i.test(m) && m !== secilen)]
        : zincir.filter((m) => !/^local:/i.test(m)))
      : [secilenYerel || zincir.find((m) => /^local:/i.test(m)) || '']).slice(0, 5)
    if (!denemeler.length || !denemeler[0]) {
      return target === 'api'
        ? bosCevap('OpenRouter metin modeli kayıtlı değil; Genel sekmesinden bir model seç.')
        : bosCevap('Yerel model kayıtlı değil; Yerel Model sekmesinden sunucuya bağlan ve modeli ekle.')
    }
    if (target === 'local' && !localConfigured()) return bosCevap('Yerel sunucu adresi kayıtlı değil; Yerel Model sekmesinden kur.')
    if (target === 'api' && !String(s.apiKey ?? '').trim()) return bosCevap('OpenRouter API anahtarı yok; Genel sekmesinden anahtarı kaydet.')

    const etiket = target === 'api' ? '[API]' : '[yerel]'
    const basladi = Date.now()
    let sonHata = ''
    for (const model of denemeler) {
      // Satırda modelin kullanıcıya görünen adı yazılır; yerellik zaten etikette belli.
      const gorunen = target === 'local' ? model.replace(/^local:/i, '') : model
      log('chat', `${etiket} ${gorunen} → istek gönderildi`)
      try {
        const r = await directChat({ apiKey: s.apiKey, model, prompt, allowLocal: target === 'local' })
        const gpu = await gpuInfo()
        log('chat', `${etiket} ← ${(r.ms / 1000).toFixed(2)} sn · ${r.text.length} karakter${gpu ? ` · VRAM ${gpu}` : ''}`)
        return { ok: true, reply: r.text, target: r.local ? 'local' as const : 'api' as const, model: r.model, ms: r.ms, gpu }
      } catch (e) {
        sonHata = (e as Error)?.message || String(e)
        log('warn', `${etiket} ${gorunen} ← hata: ${sonHata}`)
      }
    }
    return { ok: false, reply: '', target, model: denemeler[denemeler.length - 1] ?? '', ms: Date.now() - basladi, gpu: '', error: sonHata || 'Model cevap vermedi.' }
  })
  // Koşu öncesi denetim: verilen mutlak yollardan DİSKTE OLMAYANLARI döndürür. Hiçbir şey açmaz/yazmaz.
  ipcMain.handle('paths:missing', (_e, paths: unknown) => {
    const liste = Array.isArray(paths) ? paths : []
    return liste
      .filter((p): p is string => typeof p === 'string' && !!p.trim())
      .filter((p) => { try { return !fs.existsSync(p) } catch { return false } })
  })
  ipcMain.handle('openrouter:testVision', async () => {
    const s = getSettings()
    if (!s.apiKey && !localConfigured()) throw new Error('Görsel test için OpenRouter anahtarını veya yerel sunucu ayarlarını kaydet.')
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
    let answered = ''
    const text = await visionDescribe({ apiKey: s.apiKey, model: models, image: shot.image, onAnsweredModel: model => { answered = model } })
    return { model: answered, text }
  })
}

app.on('before-quit', (event) => {
  if (mainWindow && !mainWindow.isDestroyed() && closeGuard.ready && !closeGuard.approved) {
    event.preventDefault()
    mainWindow.close()
  }
})

app.on('will-quit', () => {
  // Bellek ölçümü kapanışta bırakılır: timer temizlenir, bekleyen ölçüm karta yazmaz.
  bellekDurumu.dur()
  void viewerServer?.close()
  globalShortcut.unregisterAll()
  bridge.shutdown()
})

app.on('window-all-closed', () => {
  destroyHud()
  bridge.shutdown()
  app.quit()
})
