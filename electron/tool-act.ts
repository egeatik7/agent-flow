/**
 * Tek tek eylemler: "şuna tıkla", "bunu yaz", "şu tuşu gönder", "şu kadar bekle".
 *
 * Bu, akış kurmadan çalışmanın kapısıdır. Her çağrı **tek kullanımlık bir grafik** kurar (tek
 * node), motoru o grafiğin bir kopyasında koşturur ve o node bitince zinciri motorun kendi durdurma
 * denetimiyle keser. Tuval, branch, kayıtlı akış hiç görülmez: hiçbir şey yazılmaz. Motorun hedef
 * bulma, odak, güvenlik ve durdurma yolları aynen kullanılır — ayrı bir tıklayıcı yoktur.
 */
import { createNode, type AgentGraph, type AgentNode, type NodeKind } from './graph-types'
import { probeOnce } from './tool-probe'
import type { Executor } from './runner'

export type ActKind = 'click' | 'type' | 'key' | 'wait'

export type ActSpec = {
  kind: ActKind
  title: string
  fields: Record<string, unknown>
}

export type ActResult = {
  /** The node reported done or error before the chain was stopped by us. */
  status: 'done' | 'error' | 'none'
  interrupted: boolean
  ms: number
  /** Whether the action itself was reported as done by the node. */
  acted: boolean
}

/** The node a single action needs, and the one-node graph it runs in. Nothing else. */
export function actionGraph(spec: ActSpec): { graph: AgentGraph; node: AgentNode } {
  const node = createNode(spec.kind as NodeKind, 200, 0, 1)
  node.title = spec.title
  for (const [k, v] of Object.entries(spec.fields)) {
    if (v !== undefined && v !== null) (node as unknown as Record<string, unknown>)[k] = v
  }
  const start = createNode('start', 0, 0)
  return { graph: { nodes: [start, node], edges: [{ id: 'act-e1', from: start.id, fromPort: 'next', to: node.id }] }, node }
}

/**
 * Runs one action through the engine. The caller supplies the executor, so the guards, the stop and
 * the settings are exactly the ones a normal run uses; the trace callback carries the engine's own
 * events out, so the caller can describe which stage found which target in the usual way.
 */
export async function runAction(
  spec: ActSpec,
  executor: Executor,
  opts: { maxSteps: number; stepDelayMs: number; userStop?: () => boolean; onTrace?: (event: unknown) => void }
): Promise<ActResult> {
  const { graph, node } = actionGraph(spec)
  let done = false
  const wrapped: Executor = {
    ...executor,
    shouldStop: () => done || !!opts.userStop?.(),
    step: (id, status) => {
      executor.step(id, status)
      if (id === node.id && (status === 'done' || status === 'error')) done = true
    },
  }
  const started = Date.now()
  const res = await probeOnce(graph, node.id, wrapped, {
    maxSteps: opts.maxSteps,
    stepDelayMs: opts.stepDelayMs,
    userStop: () => done || !!opts.userStop?.(),
  })
  return { status: res.nodeStatus, interrupted: res.interrupted, ms: Date.now() - started, acted: res.nodeStatus === 'done' }
}
