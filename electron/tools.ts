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
  NODE_SPECS,
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
import { beginProbe, endProbe, probing, snapshot } from './tool-state'

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
  /** Every box around the node, outermost first (run.state). */
  loopChain?: LoopRef[]
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
  /** True while the user's own stop is in effect. */
  userStop: () => boolean
  /** Sends the transient canvas highlight. Nothing else may be written by a tool. */
  sendStep: (payload: unknown) => void
  /** What an outside caller may do without asking. The panel is never gated. */
  permission: () => 'off' | 'ask' | 'auto'
  /** Asks the person in front of the app. Resolves false when refused or not answered. */
  askApproval: (summary: string) => Promise<boolean>
  /** The user's own stop, for `run.stop`. */
  requestStop: () => void
}

/** `panel` is a person pressing a button in the app, which is its own approval. */
export type ToolSource = 'panel' | 'agent'

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
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

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
  label?: string
  x?: number
  y?: number
  stages: { stage: string; candidates?: number }[]
}

/** Turns the resolution trace the engine already emits into a plain sentence. */
function describeTrace(traces: TargetTrace[]): TraceSummary {
  const stages: { stage: string; candidates?: number }[] = []
  const counts = new Map<string, number>()
  let stage: string | undefined
  let window = ''
  let label: string | undefined
  let x: number | undefined
  let y: number | undefined
  for (const t of traces) {
    if (t.kind === 'request') window = t.windowTitle || ''
    if (t.kind === 'observation') {
      const n = t.scan?.items?.length
      stages.push({ stage: t.source, candidates: n })
      if (typeof n === 'number') counts.set(t.source, n)
    }
    if (t.kind === 'resolved') {
      stage = t.source
      label = t.item?.text || t.target.label
      x = t.target.x
      y = t.target.y
    }
  }
  const seen = stages
    .filter((s) => s.candidates !== undefined)
    .map((s) => `${s.stage} ${s.candidates}`)
    .join(', ')
  const text = seen ? `Basamaklar: ${seen}.` : 'Hiçbir basamak aday listesi vermedi.'
  return { text, stage, window, candidates: stage ? counts.get(stage) : undefined, label, x, y, stages }
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

const flowContext: ToolDef = {
  name: 'flow.context',
  summary: 'Bir node’un paket yolunu, içindeki kutuları ve o anki öğeyi söyler.',
  sendsInput: false,
  ready: true,
  run: async (args, ctx) => {
    const graph = graphOf(args, ctx)
    const nodeId = text(args.nodeId)
    if (!nodeId) return failed(flowContext.name, 'nodeId gerekli.')
    const place = findPlace(graph, nodeId)
    if (!place) return failed(flowContext.name, `Node bulunamadı: ${nodeId}`)
    const context = contextOf(graph, nodeId)
    const chain = context?.loops ?? []
    const parts = [`“${place.node.title}”`]
    parts.push(place.packagePath.length ? `${place.packagePath.length} katman paket içinde` : 'kök seviyesinde')
    if (chain.length) {
      const last = chain[chain.length - 1]
      parts.push(
        `kutular: ${chain
          .map((l) => `${l.title}${typeof l.index === 'number' ? ` ${l.index + 1}/${l.total}` : ''}${l.item ? ` (“${l.item}”)` : ''}`)
          .join(' › ')}`
      )
      // A folder-backed box fills its list while it runs, so the saved item is a placeholder.
      if (last.templated || last.folder) parts.push('dikkat: bu kutunun öğe listesi çalışırken klasörden doldurulur')
    }
    parts.push('Yazma yok.')
    const message = parts.join(' · ')
    ctx.log('info', `Ajan · bağlam · ${message}`)
    return {
      ok: true,
      tool: flowContext.name,
      outcome: 'tamam',
      message,
      node: nodeRef(place),
      loop: chain.length ? chain[chain.length - 1] : undefined,
      loopChain: chain,
      data: { packagePath: place.packagePath, loops: chain },
    }
  },
}

const stepRun: ToolDef = {
  name: 'step.run',
  summary: 'Tek adım: seçilen node’u mevcut motorla çalıştırır, akışı ilerletmez.',
  sendsInput: true,
  ready: true,
  run: async (args, ctx) => {
    const graph = graphOf(args, ctx)
    const nodeId = text(args.nodeId)
    if (!nodeId) return failed(stepRun.name, 'nodeId gerekli.')
    if (ctx.isRunning()) return failed(stepRun.name, 'Bir koşu sürüyor; tek adım için önce durdur.')
    if (probing()) return failed(stepRun.name, 'Başka bir tek adım sürüyor.')
    const place = findPlace(graph, nodeId)
    if (!place) return failed(stepRun.name, `Node bulunamadı: ${nodeId}`)
    const node = place.node
    if (node.kind === 'start' || node.kind === 'end') {
      return failed(stepRun.name, `“${NODE_SPECS[node.kind].label}” node’u tek adımda çalıştırılmaz.`)
    }
    const loop = loopOf(graph, nodeId)
    const s = ctx.getSettings()
    const timeoutMs = Math.min(15 * 60_000, Math.max(5_000, num(args.timeoutMs) ?? 120_000))
    const { createAgent } = await import('./agent')
    const { probeOnce } = await import('./tool-probe')
    const logs: string[] = []
    const traces: TargetTrace[] = []
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    beginProbe(nodeId)
    try {
      const agent = createAgent({
        log: (level, message) => {
          if (logs.length < 200) logs.push(`${level}: ${message}`)
          ctx.log(level, message)
        },
        send: (channel, payload) => {
          // Only the transient step highlight reaches the canvas: a probe writes nothing.
          if (channel === 'agent:step') ctx.sendStep(payload)
        },
        settings: ctx.getSettings,
        shouldStop: () => timedOut || ctx.userStop(),
        setLoop: () => {},
        setMethod: () => {},
        onTargetTrace: (event) => {
          if (traces.length < 200) traces.push(event)
        },
        captureTargetImages: false,
      })
      timer = setTimeout(() => {
        timedOut = true
      }, timeoutMs)
      const started = Date.now()
      const r = await probeOnce(graph, nodeId, agent.executor, {
        packagePath: place.packagePath,
        maxSteps: Math.max(1, s.maxSteps),
        stepDelayMs: Math.max(0, s.stepDelayMs),
        userStop: () => timedOut || ctx.userStop(),
      })
      const ms = Date.now() - started
      const t = describeTrace(traces)
      const acted = traces.some((e) => e.kind === 'input')

      if (r.interrupted) {
        const why = timedOut ? `süre doldu (${Math.round(timeoutMs / 1000)} sn)` : 'kullanıcı durdurdu'
        const message = `“${node.title}” çalıştırılamadı: ${why}.`
        ctx.log('warn', `Ajan · tek adım · ${message}`)
        return { ok: true, tool: stepRun.name, outcome: 'durduruldu', message, node: nodeRef(place), action: { kind: node.kind, sent: acted }, loop, log: logs.slice(-12) }
      }

      const parts = [`“${node.title}” çalıştırıldı.`]
      if (t.stage) {
        parts.push(
          `Hedef: ${t.stage}${t.candidates !== undefined ? ` · ${t.candidates} aday` : ''}${t.label ? ` · “${t.label}”` : ''}${
            typeof t.x === 'number' ? ` (${Math.round(t.x)}, ${Math.round(t.y ?? 0)})` : ''
          }.`
        )
      }
      parts.push(acted ? 'Eylem gönderildi.' : 'Eylem gönderilmedi.')
      if (loop) parts.push(`Döngü: ${loop.title}${typeof loop.index === 'number' ? ` · ${loop.index + 1}/${loop.total}` : ''}${loop.item ? ` (“${loop.item}”)` : ''}.`)
      parts.push(`Zincir bu adımdan sonra durduruldu (${ms} ms); akış ilerlemedi.`)
      const message = parts.join(' ')
      ctx.log('info', `Ajan · tek adım · ${message}`)
      return {
        ok: true,
        tool: stepRun.name,
        outcome: 'tamam',
        message,
        node: nodeRef(place),
        target: t.stage ? { found: true, stage: t.stage, label: t.label, x: t.x, y: t.y, window: t.window, candidates: t.candidates } : undefined,
        action: { kind: node.kind, sent: acted },
        observed: { note: 'Tek adım: kopya akış üzerinde koştu; işaret, hafıza ve kayıtlı yol değişmedi.' },
        loop,
        log: logs.slice(-12),
        data: { ms, reachedNode: r.reachedNode, nodeStatus: r.nodeStatus },
      }
    } catch (e) {
      const reason = (e as Error).message
      const outcome: ToolOutcome = /bulunamadı/.test(reason) ? 'hedef-yok' : 'hata'
      const message = `“${node.title}” çalıştırılamadı: ${reason}`
      ctx.log(outcome === 'hedef-yok' ? 'warn' : 'error', `Ajan · tek adım · ${message}`)
      return { ok: true, tool: stepRun.name, outcome, message, node: nodeRef(place), action: { kind: node.kind, sent: false }, loop, log: logs.slice(-12) }
    } finally {
      if (timer) clearTimeout(timer)
      endProbe()
    }
  },
}

const runStop: ToolDef = {
  name: 'run.stop',
  summary: 'Çalışan koşuyu durdurur.',
  sendsInput: false,
  ready: true,
  run: async (_args, ctx) => {
    ctx.requestStop()
    const message = 'Durdurma istendi; koşu bir sonraki adımın başında durur.'
    ctx.log('warn', `Ajan · durdur · ${message}`)
    return { ok: true, tool: runStop.name, outcome: 'tamam', message }
  },
}

const runState: ToolDef = {
  name: 'run.state',
  summary: 'Koşunun hangi node’da, hangi kutuda, hangi öğede olduğunu söyler.',
  sendsInput: false,
  ready: true,
  run: async (_args, ctx) => {
    const s = snapshot()
    const running = ctx.isRunning()
    const chain = s.loops.map((l) => `${l.title}${typeof l.index === 'number' ? ` ${l.index + 1}/${l.total}` : ''}${l.item ? ` (“${l.item}”)` : ''}`)
    const parts: string[] = []
    if (s.probing) parts.push(`Tek adım sürüyor: “${s.nodeTitle ?? s.nodeId ?? '—'}”.`)
    else if (running) parts.push(`Koşu sürüyor: “${s.nodeTitle ?? s.nodeId ?? '—'}”.`)
    else parts.push('Şu an koşu yok.')
    if (chain.length) parts.push(`Kutular: ${chain.join(' › ')}.`)
    if (s.packagePath.length) parts.push(`Paket: ${s.packagePath.length} katman derinde.`)
    if (s.steps.done || s.steps.errors) parts.push(`Gözlenen adımlar: ${s.steps.done} tamam, ${s.steps.errors} hata.`)
    if (ctx.userStop()) parts.push('Durdurma isteği açık.')
    if (s.lastError) parts.push(`Son hata: ${s.lastError}`)
    const message = parts.join(' ')
    if (running || s.probing) ctx.log('info', `Ajan · durum · ${message}`)
    return {
      ok: true,
      tool: runState.name,
      outcome: 'tamam',
      message,
      loop: s.loops.length ? s.loops[s.loops.length - 1] : undefined,
      loopChain: s.loops,
      data: {
        running,
        probing: s.probing,
        stopRequested: ctx.userStop(),
        nodeId: s.nodeId,
        nodeTitle: s.nodeTitle,
        packagePath: s.packagePath,
        steps: s.steps,
        lastError: s.lastError,
        startedAt: s.startedAt,
        ms: s.startedAt ? Date.now() - s.startedAt : undefined,
      },
    }
  },
}

/** Announced in the panel, refused with a clear reason until they are built. */
const planned: ToolDef[] = [
  { name: 'run.from', summary: 'Belirtilen node’dan akışı sürdürür.', sendsInput: true, ready: false },
  { name: 'screen.read', summary: 'Pencereyi ve ekrandaki yazıları okur.', sendsInput: false, ready: false },
]

const TOOLS: ToolDef[] = [flowRead, flowContext, targetPreview, stepRun, runState, runStop, ...planned]

export function toolList(): ToolSpec[] {
  return TOOLS.map(({ name, summary, sendsInput, ready }) => ({ name, summary, sendsInput, ready }))
}

export async function callTool(name: string, args: unknown, ctx: ToolContext, source: ToolSource = 'agent'): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) return failed(name, `Bilinmeyen araç: ${name}`)
  if (!tool.ready || !tool.run) return failed(name, `“${tool.name}” henüz hazır değil: ${tool.summary}`)
  const input: Args = args && typeof args === 'object' ? (args as Args) : {}

  // An outside caller has to earn the right to touch the desktop; the panel already has it.
  if (source === 'agent' && tool.sendsInput) {
    const mode = ctx.permission()
    if (mode === 'off') return failed(name, `“${tool.name}” için ajan izni kapalı. Ajan sekmesinden açabilirsin.`)
    if (mode === 'ask') {
      const what = typeof input.nodeId === 'string' ? ` (node ${input.nodeId})` : ''
      const approved = await ctx.askApproval(`${tool.summary}${what}`)
      if (!approved) {
        ctx.log('warn', `Ajan · ${name} · onay verilmedi.`)
        return { ok: false, tool: name, outcome: 'durduruldu', message: 'Bu çağrı için onay verilmedi.' }
      }
    }
  }

  try {
    return await tool.run(input, ctx)
  } catch (e) {
    const message = `Araç çalıştırılamadı: ${(e as Error).message}`
    ctx.log('error', `Ajan · ${name} · ${message}`)
    return failed(name, message)
  }
}
