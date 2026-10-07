import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { ClickMode, Locator } from './graph-types'
import type { ScanResult, ScreenItem } from './matcher'
import type { InputGuard, InputWindow, InputState, Point } from './input-policy'
import { mergeOnnxLines, onnxError, readRawShot, recognizeBgra, recognizeSideways, warmOnnx, type OcrEngine } from './ocr-onnx'

const IS_WIN = process.platform === 'win32'

function scriptDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'a11y') : path.join(app.getAppPath(), 'a11y')
}

function psArgs(script: string, extra: string[] = []): string[] {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...extra]
}

const ERROR_TEXT: Record<string, string> = {
  NO_TARGET_WINDOW: 'Hedef pencere seçilmedi.',
  WINDOW_NOT_FOUND: 'Hedef pencere bulunamadı (kapalı olabilir)',
}

function friendly(msg: string): string {
  for (const [code, text] of Object.entries(ERROR_TEXT)) {
    if (msg.startsWith(code)) return text + msg.slice(code.length)
  }
  return msg
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout; proc: ChildProcessWithoutNullStreams }

class Worker {
  private proc: ChildProcessWithoutNullStreams | null = null
  private ready: Promise<void> | null = null
  private pending = new Map<string, Pending>()
  private seq = 0
  /** Settles when the request before this one has been answered. */
  private tail: Promise<void> = Promise.resolve()

  /** Kills `proc` and forgets it, but only if it is still the current worker: a newer, healthy one stays. */
  private drop(proc: ChildProcessWithoutNullStreams) {
    if (this.proc === proc) {
      this.proc = null
      this.ready = null
    }
    try {
      proc.kill()
    } catch {
      /* already gone */
    }
  }

  private start(): Promise<void> {
    const script = path.join(scriptDir(), 'worker.ps1')
    if (!fs.existsSync(script)) return Promise.reject(new Error(`Otomasyon script’i bulunamadı: ${script}`))
    const proc = spawn('powershell.exe', psArgs(script), { windowsHide: true })
    this.proc = proc
    // A dying worker may still emit data after its replacement has started.
    // Each process owns its partial response buffer and pending requests.
    let buf = ''
    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')
    // Writing to a worker that just died raises EPIPE on stdin; the exit handler below already fails the pending requests.
    proc.stdin.on('error', () => {})

    const ready = new Promise<void>((resolve, reject) => {
      const boot = setTimeout(() => {
        reject(new Error('PowerShell otomasyon işçisi başlamadı (60 sn).'))
        // A worker that never said READY must not stay as the current one, or every later call waits on it for good.
        this.drop(proc)
      }, 60000)
      const onLine = (line: string) => {
        if (line === 'READY') {
          clearTimeout(boot)
          resolve()
          return
        }
        const tab = line.indexOf('\t')
        if (tab < 0) return
        const id = line.slice(0, tab)
        const p = this.pending.get(id)
        if (!p || p.proc !== proc) return
        this.pending.delete(id)
        clearTimeout(p.timer)
        try {
          const res = JSON.parse(Buffer.from(line.slice(tab + 1), 'base64').toString('utf8')) as {
            ok: boolean
            data?: unknown
            error?: string
          }
          if (res.ok) p.resolve(res.data ?? null)
          else p.reject(new Error(friendly(res.error || 'Bilinmeyen hata')))
        } catch {
          p.reject(new Error('Otomasyon yanıtı okunamadı.'))
        }
      }
      proc.stdout.on('data', (d: string) => {
        buf += d
        const lines = buf.split(/\r?\n/)
        buf = lines.pop() ?? ''
        for (const l of lines) if (l.trim()) onLine(l.trim())
      })
      let errText = ''
      proc.stderr.on('data', (d: string) => {
        errText = (errText + d).slice(-2000)
      })
      proc.on('error', (e) => {
        clearTimeout(boot)
        reject(new Error(`PowerShell başlatılamadı: ${e.message}`))
        this.drop(proc)
      })
      proc.on('exit', () => {
        clearTimeout(boot)
        if (this.proc === proc) {
          this.proc = null
          this.ready = null
        }
        const err = new Error(`Otomasyon işçisi kapandı. ${errText.trim().split(/\r?\n/).slice(-3).join(' ')}`.trim())
        for (const [id, p] of this.pending) {
          if (p.proc !== proc) continue
          this.pending.delete(id)
          clearTimeout(p.timer)
          p.reject(err)
        }
        reject(err)
      })
    })
    return ready
  }

  /**
   * One request at a time. The worker answers in order, so a request's time limit has to count from when it is
   * written, not from when it queued behind a long scan; otherwise a short call times out and kills a healthy worker.
   */
  async call<T>(op: string, payload: object = {}, timeoutMs = 60000): Promise<T> {
    const turn = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => (release = resolve))
    await turn
    try {
      return await this.send<T>(op, payload, timeoutMs)
    } finally {
      release()
    }
  }

  private async send<T>(op: string, payload: object, timeoutMs: number): Promise<T> {
    if (!this.proc || !this.ready) this.ready = this.start()
    await this.ready
    const proc = this.proc
    if (!proc) throw new Error('Otomasyon işçisi çalışmıyor.')
    const id = String(++this.seq)
    const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Otomasyon zaman aşımı (${op}).`))
        // Only the worker this request was sent to; a newer one that started since is left alone.
        this.drop(proc)
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer, proc })
      proc.stdin.write(`${id}\t${op}\t${b64}\n`)
    })
  }

  kill() {
    const p = this.proc
    this.proc = null
    this.ready = null
    try {
      p?.kill()
    } catch {
      /* already gone */
    }
  }
}

const worker = new Worker()

let hudHandle: () => string = () => ''

/** HWND of the on-screen status card, so a grab can hide it for that instant. */
export function setHudHandle(get: () => string) {
  hudHandle = get
}

function withHud<T extends object>(payload: T): T & { hudHwnd?: string } {
  const hudHwnd = hudHandle()
  return hudHwnd ? { ...payload, hudHwnd } : payload
}

let ocrEngine: OcrEngine = 'windows'
let valueLo = 0.15
let valueHi = 0.8

export function setOcrEngine(v: OcrEngine | undefined) {
  ocrEngine = v === 'onnx' ? 'onnx' : 'windows'
}

export function setValueRamp(lo: number, hi: number) {
  valueLo = lo
  valueHi = hi
}

/** Starts the automation worker. Resolves when it answers, or immediately off Windows. */
export function warmUp(): Promise<void> {
  if (!IS_WIN) return Promise.resolve()
  warmOnnx().catch(() => {})
  return worker.call('ping').then(
    () => undefined,
    () => undefined
  )
}

export function shutdown() {
  worker.kill()
}

const DEMO_ITEMS: ScreenItem[] = [
  { id: 1, text: 'Hunyuan Tencent', type: 'TabItem', src: 'uia', x: 120, y: 60, w: 130, h: 28 },
  { id: 2, text: 'Model Seç', type: 'Button', src: 'uia', x: 420, y: 200, w: 110, h: 30 },
  { id: 3, text: 'Modeli İndir', type: 'Button', src: 'uia', x: 420, y: 260, w: 110, h: 30 },
  { id: 4, text: 'Arama', type: 'Edit', src: 'uia', x: 700, y: 60, w: 260, h: 26 },
  { id: 5, text: 'Opera', type: 'Text', src: 'ocr', x: 40, y: 1040, w: 44, h: 16 },
]

export async function listWindows(): Promise<{ title: string; handle: string }[]> {
  if (!IS_WIN) return [{ title: 'Demo Uygulama', handle: '0' }]
  return worker.call('listWindows', { ownPid: process.pid })
}

const PLACEHOLDER_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

function readPreview(file: string, w: number, h: number, mime?: string): ScanResult['image'] {
  const data = fs.readFileSync(file).toString('base64')
  fs.unlink(file, () => {})
  return { data, w, h, mime: mime || 'image/jpeg' }
}

export async function scan(opts: {
  windowTitle?: string
  image?: 'none' | 'plain' | 'marked'
  maxImageW?: number
  /** Set false to skip UI Automation / OCR when only the screenshot is needed. */
  uia?: boolean
  ocr?: boolean
  /** Re-walk every visible window and the whole screen, without focusing the pinned target. */
  fresh?: boolean
  /** Capture only the primary monitor (when no window is pinned). */
  primary?: boolean
  /** Round the image size to a multiple of this (UI-TARS wants 28). */
  snap?: number
  /** Give a plain picture the size maxImageW / snap ask for. A plain picture is otherwise full size (scanner preview). */
  fit?: boolean
  /** Also return a tiny grayscale signature to tell whether the screen changed. */
  sig?: boolean
  /** Which reader wins. Defaults to the saved choice. */
  ocrEngine?: OcrEngine
  /** Also read a turned copy, and keep only lines the upright pass missed. The preview is already a separate copy. */
  tilt?: boolean
  /** Stop after Windows OCR and keep the raw frame so ONNX can run later, only if this pass missed. */
  deferOnnx?: boolean
  /** Developer preview: inspect the selected window without bringing it forward. */
  readOnly?: boolean
}): Promise<ScanResult & { shot?: string }> {
  if (!IS_WIN) {
    return {
      area: { x: 0, y: 0, w: 1920, h: 1080 },
      items: opts.uia === false && opts.ocr === false ? [] : DEMO_ITEMS,
      ocr: true,
      uiaCount: 4,
      ocrCount: 1,
      image: opts.image && opts.image !== 'none' ? { data: PLACEHOLDER_PNG, w: 1, h: 1, mime: 'image/png' } : null,
      window: opts.windowTitle ?? '',
    }
  }
  const r = await worker.call<ScanResult & { shot?: string }>(
    'scan',
    withHud({
      windowTitle: opts.windowTitle || '',
      image: opts.image ?? 'none',
      maxImageW: opts.maxImageW ?? 1400,
      ownPid: process.pid,
      uia: opts.uia !== false,
      ocr: opts.ocr !== false,
      fresh: opts.fresh === true,
      primary: opts.primary === true,
      snap: opts.snap ?? 0,
      fit: opts.fit === true,
      sig: opts.sig === true,
      tilt: opts.tilt === true,
      valueLo,
      valueHi,
      readOnly: opts.readOnly === true,
    }),
    180000
  )
  const items = Array.isArray(r.items) ? r.items : r.items ? [r.items as unknown as ScreenItem] : []
  let onnx = false
  let onnxAdded = 0
  let sideCount = Number(r.sideCount) || 0
  let engine: OcrEngine = 'windows'
  const shot = r.shot
  const prefer = opts.ocrEngine ?? ocrEngine
  const holdShot = opts.deferOnnx === true && typeof shot === 'string' && path.basename(shot).startsWith('xpas-onnx-')
  if (!holdShot && opts.ocr !== false && shot && typeof shot === 'string' && path.basename(shot).startsWith('xpas-onnx-')) {
    try {
      const raw = readRawShot(fs.readFileSync(shot))
      const lines = await recognizeBgra(raw.bgra, raw.w, raw.h, r.area?.x ?? 0, r.area?.y ?? 0)
      const merged = mergeOnnxLines(items, lines, prefer)
      items.splice(0, items.length, ...merged.items)
      onnxAdded = merged.added
      onnx = merged.usedOnnx && !onnxError()
      if (prefer === 'onnx' && merged.usedOnnx) {
        engine = 'onnx'
        sideCount = 0
      }
      if (opts.tilt) {
        const side = await recognizeSideways(raw.bgra, raw.w, raw.h, r.area?.x ?? 0, r.area?.y ?? 0, items)
        if (side.length) {
          items.push(...side)
          sideCount += side.length
          if (!onnxError()) onnx = true
        }
      }
    } catch {
      onnx = false
    } finally {
      fs.unlink(shot, () => {})
    }
  }
  const { shot: _shot, sideCount: _side, ...rest } = r
  void _shot
  void _side
  const carried = rest as ScanResult & { image?: { path?: string; data?: string; w?: number; h?: number; mime?: string } | null }
  let image = carried.image ?? null
  if (image?.path && fs.existsSync(image.path)) {
    image = readPreview(image.path, image.w ?? 0, image.h ?? 0, image.mime)
  }
  return { ...rest, items, image, onnx, onnxAdded, sideCount, ocrEngine: engine, shot: holdShot ? shot : undefined }
}

/** Second reader, used only after Windows OCR missed the target. The raw frame is the ramped copy, turned again for sideways text. */
export async function applyOnnx(res: ScanResult & { shot?: string }): Promise<ScanResult> {
  const shot = res.shot
  const { shot: _drop, ...base } = res
  void _drop
  if (!shot || !fs.existsSync(shot)) return base
  try {
    const raw = readRawShot(fs.readFileSync(shot))
    const originX = res.area?.x ?? 0
    const originY = res.area?.y ?? 0
    const lines = await recognizeBgra(raw.bgra, raw.w, raw.h, originX, originY)
    // This is a fallback reader: keep unrelated, valid Windows OCR lines.
    // Explicit ONNX-only scans still use their selected engine above.
    const merged = mergeOnnxLines(res.items, lines, 'windows')
    const items = merged.items.slice()
    let sideCount = 0
    const side = await recognizeSideways(raw.bgra, raw.w, raw.h, originX, originY, items)
    if (side.length) {
      items.push(...side)
      sideCount = side.length
    }
    return {
      ...base,
      items,
      onnx: (merged.usedOnnx || sideCount > 0) && !onnxError(),
      onnxAdded: merged.added + sideCount,
      sideCount,
      ocrEngine: merged.usedOnnx ? 'onnx' : base.ocrEngine,
    }
  } finally {
    fs.unlink(shot, () => {})
  }
}

export function discardShot(shot?: string) {
  if (shot) fs.unlink(shot, () => {})
}

export async function crop(rect: { x: number; y: number; w: number; h: number }, maxW = 800, fit = false, snap = 0): Promise<{
  area: { x: number; y: number; w: number; h: number }
  image: { data: string; w: number; h: number; mime?: string }
}> {
  if (!IS_WIN) return { area: rect, image: { data: PLACEHOLDER_PNG, w: 1, h: 1, mime: 'image/png' } }
  const got = await worker.call<{ area: { x: number; y: number; w: number; h: number }; image: { path?: string; data?: string; w: number; h: number; mime?: string } }>('crop', withHud({ ...rect, maxW, fit, snap }))
  if (got.image?.path && fs.existsSync(got.image.path)) got.image = readPreview(got.image.path, got.image.w, got.image.h, got.image.mime) ?? got.image
  return got as { area: { x: number; y: number; w: number; h: number }; image: { data: string; w: number; h: number; mime?: string } }
}

export async function clickAt(x: number, y: number, button: ClickMode = 'left', target?: InputWindow): Promise<void> {
  if (!IS_WIN) return
  await worker.call('clickAt', { x: Math.round(x), y: Math.round(y), button, target })
}
/**
 * Fareyi bir noktaya taşır — TIKLAMAZ. İnisiyatif ajanı önce konumlanıp emin olabilsin,
 * sonra "oradan tıkla" diyebilsin diye vardır. Örtülme kontrolü clickAt ile aynıdır.
 */
export async function moveMouse(x: number, y: number, target?: InputWindow): Promise<{ hwnd?: number }> {
  if (!IS_WIN) return {}
  const r = await worker.call<{ hwnd?: number }>('moveAt', { x: Math.round(x), y: Math.round(y), target })
  return r && typeof r === 'object' ? r : {}
}

/**
 * GERÇEK imleç konumu (bellekteki tahmin değil). "Oradan tıkla" buna bakar; okunamazsa
 * `undefined` döner ve çağıran TIKLAMAZ.
 */
export async function cursorPos(): Promise<{ x: number; y: number } | undefined> {
  if (!IS_WIN) return undefined
  try {
    const r = await worker.call<{ x: number; y: number }>('cursorPos', {})
    return r && Number.isFinite(r.x) && Number.isFinite(r.y) ? { x: r.x, y: r.y } : undefined
  } catch {
    return undefined
  }
}

/**
 * Fare konumundan tıklama. `hwnd`, TAŞIMA anındaki penceredir; worker arada pencere
 * değiştiyse ya da nokta başka pencereyle örtüldüyse TIKLAMAZ (açık hata verir).
 */
export async function clickCurrentAt(x: number, y: number, hwnd?: number, target?: InputWindow): Promise<void> {
  if (!IS_WIN) return
  await worker.call('clickCurrentAt', { x: Math.round(x), y: Math.round(y), hwnd, target })
}

export async function locate(
  locator: Locator,
  windowTitle: string,
  readOnly = false
): Promise<{ x: number; y: number; w: number; h: number; name: string; enabled?: boolean } | null> {
  if (!IS_WIN) return null
  return worker.call('locate', { locator, windowTitle, readOnly }, 30000)
}

export async function windowRect(windowTitle: string): Promise<{ x: number; y: number; w: number; h: number }> {
  if (!IS_WIN) return { x: 0, y: 0, w: 1920, h: 1080 }
  return worker.call('windowRect', { windowTitle })
}

export type TypeFieldChoice = {
  id: number
  /** Opaque identity retained by the worker while the model chooses. */
  token: string
  window: string
  /** What UIA reports. Classic Win32 forms report every control as a Pane. */
  type: string
  /** The control's own window class (Edit, RichEdit…), empty when it has none. */
  native?: string
  /** For classic edit boxes UIA puts the typed text here, so it is not a caption. */
  name: string
  value: string
  /** False when the text could not be read; unknown is not the same as empty. */
  valueKnown?: boolean
  /** The caption on this field's row, if any. */
  label?: string
  clicked: boolean
  /** The caption the previous click landed on belongs to this field. */
  related?: boolean
}

export type TypeResult = {
  cleared: boolean
  skippedClear: boolean
  focusHwnd?: string
  writeSent?: boolean
  code?: string
  diagnostics?: InputState
  pasted: boolean
  focusType: string
  rescued?: boolean
  where?: string
  via?: string
  needChoice?: boolean
  choices?: TypeFieldChoice[]
  /** Read from the field actually written, before a submit can move focus. */
  value?: string | null
}

export async function typeText(
  text: string,
  pressEnter: boolean,
  clearFirst: boolean,
  at?: { x: number; y: number },
  fieldToken?: string,
  guard?: InputGuard
): Promise<TypeResult | null> {
  if (!IS_WIN) return null
  if (!text && !pressEnter && !clearFirst) return null
  // Text is sent character by character with a gap, so a long text needs more room than
  // the bridge default; otherwise a healthy worker is killed halfway through a write.
  const budgetMs = Math.min(300000, 15000 + text.length * 60)
  return worker.call<TypeResult>('typeText', {
    text,
    pressEnter,
    clearFirst,
    x: at ? Math.round(at.x) : 0,
    y: at ? Math.round(at.y) : 0,
    ownPid: process.pid,
    fieldToken: fieldToken ?? '',
    guard,
  }, budgetMs)
}

export async function inputState(): Promise<InputState | null> {
  if (!IS_WIN) return null
  return worker.call('inputState', {}, 10000)
}

export async function inputTarget(opts: { target?: InputWindow; windowTitle?: string; at?: Point; followOwnedDialog?: boolean } = {}): Promise<InputWindow | null> {
  if (!IS_WIN) return null
  return worker.call('inputTarget', { ...opts, ownPid: process.pid }, 10000)
}

export async function assertInputTarget(target: InputWindow, focusHwnd?: string): Promise<void> {
  if (!IS_WIN) return
  await worker.call('assertInputTarget', { target, focusHwnd }, 10000)
}

/** Lock screen or secure desktop is up: nothing can be seen or clicked. */
export async function isLocked(): Promise<boolean> {
  if (!IS_WIN) return false
  try {
    return !!(await worker.call<boolean>('locked', {}, 10000))
  } catch {
    return false
  }
}

export async function ocrInfo(): Promise<{ ok: boolean; main: string; extra: string[]; available: string[] } | null> {
  if (!IS_WIN) return null
  try {
    return await worker.call('ocrInfo', {}, 30000)
  } catch {
    return null
  }
}

/** Small picture around a screen point (for checking a replayed click lands on the same thing). */
export async function patchAt(x: number, y: number, size = 64): Promise<{ data: string; w: number; h: number } | null> {
  if (!IS_WIN) return null
  try {
    return await worker.call('patch', withHud({ x: Math.round(x), y: Math.round(y), size }), 15000)
  } catch {
    return null
  }
}

export async function sendKeys(keys: string, windowTitle?: string, target?: InputWindow, focusHwnd?: string): Promise<void> {
  if (!IS_WIN) return
  await worker.call('keys', { keys, windowTitle: windowTitle || '', target, focusHwnd })
}

/** The element under a scanner box, with a picture of the box. */
export async function pickAt(box: { x: number; y: number; w: number; h: number }): Promise<Locator | null> {
  if (!IS_WIN) return null
  return worker.call('pick', withHud({ x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) }), 30000)
}

/** Where a saved icon picture is on screen now (score 0–1). */
export async function findImage(
  icon: string,
  windowTitle?: string,
  region?: { x: number; y: number; w: number; h: number }
): Promise<{ x: number; y: number; score: number; window: string } | null> {
  if (!IS_WIN) return null
  return worker.call('findImage', withHud({ icon, windowTitle: windowTitle || '', region: region ?? null }), 30000)
}

export async function drag(x1: number, y1: number, x2: number, y2: number): Promise<void> {
  if (!IS_WIN) return
  await worker.call('drag', { x1: Math.round(x1), y1: Math.round(y1), x2: Math.round(x2), y2: Math.round(y2) })
}

export async function scroll(x: number, y: number, direction: 'up' | 'down' | 'left' | 'right', clicks = 5): Promise<void> {
  if (!IS_WIN) return
  await worker.call('scroll', { x: Math.round(x), y: Math.round(y), direction, clicks })
}

/** Real key combination (keybd_event), e.g. ['ctrl','shift','a'] or ['win']. */
export async function hotkey(keys: string[]): Promise<void> {
  if (!IS_WIN) return
  await worker.call('hotkey', { keys })
}

export async function foreground(): Promise<{ title: string; pid: number; proc?: string; hwnd?: string } | null> {
  if (!IS_WIN) return null
  try {
    return await worker.call('foreground', {}, 10000)
  } catch {
    return null
  }
}

/** What the focused field holds, or null when it does not expose a value. */
export async function focusedValue(): Promise<string | null> {
  if (!IS_WIN) return null
  try {
    const r = await worker.call<{ value: string } | null>('focusedValue', {}, 10000)
    return r ? r.value : null
  } catch {
    return null
  }
}

export async function captureAtCursor(): Promise<Locator | null> {
  if (!IS_WIN) {
    return { name: 'Model Seç', text: 'Model Seç', controlType: 'Button', path: '0/1', windowTitle: 'Demo Uygulama', x: 475, y: 215 }
  }
  return worker.call('capture', withHud({}))
}
