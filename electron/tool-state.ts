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
let debugRun = false
let stopOnError: (() => void) | null = null
let frozen: FrozenReport | null = null
/** Reports of earlier runs, newest first: a new run must not erase what the last one found. */
let archive: FrozenReport[] = []
const ARCHIVE_MAX = 3
const STEP_RING = 60
const LOG_RING = 200

export type StepLine = { id: string; status: string; at: number }

export type FrozenReport = {
  /** Which run this belongs to, and which failure inside it: two runs must never be mixed up. */
  runId: string
  failureId: string
  /** A failed step, or a failure of the run itself that produced no step event. */
  kind: 'step' | 'run'
  at: number
  nodeId: string
  nodeTitle: string
  /** The engine's own message. Empty until it arrives, which the pending flag says. */
  error: string
  errorPending: boolean
  loops: { title: string; index?: number; total?: number; item?: string }[]
  packagePath: string[]
  steps: StepLine[]
  log: { level: string; text: string }[]
  /** The error screenshot, handed over by whoever writes it: a path, verbatim, or empty. */
  shot: string
  shotPending: boolean
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
  // A new run starts clean: its own steps and its own log. The previous report is kept aside by
  // its run id instead of being overwritten, and the screenshot of the old failure goes with it.
  if (frozen) {
    archive = [frozen, ...archive].slice(0, ARCHIVE_MAX)
    frozen = null
  }
  lines = []
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
  if (debugRun && status === 'error') openFailure(p.id, 'step')
}

/**
 * Opens the record of the failure a debug run is stopped for.
 *
 * It is opened at the step event, because that is the only moment the loop item and the package
 * path are still true, but the engine's real message and its screenshot arrive a moment later -
 * through the log and through the screenshot writer. So the record starts incomplete and is
 * completed by whichever of those comes, as long as it belongs to the same run and the same
 * failure. A user's Stop is not a failure and never opens one.
 */
function openFailure(nodeId: string, kind: 'step' | 'run', message?: string): void {
  if (frozen || !run) return
  const snap = snapshot()
  frozen = {
    runId: run.id,
    failureId: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    kind,
    at: Date.now(),
    nodeId: nodeId || snap.nodeId || '',
    nodeTitle: snap.nodeTitle ?? '',
    error: message ?? '',
    errorPending: !message,
    loops: snap.loops,
    packagePath: snap.packagePath,
    steps: [...steps].slice(-20),
    log: [...lines].slice(-40),
    shot: '',
    shotPending: true,
  }
  // Either way this is a failure, and a debug run stops at the next boundary for it: the message
  // may still be on its way, which is exactly why the record starts incomplete.
  stopOnError?.()
}

/** The engine's own message for the failure that is open: the real one, not the previous one. */
export function completeFailure(message: string): void {
  if (!frozen || !frozen.errorPending) return
  frozen.error = message
  frozen.errorPending = false
}

/** A runner-level failure that never produced a step event (a broken output, a thrown error). */
export function noteRunFailed(message: string): void {
  if (!debugRun) return
  if (frozen) {
    completeFailure(message)
    return
  }
  openFailure(current ?? '', 'run', message)
}

/**
 * The error screenshot, handed over by the code that writes it: a path, verbatim, whether it is
 * png or jpg, with spaces or not. An empty path means the picture could not be taken at all, and
 * that is what the report will say instead of guessing from a log line.
 */
export function noteFailureShot(file: string): void {
  if (!frozen) return
  frozen.shot = String(file || '')
  frozen.shotPending = false
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
}

/** Called when a debug run breaks: the app stops the run at the next boundary. */
export function setErrorStopHook(fn: (() => void) | null): void {
  stopOnError = fn
}

/** The frozen context of the moment a debug run broke: the current one, or an earlier one by run. */
export function frozenReport(runId?: string): FrozenReport | null {
  if (!runId) return frozen
  if (frozen?.runId === runId) return frozen
  return archive.find((r) => r.runId === runId) ?? null
}

/** The reports of earlier runs, newest first: a new run must not overwrite what the last one found. */
export function recentReports(): FrozenReport[] {
  return [...(frozen ? [frozen] : []), ...archive]
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
