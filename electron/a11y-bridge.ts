import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { ClickMode, Locator } from './graph-types'
import type { ScanResult, ScreenItem } from './matcher'
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

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }

class Worker {
  private proc: ChildProcessWithoutNullStreams | null = null
  private ready: Promise<void> | null = null
  private pending = new Map<string, Pending>()
  private seq = 0
  private buf = ''

  private start(): Promise<void> {
    const script = path.join(scriptDir(), 'worker.ps1')
    if (!fs.existsSync(script)) return Promise.reject(new Error(`Otomasyon script’i bulunamadı: ${script}`))
    const proc = spawn('powershell.exe', psArgs(script), { windowsHide: true })
    this.proc = proc
    this.buf = ''
    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')

    const ready = new Promise<void>((resolve, reject) => {
      const boot = setTimeout(() => reject(new Error('PowerShell otomasyon işçisi başlamadı (60 sn).')), 60000)
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
        if (!p) return
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
        this.buf += d
        const lines = this.buf.split(/\r?\n/)
        this.buf = lines.pop() ?? ''
        for (const l of lines) if (l.trim()) onLine(l.trim())
      })
      let errText = ''
      proc.stderr.on('data', (d: string) => {
        errText = (errText + d).slice(-2000)
      })
      proc.on('error', (e) => {
        clearTimeout(boot)
        reject(new Error(`PowerShell başlatılamadı: ${e.message}`))
      })
      proc.on('exit', () => {
        clearTimeout(boot)
        if (this.proc === proc) {
          this.proc = null
          this.ready = null
        }
        const err = new Error(`Otomasyon işçisi kapandı. ${errText.trim().split(/\r?\n/).slice(-3).join(' ')}`.trim())
        for (const p of this.pending.values()) {
          clearTimeout(p.timer)
          p.reject(err)
        }
        this.pending.clear()
        reject(err)
      })
    })
    return ready
  }

  async call<T>(op: string, payload: object = {}, timeoutMs = 60000): Promise<T> {
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
        this.kill()
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
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

let ocrEngine: OcrEngine = 'windows'

export function setOcrEngine(v: OcrEngine | undefined) {
  ocrEngine = v === 'onnx' ? 'onnx' : 'windows'
}

export function warmUp() {
  if (!IS_WIN) return
  worker.call('ping').catch(() => {})
  warmOnnx().catch(() => {})
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
  /** Also return a tiny grayscale signature to tell whether the screen changed. */
  sig?: boolean
  /** Which reader wins. Defaults to the saved choice. */
  ocrEngine?: OcrEngine
  /** Also read the shot turned 90° counter-clockwise, and keep only lines the upright pass missed. */
  tilt?: boolean
}): Promise<ScanResult> {
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
    {
      windowTitle: opts.windowTitle || '',
      image: opts.image ?? 'none',
      maxImageW: opts.maxImageW ?? 1400,
      ownPid: process.pid,
      uia: opts.uia !== false,
      ocr: opts.ocr !== false,
      fresh: opts.fresh === true,
      primary: opts.primary === true,
      snap: opts.snap ?? 0,
      sig: opts.sig === true,
      tilt: opts.tilt === true,
    },
    90000
  )
  const items = Array.isArray(r.items) ? r.items : r.items ? [r.items as unknown as ScreenItem] : []
  let onnx = false
  let onnxAdded = 0
  let sideCount = Number(r.sideCount) || 0
  let engine: OcrEngine = 'windows'
  const shot = r.shot
  const prefer = opts.ocrEngine ?? ocrEngine
  if (opts.ocr !== false && shot && typeof shot === 'string' && path.basename(shot).startsWith('xpas-onnx-')) {
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
  return { ...rest, items, onnx, onnxAdded, sideCount, ocrEngine: engine }
}

export async function crop(rect: { x: number; y: number; w: number; h: number }, maxW = 800): Promise<{
  area: { x: number; y: number; w: number; h: number }
  image: { data: string; w: number; h: number; mime?: string }
}> {
  if (!IS_WIN) return { area: rect, image: { data: PLACEHOLDER_PNG, w: 1, h: 1, mime: 'image/png' } }
  return worker.call('crop', { ...rect, maxW })
}

export async function clickAt(x: number, y: number, button: ClickMode = 'left'): Promise<void> {
  if (!IS_WIN) return
  await worker.call('clickAt', { x: Math.round(x), y: Math.round(y), button })
}

export async function locate(
  locator: Locator,
  windowTitle: string
): Promise<{ x: number; y: number; w: number; h: number; name: string; enabled?: boolean } | null> {
  if (!IS_WIN) return null
  return worker.call('locate', { locator, windowTitle }, 30000)
}

export async function windowRect(windowTitle: string): Promise<{ x: number; y: number; w: number; h: number }> {
  if (!IS_WIN) return { x: 0, y: 0, w: 1920, h: 1080 }
  return worker.call('windowRect', { windowTitle })
}

export type TypeResult = { cleared: boolean; skippedClear: boolean; pasted: boolean; focusType: string }

export async function typeText(text: string, pressEnter: boolean, clearFirst: boolean): Promise<TypeResult | null> {
  if (!IS_WIN) return null
  if (!text && !pressEnter && !clearFirst) return null
  return worker.call<TypeResult>('typeText', { text, pressEnter, clearFirst })
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
    return await worker.call('patch', { x: Math.round(x), y: Math.round(y), size }, 15000)
  } catch {
    return null
  }
}

export async function sendKeys(keys: string, windowTitle?: string): Promise<void> {
  if (!IS_WIN) return
  await worker.call('keys', { keys, windowTitle: windowTitle || '' })
}

/** The element under a scanner box, with a picture of the box. */
export async function pickAt(box: { x: number; y: number; w: number; h: number }): Promise<Locator | null> {
  if (!IS_WIN) return null
  return worker.call('pick', { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) }, 30000)
}

/** Where a saved icon picture is on screen now (score 0–1). */
export async function findImage(
  icon: string,
  windowTitle?: string,
  region?: { x: number; y: number; w: number; h: number }
): Promise<{ x: number; y: number; score: number; window: string } | null> {
  if (!IS_WIN) return null
  return worker.call('findImage', { icon, windowTitle: windowTitle || '', region: region ?? null }, 30000)
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

export async function foreground(): Promise<{ title: string; pid: number; proc?: string } | null> {
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
  return worker.call('capture', {})
}
