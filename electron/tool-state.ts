/**
 * What the tool layer knows about a run.
 *
 * Filled from the step events and error lines the engine already emits, so nothing here
 * guesses: which node is running, what it reported, and — through the flow's own context
 * resolver — which box and which item the run is on. Pure data: no Electron, no engine, so it
 * can be tested on its own.
 *
 * The step counts are what the tool layer *observed*, not the runner's own tally; they are
 * named `steps` so a caller never mistakes them for the run's official summary.
 */
import type { AgentGraph } from './graph-types'
import { contextOf, findPlace, type LoopContext } from './tool-context'

export type RunSnapshot = {
  /** The node the engine last reported as running, or the probed node. */
  nodeId?: string
  nodeTitle?: string
  /** Observed step results, not the runner's tally. */
  steps: { done: number; errors: number }
  lastError?: string
  startedAt?: number
  /** Boxes around that node, outermost first. */
  loops: LoopContext[]
  packagePath: string[]
  probing: boolean
}

let run: { graph: AgentGraph; at: number } | null = null
let probe: { nodeId: string; at: number } | null = null
let current: string | undefined
let done = 0
let errors = 0
let lastError: string | undefined

export function beginRun(graph: AgentGraph): void {
  run = { graph, at: Date.now() }
  probe = null
  current = undefined
  done = 0
  errors = 0
  lastError = undefined
}

export function endRun(): void {
  run = null
  current = undefined
}

export function beginProbe(nodeId: string): void {
  probe = { nodeId, at: Date.now() }
}

export function endProbe(): void {
  probe = null
}

export function probing(): boolean {
  return !!probe
}

/** A step event from the engine: `{ id, status }`. */
export function noteStep(payload: unknown): void {
  const p = payload as { id?: unknown; status?: unknown } | null
  if (!p || typeof p.id !== 'string') return
  if (p.status === 'running') current = p.id
  if (p.status === 'done') {
    done++
    if (current === p.id) current = undefined
  }
  if (p.status === 'error') errors++
}

export function noteError(message: string): void {
  lastError = message
}

export function snapshot(): RunSnapshot {
  const nodeId = current ?? probe?.nodeId
  const graph = run?.graph
  const place = graph && nodeId ? findPlace(graph, nodeId) : null
  const context = graph && nodeId ? contextOf(graph, nodeId) : null
  return {
    nodeId,
    nodeTitle: place?.node.title,
    steps: { done, errors },
    lastError,
    startedAt: run?.at ?? probe?.at,
    loops: context?.loops ?? [],
    packagePath: context?.packagePath ?? [],
    probing: !!probe,
  }
}
