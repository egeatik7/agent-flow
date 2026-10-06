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
/** The last steps in order, the engine's log lines and what a broken debug run looked like. */
let steps: { id: string; status: string; at: number }[] = []
let lines: { level: string; text: string; at: number }[] = []
let lastShot = ''
let debugRun = false
let stopOnError: (() => void) | null = null
let frozen: FrozenReport | null = null
const STEP_RING = 60
const LOG_RING = 200

export type StepLine = { id: string; status: string; at: number }

export type FrozenReport = {
  at: number
  nodeId: string
  nodeTitle: string
  error: string
  loops: { title: string; index?: number; total?: number; item?: string }[]
  packagePath: string[]
  steps: StepLine[]
  log: { level: string; text: string }[]
  /** The error screenshot the engine saved, if its log line named one. */
  shot: string
}

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
  steps = []
  frozen = null
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
  // Debug mode belongs to one run; the frozen report of that run stays readable afterwards.
  debugRun = false
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
  const status = typeof p.status === 'string' ? p.status : ''
  if (p.status === 'running') current = p.id
  if (p.status === 'done') {
    done++
    if (current === p.id) current = undefined
  }
  if (p.status === 'error') errors++
  steps.push({ id: p.id, status, at: Date.now() })
  if (steps.length > STEP_RING) steps.splice(0, steps.length - STEP_RING)
  // A debug run keeps the moment it broke: the loop item, the package path and the error are all
  // still true only right now. Within a step of this, the flow moves on to the next file.
  if (debugRun && status === 'error' && !frozen) {
    const snap = snapshot()
    frozen = {
      at: Date.now(),
      nodeId: p.id,
      nodeTitle: snap.nodeTitle ?? '',
      error: snap.lastError ?? '',
      loops: snap.loops,
      packagePath: snap.packagePath,
      steps: [...steps].slice(-20),
      log: [...lines].slice(-40),
      shot: lastShot,
    }
    // Stop the run at the next step boundary, so nothing after the failure happens by itself.
    stopOnError?.()
  }
}

export function noteError(message: string): void {
  lastError = message
}

/** Debug mode: stop at the first failed step and keep everything that was true at that moment. */
export function setDebugRun(on: boolean): void {
  debugRun = on
  if (on) frozen = null
}

export function isDebugRun(): boolean {
  return debugRun
}

/** The engine's own log lines, kept in memory: a report can quote them without reading a file. */
export function noteLogLine(level: string, text: string): void {
  lines.push({ level, text, at: Date.now() })
  if (lines.length > LOG_RING) lines.splice(0, lines.length - LOG_RING)
  const shot = /([A-Za-z]:\\[^\s"']+\.png)/.exec(text)
  if (shot) lastShot = shot[1]
}

/** Called when a debug run breaks: the app stops the run at the next boundary. */
export function setErrorStopHook(fn: (() => void) | null): void {
  stopOnError = fn
}

/** The frozen context of the moment a debug run broke, if it did. */
export function frozenReport(): FrozenReport | null {
  return frozen
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
