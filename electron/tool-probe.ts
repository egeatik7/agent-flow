/**
 * One isolated step.
 *
 * The node runs through the real engine — same target finding, same focus, same guards, same
 * stop path — but on a copy of the flow, and the chain is stopped through the engine's own
 * stop check as soon as that node reports that it finished. Nothing is written back: the box
 * tick, the node memory, the recorded paths and the run tally all live in the copy, which is
 * thrown away. This is the same way "Seçiliden Çalıştır" resumes a run; there is no second
 * clicker that bypasses the engine's controls.
 */
import type { AgentGraph } from './graph-types'
import { runGraph, StoppedError, type Executor } from './runner'

export type ProbeResult = {
  /** The node itself reported done or error before the chain was stopped. */
  reachedNode: boolean
  nodeStatus: 'done' | 'error' | 'none'
  /** The stop came from somewhere else: the user, or a timeout. */
  interrupted: boolean
  /** The run's own summary, when the chain ended on its own. */
  summary?: { steps: number; failed: number }
}

export type ProbeOptions = {
  packagePath?: string[]
  maxSteps: number
  stepDelayMs: number
  userStop?: () => boolean
}

export async function probeOnce(graph: AgentGraph, nodeId: string, ex: Executor, opts: ProbeOptions): Promise<ProbeResult> {
  const copy = structuredClone(graph)
  let stopAfter = false
  let nodeStatus: 'done' | 'error' | 'none' = 'none'

  const executor: Executor = {
    ...ex,
    shouldStop: () => stopAfter || !!opts.userStop?.(),
    step: (id, status) => {
      ex.step(id, status)
      if (id === nodeId && (status === 'done' || status === 'error')) {
        stopAfter = true
        nodeStatus = status
      }
    },
  }

  try {
    const summary = await runGraph(copy, executor, {
      maxSteps: opts.maxSteps,
      stepDelayMs: opts.stepDelayMs,
      startId: nodeId,
      resume: true,
      packagePath: opts.packagePath?.length ? opts.packagePath : undefined,
    })
    // The chain ended on its own: this node was the last step of its chain.
    return { reachedNode: nodeStatus !== 'none', nodeStatus, interrupted: false, summary: { steps: summary.steps, failed: summary.failed } }
  } catch (e) {
    if (e instanceof StoppedError) return { reachedNode: stopAfter, nodeStatus, interrupted: !stopAfter }
    throw e
  }
}
