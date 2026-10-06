/**
 * The tool layer: everything an outside agent is allowed to do, in one place.
 *
 * The Ajan panel, the local endpoint and (later) an MCP adapter all call these functions, so
 * limits, permissions and logging are enforced once instead of per transport. Tools drive the
 * engine that already exists; none of them re-implements target finding, focus or input.
 *
 * Every call answers with the same shape, so a caller can tell apart: was the target found,
 * was the action sent, what was observed, did it fail or was it stopped, and where the run is.
 * `ok` means "the tool answered". A missing target is an answer, not an error.
 */
import {
  loopKeys,
  loopStartIndex,
  normalizeGraph,
  summarize,
  type AgentGraph,
  type AppSettings,
  type LogLevel,
} from './graph-types'
import type { TargetTrace } from './target-trace'
import { contextOf, countEdges, findPlace, walkGraph } from './tool-context'

export type ToolOutcome = 'tamam' | 'hedef-yok' | 'eylem-belirsiz' | 'hata' | 'durduruldu'

export type NodeRef = { id: string; kind: string; title: string; packagePath: string[] }

export type LoopRef = {
  id: string
  title: string
  item?: string
  index?: number
  total?: number
  vars?: Record<string, string>
  /** Where the items come from, so a caller never has to guess. */
  folder?: string
  count?: number
  templated?: boolean
  startIndex?: number
}

export type ToolResult = {
  ok: boolean
  tool: string
  outcome: ToolOutcome
  /** One plain sentence, built from what the engine reported, for the user and the agent. */
  message: string
  node?: NodeRef
  target?: {
    found: boolean
    stage?: string
    x?: number
    y?: number
    label?: string
    window?: string
    candidates?: number
    reason?: string
  }
  action?: { kind: string; sent: boolean }
  observed?: { note?: string }
  loop?: LoopRef
  suggestion?: string
  data?: Record<string, unknown>
}

/** What the panel needs to draw the catalogue, including tools that are not built yet. */
export type ToolSpec = { name: string; summary: string; sendsInput: boolean; ready: boolean }

export type ToolContext = {
  /** The saved flow. A caller may pass its live canvas as `args.graph` instead. */
  getGraph: () => AgentGraph
  getSettings: () => AppSettings
  log: (level: LogLevel, message: string) => void
  isRunning: () => boolean
}

type Args = Record<string, unknown>

type ToolDef = {
  name: string
  summary: string
  /** True when the tool can send keyboard or mouse input to the desktop. */
  sendsInput: boolean
  ready: boolean
  run?: (args: Args, ctx: ToolContext) => Promise<ToolResult>
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The flow the caller means: its live canvas when it sent one, otherwise the saved flow. */
function graphOf(args: Args, ctx: ToolContext): AgentGraph {
  const raw = args.graph
  if (raw && typeof raw === 'object') {
    try {
      return normalizeGraph(raw)
    } catch {
      /* an unusable canvas falls back to the saved flow */
    }
  }
  return ctx.getGraph()
}

function nodeRef(place: { node: { id: string; kind: string; title: string }; packagePath: string[] }): NodeRef {
  return { id: place.node.id, kind: place.node.kind, title: place.node.title, packagePath: place.packagePath }
}

function loopOf(graph: AgentGraph, nodeId: string): LoopRef | undefined {
  const ctx = contextOf(graph, nodeId)
  if (!ctx?.loop) return undefined
  return ctx.loop
}

function failed(tool: string, message: string): ToolResult {
  return { ok: false, tool, outcome: 'hata', message }
}

type TraceSummary = {
  text: string
  stage?: string
  window?: string
  candidates?: number
  stages: { stage: string; candidates?: number }[]
}

/** Turns the resolution trace the engine already emits into a plain sentence. */
function describeTrace(traces: TargetTrace[]): TraceSummary {
  const stages: { stage: string; candidates?: number }[] = []
  const counts = new Map<string, number>()
  let stage: string | undefined
  let window = ''
  for (const t of traces) {
    if (t.kind === 'request') window = t.windowTitle || ''
    if (t.kind === 'observation') {
      const n = t.scan?.items?.length
      stages.push({ stage: t.source, candidates: n })
      if (typeof n === 'number') counts.set(t.source, n)
    }
    if (t.kind === 'resolved') stage = t.source
  }
  const seen = stages
    .filter((s) => s.candidates !== undefined)
    .map((s) => `${s.stage} ${s.candidates}`)
    .join(', ')
  const text = seen ? `Basamaklar: ${seen}.` : 'Hiçbir basamak aday listesi vermedi.'
  return { text, stage, window, candidates: stage ? counts.get(stage) : undefined, stages }
}

const flowRead: ToolDef = {
  name: 'flow.read',
  summary: 'Akıştaki node’ları, paketleri ve döngüleri listeler. Yazmaz.',
  sendsInput: false,
  ready: true,
  run: async (args, ctx) => {
    const graph = graphOf(args, ctx)
    const nodes: (NodeRef & { summary: string })[] = []
    const loops: (LoopRef & { packagePath: string[]; memberIds: string[] })[] = []
    const packages: { id: string; title: string; packagePath: string[]; nodes: number }[] = []
    walkGraph(graph, ({ node, packagePath }) => {
      nodes.push({ ...nodeRef({ node, packagePath }), summary: summarize(node) })
      if (node.kind === 'loop') {
        const keys = loopKeys(node)
        const tick = loopStartIndex(node, keys.length, true)
        loops.push({
          id: node.id,
          title: node.title,
          total: keys.length,
          item: keys[tick],
          index: tick,
          packagePath,
          memberIds: [...(node.members ?? [])],
          folder: typeof node.folder === 'string' ? node.folder : undefined,
          count: typeof node.count === 'number' ? node.count : undefined,
          templated: !!node.templated,
          startIndex: typeof node.startIndex === 'number' ? node.startIndex : undefined,
        })
      }
      if (node.kind === 'package') packages.push({ id: node.id, title: node.title, packagePath, nodes: node.inner?.nodes.length ?? 0 })
    })
    // A box's members are the nodes a lap runs, so name them where the caller can see them.
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const loopsWithMembers = loops.map(({ memberIds, ...loop }) => ({
      ...loop,
      members: memberIds.map((id) => ({ id, title: byId.get(id)?.title ?? id, kind: byId.get(id)?.kind ?? '?' })),
    }))
    const edges = countEdges(graph)
    const message = `${nodes.length} node · ${packages.length} paket · ${loops.length} döngü · ${edges} bağlantı (paketlerin içi dahil).`
    ctx.log('info', `Ajan · akışı oku · ${message}`)
    return { ok: true, tool: flowRead.name, outcome: 'tamam', message, data: { nodes, loops: loopsWithMembers, packages, edges } }
  },
}

const targetPreview: ToolDef = {
  name: 'target.preview',
  summary: 'Bir node için Nubbo’nun nereyi hedefleyeceğini gösterir. Ekrana girdi göndermez.',
  sendsInput: false,
  ready: true,
  run: async (args, ctx) => {
    const graph = graphOf(args, ctx)
    const nodeId = text(args.nodeId)
    if (!nodeId) return failed(targetPreview.name, 'nodeId gerekli.')
    const place = findPlace(graph, nodeId)
    if (!place) return failed(targetPreview.name, `Node bulunamadı: ${nodeId}`)
    const node = place.node
    // The engine is loaded only when a tool actually needs it, so the tool layer stays light
    // and testable. A separate, silent agent: a preview writes no memory, sends no patch and
    // keeps no log of its own.
    const { createAgent } = await import('./agent')
    const traces: TargetTrace[] = []
    const agent = createAgent({
      log: () => {},
      send: () => {},
      settings: ctx.getSettings,
      shouldStop: () => false,
      onTargetTrace: (event) => {
        if (traces.length < 200) traces.push(event)
      },
      captureTargetImages: false,
    })
    try {
      const target = await agent.previewTarget(node)
      const t = describeTrace(traces)
      const label = target.label || '—'
      const message = `“${node.title}” için aradım. ${t.text} Seçilen: ${label} (${Math.round(target.x)}, ${Math.round(target.y)}). Tıklama gönderilmedi.`
      ctx.log('info', `Ajan · hedefi önizle · ${message}`)
      return {
        ok: true,
        tool: targetPreview.name,
        outcome: 'tamam',
        message,
        node: nodeRef(place),
        target: { found: true, stage: t.stage, x: target.x, y: target.y, label: target.label, window: t.window, candidates: t.candidates },
        action: { kind: 'none', sent: false },
        observed: { note: 'Önizleme: ekrana hiçbir girdi gönderilmedi.' },
        loop: loopOf(graph, nodeId),
        data: { stages: t.stages },
      }
    } catch (e) {
      const reason = (e as Error).message
      const t = describeTrace(traces)
      const message = `“${node.title}” için aradım, bulamadım. ${t.text} Sebep: ${reason}`
      ctx.log('warn', `Ajan · hedefi önizle · ${message}`)
      return {
        ok: true,
        tool: targetPreview.name,
        outcome: 'hedef-yok',
        message,
        node: nodeRef(place),
        target: { found: false, reason, window: t.window },
        action: { kind: 'none', sent: false },
        observed: { note: 'Önizleme: ekrana hiçbir girdi gönderilmedi.' },
        loop: loopOf(graph, nodeId),
        data: { stages: t.stages },
        suggestion: 'Hedef bulunamadıysa node’un hedefini Ekrandan Seç ile yenilemek gerekebilir.',
      }
    }
  },
}

/** Announced in the panel, refused with a clear reason until they are built. */
const planned: ToolDef[] = [
  { name: 'step.run', summary: 'Tek adım: seçilen node’u mevcut motorla çalıştırır.', sendsInput: true, ready: false },
  { name: 'run.from', summary: 'Belirtilen node’dan akışı sürdürür.', sendsInput: true, ready: false },
  { name: 'run.state', summary: 'Koşunun hangi node’da, hangi öğede olduğunu söyler.', sendsInput: false, ready: false },
  { name: 'run.stop', summary: 'Çalışan koşuyu durdurur.', sendsInput: false, ready: false },
  { name: 'screen.read', summary: 'Pencereyi ve ekrandaki yazıları okur.', sendsInput: false, ready: false },
]

const TOOLS: ToolDef[] = [flowRead, targetPreview, ...planned]

export function toolList(): ToolSpec[] {
  return TOOLS.map(({ name, summary, sendsInput, ready }) => ({ name, summary, sendsInput, ready }))
}

export async function callTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) return failed(name, `Bilinmeyen araç: ${name}`)
  if (!tool.ready || !tool.run) return failed(name, `“${tool.name}” henüz hazır değil: ${tool.summary}`)
  const input: Args = args && typeof args === 'object' ? (args as Args) : {}
  try {
    return await tool.run(input, ctx)
  } catch (e) {
    const message = `Araç çalıştırılamadı: ${(e as Error).message}`
    ctx.log('error', `Ajan · ${name} · ${message}`)
    return failed(name, message)
  }
}
