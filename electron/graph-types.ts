export type NodeKind =
  | 'start'
  | 'click'
  | 'type'
  | 'key'
  | 'wait'
  | 'condition'
  | 'loop'
  | 'ai'
  | 'browser'
  | 'waitFile'
  | 'moveFile'
  | 'package'
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
  /** PNG (base64) of the picked element, searched for on screen when nothing else finds it. */
  icon?: string
}

/** One step of an İnisiyatif run that reached its goal; replayed first on the next lap. */
export type PathStep = {
  action: 'click' | 'double' | 'right' | 'drag' | 'hotkey' | 'type' | 'scroll' | 'wait' | 'move' | 'clickCurrent'
  /** Point as a fraction of the screen (0–1). */
  rx?: number
  ry?: number
  rx2?: number
  ry2?: number
  keys?: string[]
  text?: string
  direction?: 'up' | 'down' | 'left' | 'right'
  thought?: string
  /** Screen signature before the step; replay stops when the screen no longer looks like this. */
  sig?: string
  /** Picture (PNG base64) around the click point when recorded; replay clicks only where this is found again. */
  patch?: string
}

export type ClickMode = 'left' | 'double' | 'right' | 'move'

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
  /** Loop: one value per lap, exposed as {{öğe}} while the members run. */
  items?: string[]
  /** Loop: item on screen during a run. Cleared when the loop finishes. */
  loopIndex?: number
  /**
   * Loop: item “Seçiliden Çalıştır” continues from. A full run ignores it and starts at the first item.
   * Follows the live lap, and stays where the run stopped.
   */
  startIndex?: number
  /** Loop: folder the list was filled from. Dosyayı Bekle: folder to watch. */
  folder?: string
  /** Loop: nodes that belong to this box and repeat once per item. */
  members?: string[]
  /** Last successful targets of this node. */
  memory?: TargetMemo[]
  /** İnisiyatif (liste): the actions of the last lap that reached the goal. */
  trace?: string[]
  /** İnisiyatif (ekran): the steps of the last lap that reached the goal. */
  path?: PathStep[]
  /** İnisiyatif: look at the screenshot and click coordinates, or pick from the list of screen texts. */
  engine?: 'screen' | 'list'
  maxActions?: number
  url?: string
  browser?: 'auto' | 'msedge' | 'chrome'
  /** Dosyayı Bekle: e.g. *.glb (empty = any file). */
  pattern?: string
  /** Dosyayı Taşı: source path (default {{dosya}}). */
  source?: string
  /** Set while running when a field of this node contains a {{…}} value, so its target differs per lap. */
  templated?: boolean
  /** Last known screen position of the target; breaks ties when the same text appears several times. */
  anchor?: { x: number; y: number }
  locator?: Locator
  /** Paket: the flow hidden inside this node. Runs from its own Başlangıç through to the end, then the outer flow continues. */
  inner?: AgentGraph
  /** Paket: the inner edge that used to leave the selection, restored when the package is unpacked. */
  packageExit?: { from: string; fromPort: string }
  /** When set, this node’s settings are listed on the package that contains it. */
  expose?: boolean
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

/** One canvas. The open tab is the project the agent runs and the file export writes. */
export type CanvasTab = {
  id: string
  name: string
  graph: AgentGraph
  /** Explicit library record this open tab was loaded from. */
  savedId?: string
  /** Last explicitly saved/opened state; also the untouched state of a new canvas. */
  baseline?: { name: string; graph: AgentGraph }
}

export type SavedCanvas = { id: string; name: string; graph: AgentGraph; updatedAt: number }
export type AutomationEntry = { id: string; canvasId: string }
export type CanvasAutomation = { id: string; name: string; entries: AutomationEntry[]; updatedAt: number }
export type CanvasLibrary = { schemaVersion?: 2; canvases: SavedCanvas[]; automations: CanvasAutomation[] }

export type CanvasBook = {
  activeId: string
  tabs: CanvasTab[]
  library?: CanvasLibrary
  /**
   * Agent branches: recipes of edits over a canvas, kept as they are, never copies of a flow.
   * Their shape lives in electron/tool-branch.ts; this layer only carries them so a save does
   * not drop them. Absent (or empty) for books that never had one.
   */
  branches?: unknown[]
}

export type AppSettings = {
  recovery?: import('./recovery-settings').RecoverySettings
  apiKey: string
  model: string
  /** Tried, in order, when `model` cannot be reached. At most four; five names in total. */
  modelBackups: string[]
  /**
   * OpenAI uyumlu YEREL sunucu adresi (llama.cpp / Ollama / LM Studio). Boş = yalnız OpenRouter.
   * Zincirde `local:<model>` yazan satır bu adrese gider; diğer bütün satırlar OpenRouter'da kalır.
   */
  localBaseUrl?: string
  targetWindow: string
  stepDelayMs: number
  maxSteps: number
  /** Attach a numbered screenshot to LLM requests (needs a vision-capable model). */
  sendScreenshot: boolean
  /** Model used by nodes running in screenshot (vision) mode; same OpenRouter key. */
  visionModel: string
  /** Tried, in order, when `visionModel` cannot be reached. */
  visionBackups: string[]
  /** Minimize this app while the agent runs so it does not cover the target. */
  hideWhileRunning: boolean
  /** Model that drives İnisiyatif from screenshots (UI-TARS or any vision model). */
  agentModel: string
  /** Tried, in order, when `agentModel` cannot be reached. */
  agentBackups: string[]
  /** Which reader supplies on-screen text. UI Automation names are used either way. */
  ocrEngine: 'windows' | 'onnx' | 'combined'
  /** Output value for an input of 0. The preview and the readers share this. */
  valueLo: number
  /** Output value for an input of 1. */
  valueHi: number
  /** Click search order. Missing ids are appended. */
  findOrder: import('./llm-flow').FindStageId[]
  /** Stages skipped in that order. */
  findOff: import('./llm-flow').FindStageId[]
  /** Custom system prompts. Empty means the built-in text. */
  llmPrompts: import('./llm-flow').LlmPrompts
  /**
   * What an outside agent may do without asking. The Ajan panel is never gated: a person
   * pressing a button is the approval. `ask` shows a confirmation for every acting call.
   */
  agentPermission: 'off' | 'ask' | 'auto'
  /** Listen on 127.0.0.1 so an outside agent can reach the same tools the panel uses. */
  agentEndpoint: boolean
  /**
   * How much the engine looks at the screen after an action (CLAUDE.md §17).
   *
   * The decision is that verification runs **log-only** by default, and that the threshold tuning
   * is not to be tried again. So:
   *  - `off`: no scan at all - the action is taken at its word, nothing waits, no model runs
   *  - `log`: look, and say what was seen, but never judge the step and never spend a model call
   *  - `on`:  look, and let the recovery attempts run too (a closer look, then a plan question)
   */
  screenCheck: 'off' | 'log' | 'on'
}

/**
 * The verification mode, with the decided default for a flow saved before the setting existed.
 * Anything unrecognised counts as `log`: a silent `on` would spend model calls nobody asked for,
 * and a silent `off` would stop reporting what the screen actually showed.
 */
export function screenCheckMode(s: { screenCheck?: string } | undefined): 'off' | 'log' | 'on' {
  const v = s?.screenCheck
  return v === 'off' || v === 'on' ? v : 'log'
}

export function clampRamp(lo: unknown, hi: unknown): { lo: number; hi: number } {
  const unit = (n: unknown, fallback: number) => {
    const v = typeof n === 'number' ? n : Number(n)
    if (!Number.isFinite(v)) return fallback
    return Math.min(1, Math.max(0, v))
  }
  let a = unit(lo, 0.15)
  let b = unit(hi, 0.8)
  if (b < a) {
    const t = a
    a = b
    b = t
  }
  return { lo: a, hi: b }
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  model: 'openai/gpt-4o-mini',
  modelBackups: [],
  localBaseUrl: '',
  targetWindow: '',
  stepDelayMs: 800,
  maxSteps: 2000,
  sendScreenshot: true,
  visionModel: 'google/gemini-3.8-flash',
  visionBackups: [],
  hideWhileRunning: true,
  agentModel: 'bytedance/ui-tars-1.5-7b',
  agentBackups: [],
  ocrEngine: 'combined',
  valueLo: 0.15,
  valueHi: 0.8,
  findOrder: ['chrome', 'uia', 'icon', 'windows', 'list', 'tars', 'offset'],
  findOff: ['list'],
  llmPrompts: {},
  agentPermission: 'ask',
  agentEndpoint: false,
  screenCheck: 'log',
}

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
  condition: {
    label: 'Koşul',
    icon: '?',
    color: '#b03a3a',
    hasInput: true,
    outputs: [
      { key: 'true', label: 'var' },
      { key: 'false', label: 'yok' },
    ],
    description: 'Ekranda bir yazı ya da seçilen öğe (simge dahil) var mı? İstersen görünene kadar bekler.',
  },
  loop: {
    label: 'Her Öğe İçin',
    icon: '↻',
    color: '#8a4b16',
    hasInput: true,
    outputs: [{ key: 'done', label: 'bitti' }],
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
  package: {
    label: 'Paket',
    icon: '▣',
    color: '#24406e',
    hasInput: true,
    outputs: NEXT,
    description: 'Seçilen adımları tek node’da toplar. İçi Başlangıç’tan bitişe kadar çalışır, sonra dışarıdaki sonraki node’a geçer.',
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
export const PACKAGE_BODY = 80
export const NODE_PORT_ROW = 22

export function nodeWidth(kind: NodeKind): number {
  return kind === 'package' ? NODE_W + 32 : NODE_W
}

export function nodeHeight(kind: NodeKind): number {
  const body = kind === 'package' ? PACKAGE_BODY : NODE_BODY
  return NODE_BORDER * 2 + NODE_HEADER + body + Math.max(NODE_SPECS[kind].outputs.length, 0) * NODE_PORT_ROW + 4
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
    x: n.x + nodeWidth(n.kind) - NODE_BORDER,
    y: n.y + NODE_BORDER + NODE_HEADER + (n.kind === 'package' ? PACKAGE_BODY : NODE_BODY) + idx * NODE_PORT_ROW + NODE_PORT_ROW / 2,
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
    case 'condition':
      return { ...base, text: '', timeoutMs: 0 }
    case 'loop':
      return { ...base, count: 3, members: [] }
    case 'ai':
      return { ...base, prompt: '', maxActions: 25, engine: 'screen' }
    case 'browser':
      return { ...base, url: 'https://', browser: 'auto' }
    case 'waitFile':
      return { ...base, folder: '', pattern: '', timeoutMs: 300000 }
    case 'moveFile':
      return { ...base, source: '{{dosya}}', text: '' }
    case 'package':
      return { ...base, inner: { nodes: [], edges: [] } }
    default:
      return base
  }
}

/** Count actual nodes across nested packages, without counting package wrappers
 * or their synthetic Start/End markers. Loops count once, not once per item. */
export function packageStepCount(graph: AgentGraph | undefined): number {
  return (graph?.nodes ?? []).reduce((count, node) => count + (
    node.kind === 'package' ? packageStepCount(node.inner) : node.kind === 'start' || node.kind === 'end' ? 0 : 1
  ), 0)
}

export function summarize(n: AgentNode): string {
  switch (n.kind) {
    case 'start':
      return 'Akış buradan başlar.'
    case 'click': {
      const mode = n.clickMode === 'double' ? ' (çift tık)' : n.clickMode === 'right' ? ' (sağ tık)' : n.clickMode === 'move' ? ' (fareyi oynat)' : ''
      const label = n.locator?.text || n.locator?.name
      const body =
        n.prompt?.trim() ||
        (label ? `“${label}” yazan yere tıkla` : n.locator?.icon ? 'Seçilen simgeye tıkla' : n.locator ? 'Yakalanan yere tıkla' : 'Ne yazan yere tıklanacağını yaz…')
      return body + mode
    }
    case 'type':
      return `${n.prompt?.trim() ? n.prompt.trim() + ' → ' : ''}“${n.text || ''}”${n.pressEnter ? ' + Enter' : ''}`
    case 'key':
      return `Tuş: ${n.keys || '—'}`
    case 'wait':
      return `${((n.ms ?? 0) / 1000).toLocaleString('tr-TR')} sn bekle`
    case 'condition': {
      const what = n.text?.trim() ? `“${n.text.trim()}”` : n.locator ? 'seçilen öğe' : '“—”'
      const wait = Math.round((n.timeoutMs ?? 0) / 1000)
      return wait > 0 ? `${what} görünene kadar bekle (en çok ${wait} sn)` : `Ekranda ${what} var mı?`
    }
    case 'loop': {
      const keys = loopKeys(n)
      return listItems(n).length ? `${keys.length} öğe, her çalıştırmada baştan` : `${keys.length} kez`
    }
    case 'ai':
      return n.prompt?.trim() || 'Hedefi yaz: örn. “Blender’da küp ekle ve kırmızı materyal ver”'
    case 'browser':
      return n.url?.trim() && n.url.trim() !== 'https://' ? n.url.trim() : 'Açılacak adresi yaz…'
    case 'waitFile':
      return `${n.folder?.trim() || 'İndirilenler'}${n.pattern?.trim() ? ` · ${n.pattern.trim()}` : ''} (en çok ${Math.round((n.timeoutMs ?? 0) / 1000)} sn)`
    case 'moveFile':
      return `${n.source?.trim() || '{{dosya}}'} → ${n.text?.trim() || 'hedef yolu yaz…'}`
    case 'package': {
      const steps = packageStepCount(n.inner)
      return steps ? `${steps} adım` : 'Boş paket'
    }
    case 'end':
      return 'Akışı bitir.'
  }
}

export function listItems(n: AgentNode): string[] {
  return (n.items ?? []).map((s) => s.trim()).filter(Boolean)
}

/**
 * First item of a run. A full run starts at 0. A run that begins inside the box
 * continues from `startIndex` through the end of the list.
 */
export function loopStartIndex(loop: AgentNode, total: number, resume: boolean): number {
  if (!resume || total < 1) return 0
  const raw = loop.startIndex
  const i = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 0
  return Math.min(Math.max(0, i), total - 1)
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

export const TEMPLATE_VARS = ['{{öğe}}', '{{öğe.isim}}', '{{öğe.ad}}', '{{sıra}}', '{{toplam}}']

/** Preferred model first, then backups. Empty and repeated names are dropped. At most five. */
export function modelChain(primary: string | undefined, backups: string[] | undefined): string[] {
  const out: string[] = []
  for (const raw of [primary, ...(Array.isArray(backups) ? backups : [])]) {
    const name = String(raw ?? '').trim()
    if (!name || out.includes(name)) continue
    out.push(name)
    if (out.length >= 5) break
  }
  return out
}

export function cleanBackups(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const name = item.trim()
    if (!name || out.includes(name)) continue
    out.push(name)
    if (out.length >= 4) break
  }
  return out
}

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
    delete (loop as { results?: unknown }).results
    delete (loop as { onError?: unknown }).onError
    delete (loop as { attempts?: unknown }).attempts
    delete loop.loopIndex
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

/** Remove passive legacy Kontrol cards while preserving their real successor/port. */
function withoutLegacyProbes(g: { nodes?: LegacyNode[]; edges?: Partial<AgentEdge>[] }) {
  const nodes = (g.nodes ?? []).filter(n => n && n.id)
  const edges = (g.edges ?? []).filter(e => e && e.from && e.to)
  const probes = new Set(nodes.filter(n => (n.kind as string) === 'probe').map(n => n.id!))
  if (!probes.size) return g
  const successor = new Map<string, string>()
  const ids = new Set(nodes.map(n => n.id!))
  for (const e of edges) {
    if (probes.has(e.from!) && (e.fromPort || 'next') === 'next' && ids.has(e.to!) && !successor.has(e.from!)) successor.set(e.from!, e.to!)
  }
  const resolve = (id: string): string | undefined => {
    const seen = new Set<string>()
    while (probes.has(id)) {
      if (seen.has(id)) return undefined
      seen.add(id)
      const next = successor.get(id)
      if (!next) return undefined
      id = next
    }
    return id
  }
  const clean = { nodes: nodes.filter(n => !probes.has(n.id!)).map(n => Array.isArray(n.members)
      ? { ...n, members: n.members.filter(id => !probes.has(id)) } : n),
    edges: edges.flatMap(e => {
      if (probes.has(e.from!)) return []
      const to = resolve(e.to!)
      return to ? [{ ...e, to }] : []
    }) }
  // A disconnected loop picks its head by position. Never silently switch its branch.
  const head = (members: string[], pool: LegacyNode[], links: Partial<AgentEdge>[]) => {
    const ids = new Set(members)
    const candidates = pool.filter(n => ids.has(n.id!) && n.kind !== 'start')
    const fed = new Set(links.filter(e => ids.has(e.from!) && ids.has(e.to!)).map(e => e.to))
    const roots = candidates.filter(n => !fed.has(n.id))
    return [...(roots.length ? roots : candidates)].sort((a, b) => (a.x ?? 60) - (b.x ?? 60) || (a.y ?? 60) - (b.y ?? 60))[0]?.id
  }
  for (const loop of nodes) {
    if (loop.kind !== 'loop' || !Array.isArray(loop.members)) continue
    const before = head(loop.members, nodes, edges)
    const after = head(loop.members.filter(id => !probes.has(id)), clean.nodes, clean.edges)
    if (before && resolve(before) !== after) throw new Error(`“${loop.title || loop.id}”: Kontrol kaldırılınca kutunun ilk adımı değişiyor. Bağımsız kolları bağlayıp yeniden açın. Akış değiştirilmedi.`)
  }
  return clean
}

export function normalizeGraph(raw: unknown): AgentGraph {
  const g = withoutLegacyProbes((raw ?? {}) as { nodes?: LegacyNode[]; edges?: Partial<AgentEdge>[] })
  const waitIds = new Set<string>()
  const nodes: AgentNode[] = (g.nodes ?? [])
    .filter((n) => n && n.id)
    .map((n) => {
      if ((n.kind as string) === 'waitFor') {
        waitIds.add(n.id!)
        n = { ...n, kind: 'condition', timeoutMs: n.timeoutMs ?? 15000 }
      }
      if (n.kind && !Object.prototype.hasOwnProperty.call(NODE_SPECS, n.kind)) {
        throw new Error(`Desteklenmeyen node türü: ${String(n.kind)} (${n.id}). Akış değiştirilmedi.`)
      }
      const kind: NodeKind = n.kind ? (n.kind as NodeKind) : 'click'
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
      if (kind === 'loop') {
        if (!Array.isArray(n.members)) delete node.members
        delete (node as { results?: unknown }).results
        delete (node as { onError?: unknown }).onError
        delete (node as { attempts?: unknown }).attempts
        delete node.loopIndex
      }
      if (kind === 'package') node.inner = normalizeGraph(n.inner ?? { nodes: [], edges: [] })
      return node
    })
  const ids = new Set(nodes.map((n) => n.id))
  let edges: AgentEdge[] = (g.edges ?? [])
    .filter((e) => e && e.from && e.to && ids.has(e.from) && ids.has(e.to))
    .map((e) => {
      let fromPort = e.fromPort || 'next'
      if (waitIds.has(e.from!)) fromPort = fromPort === 'found' ? 'true' : fromPort === 'timeout' ? 'false' : fromPort
      return { id: e.id || rid(), from: e.from!, to: e.to!, fromPort }
    })

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

/** Independent snapshots. Empty arrays mean intentionally deleted, never reseed them. */
function normalizeSavedCanvases(raw: unknown): SavedCanvas[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  return raw.flatMap((value, i) => {
    if (!value || typeof value !== 'object') return []
    const r = value as Partial<SavedCanvas>
    if (!r.graph || !Array.isArray(r.graph.nodes) || !Array.isArray(r.graph.edges)) return []
    let id = typeof r.id === 'string' && r.id ? r.id : rid()
    if (seen.has(id)) id = rid()
    seen.add(id)
    return [{ id, name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 48) : `Tuval ${i + 1}`,
      graph: normalizeGraph(r.graph), updatedAt: Number.isFinite(r.updatedAt) && r.updatedAt! >= 0 ? r.updatedAt! : 0 }]
  })
}

export function normalizeCanvasBook(raw: unknown, fallback?: AgentGraph): CanvasBook {
  const rec = raw as { activeId?: unknown; tabs?: unknown; branches?: unknown; library?: unknown } | null
  const seen = new Set<string>()
  const tabs: CanvasTab[] = rec && Array.isArray(rec.tabs) ? rec.tabs.map((item, i) => {
    const t = item as Partial<CanvasTab> | null
    let id = typeof t?.id === 'string' && t.id ? t.id : rid()
    if (seen.has(id)) id = rid()
    seen.add(id)
    return { id, name: typeof t?.name === 'string' && t.name.trim() ? t.name.trim().slice(0, 48) : `Tuval ${i + 1}`,
      graph: normalizeGraph(t?.graph), ...(typeof t?.savedId === 'string' ? { savedId: t.savedId } : {}),
      ...(t?.baseline && typeof t.baseline.name === 'string' && Array.isArray(t.baseline.graph?.nodes) && Array.isArray(t.baseline.graph?.edges)
        ? { baseline: { name: t.baseline.name, graph: normalizeGraph(t.baseline.graph) } } : {}) }
  }) : [{ id: rid(), name: 'Tuval 1', graph: normalizeGraph(fallback ?? { nodes: [], edges: [] }) }]
  const activeId = tabs.some(t => t.id === rec?.activeId) ? String(rec!.activeId) : tabs[0]?.id ?? ''
  let library: CanvasLibrary
  if (rec?.library && typeof rec.library === 'object') {
    const lib = rec.library as { canvases?: unknown; automations?: unknown }
    const catalog = normalizeSavedCanvases(lib.canvases)
    const legacyMembers = new Set<string>()
    const ids = new Set<string>()
    const automations: CanvasAutomation[] = Array.isArray(lib.automations) ? lib.automations.flatMap(value => {
      if (!value || typeof value !== 'object') return []
      const a = value as { id?: unknown; name?: unknown; entries?: unknown; canvases?: unknown; updatedAt?: unknown }
      if (!Array.isArray(a.entries) && !Array.isArray(a.canvases)) return []
      let id = typeof a.id === 'string' && a.id ? a.id : rid()
      if (ids.has(id)) id = rid()
      ids.add(id)
      const entryIds = new Set<string>()
      const makeEntry = (rawId: unknown, canvasId: string): AutomationEntry => {
        let entryId = typeof rawId === 'string' && rawId ? rawId : rid()
        if (entryIds.has(entryId)) entryId = rid()
        entryIds.add(entryId)
        return { id: entryId, canvasId }
      }
      const entries = Array.isArray(a.entries) ? a.entries.flatMap(value => {
        const e = value as Partial<AutomationEntry> | null
        return e && typeof e.canvasId === 'string' && catalog.some(c => c.id === e.canvasId) ? [makeEntry(e.id, e.canvasId)] : []
      }) : normalizeSavedCanvases(a.canvases).map(snapshot => {
        // V1 automation snapshots move into the single catalog. A differing old
        // copy must survive migration; never overwrite an already-saved canvas.
        const identical = (c: SavedCanvas) => c.name === snapshot.name && JSON.stringify(c.graph) === JSON.stringify(snapshot.graph)
        const same = catalog.find(c => c.id === snapshot.id && identical(c)) ?? catalog.find(identical)
        let canvasId = same?.id
        if (!canvasId) {
          canvasId = catalog.some(c => c.id === snapshot.id) ? rid() : snapshot.id
          catalog.push({ ...snapshot, id: canvasId })
        }
        legacyMembers.add(canvasId)
        return makeEntry(snapshot.id, canvasId)
      })
      return [{ id, name: typeof a.name === 'string' && a.name.trim() ? a.name.trim().slice(0, 48) : 'Otomasyon', entries,
        updatedAt: typeof a.updatedAt === 'number' && Number.isFinite(a.updatedAt) && a.updatedAt >= 0 ? a.updatedAt : 0 }]
    }) : []
    library = { schemaVersion: 2, canvases: catalog, automations }
    // Old group-open tabs had no savedId. Reattach an exact, unambiguous
    // legacy working copy so its next Save updates the shared group record.
    for (const tab of tabs) if (!tab.savedId) {
      const matches = catalog.filter(c => legacyMembers.has(c.id) && c.name === tab.name && JSON.stringify(c.graph) === JSON.stringify(tab.graph))
      if (matches.length === 1) tab.savedId = matches[0].id
    }

  } else {
    // Upgrade old saved tabs once; closing a tab will no longer remove its saved flow.
    library = { schemaVersion: 2, canvases: tabs.map(t => ({ id: t.id, name: t.name, graph: structuredClone(t.graph), updatedAt: 0 })), automations: [] }
    for (const t of tabs) t.savedId = t.id
  }
  const branches = Array.isArray(rec?.branches) ? rec!.branches.filter(b => !!b && typeof b === 'object' && typeof (b as { id?: unknown }).id === 'string') : undefined
  return { activeId, tabs, library, ...(branches?.length ? { branches } : {}) }
}
