import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { A11yNode, Locator } from './graph-types'

const IS_WIN = process.platform === 'win32'

function scriptDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'a11y')
    : path.join(app.getAppPath(), 'a11y')
}

function psArgs(script: string, extra: string[]): string[] {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...extra]
}

const ERROR_TEXT: Record<string, string> = {
  NO_TARGET_WINDOW: 'Hedef pencere seçilmedi. Ayarlar > Hedef pencere.',
  WINDOW_NOT_FOUND: 'Hedef pencere bulunamadı (kapalı olabilir)',
  ELEMENT_NOT_FOUND: 'Öğe hedef pencerede bulunamadı',
  ELEMENT_NOT_CLICKABLE: 'Öğe görünür değil ve tıklanamıyor.',
}

function friendly(msg: string): string {
  for (const [code, text] of Object.entries(ERROR_TEXT)) {
    if (msg.startsWith(code)) return text + msg.slice(code.length)
  }
  return msg
}

function runUia<T>(op: string, payload: object, timeoutMs = 45000): Promise<T> {
  const script = path.join(scriptDir(), 'uia.ps1')
  if (!fs.existsSync(script)) {
    return Promise.reject(new Error(`UI Automation script bulunamadı: ${script}`))
  }
  const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', psArgs(script, ['-Op', op, '-Payload', b64]), {
      windowsHide: true,
    })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      ps.kill()
      reject(new Error(`UI Automation zaman aşımı (${op})`))
    }, timeoutMs)
    ps.stdout.setEncoding('utf8')
    ps.stderr.setEncoding('utf8')
    ps.stdout.on('data', (d: string) => (out += d))
    ps.stderr.on('data', (d: string) => (err += d))
    ps.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`PowerShell başlatılamadı: ${e.message}`))
    })
    ps.on('close', () => {
      clearTimeout(timer)
      const line = out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith('{'))
        .pop()
      if (!line) {
        reject(new Error(friendly(err.trim() || `UI Automation yanıt vermedi (${op})`)))
        return
      }
      try {
        const res = JSON.parse(line) as { ok: boolean; data?: T; error?: string }
        if (res.ok) resolve(res.data as T)
        else reject(new Error(friendly(res.error || 'Bilinmeyen hata')))
      } catch {
        reject(new Error(`UI Automation çıktısı okunamadı: ${line.slice(0, 200)}`))
      }
    })
  })
}

const DEMO_TREE: A11yNode = {
  id: '0',
  name: 'Demo Uygulama',
  controlType: 'Window',
  path: '0',
  children: [
    { id: '0/0', name: 'Hunyuan Tencent', controlType: 'TabItem', automationId: 'tab-hunyuan', path: '0/0' },
    { id: '0/1', name: 'Model Seç', controlType: 'Button', automationId: 'btn-model', path: '0/1' },
    { id: '0/2', name: 'Modeli İndir', controlType: 'Button', automationId: 'btn-download', path: '0/2' },
    { id: '0/3', name: 'Arama', controlType: 'Edit', automationId: 'search', path: '0/3' },
  ],
}

export async function listWindows(): Promise<{ title: string; handle: string }[]> {
  if (!IS_WIN) return [{ title: 'Demo Uygulama', handle: '0' }]
  return runUia('listWindows', { ownPid: process.pid })
}

export async function captureTree(windowTitle: string, maxDepth: number): Promise<A11yNode> {
  if (!IS_WIN) return { ...DEMO_TREE, name: windowTitle || DEMO_TREE.name }
  return runUia('tree', { windowTitle, maxDepth })
}

export async function clickLocator(locator: Locator, windowTitle: string): Promise<{ method: string }> {
  if (!IS_WIN) return { method: 'demo' }
  return runUia('click', { locator, windowTitle })
}

export async function typeInto(
  locator: Locator,
  windowTitle: string,
  text: string,
  pressEnter: boolean
): Promise<void> {
  if (!IS_WIN) return
  await runUia('type', { locator, windowTitle, text, pressEnter })
}

export async function sendKeys(keys: string, windowTitle: string): Promise<void> {
  if (!IS_WIN) return
  await runUia('keys', { keys, windowTitle })
}

export async function elementExists(text: string, windowTitle: string): Promise<boolean> {
  if (!IS_WIN) return true
  const r = await runUia<{ found: boolean }>('exists', { text, windowTitle })
  return !!r?.found
}

export async function captureAtCursor(): Promise<Locator | null> {
  if (!IS_WIN) {
    return { name: 'Model Seç', controlType: 'Button', automationId: 'btn-model', path: '0/1', windowTitle: 'Demo Uygulama' }
  }
  return runUia('capture', {})
}

export type Recorder = { stop: () => void }

export function startRecorder(
  onClick: (loc: Locator) => void,
  onError: (msg: string) => void
): Recorder {
  if (!IS_WIN) return { stop: () => {} }
  const script = path.join(scriptDir(), 'record.ps1')
  const ps: ChildProcess = spawn('powershell.exe', psArgs(script, ['-OwnPid', String(process.pid)]), {
    windowsHide: true,
  })
  let buf = ''
  ps.stdout?.setEncoding('utf8')
  ps.stdout?.on('data', (d: string) => {
    buf += d
    const lines = buf.split(/\r?\n/)
    buf = lines.pop() ?? ''
    for (const raw of lines) {
      const line = raw.trim()
      if (!line.startsWith('{')) continue
      try {
        const obj = JSON.parse(line)
        if (obj.ready) continue
        onClick(obj as Locator)
      } catch {
        /* partial line */
      }
    }
  })
  ps.stderr?.setEncoding('utf8')
  ps.stderr?.on('data', (d: string) => {
    const msg = d.trim()
    if (msg) onError(msg.slice(0, 300))
  })
  ps.on('error', (e) => onError(`Kaydedici başlatılamadı: ${e.message}`))
  return {
    stop: () => {
      try {
        ps.kill()
      } catch {
        /* already gone */
      }
    },
  }
}
