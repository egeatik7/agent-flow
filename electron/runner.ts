import {
  NODE_SPECS,
  portLabel,
  type AgentGraph,
  type AgentNode,
  type LogLevel,
  type StepStatus,
} from './graph-types'

export type Executor = {
  log: (level: LogLevel, message: string) => void
  step: (id: string, status: StepStatus) => void
  shouldStop: () => boolean
  click: (node: AgentNode, stepNo: number) => Promise<void>
  type: (node: AgentNode, stepNo: number) => Promise<void>
  key: (node: AgentNode) => Promise<void>
  exists: (text: string, node: AgentNode) => Promise<boolean>
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

  const loopCounters = new Map<string, number>()
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
      port = await execNode(node, ex, loopCounters, steps, opts.stepDelayMs)
    } catch (e) {
      ex.step(node.id, 'error')
      throw e
    }
    ex.step(node.id, 'done')

    if (node.kind === 'end') {
      ex.log('success', `“${node.title}” ile akış bitti (${steps} adım).`)
      return
    }
    if (NODE_SPECS[node.kind].outputs.length === 0) break

    const edge = graph.edges.find((e) => e.from === node.id && e.fromPort === port)
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

async function execNode(
  node: AgentNode,
  ex: Executor,
  loopCounters: Map<string, number>,
  stepNo: number,
  stepDelayMs: number
): Promise<string> {
  const settle = () => interruptibleSleep(stepDelayMs, ex.shouldStop)
  switch (node.kind) {
    case 'start':
      ex.log('info', 'Akış başladı.')
      return 'next'
    case 'click':
      ex.log('info', `[${stepNo}] Tıkla: ${node.prompt || node.locator?.name || node.title}`)
      await ex.click(node, stepNo)
      await settle()
      return 'next'
    case 'type':
      ex.log('info', `[${stepNo}] Yaz: “${node.text ?? ''}”`)
      await ex.type(node, stepNo)
      await settle()
      return 'next'
    case 'key':
      ex.log('info', `[${stepNo}] Tuş: ${node.keys}`)
      await ex.key(node)
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
      const total = Math.max(1, node.count ?? 1)
      const done = loopCounters.get(node.id) ?? 0
      if (done < total) {
        loopCounters.set(node.id, done + 1)
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
