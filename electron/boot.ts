import { app, BrowserWindow, dialog } from 'electron'
import fs from 'fs'
import path from 'path'
import { profileDirName } from './profile'

// Keep the existing profile folder before any store is opened. NUBBO_PROFILE puts an instance on
// its own folder (flows, logs and endpoint token included), so a test instance can never touch
// the flows of the one the person is working in.
app.setPath('userData', path.join(app.getPath('appData'), profileDirName(process.env.NUBBO_PROFILE)))

let splash: BrowserWindow | null = null
let pageReady = false
let pending = { pct: 28, line: 'Süreç açılıyor…' }

function bootHtml() {
  return path.join(__dirname, '../resources/boot/index.html')
}

function appVersion(): string {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')
    const version = String(JSON.parse(raw).version ?? '')
    return version
  } catch {
    return ''
  }
}

function paint() {
  if (!pageReady || !splash || splash.isDestroyed()) return
  const { pct, line } = pending
  const ver = appVersion()
  splash.webContents
    .executeJavaScript(
      `window.boot&&window.boot(${Math.round(pct)}, ${JSON.stringify(line)});window.bootVer&&window.bootVer(${JSON.stringify(ver)})`
    )
    .catch(() => {})
}

function report(pct: number, line: string) {
  pending = { pct, line }
  paint()
}

function openSplash(): Promise<void> {
  splash = new BrowserWindow({
    width: 440,
    height: 512,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    center: true,
    alwaysOnTop: true,
    backgroundColor: '#3a6ea5',
    icon: path.join(__dirname, '../resources/icon.png'),
    title: 'Nubbo Agent Studio',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  splash.setMenuBarVisibility(false)
  splash.once('ready-to-show', () => {
    if (!splash || splash.isDestroyed()) return
    splash.show()
    splash.focus()
  })
  splash.webContents.on('did-finish-load', () => {
    pageReady = true
    paint()
  })
  return splash.loadFile(bootHtml())
}

function closeSplash() {
  const w = splash
  splash = null
  pageReady = false
  if (!w || w.isDestroyed()) return
  w.destroy()
}

app.whenReady().then(async () => {
  try {
    await openSplash()
    report(28, 'Süreç açılıyor…')
    report(42, 'Ana program yükleniyor…')
    const { startApp } = await import('./main')
    await startApp(report, closeSplash)
  } catch (e) {
    dialog.showErrorBox('Nubbo açılmadı', (e as Error).message || String(e))
    app.quit()
  }
})
