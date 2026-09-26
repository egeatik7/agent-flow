import { runGraph, StoppedError, type Executor } from '../../electron/runner'
import type { A11yNode, AgentGraph, AppSettings, Locator, LogLevel, StepStatus } from '../types'

export const DEMO_TREE: A11yNode = {
  id: '0',
  name: 'Demo Uygulama',
  controlType: 'Window',
  path: '0',
  children: [
    {
      id: '0/0',
      name: 'Üst menü',
      controlType: 'ToolBar',
      path: '0/0',
      children: [
        { id: '0/0/0', name: 'Hunyuan Tencent', controlType: 'TabItem', automationId: 'tab-hunyuan', path: '0/0/0' },
        { id: '0/0/1', name: 'Ayarlar', controlType: 'MenuItem', path: '0/0/1' },
      ],
    },
    { id: '0/1', name: 'Model Seç', controlType: 'Button', automationId: 'btn-model', path: '0/1' },
    { id: '0/2', name: 'Modeli İndir', controlType: 'Button', automationId: 'btn-download', path: '0/2' },
    { id: '0/3', name: 'Arama', controlType: 'Edit', automationId: 'search', path: '0/3' },
  ],
}

export const DEMO_CAPTURE: Locator = {
  name: 'Model Seç',
  controlType: 'Button',
  automationId: 'btn-model',
  path: '0/1',
  windowTitle: 'Demo Uygulama',
}

let demoStop = false

export function stopDemo() {
  demoStop = true
}

const pause = (ms: number) =>
  new Promise<void>((resolve, reject) => {
    const end = Date.now() + ms
    const tick = () => {
      if (demoStop) reject(new StoppedError())
      else if (Date.now() >= end) resolve()
      else setTimeout(tick, 50)
    }
    tick()
  })

export async function runDemo(
  graph: AgentGraph,
  settings: AppSettings,
  log: (l: LogLevel, m: string) => void,
  step: (id: string, s: StepStatus) => void,
  startId?: string
) {
  demoStop = false
  const ex: Executor = {
    log,
    step,
    shouldStop: () => demoStop,
    click: async (n) => {
      await pause(350)
      log('info', `(demo) tıklandı: ${n.locator?.name ?? n.prompt ?? n.title}`)
    },
    type: async (n) => {
      await pause(350)
      log('info', `(demo) yazıldı: “${n.text ?? ''}”`)
    },
    key: async (n) => {
      await pause(200)
      log('info', `(demo) tuş: ${n.keys}`)
    },
    exists: async () => {
      await pause(250)
      return Math.random() > 0.3
    },
  }
  try {
    await runGraph(graph, ex, {
      maxSteps: settings.maxSteps,
      stepDelayMs: Math.min(settings.stepDelayMs, 300),
      startId,
    })
  } catch (e) {
    if (e instanceof StoppedError) log('warn', 'Ajan durduruldu.')
    else throw e
  }
}
