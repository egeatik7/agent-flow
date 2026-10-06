/**
 * What the tool layer knows about runs.
 *
 * Filled from the step events and error lines the engine already emits, so nothing here
 * guesses: which node is running, what it reported, and — through the flow's own context
 * resolver — which box and which item the run is on. Pure data: no Electron, no engine, so it
 * can be tested on its own.
 *
 * Two kinds of numbers live here and they are named apart on purpose:
 *   observed  what this layer watched go by (step events), good for "where am I now";
 *   official  the run's own summary, good for "how did it end".
 */
import type { AgentGraph } from './graph-types'
import { contextOf, findPlace, type LoopContext } from './tool-context'

export type RunResult = {
  runId: string
  ok: boolean
  /** Failed loop items or turns, from the run's own summary. */
  failed?: number
  /** Steps the run counted, from the run's own summary. */
  steps?: number
  stopped?: boolean
  error?: string
  startedAt: number
  endedAt: number
  startId?: string
}

export type RunSnapshot = {
  runId?: string
  /** The node the engine last reported as running, or the probed node. */
  nodeId?: string
  nodeTitle?: string
  /** Step events this layer watched: not the run's own tally. */
  observed: { done: number; errors: number }
  lastError?: string
  startedAt?: number
  /** Boxes around that node, outermost first. */
  loops: LoopContext[]
  packagePath: string[]
  probing: boolean
  /** How the previous run ended, kept after it is over. */
  last: RunResult | null
}

let run: { graph: AgentGraph; at: number; id: string; startId?: string } | null = null
let probe: { nodeId: string; at: number } | null = null
let current: string | undefined
let done = 0
let errors = 0
let lastError: string | undefined
let last: RunResult | null = null
let seq = 0

function newRunId(): string {
  seq += 1
  return `r${Date.now().toString(36)}-${seq.toString(36)}`
}

/** Starts recording a run and returns its id. */
export function beginRun(graph: AgentGraph, startId?: string): string {
  const id = newRunId()
  run = { graph, at: Date.now(), id, startId }
  probe = null
  current = undefined
  done = 0
  errors = 0
  lastError = undefined
  return id
}

/** Ends the run and keeps how it ended, so a caller can still ask after it finished. */
export function endRun(result?: { ok?: boolean; failed?: number; steps?: number; stopped?: boolean; error?: string }): void {
  if (run) {
    last = {
      runId: run.id,
      ok: result?.ok ?? false,
      failed: result?.failed,
      steps: result?.steps,
      stopped: result?.stopped,
      error: result?.error,
      startedAt: run.at,
      endedAt: Date.now(),
      startId: run.startId,
    }
  }
  run = null
  current = undefined
}

export function runId(): string | undefined {
  return run?.id
}

/**
 * Claims the single-step slot. Returns false when another step is already running, and it
 * decides that without awaiting anything, so two callers cannot both get through.
 */
export function beginProbe(nodeId: string): boolean {
  if (probe) return false
  probe = { nodeId, at: Date.now() }
  return true
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
    runId: run?.id,
    nodeId,
    nodeTitle: place?.node.title,
    observed: { done, errors },
    lastError,
    startedAt: run?.at ?? probe?.at,
    loops: context?.loops ?? [],
    packagePath: context?.packagePath ?? [],
    probing: !!probe,
    last,
  }
}
