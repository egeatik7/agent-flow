import { runGraph, StoppedError, type Executor } from '../../electron/runner'
import { containsText, extractTarget, matchFuzzy, matchPrompt, matchText } from '../../electron/matcher'
import type { AgentGraph, AgentNode, AppSettings, Locator, LogLevel, ScanResult, ScreenItem, StepStatus } from '../types'

const W = 1920
const H = 1080

const ITEMS: ScreenItem[] = [
  { id: 1, text: 'Dosya', type: 'MenuItem', src: 'uia', x: 12, y: 40, w: 48, h: 22 },
  { id: 2, text: 'Düzen', type: 'MenuItem', src: 'uia', x: 66, y: 40, w: 52, h: 22 },
  { id: 3, text: 'Hunyuan Tencent', type: 'TabItem', src: 'uia', x: 140, y: 84, w: 170, h: 34 },
  { id: 4, text: 'Qwen', type: 'TabItem', src: 'uia', x: 316, y: 84, w: 90, h: 34 },
  { id: 5, text: 'Ara...', type: 'Edit', src: 'uia', x: 1380, y: 88, w: 380, h: 28 },
  { id: 6, text: 'Model Seç', type: 'Button', src: 'uia', x: 160, y: 190, w: 150, h: 36 },
  { id: 7, text: 'Hunyuan-7B-Instruct', type: 'Text', src: 'ocr', x: 180, y: 262, w: 210, h: 18 },
  { id: 8, text: 'Hunyuan-Large', type: 'Text', src: 'ocr', x: 180, y: 302, w: 150, h: 18 },
  { id: 9, text: 'Modeli İndir', type: 'Button', src: 'uia', x: 160, y: 360, w: 150, h: 36 },
  { id: 10, text: 'İndirme tamamlandı', type: 'Text', src: 'ocr', x: 330, y: 369, w: 190, h: 18 },
  { id: 11, text: 'Opera', type: 'Button', src: 'uia', x: 250, y: 1044, w: 40, h: 34 },
  { id: 12, text: 'Chrome', type: 'Button', src: 'uia', x: 300, y: 1044, w: 40, h: 34 },
  { id: 13, text: '20:04', type: 'Text', src: 'ocr', x: 1840, y: 1052, w: 44, h: 16 },
]

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
}

function demoSvg(): string {
  const boxes = ITEMS.map((i) => {
    const btn = i.type === 'Button' || i.type === 'TabItem' || i.type === 'MenuItem' || i.type === 'Edit'
    const fill = i.type === 'Edit' ? '#fff' : btn ? '#e8eefc' : 'none'
    const stroke = btn ? '#6b8fd6' : 'none'
    return `<rect x="${i.x}" y="${i.y}" width="${i.w}" height="${i.h}" rx="4" fill="${fill}" stroke="${stroke}"/><text x="${i.x + 8}" y="${i.y + i.h / 2 + 6}" font-family="Tahoma, Geneva, Verdana" font-size="16" fill="${i.type === 'Edit' ? '#888' : '#1b2a44'}">${esc(i.text)}</text>`
  }).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#2b5797"/>
<rect x="0" y="30" width="${W}" height="1000" fill="#f3f4f7"/>
<rect x="0" y="0" width="${W}" height="30" fill="#1f1f1f"/><text x="12" y="21" font-family="Tahoma, Geneva, Verdana" font-size="14" fill="#ddd">Model Hub — Demo Uygulama</text>
<rect x="0" y="1030" width="${W}" height="50" fill="#202020"/>
<rect x="140" y="170" width="620" height="260" rx="6" fill="#fff" stroke="#d0d4dc"/>
${boxes}</svg>`
  return btoa(unescape(encodeURIComponent(svg)))
}

export function demoScan(): ScanResult {
  return {
    area: { x: 0, y: 0, w: W, h: H },
    items: ITEMS,
    ocr: true,
    uiaCount: ITEMS.filter((i) => i.src === 'uia').length,
    ocrCount: ITEMS.filter((i) => i.src === 'ocr').length,
    image: { data: demoSvg(), w: W, h: H, mime: 'image/svg+xml' },
    window: '',
  }
}

export const DEMO_CAPTURE: Locator = {
  name: 'Model Seç',
  text: 'Model Seç',
  controlType: 'Button',
  path: '0/1',
  windowTitle: 'Demo Uygulama',
  x: 235,
  y: 208,
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

function demoLocate(n: AgentNode): ScreenItem | null {
  const prompt = n.prompt?.trim() ?? ''
  const ex = extractTarget(prompt)
  const anchor = n.anchor
  const hit =
    (ex?.quoted ? matchText(ITEMS, ex.text, { anchor }) : null) ??
    matchPrompt(ITEMS, prompt || n.locator?.text || '', anchor) ??
    (ex ? matchText(ITEMS, ex.text, { anchor }) : null) ??
    (n.locator?.text ? matchText(ITEMS, n.locator.text, { anchor }) : null) ??
    matchFuzzy(ITEMS, ex?.text || prompt || n.locator?.text || '', { anchor })
  return hit?.item ?? null
}

export async function runDemo(
  graph: AgentGraph,
  settings: AppSettings,
  log: (l: LogLevel, m: string) => void,
  step: (id: string, s: StepStatus) => void,
  startId?: string,
  patchNode?: (id: string, patch: Partial<AgentNode>) => void,
  packagePath?: string[],
  reportEnd = false,
  edge?: (id: string, from: string, to: string) => void
) {
  demoStop = false
  const ex: Executor = {
    log,
    step,
    edge,
    patchNode,
    shouldStop: () => demoStop,
    click: async (n) => {
      const attempt = async () => {
        await pause(350)
        const item = demoLocate(n)
        if (!item) {
          throw new Error(
            `(demo) “${n.prompt || n.title}” demo ekranda bulunamadı. Gerçek çalıştırmada LLM de devreye girer.`
          )
        }
        log('success', `(demo) Tıklandı: “${item.text}” @${item.x + item.w / 2},${item.y + item.h / 2}`)
      }
      try {
        await attempt()
      } catch (e) {
        if (demoStop) throw e
        log('warn', `“${n.title}” bulunamadı. 3 sn sonra ekran yenilenip bir kez daha denenecek.`)
        await pause(3000)
        if (demoStop) throw new StoppedError()
        await attempt()
      }
    },
    type: async (n) => {
      await pause(350)
      const item = n.prompt?.trim() ? demoLocate(n) : null
      log('success', `(demo) ${item ? `“${item.text}” alanına ` : ''}yazıldı: “${n.text ?? ''}”`)
    },
    key: async (n) => {
      await pause(200)
      log('info', `(demo) tuş: ${n.keys}`)
    },
    initiative: async (n) => {
      await pause(600)
      log('info', `(demo) [inisiyatif 1/${n.maxActions ?? 12}] tıkla “Model Seç” — hedefe giden ilk adım`)
      await pause(500)
      log('info', '(demo) [inisiyatif 2] done — hedef ekranda görünüyor')
      patchNode?.(n.id, { trace: ['tıkla “Model Seç”'] })
      return true
    },
    exists: async (text, n) => {
      await pause(250)
      return containsText(ITEMS, text)
    },
  }
  try {
    const summary = await runGraph(graph, ex, {
      maxSteps: settings.maxSteps,
      stepDelayMs: Math.min(settings.stepDelayMs, 300),
      startId,
      resume: !!startId,
      packagePath,
      reportEnd,
    })
    return { ok: summary.failed === 0, ...summary }
  } catch (e) {
    if (e instanceof StoppedError) { log('warn', 'Ajan durduruldu.'); return { ok: false, stopped: true } }
    else throw e
  }
}
