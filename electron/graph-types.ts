export type NodeKind =
  | 'start'
  | 'click'
  | 'type'
  | 'key'
  | 'wait'
  | 'waitFor'
  | 'condition'
  | 'loop'
  | 'ai'
  | 'browser'
  | 'waitFile'
  | 'moveFile'
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

/** What a target looked like on a lap that worked. A hint for the next lap, never an answer. */
export type TargetMemo = {
  win: string
  type: string
  src: 'uia' | 'ocr' | 'dom'
  /** Centre of the target as a fraction of the scanned area (0–1). */
  rx: number
  ry: number
  text: string
  at: number
}

export type ItemStatus = 'ok' | 'fail'

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
  /** Loop: one value per lap, exposed as {{öğe}} while the members run. */
  items?: string[]
  /** Loop: item being processed right now (display only; resume comes from `results`). */
  loopIndex?: number
  /** Loop: folder the list was filled from. Dosyayı Bekle: folder to watch. */
  folder?: string
  /** Loop: nodes that belong to this box and repeat once per item. */
  members?: string[]
  /** Loop: outcome per item key. Failed and missing items run again; a clean finish clears it. */
  results?: Record<string, ItemStatus>
  /** Loop: what to do when an item fails after its tries. */
  onError?: 'skip' | 'stop'
  /** Loop: tries per item (recovery chain runs between tries). */
  attempts?: number
  /** Last successful targets of this node. */
  memory?: TargetMemo[]
  /** İnisiyatif: the actions of the last lap that reached the goal. */
  trace?: string[]
  maxActions?: number
  url?: string
  browser?: 'auto' | 'msedge' | 'chrome'
  /** Dosyayı Bekle: e.g. *.glb (empty = any file). */
  pattern?: string
  /** Dosyayı Taşı: source path (default {{dosya}}). */
  source?: string
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
  maxSteps: 2000,
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
    label: 'Her Öğe İçin',
    icon: '↻',
    color: '#8a4b16',
    hasInput: true,
    outputs: [
      { key: 'done', label: 'bitti' },
      { key: 'error', label: 'hata olursa' },
    ],
    description: 'Bir kutu. İçine koyduğun node’lar listedeki her öğe için (veya N kez) sırayla çalışır.',
  },
  ai: {
    label: 'İnisiyatif',
    icon: '✦',
    color: '#b0306a',
    hasInput: true,
    outputs: [
      { key: 'next', label: 'tamam' },
      { key: 'fail', label: 'olmadı' },
    ],
    description: 'Hedefi yaz, birkaç adımlık işi model ekrana bakarak kendisi yapar.',
  },
  browser: {
    label: 'Tarayıcıyı Aç',
    icon: '◎',
    color: '#0b7a75',
    hasInput: true,
    outputs: NEXT,
    description: 'Edge/Chrome’u programın profiliyle açar. Sonraki adımlar sayfanın içini görerek çalışır.',
  },
  waitFile: {
    label: 'Dosyayı Bekle',
    icon: '⇣',
    color: '#4a6b1f',
    hasInput: true,
    outputs: [
      { key: 'found', label: 'geldi' },
      { key: 'timeout', label: 'zaman aşımı' },
    ],
    description: 'Klasöre yeni bir dosya inip tamamlanana kadar bekler. Dosya {{dosya}} olur.',
  },
  moveFile: {
    label: 'Dosyayı Taşı',
    icon: '⇢',
    color: '#5b5f1f',
    hasInput: true,
    outputs: NEXT,
    description: 'Bir dosyayı yeni adıyla başka yere taşır (örn. D:\\Modeller\\{{öğe.isim}}.glb).',
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
  return NODE_BORDER * 2 + NODE_HEADER + NODE_BODY + Math.max(NODE_SPECS[kind].outputs.length, 0) * NODE_PORT_ROW + 4
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
    y: n.y + NODE_BORDER + NODE_HEADER + NODE_BODY + idx * NODE_PORT_ROW + NODE_PORT_ROW / 2,
  }
}

export function portLabel(kind: NodeKind, port: string): string {
  return NODE_SPECS[kind].outputs.find((o) => o.key === port)?.label ?? port
}

function rid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

export const newId = rid

export function createNode(kind: NodeKind, x: number, y: number, index = 1): AgentNode {
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
      return { ...base, count: 3, members: [], onError: 'skip', attempts: 2 }
    case 'ai':
      return { ...base, prompt: '', maxActions: 12 }
    case 'browser':
      return { ...base, url: 'https://', browser: 'auto' }
    case 'waitFile':
      return { ...base, folder: '', pattern: '', timeoutMs: 300000 }
    case 'moveFile':
      return { ...base, source: '{{dosya}}', text: '' }
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
      const keys = loopKeys(n)
      const done = keys.filter((k) => n.results?.[k] === 'ok').length
      const failed = keys.filter((k) => n.results?.[k] === 'fail').length
      const what = listItems(n).length ? `${keys.length} öğe` : `${keys.length} kez`
      return `${what}${done ? ` · ${done} tamam` : ''}${failed ? ` · ${failed} hatalı` : ''}`
    }
    case 'ai':
      return n.prompt?.trim() || 'Hedefi yaz: örn. “sağdaki ayarlardan dili Türkçe yap”'
    case 'browser':
      return n.url?.trim() && n.url.trim() !== 'https://' ? n.url.trim() : 'Açılacak adresi yaz…'
    case 'waitFile':
      return `${n.folder?.trim() || 'İndirilenler'}${n.pattern?.trim() ? ` · ${n.pattern.trim()}` : ''} (en çok ${Math.round((n.timeoutMs ?? 0) / 1000)} sn)`
    case 'moveFile':
      return `${n.source?.trim() || '{{dosya}}'} → ${n.text?.trim() || 'hedef yolu yaz…'}`
    case 'end':
      return 'Akışı bitir.'
  }
}

export function listItems(n: AgentNode): string[] {
  return (n.items ?? []).map((s) => s.trim()).filter(Boolean)
}

/** One key per lap: the list rows, or #1…#N in count mode. */
export function loopKeys(n: AgentNode): string[] {
  const items = listItems(n)
  if (items.length) return items
  const total = Math.max(1, n.count ?? 1)
  return Array.from({ length: total }, (_, i) => `#${i + 1}`)
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

/** {{dosya}}, {{dosya.ad}}, {{dosya.isim}}, {{dosya.uzantı}} for the last file Dosyayı Bekle saw. */
export function fileVars(file: string): Record<string, string> {
  const ad = baseName(file)
  const ext = ad.includes('.') ? ad.slice(ad.lastIndexOf('.')) : ''
  const vars: Record<string, string> = {
    dosya: file,
    'dosya.ad': ad,
    'dosya.isim': ext ? ad.slice(0, -ext.length) : ad,
    'dosya.uzantı': ext,
  }
  return Object.fromEntries(Object.entries(vars).map(([k, v]) => [keyNorm(k), v]))
}

export const TEMPLATE_VARS = ['{{öğe}}', '{{öğe.isim}}', '{{öğe.ad}}', '{{sıra}}', '{{toplam}}', '{{dosya}}']

/** Replaces {{name}} placeholders; accepts ASCII spellings too ({{oge.isim}}, {{sira}}). Unknown names stay as-is. */
export function renderTemplate(s: string | undefined, vars: Record<string, string>): string | undefined {
  if (!s || !s.includes('{{')) return s
  return s.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, k: string) => vars[keyNorm(k)] ?? m)
}

export function hasTemplate(s: string | undefined): boolean {
  return !!s && /\{\{[^{}]+\}\}/.test(s)
}

type LegacyNode = Partial<AgentNode> & {
  recorded?: Locator
}

/** The cycle an old loop card closed with its “tekrar” edge. */
function legacyLoopBody(edges: AgentEdge[], loopId: string): string[] {
  const start = edges.find((e) => e.from === loopId && e.fromPort === 'loop')?.to
  if (!start || start === loopId) return []
  const fwd = new Set<string>()
  const q = [start]
  while (q.length) {
    const id = q.shift()!
    if (id === loopId || fwd.has(id)) continue
    fwd.add(id)
    for (const e of edges) if (e.from === id) q.push(e.to)
  }
  const back = new Set<string>()
  const q2 = [loopId]
  while (q2.length) {
    const id = q2.shift()!
    for (const e of edges) {
      if (e.to === id && e.from !== loopId && !back.has(e.from)) {
        back.add(e.from)
        q2.push(e.from)
      }
    }
  }
  return [...fwd].filter((id) => back.has(id))
}

/** Old flows: a loop card at the end of a cycle. Turn it into a box that holds the cycle. */
function migrateLegacyLoops(nodes: AgentNode[], edges: AgentEdge[]): AgentEdge[] {
  let out = edges
  for (const loop of nodes) {
    if (loop.kind !== 'loop' || Array.isArray(loop.members)) continue
    const head = out.find((e) => e.from === loop.id && e.fromPort === 'loop')?.to
    const body = legacyLoopBody(out, loop.id)
    const inBody = new Set(body)
    loop.members = body
    loop.onError = 'skip'
    loop.attempts = 2
    const items = listItems(loop)
    if (items.length && (loop.loopIndex ?? 0) > 0) {
      loop.results = Object.fromEntries(items.slice(0, loop.loopIndex).map((k) => [k, 'ok' as ItemStatus]))
    }
    out = out
      .filter((e) => !(e.from === loop.id && e.fromPort === 'loop'))
      .filter((e) => !(inBody.has(e.from) && (e.to === loop.id || e.to === head)))
      .map((e) => {
        if (head && e.to === head && !inBody.has(e.from) && e.from !== loop.id) return { ...e, to: loop.id }
        if (e.fromPort === 'done' && (inBody.has(e.from) || e.from === loop.id)) return { ...e, from: loop.id }
        return e
      })
    const members = nodes.filter((n) => inBody.has(n.id))
    if (members.length) {
      loop.x = Math.min(...members.map((n) => n.x)) - 24
      loop.y = Math.min(...members.map((n) => n.y)) - 52
    }
  }
  return out
}

/** Every node sits in at most one box, and a box never contains itself. */
function sanitizeMembers(nodes: AgentNode[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const owner = new Map<string, string>()
  for (const loop of nodes) {
    if (loop.kind !== 'loop') continue
    loop.members = (loop.members ?? []).filter((id) => {
      const m = byId.get(id)
      if (!m || id === loop.id || m.kind === 'start' || owner.has(id)) return false
      owner.set(id, loop.id)
      return true
    })
  }
  for (const loop of nodes) {
    if (loop.kind !== 'loop') continue
    const seen = new Set<string>()
    let up = owner.get(loop.id)
    while (up && !seen.has(up)) {
      if (up === loop.id) break
      seen.add(up)
      up = owner.get(up)
    }
    if (up === loop.id) {
      const parent = byId.get(owner.get(loop.id)!)
      if (parent) parent.members = (parent.members ?? []).filter((id) => id !== loop.id)
      owner.delete(loop.id)
    }
  }
}

export function normalizeGraph(raw: unknown): AgentGraph {
  const g = (raw ?? {}) as { nodes?: LegacyNode[]; edges?: Partial<AgentEdge>[] }
  const nodes: AgentNode[] = (g.nodes ?? [])
    .filter((n) => n && n.id)
    .map((n) => {
      const kind: NodeKind = n.kind && n.kind in NODE_SPECS ? (n.kind as NodeKind) : 'click'
      const fallback = createNode(kind, n.x ?? 60, n.y ?? 60)
      const { recorded, ...rest } = n
      const node = {
        ...fallback,
        ...rest,
        id: n.id!,
        kind,
        title: n.title || fallback.title,
        locator: n.locator ?? recorded,
      } as AgentNode
      if (kind === 'loop' && !Array.isArray(n.members)) delete node.members
      return node
    })
  const ids = new Set(nodes.map((n) => n.id))
  let edges: AgentEdge[] = (g.edges ?? [])
    .filter((e) => e && e.from && e.to && ids.has(e.from) && ids.has(e.to))
    .map((e) => ({
      id: e.id || rid(),
      from: e.from!,
      to: e.to!,
      fromPort: e.fromPort || 'next',
    }))

  edges = migrateLegacyLoops(nodes, edges)
  sanitizeMembers(nodes)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const seenPort = new Set<string>()
  edges = edges.filter((e) => {
    const from = byId.get(e.from)
    if (!from || !NODE_SPECS[from.kind].outputs.some((o) => o.key === e.fromPort)) return false
    const key = `${e.from}:${e.fromPort}`
    if (seenPort.has(key)) return false
    seenPort.add(key)
    return true
  })

  if (!nodes.some((n) => n.kind === 'start')) {
    const firstFree = nodes.find((n) => !edges.some((e) => e.to === n.id))
    const minX = nodes.length ? Math.min(...nodes.map((n) => n.x)) : 300
    const start = createNode('start', Math.max(20, minX - NODE_W - 60), firstFree ? firstFree.y : 80)
    if (start.x + NODE_W + 40 > minX && nodes.length) {
      for (const n of nodes) n.x += NODE_W + 80
      start.x = 20
    }
    nodes.unshift(start)
    if (firstFree) {
      edges.push({ id: rid(), from: start.id, fromPort: 'next', to: firstFree.id })
    }
  }
  return { nodes, edges }
}
