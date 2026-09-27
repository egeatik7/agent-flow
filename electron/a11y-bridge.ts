import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { ClickMode, Locator } from './graph-types'
import type { ScanResult, ScreenItem } from './matcher'

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

export function warmUp() {
  if (!IS_WIN) return
  worker.call('ping').catch(() => {})
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
  const r = await worker.call<ScanResult>(
    'scan',
    {
      windowTitle: opts.windowTitle || '',
      image: opts.image ?? 'none',
      maxImageW: opts.maxImageW ?? 1400,
      ownPid: process.pid,
      uia: opts.uia !== false,
      ocr: opts.ocr !== false,
      fresh: opts.fresh === true,
    },
    90000
  )
  return { ...r, items: Array.isArray(r.items) ? r.items : r.items ? [r.items as unknown as ScreenItem] : [] }
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
): Promise<{ x: number; y: number; w: number; h: number; name: string } | null> {
  if (!IS_WIN) return null
  return worker.call('locate', { locator, windowTitle }, 30000)
}

export async function windowRect(windowTitle: string): Promise<{ x: number; y: number; w: number; h: number }> {
  if (!IS_WIN) return { x: 0, y: 0, w: 1920, h: 1080 }
  return worker.call('windowRect', { windowTitle })
}

export async function typeText(text: string, pressEnter: boolean, clearFirst: boolean): Promise<void> {
  if (!IS_WIN) return
  await worker.call('typeText', { text, pressEnter, clearFirst })
}

export async function sendKeys(keys: string, windowTitle?: string): Promise<void> {
  if (!IS_WIN) return
  await worker.call('keys', { keys, windowTitle: windowTitle || '' })
}

export async function captureAtCursor(): Promise<Locator | null> {
  if (!IS_WIN) {
    return { name: 'Model Seç', text: 'Model Seç', controlType: 'Button', path: '0/1', windowTitle: 'Demo Uygulama', x: 475, y: 215 }
  }
  return worker.call('capture', {})
}
