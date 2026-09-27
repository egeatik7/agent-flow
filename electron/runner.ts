import {
  NODE_SPECS,
  baseName,
  itemVars,
  listItems,
  portLabel,
  renderTemplate,
  type AgentGraph,
  type AgentNode,
  type LogLevel,
  type StepStatus,
} from './graph-types'
import { loopDoneEdge, loopTail } from './loop-graph'

type RunState = {
  loopCounters: Map<string, number>
  listIndex: Map<string, number>
  vars: Record<string, string>
}

function renderNode(node: AgentNode, vars: Record<string, string>): AgentNode {
  return {
    ...node,
    prompt: renderTemplate(node.prompt, vars),
    text: renderTemplate(node.text, vars),
    keys: renderTemplate(node.keys, vars),
  }
}

/** The next one or two nodes, already filled with the current loop variables. */
export type StepAhead = { next?: AgentNode; then?: AgentNode }

export type Executor = {
  log: (level: LogLevel, message: string) => void
  step: (id: string, status: StepStatus) => void
  shouldStop: () => boolean
  click: (node: AgentNode, stepNo: number, ahead?: StepAhead) => Promise<void>
  type: (node: AgentNode, stepNo: number, ahead?: StepAhead) => Promise<void>
  key: (node: AgentNode, ahead?: StepAhead) => Promise<void>
  exists: (text: string, node: AgentNode) => Promise<boolean>
  /** Called when a list loop moves to another item, so the index can be persisted for resuming. */
  loopProgress?: (id: string, index: number) => void
}

export class StoppedError extends Error {
  constructor() {
    super('Kullanıcı tarafından durduruldu.')
  }
}

export async function interruptibleSleep(ms: number, shouldStop: () => boolean) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (shouldStop()) throw new StoppedError()
    await new Promise((r) => setTimeout(r, Math.min(100, end - Date.now())))
  }
}

export function findEntry(graph: AgentGraph, startId?: string): AgentNode | undefined {
  if (startId) return graph.nodes.find((n) => n.id === startId)
  return (
    graph.nodes.find((n) => n.kind === 'start') ??
    graph.nodes.find((n) => !graph.edges.some((e) => e.to === n.id))
  )
}

export async function runGraph(
  graph: AgentGraph,
  ex: Executor,
  opts: { maxSteps: number; stepDelayMs: number; startId?: string }
): Promise<void> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  let current = findEntry(graph, opts.startId)
  if (!current) throw new Error('Başlangıç node’u bulunamadı.')

  const state: RunState = { loopCounters: new Map(), listIndex: new Map(), vars: { sira: '1' } }
  for (const n of graph.nodes) {
    const items = n.kind === 'loop' ? listItems(n) : []
    if (!items.length) continue
    const idx = (n.loopIndex ?? 0) >= 0 && (n.loopIndex ?? 0) < items.length ? n.loopIndex ?? 0 : 0
    state.listIndex.set(n.id, idx)
    if (Object.keys(state.vars).length <= 1) {
      state.vars = itemVars(items[idx], idx, items.length)
      ex.log(
        'info',
        idx > 0
          ? `“${n.title}” kaldığı yerden devam ediyor: ${idx + 1}/${items.length} (${baseName(items[idx])})`
          : `“${n.title}”: ${items.length} öğe, ilki ${baseName(items[0])}`
      )
    }
  }
  let steps = 0

  while (current) {
    const node: AgentNode = current
    if (ex.shouldStop()) throw new StoppedError()
    if (steps >= opts.maxSteps) {
      throw new Error(
        `En fazla ${opts.maxSteps} adım çalıştırıldı ve durduruldu. Sonsuz döngü olabilir; Ayarlar’dan “Maks. adım” değerini artırabilirsin.`
      )
    }
    steps++
    ex.step(node.id, 'running')

    let port = 'next'
    try {
      const live = node.kind === 'loop' ? node : renderNode(node, state.vars)
      port = await execNode(live, ex, state, steps, opts.stepDelayMs, peekAhead(graph, byId, live, state.vars))
    } catch (e) {
      ex.step(node.id, 'error')
      throw e
    }
    ex.step(node.id, 'done')

    if (node.kind === 'end') {
      ex.log('success', `“${node.title}” ile akış bitti (${steps} adım).`)
      return
    }

    const left = leaveFinishedLoop(graph, byId, node, port, state, ex)
    if (left === 'stop') break
    if (left) {
      current = left
      continue
    }

    if (NODE_SPECS[node.kind].outputs.length === 0) break

    const edge = edgeFrom(graph, node, port)
    if (!edge) {
      ex.log(
        'info',
        `“${node.title}” node’unun “${portLabel(node.kind, port)}” çıkışı bağlı değil, akış burada bitti.`
      )
      break
    }
    current = byId.get(edge.to)
  }
  ex.log('success', `Akış tamamlandı (${steps} adım).`)
}

function edgeFrom(graph: AgentGraph, node: AgentNode, port: string) {
  if (node.kind === 'loop' && port === 'done') return loopDoneEdge(graph, node.id)
  return graph.edges.find((e) => e.from === node.id && e.fromPort === port)
}

/** True while another pass should go back through the loop card. */
function loopStillGoing(node: AgentNode, state: RunState): boolean {
  const items = listItems(node)
  if (items.length) {
    const cur = state.listIndex.get(node.id) ?? 0
    return cur + 1 < items.length
  }
  const total = Math.max(1, node.count ?? 1)
  return (state.loopCounters.get(node.id) ?? 0) < total
}

function closeLoop(node: AgentNode, state: RunState, ex: Executor, fromTitle: string) {
  const items = listItems(node)
  if (items.length) {
    const cur = state.listIndex.get(node.id) ?? 0
    ex.log('success', `Döngü “${node.title}”: ${cur + 1}/${items.length} bitti (${baseName(items[cur] ?? '')})`)
    state.listIndex.set(node.id, 0)
    state.vars = itemVars(items[0], 0, items.length)
    ex.loopProgress?.(node.id, 0)
    ex.log('success', `Döngü “${node.title}”: listedeki ${items.length} öğenin hepsi bitti. Çıkış “${fromTitle}” node’undan.`)
    return
  }
  state.loopCounters.delete(node.id)
  ex.log('info', `Döngü “${node.title}” bitti. Çıkış “${fromTitle}” node’undan.`)
}

/**
 * The last node of the group is about to enter the loop card, and this pass was the final one.
 * Leave from that node’s “bitti” edge instead of finishing on the loop card.
 */
function leaveFinishedLoop(
  graph: AgentGraph,
  byId: Map<string, AgentNode>,
  node: AgentNode,
  port: string,
  state: RunState,
  ex: Executor
): AgentNode | 'stop' | null {
  const hopEdge = graph.edges.find((e) => e.from === node.id && e.fromPort === port)
  const dest = hopEdge ? byId.get(hopEdge.to) : undefined
  if (!dest || dest.kind !== 'loop') return null
  if (loopTail(graph, dest.id) !== node.id) return null
  if (loopStillGoing(dest, state)) return null
  closeLoop(dest, state, ex, node.title)
  const exit = loopDoneEdge(graph, dest.id)
  if (!exit) {
    ex.log('info', `“${node.title}” döngünün son adımı. Turlar bitti, “bitti” çıkışı bağlı değil.`)
    return 'stop'
  }
  return byId.get(exit.to) ?? 'stop'
}

function hop(graph: AgentGraph, byId: Map<string, AgentNode>, from: AgentNode, port: string, vars: Record<string, string>) {
  const edge = graph.edges.find((e) => e.from === from.id && e.fromPort === port)
  const raw = edge ? byId.get(edge.to) : undefined
  return raw ? renderNode(raw, vars) : undefined
}

function peekAhead(graph: AgentGraph, byId: Map<string, AgentNode>, node: AgentNode, vars: Record<string, string>): StepAhead {
  const next = hop(graph, byId, node, 'next', vars)
  if (!next) return {}
  const port = next.kind === 'loop' ? 'loop' : next.kind === 'waitFor' ? 'found' : next.kind === 'condition' ? 'true' : 'next'
  return { next, then: hop(graph, byId, next, port, vars) }
}

async function execNode(
  node: AgentNode,
  ex: Executor,
  state: RunState,
  stepNo: number,
  stepDelayMs: number,
  ahead: StepAhead
): Promise<string> {
  const { loopCounters, listIndex } = state
  const settle = () => interruptibleSleep(stepDelayMs, ex.shouldStop)
  switch (node.kind) {
    case 'start':
      ex.log('info', 'Akış başladı.')
      return 'next'
    case 'click':
      ex.log('info', `[${stepNo}] Tıkla: ${node.prompt || node.locator?.name || node.title}`)
      await ex.click(node, stepNo, ahead)
      await settle()
      return 'next'
    case 'type':
      ex.log('info', `[${stepNo}] Yaz: “${node.text ?? ''}”`)
      await ex.type(node, stepNo, ahead)
      await settle()
      return 'next'
    case 'key':
      ex.log('info', `[${stepNo}] Tuş: ${node.keys}`)
      await ex.key(node, ahead)
      await settle()
      return 'next'
    case 'wait': {
      const ms = Math.max(0, node.ms ?? 0)
      ex.log('info', `[${stepNo}] Zamanlayıcı: ${(ms / 1000).toLocaleString('tr-TR')} sn`)
      await interruptibleSleep(ms, ex.shouldStop)
      return 'next'
    }
    case 'waitFor': {
      const text = (node.text ?? '').trim()
      if (!text) throw new Error(`“${node.title}”: beklenecek öğe metni boş.`)
      const timeout = Math.max(500, node.timeoutMs ?? 15000)
      const until = Date.now() + timeout
      ex.log('info', `[${stepNo}] “${text}” bekleniyor…`)
      while (Date.now() < until) {
        if (await ex.exists(text, node)) {
          ex.log('info', `“${text}” bulundu.`)
          return 'found'
        }
        await interruptibleSleep(700, ex.shouldStop)
      }
      ex.log('warn', `“${text}” ${Math.round(timeout / 1000)} sn içinde görünmedi.`)
      return 'timeout'
    }
    case 'condition': {
      const text = (node.text ?? '').trim()
      if (!text) throw new Error(`“${node.title}”: koşul metni boş.`)
      const found = await ex.exists(text, node)
      ex.log('info', `[${stepNo}] Koşul “${text}”: ${found ? 'var' : 'yok'}`)
      return found ? 'true' : 'false'
    }
    case 'loop': {
      const items = listItems(node)
      if (items.length) {
        // The loop node sits at the end of its body: arriving here means the current item is finished.
        const cur = listIndex.get(node.id) ?? 0
        ex.log('success', `Döngü “${node.title}”: ${cur + 1}/${items.length} bitti (${baseName(items[cur] ?? '')})`)
        const next = cur + 1
        if (next < items.length) {
          listIndex.set(node.id, next)
          state.vars = itemVars(items[next], next, items.length)
          ex.loopProgress?.(node.id, next)
          ex.log('info', `Sıradaki öğe ${next + 1}/${items.length}: ${baseName(items[next])}`)
          return 'loop'
        }
        listIndex.set(node.id, 0)
        state.vars = itemVars(items[0], 0, items.length)
        ex.loopProgress?.(node.id, 0)
        ex.log('success', `Döngü “${node.title}”: listedeki ${items.length} öğenin hepsi bitti.`)
        return 'done'
      }
      const total = Math.max(1, node.count ?? 1)
      const done = loopCounters.get(node.id) ?? 0
      if (done < total) {
        loopCounters.set(node.id, done + 1)
        state.vars = { ...state.vars, sira: String(done + 2) }
        ex.log('info', `Döngü “${node.title}”: ${done + 1}/${total}`)
        return 'loop'
      }
      loopCounters.delete(node.id)
      ex.log('info', `Döngü “${node.title}” bitti.`)
      return 'done'
    }
    case 'end':
      return 'end'
  }
}
