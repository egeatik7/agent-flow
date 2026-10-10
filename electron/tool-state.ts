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

export type StepLine = { id: string; status: string; at: number }

/**
 * A box around the node carries everything a resume needs - which box, which item, and the
 * variables resolved for it - and `LoopContext` from the context reader is already that shape.
 */
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
  /** Steps that were sent but whose reaction was not clear: they need a look. */
  review?: number
  lastReview?: string
  /** Steps a person stopped. Counted apart from errors: a stop is not a failure. */
  stopped?: number
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
/**
 * Why the run stopped: the person asked, a debug failure, or a bounded region test reaching the
 * node it was told to stop after. Three very different things that must not be reported as one.
 */
let stoppedBy: 'user' | 'debug-error' | 'until' | null = null
/** The node a bounded test stops after, once it has finished. */
let stopAt: string | null = null
let stopAtHook: (() => void) | null = null
let frozen: FrozenReport | null = null
/** Steps a person stopped, counted apart from errors: a stop is not a failure (CLAUDE.md §4). */
let stoppedSteps = 0
/** Steps whose reaction was not clear: sent, but nothing confirmed. They need a look. */
let review = 0
let lastReview = ''
/** Reports of earlier runs, newest first: a new run must not erase what the last one found. */
let archive: FrozenReport[] = []
const ARCHIVE_MAX = 3
const STEP_RING = 60
const LOG_RING = 200

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
  loops: LoopContext[]
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
  // A bounded test belongs to one run: the boundary and the reason start clean every time.
  stopAt = null
  stoppedBy = null
  review = 0
  stoppedSteps = 0
  lastReview = ''
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
  if (p.status === 'error') if (stopReason() === 'user') stoppedSteps++
    else errors++
  steps.push({ id: p.id, status, at: Date.now() })
  if (steps.length > STEP_RING) steps.splice(0, steps.length - STEP_RING)
  // A bounded region test stops once the node it was told to stop after has finished, so nothing
  // beyond the region being repaired runs.
  if (status === 'done' && stopAt && p.id === stopAt) {
    stoppedBy = 'until'
    stopAtHook?.()
  }
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
  // Yorumun söylediği kural burada uygulanır: kullanıcının Durdur'u asla kayıt açmaz.
  // Adım olayı yolu da buradan geçer, o yüzden koruma tek yerde durur.
  if (stopReason() === 'user') return
  const snap = snapshot()
  // A failed output can arrive after done cleared current. Resolve the failure's
  // explicit ID rather than losing its title, package path and current loop item.
  const failedId = nodeId || snap.nodeId || ''
  const place = failedId ? findPlace(run.graph, failedId) : null
  const context = failedId ? contextOf(run.graph, failedId) : null
  frozen = {
    runId: run.id,
    failureId: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    kind,
    at: Date.now(),
    nodeId: failedId,
    nodeTitle: place?.node.title ?? snap.nodeTitle ?? '',
    error: message ?? '',
    errorPending: !message,
    loops: context?.loops ?? snap.loops,
    packagePath: context?.packagePath ?? snap.packagePath,
    steps: [...steps].slice(-20),
    log: [...lines].slice(-40),
    shot: '',
    shotPending: true,
  }
  // Either way this is a failure, and a debug run stops at the next boundary for it: the message
  // may still be on its way, which is exactly why the record starts incomplete.
  stoppedBy = 'debug-error'
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
  // Kullanıcı durdurduysa bu bir arıza değildir: donmuş hata oluşturulmaz (CLAUDE.md §4).
  if (stopReason() === 'user') return
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
  // The previous report is NOT cleared here. Turning debug on happens before a run begins
  // (setDebugRun then beginRun), so clearing it here destroyed the record before beginRun could put
  // it aside - a second debug run wiped the first one's evidence. beginRun archives it instead.
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

/**
 * "Bakılması gereken" adımlar.
 *
 * Motor, tepkisi net olmayan bir eylemden sonra akışı bozmaz: uyarır ve devam eder. Bu doğru bir
 * politika, ama sonuç "0 hata" diye okununca yalan söylenmiş olur — bir kez bizzat yaşandı: tıklama
 * ıskaladı, akış devam etti, sonuç temiz göründü, ekranda ise hiçbir şey olmamıştı. Bu yüzden bu
 * satırlar sayılır ve sonuç "bakılmalı" diye söylenir.
 */
export function noteReview(message: string): void {
  review += 1
  lastReview = message
}

export function reviewCount(): number {
  return review
}

export function lastReviewLine(): string {
  return lastReview
}

/** Called when a bounded region test reaches the node it was told to stop after. */
export function setStopAtHook(fn: (() => void) | null): void {
  stopAtHook = fn
}

export function setStopAt(nodeId: string | null): void {
  stopAt = nodeId ? String(nodeId) : null
}

/** Sınırlı bölge testi istendi mi: sınır node'u hâlâ bekliyor mu (ulaşılmadıysa dolu kalır). */
export function boundaryPending(): boolean {
  return stopAt !== null
}

export function stopReason(): 'user' | 'debug-error' | 'until' | null {
  return stoppedBy
}

/** The person asked to stop: not a failure, and not a bounded test either. */
export function noteUserStop(): void {
  stoppedBy = 'user'
}

/**
 * The frozen context of the moment a debug run broke.
 *
 * Without a run id this is the current failure, or - if a later run has already happened - the most
 * recent one kept aside. That is what a repair needs: run, freeze, try a bounded region, and still
 * be able to continue from the failure that started it. The run id is always reported with it, so
 * an answer can say which run it belongs to and two runs are never mixed up.
 */
export function frozenReport(runId?: string): FrozenReport | null {
  if (!runId) return frozen ?? archive[0] ?? null
  if (frozen?.runId === runId) return frozen
  return archive.find((r) => r.runId === runId) ?? null
}

/** The last few step lines, so a caller can see what ran and what a stop cut off. */
export function recentSteps(n = 6): { id: string; status: string }[] {
  return steps.slice(-n).map((s) => ({ id: s.id, status: s.status }))
}

export function recentLogLines(n = 60): { level: string; text: string; at: number }[] {
  return lines.slice(-Math.max(0, Math.min(200, n))).map(line => ({ ...line }))
}

/** The reports of earlier runs, newest first: a new run must not overwrite what the last one found. */
export function recentReports(): FrozenReport[] {
  return [...(frozen ? [frozen] : []), ...archive]
}

/**
 * Where the last single action aimed. It is a hint for telling two same-named controls apart in the
 * next action, never an answer on its own, and it is forgotten after a minute - long enough for a
 * Win+R, type, Enter sequence, short enough not to leak into unrelated work.
 */
let actPoint: { x: number; y: number; at: number } | null = null

export function noteActPoint(p: { x: number; y: number }): void {
  actPoint = { x: p.x, y: p.y, at: Date.now() }
}

export function actPointWithin(ms: number): { x: number; y: number } | null {
  if (!actPoint || Date.now() - actPoint.at > ms) return null
  return { x: actPoint.x, y: actPoint.y }
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
    /** Steps whose reaction was unclear: sent, but unconfirmed. "0 hata" alone would mislead. */
    review,
    /** Steps a person stopped. Kept out of `errors` on purpose. */
    stopped: stoppedSteps,
    lastReview: lastReview || undefined,
  }
}
