import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

export type A11yNode = {
  id: string
  name: string
  controlType: string
  automationId?: string
  path: string
  children?: A11yNode[]
}

function a11yScriptDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'a11y')
  }
  return path.join(app.getAppPath(), 'a11y')
}

function runPowershell(scriptName: string, args: string[]): Promise<string> {
  const script = path.join(a11yScriptDir(), scriptName)
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error('WIN32_ONLY'))
      return
    }
    if (!fs.existsSync(script)) {
      reject(new Error(`Script bulunamadı: ${script}`))
      return
    }
    const ps = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        ...args,
      ],
      { windowsHide: true }
    )
    let out = ''
    let err = ''
    ps.stdout.on('data', (d) => {
      out += d.toString()
    })
    ps.stderr.on('data', (d) => {
      err += d.toString()
    })
    ps.on('close', (code) => {
      if (code !== 0) reject(new Error(err || `PowerShell exit ${code}`))
      else resolve(out.trim())
    })
  })
}

function demoTree(windowTitle?: string): A11yNode {
  const title = windowTitle || 'Demo Uygulama'
  return {
    id: 'root',
    name: title,
    controlType: 'Window',
    path: '0',
    children: [
      {
        id: 'n1',
        name: 'Hunyuan Tencent',
        controlType: 'TabItem',
        automationId: 'tab-hunyuan',
        path: '0/0',
        children: [],
      },
      {
        id: 'n2',
        name: 'Model Seç',
        controlType: 'Button',
        automationId: 'btn-model',
        path: '0/1',
        children: [],
      },
      {
        id: 'n3',
        name: 'Modeli İndir',
        controlType: 'Button',
        automationId: 'btn-download',
        path: '0/2',
        children: [],
      },
      {
        id: 'n4',
        name: 'Ayarlar',
        controlType: 'MenuItem',
        path: '0/3',
        children: [
          {
            id: 'n4a',
            name: 'API Anahtarı',
            controlType: 'Edit',
            path: '0/3/0',
          },
        ],
      },
    ],
  }
}

export async function listWindows(): Promise<{ title: string; handle: string }[]> {
  try {
    const raw = await runPowershell('list-windows.ps1', [])
    return JSON.parse(raw) as { title: string; handle: string }[]
  } catch (e) {
    if (String(e).includes('WIN32_ONLY')) {
      return [
        { title: 'Demo Uygulama', handle: '0' },
        { title: 'Notepad', handle: '1' },
        { title: 'Chrome', handle: '2' },
      ]
    }
    throw e
  }
}

export async function captureAccessibilityTree(opts: {
  windowTitle?: string
  maxDepth?: number
}): Promise<A11yNode> {
  try {
    const raw = await runPowershell('capture-tree.ps1', [
      '-WindowTitle',
      opts.windowTitle || '',
      '-MaxDepth',
      String(opts.maxDepth ?? 8),
    ])
    return JSON.parse(raw) as A11yNode
  } catch (e) {
    if (String(e).includes('WIN32_ONLY')) {
      return demoTree(opts.windowTitle)
    }
    throw e
  }
}

export async function getElementAtPoint(): Promise<A11yNode | null> {
  try {
    const raw = await runPowershell('element-at-cursor.ps1', [])
    if (!raw) return null
    return JSON.parse(raw) as A11yNode
  } catch (e) {
    if (String(e).includes('WIN32_ONLY')) {
      return {
        id: 'demo-click',
        name: 'Hunyuan Tencent',
        controlType: 'TabItem',
        automationId: 'tab-hunyuan',
        path: '0/0',
      }
    }
    throw e
  }
}

export async function clickElementByPath(
  elementPath: string,
  windowTitle?: string
): Promise<void> {
  try {
    await runPowershell('click-path.ps1', [
      '-ElementPath',
      elementPath,
      '-WindowTitle',
      windowTitle || '',
    ])
  } catch (e) {
    if (String(e).includes('WIN32_ONLY')) {
      // demo: no-op success
      return
    }
    throw e
  }
}
