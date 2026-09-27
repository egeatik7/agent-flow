import { retargetLoopExits } from './loop-graph'

export type NodeKind =
  | 'start'
  | 'click'
  | 'type'
  | 'key'
  | 'wait'
  | 'waitFor'
  | 'condition'
  | 'loop'
  | 'end'

export type Locator = {
  name: string
  controlType: string
  automationId?: string
  path: string
  windowTitle?: string
  /** Visible text at the click point (UIA name or OCR). */
  text?: string
  /** Screen point captured for this locator. */
  x?: number
  y?: number
  /** Click point relative to the top-left of its window. */
  offsetX?: number
  offsetY?: number
}

export type ClickMode = 'left' | 'double' | 'right'

export type AgentNode = {
  id: string
  kind: NodeKind
  title: string
  x: number
  y: number
  prompt?: string
  text?: string
  keys?: string
  ms?: number
  count?: number
  timeoutMs?: number
  pressEnter?: boolean
  clearFirst?: boolean
  clickMode?: ClickMode
  /** Execute this node by showing a screenshot to the vision model instead of text matching. */
  useVision?: boolean
  /** Loop list mode: one value per turn, exposed as {{öğe}} while the body runs. */
  items?: string[]
  /** Index of the list item currently being processed; persisted so a stopped run resumes there. */
  loopIndex?: number
  /** Folder the list was filled from (display only). */
  folder?: string
  /** Last known screen position of the target; breaks ties when the same text appears several times. */
  anchor?: { x: number; y: number }
  locator?: Locator
}

export type AgentEdge = {
  id: string
  from: string
  fromPort: string
  to: string
}

export type AgentGraph = {
  nodes: AgentNode[]
  edges: AgentEdge[]
}

export type AppSettings = {
  apiKey: string
  model: string
  targetWindow: string
  stepDelayMs: number
  maxSteps: number
  /** Attach a numbered screenshot to LLM requests (needs a vision-capable model). */
  sendScreenshot: boolean
  /** Model used by nodes running in screenshot (vision) mode; same OpenRouter key. */
  visionModel: string
  /** Minimize this app while the agent runs so it does not cover the target. */
  hideWhileRunning: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  model: 'openai/gpt-4o-mini',
  targetWindow: '',
  stepDelayMs: 800,
  maxSteps: 500,
  sendScreenshot: true,
  visionModel: 'google/gemini-3.8-flash',
  hideWhileRunning: true,
}

export const VISION_KINDS: NodeKind[] = ['click', 'type', 'key', 'waitFor', 'condition']

export type StepStatus = 'idle' | 'running' | 'done' | 'error'
export type LogLevel = 'info' | 'warn' | 'error' | 'success' | 'chat'

export type PortSpec = { key: string; label: string }

export type NodeSpec = {
  label: string
  icon: string
  color: string
  hasInput: boolean
  outputs: PortSpec[]
  description: string
}

const NEXT: PortSpec[] = [{ key: 'next', label: 'sonra' }]

export const NODE_SPECS: Record<NodeKind, NodeSpec> = {
  start: {
    label: 'Başlangıç',
    icon: '▶',
    color: '#2f8a2f',
    hasInput: false,
    outputs: NEXT,
    description: 'Akış buradan başlar.',
  },
  click: {
    label: 'Tıkla',
    icon: '↖',
    color: '#1f5fbf',
    hasInput: true,
    outputs: NEXT,
    description: 'Ekranda yazan yazıyı bulup tıklar (örn. “Opera’ya tıkla”).',
  },
  type: {
    label: 'Yazı Yaz',
    icon: 'T',
    color: '#6b3fa0',
    hasInput: true,
    outputs: NEXT,
    description: 'Bir alana metin yazar.',
  },
  key: {
    label: 'Tuş Gönder',
    icon: 'K',
    color: '#16808a',
    hasInput: true,
    outputs: NEXT,
    description: 'Klavye kısayolu / tuş gönderir.',
  },
  wait: {
    label: 'Zamanlayıcı',
    icon: '◷',
    color: '#d27a00',
    hasInput: true,
    outputs: NEXT,
    description: 'Belirtilen süre kadar bekler.',
  },
  waitFor: {
    label: 'Öğeyi Bekle',
    icon: '…',
    color: '#9a7b00',
    hasInput: true,
    outputs: [
      { key: 'found', label: 'bulundu' },
      { key: 'timeout', label: 'zaman aşımı' },
    ],
    description: 'Bir öğe ekranda görünene kadar bekler.',
  },
  condition: {
    label: 'Koşul',
    icon: '?',
    color: '#b03a3a',
    hasInput: true,
    outputs: [
      { key: 'true', label: 'var' },
      { key: 'false', label: 'yok' },
    ],
    description: 'Öğe varsa/yoksa farklı yola gider.',
  },
  loop: {
    label: 'Döngü',
    icon: '↻',
    color: '#8a4b16',
    hasInput: true,
    outputs: [{ key: 'loop', label: 'tekrar' }],
    description: 'Listedeki her öğe için (veya N kez) “tekrar”a döner. Turlar bitince akış döngü kartından değil, grubun son node’undaki “bitti” çıkışından devam eder.',
  },
  end: {
    label: 'Bitir',
    icon: '■',
    color: '#555555',
    hasInput: true,
    outputs: [],
    description: 'Akışı sonlandırır.',
  },
}

export const NODE_KINDS = Object.keys(NODE_SPECS) as NodeKind[]

export const NODE_W = 230
export const NODE_BORDER = 2
export const NODE_HEADER = 26
export const NODE_BODY = 58
export const NODE_PORT_ROW = 22

export function nodeHeight(kind: NodeKind): number {
  return (
    NODE_BORDER * 2 +
    NODE_HEADER +
    NODE_BODY +
    Math.max(NODE_SPECS[kind].outputs.length, 0) * NODE_PORT_ROW +
    4
  )
}

export function inputPoint(n: AgentNode) {
  return { x: n.x + NODE_BORDER, y: n.y + NODE_BORDER + NODE_HEADER / 2 }
}

export function outputPoint(n: AgentNode, port: string) {
  const idx = Math.max(
    0,
    NODE_SPECS[n.kind].outputs.findIndex((o) => o.key === port)
  )
  return {
    x: n.x + NODE_W - NODE_BORDER,
    y:
      n.y +
      NODE_BORDER +
      NODE_HEADER +
      NODE_BODY +
      idx * NODE_PORT_ROW +
      NODE_PORT_ROW / 2,
  }
}

export function portLabel(kind: NodeKind, port: string): string {
  if (port === 'done') return 'bitti'
  return NODE_SPECS[kind].outputs.find((o) => o.key === port)?.label ?? port
}

function rid(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  )
}

export const newId = rid

export function createNode(
  kind: NodeKind,
  x: number,
  y: number,
  index = 1
): AgentNode {
  const base: AgentNode = {
    id: rid(),
    kind,
    title: kind === 'start' ? 'Başlangıç' : `${NODE_SPECS[kind].label} ${index}`,
    x,
    y,
  }
  switch (kind) {
    case 'click':
      return { ...base, prompt: '', clickMode: 'left' }
    case 'type':
      return { ...base, prompt: '', text: '', pressEnter: false, clearFirst: true }
    case 'key':
      return { ...base, keys: '{ENTER}' }
    case 'wait':
      return { ...base, ms: 2000 }
    case 'waitFor':
      return { ...base, text: '', timeoutMs: 15000 }
    case 'condition':
      return { ...base, text: '' }
    case 'loop':
      return { ...base, count: 3 }
    default:
      return base
  }
}

export function summarize(n: AgentNode): string {
  switch (n.kind) {
    case 'start':
      return 'Akış buradan başlar.'
    case 'click': {
      const mode = n.clickMode === 'double' ? ' (çift tık)' : n.clickMode === 'right' ? ' (sağ tık)' : ''
      const body = n.prompt?.trim() || (n.locator ? `“${n.locator.text || n.locator.name}” yazan yere tıkla` : 'Ne yazan yere tıklanacağını yaz…')
      return body + mode
    }
    case 'type':
      return `${n.prompt?.trim() ? n.prompt.trim() + ' → ' : ''}“${n.text || ''}”${n.pressEnter ? ' + Enter' : ''}`
    case 'key':
      return `Tuş: ${n.keys || '—'}`
    case 'wait':
      return `${((n.ms ?? 0) / 1000).toLocaleString('tr-TR')} sn bekle`
    case 'waitFor':
      return `“${n.text || '—'}” görünene kadar bekle (en çok ${Math.round((n.timeoutMs ?? 0) / 1000)} sn)`
    case 'condition':
      return `Ekranda “${n.text || '—'}” var mı?`
    case 'loop': {
      const items = listItems(n)
      if (!items.length) return `${n.count ?? 1} kez tekrarla`
      const i = Math.min(Math.max(0, n.loopIndex ?? 0), items.length - 1)
      return `${items.length} öğe · sıradaki ${i + 1}/${items.length}: ${baseName(items[i])}`
    }
    case 'end':
      return 'Akışı bitir.'
  }
}

export function listItems(n: AgentNode): string[] {
  return (n.items ?? []).map((s) => s.trim()).filter(Boolean)
}

export function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

function keyNorm(k: string): string {
  return k
    .trim()
    .replace(/[İIı]/g, 'i')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/** Variables for the current loop item: {{öğe}}, {{öğe.yol}}, {{öğe.ad}}, {{öğe.isim}}, {{sıra}}, {{toplam}}. */
export function itemVars(item: string, index: number, total: number): Record<string, string> {
  const ad = baseName(item)
  const vars: Record<string, string> = {
    'öğe': item,
    'öğe.yol': item,
    'öğe.ad': ad,
    'öğe.isim': ad.replace(/\.[^.]+$/, ''),
    'sıra': String(index + 1),
    'toplam': String(total),
  }
  return Object.fromEntries(Object.entries(vars).map(([k, v]) => [keyNorm(k), v]))
}

export const TEMPLATE_VARS = ['{{öğe}}', '{{öğe.isim}}', '{{öğe.ad}}', '{{sıra}}', '{{toplam}}']

/** Replaces {{name}} placeholders; accepts ASCII spellings too ({{oge.isim}}, {{sira}}). Unknown names stay as-is. */
export function renderTemplate(s: string | undefined, vars: Record<string, string>): string | undefined {
  if (!s || !s.includes('{{')) return s
  return s.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, k: string) => vars[keyNorm(k)] ?? m)
}

type LegacyNode = Partial<AgentNode> & {
  recorded?: Locator
}

export function normalizeGraph(raw: unknown): AgentGraph {
  const g = (raw ?? {}) as { nodes?: LegacyNode[]; edges?: Partial<AgentEdge>[] }
  const nodes: AgentNode[] = (g.nodes ?? [])
    .filter((n) => n && n.id)
    .map((n) => {
      const kind: NodeKind =
        n.kind && n.kind in NODE_SPECS ? (n.kind as NodeKind) : 'click'
      const fallback = createNode(kind, n.x ?? 60, n.y ?? 60)
      const { recorded, ...rest } = n
      return {
        ...fallback,
        ...rest,
        id: n.id!,
        kind,
        title: n.title || fallback.title,
        locator: n.locator ?? recorded,
      } as AgentNode
    })
  const ids = new Set(nodes.map((n) => n.id))
  const edges: AgentEdge[] = (g.edges ?? [])
    .filter((e) => e && e.from && e.to && ids.has(e.from) && ids.has(e.to))
    .map((e) => ({
      id: e.id || rid(),
      from: e.from!,
      to: e.to!,
      fromPort: e.fromPort || 'next',
    }))

  if (!nodes.some((n) => n.kind === 'start')) {
    const firstFree = nodes.find((n) => !edges.some((e) => e.to === n.id))
    const minX = nodes.length ? Math.min(...nodes.map((n) => n.x)) : 300
    const start = createNode(
      'start',
      Math.max(20, minX - NODE_W - 60),
      firstFree ? firstFree.y : 80
    )
    if (start.x + NODE_W + 40 > minX && nodes.length) {
      for (const n of nodes) n.x += NODE_W + 80
      start.x = 20
    }
    nodes.unshift(start)
    if (firstFree) {
      edges.push({ id: rid(), from: start.id, fromPort: 'next', to: firstFree.id })
    }
  }
  return retargetLoopExits({ nodes, edges })
}
